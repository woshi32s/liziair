#!/usr/bin/env python
# -*- coding: utf-8 -*-
"""
LIZI · VST3 离线处理宿主（常驻 Python 进程）
=============================================================================
职责只有三件：
  1) 扫描本机 VST3 插件（文件系统列目录；?probe=1 全量探测，?probe=<路径> 只探测一个）
  2) 用 pedalboard 把一个音频文件跑过某个插件，写 16-bit PCM WAV
  3) 把结果用 JSON 回给 server.mjs

为什么不让 Python 自己去抓网络音频：server.mjs 那边有 AUDIO_HOSTS 白名单，
音频必须由 server.mjs 抓完落在 runtime/vst/in/ 再传路径进来。这个进程只认
本机绝对路径，绝不 fetch 任意 URL —— 否则白名单形同虚设（SSRF）。
插件路径同样只允许落在标准 VST3 目录（或 LIZI_VST3_DIRS）里，不接受任意 DLL。

启动：由 services/vst-host/start.mjs 用 runtime/vst/venv 里的 python 拉起
      （也可以手动 `python host.py`，会绑随机回环端口并写同目录 .port）
停止：父进程死了自己退（2 秒轮询一次父 pid）。

2026-11-17 第一版：只做离线渲染，不做实时 AudioStream / 插件 GUI。
"""
import ctypes
import json
import os
import sys
import threading
import time
import traceback
import wave
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from urllib.parse import urlparse, parse_qs

HERE = os.path.dirname(os.path.abspath(__file__))
PORT_FILE = os.path.join(HERE, '.port')
LOG_PREFIX = '[vst-host]'

# pedalboard 很大（JUCE + VST3 SDK），导入失败时宁可明确退出，也不要起一个空壳：
# server.mjs 会读到 "直接退出" 并把 .log 尾巴带回前端，用户知道该装依赖。
try:
    import numpy as np
    import pedalboard
    from pedalboard import load_plugin
    from pedalboard.io import AudioFile
except Exception as _import_err:  # noqa: BLE001
    print(f'{LOG_PREFIX} FATAL 无法导入 pedalboard：{_import_err!r}', flush=True)
    print(f'{LOG_PREFIX} 先执行：python -m pip install -r requirements.txt（venv 在 runtime/vst/venv）', flush=True)
    sys.exit(1)

PB_VERSION = getattr(pedalboard, '__version__', 'unknown')

# 同一时刻只处理一个：插件经常吃满多核/几 GB 内存，两个并行渲染会把机器拖死。
# 扫描时“真正 load_plugin”的那几下也用这把锁，避免探测和渲染同时加载插件。
_RENDER_LOCK = threading.Lock()

# pluginPath → 已加载实例。插件加载实测 1–20 秒，每次渲染都重载太浪费；
# 处理前 reset() 清状态，preset/params 每次重新设置，所以复用是安全的。
_plugin_cache = {}
_plugin_cache_lock = threading.Lock()

# 扫描结果进程内缓存：列目录很快，但 probe 要 load_plugin，可能几十秒，不能每次重来。
_scan_cache = None
_scan_lock = threading.Lock()


# ---------------------------------------------------------------------------
# VST3 目录与扫描
# ---------------------------------------------------------------------------
def vst_roots():
    """标准目录 + LIZI_VST3_DIRS（分号分隔）。只收真实存在的目录。"""
    roots = [
        r'C:\Program Files\Common Files\VST3',
        r'C:\Program Files (x86)\Common Files\VST3',
        os.path.join(os.environ.get('LOCALAPPDATA', ''), 'Programs', 'Common', 'VST3'),
    ]
    for p in os.environ.get('LIZI_VST3_DIRS', '').split(';'):
        p = p.strip()
        if p:
            roots.append(p)
    out, seen = [], set()
    for r in roots:
        if not r:
            continue
        r = os.path.abspath(os.path.expandvars(r))
        key = os.path.normcase(r)
        if os.path.isdir(r) and key not in seen:
            seen.add(key)
            out.append(r)
    return out


def _walk_vst3(top, depth, found, seen):
    if depth > 3:
        return
    try:
        entries = list(os.scandir(top))
    except OSError:
        return
    for e in entries:
        # .vst3 既可能是目录包（Xxx.vst3/Contents/...），也可能是一个文件包
        if e.name.lower().endswith('.vst3'):
            key = os.path.normcase(os.path.abspath(e.path))
            if key in seen:
                continue
            seen.add(key)
            found.append(e.path)
        elif e.is_dir(follow_symlinks=False):
            # 厂商子目录（如 FabFilter/Pro-Q 4.vst3）继续往下，但不进 .vst3 包内部
            _walk_vst3(e.path, depth + 1, found, seen)


def scan_plugins():
    """列文件系统，不加载。name 先填文件名（去掉 .vst3）。"""
    with _scan_lock:
        global _scan_cache
        if _scan_cache is not None:
            return _scan_cache
        paths = []
        seen = set()
        for root in vst_roots():
            _walk_vst3(root, 0, paths, seen)
        _scan_cache = [{
            'path': p,
            'name': os.path.splitext(os.path.basename(p))[0],
            'vendor': '',
            'version': '',
            'probed': False,
        } for p in paths]
        return _scan_cache


def probe_plugin(entry, force=False):
    """真正 load_plugin 拿 name/vendor/version。失败只标记，不弄死进程。

    2026-11-17：加 force —— 单插件探测是用户明确点名要读，之前失败过的条目也重试一次。
    """
    if entry.get('probed') and not force:
        return
    if force:
        entry.pop('probeError', None)
    try:
        with _RENDER_LOCK:
            plugin = load_plugin(entry['path'])
            # pedalboard 0.9.26 没有 .vendor（调研文档写的是旧版 API），厂家在
            # .manufacturer_name。每个字段单独兜底，一个字段缺失不能毁掉整条探测记录。
            for field, attrs in (
                ('name', ('name', 'descriptive_name')),
                ('vendor', ('manufacturer_name', 'vendor')),
                ('version', ('version',)),
            ):
                for a in attrs:
                    try:
                        v = getattr(plugin, a)
                    except Exception:  # noqa: BLE001
                        v = ''
                    if v:
                        entry[field] = v
                        break
            entry['probed'] = True
    except Exception as e:  # noqa: BLE001
        entry['probed'] = True
        entry['probeError'] = str(e)[:300]


# ---------------------------------------------------------------------------
# 路径校验
# ---------------------------------------------------------------------------
def _under(path, roots):
    try:
        p = os.path.normcase(os.path.realpath(path))
    except OSError:
        return False
    for r in roots:
        try:
            rr = os.path.normcase(os.path.realpath(r))
        except OSError:
            continue
        if p == rr or p.startswith(rr + os.sep):
            return True
    return False


def plugin_allowed(path):
    """只允许从扫描目录加载，防止把任意本机 DLL 当 VST3 塞进来。"""
    return (os.path.isfile(path) or os.path.isdir(path)) and _under(path, vst_roots())


def resolve_probe_target(raw):
    """2026-11-17 单插件探测：把 probe 参数解析成候选路径。

    绝对路径原样用；相对路径按每个扫描根尝试拼接（正/反斜杠两种写法都试）。
    第二个返回值是安全结论：
      - 有一个候选 realpath 后落在扫描根之内 → (该候选, True)；
      - 全都越界 → (原样候选, False)，调用方回 400。
    所以 `..\\..\\Windows\\System32\\x.dll`、或绝对路径指向别处都会被挡住，
    probe 参数不会变成「加载任意 DLL」的代码执行入口。
    """
    raw = (raw or '').strip()
    roots = vst_roots()
    if os.path.isabs(raw):
        cands = [raw]
    else:
        rels = [raw]
        alt = raw.replace('/', '\\')
        if alt != raw:
            rels.append(alt)
        cands = [os.path.join(r, rel) for r in roots for rel in rels]
    for c in cands:
        if _under(c, roots):
            return os.path.abspath(c), True
    return (os.path.abspath(cands[0]) if cands else raw), False


def probe_one(path):
    """2026-11-17 只探测一个插件，返回对外条目（去掉内部 probed 字段）。

    结果直接落在 _scan_cache 的同一条目上：之后再列全表就带着 name/vendor/version，
    不用再 load 一次。已经成功探测过的直接复用；之前报错的才重试。
    扫描没列到的路径（例如层级更深）只探测、不塞进缓存，避免污染全量列表。
    """
    key = os.path.normcase(os.path.abspath(path))
    entry = None
    for e in scan_plugins():          # 只是列目录，很快；顺带保证缓存已建立
        if os.path.normcase(os.path.abspath(e['path'])) == key:
            entry = e
            break
    if entry is None:
        entry = {
            'path': path,
            'name': os.path.splitext(os.path.basename(path))[0],
            'vendor': '',
            'version': '',
            'probed': False,
        }
    if not os.path.exists(path):
        # 不存在就别去 load 了，load_plugin 的报错对用户没有信息量
        entry['probed'] = True
        entry['probeError'] = '路径不存在：' + path
    elif entry.get('probed') and entry.get('probeError'):
        probe_plugin(entry, force=True)
    else:
        probe_plugin(entry)
    return {k: v for k, v in entry.items() if k != 'probed'}


# ---------------------------------------------------------------------------
# 渲染
# ---------------------------------------------------------------------------
def _get_plugin(plugin_path):
    key = os.path.normcase(os.path.abspath(plugin_path))
    with _plugin_cache_lock:
        inst = _plugin_cache.get(key)
    if inst is None:
        inst = load_plugin(plugin_path)   # 可能很慢，锁外面加载也能接受：渲染锁已经串行化了
        with _plugin_cache_lock:
            _plugin_cache[key] = inst
    return inst


def _apply_params(plugin, params):
    """参数名不认识就跳过并回报，不要让整次渲染失败。"""
    applied, skipped = {}, {}
    if not isinstance(params, dict):
        return applied, skipped
    known = getattr(plugin, 'parameters', {}) or {}
    for name, value in params.items():
        if name not in known:
            skipped[name] = '该插件没有这个参数'
            continue
        if isinstance(value, (dict, list, tuple)) or value is None:
            skipped[name] = '参数值必须是数字、布尔或字符串'
            continue
        try:
            setattr(plugin, name, value)
            # 回显**调用方传的值**。pedalboard 的 getattr 拿回来的是归一化 raw_value
            # （传 mix=100，读回 0.5），直接回报会让人以为没生效。
            applied[name] = value
        except Exception as e:  # noqa: BLE001
            skipped[name] = str(e)[:200]
    return applied, skipped


def _write_wav_16(path, audio, sample_rate):
    """float32 (channels, frames) → 16-bit PCM WAV。用标准库 wave，位深确定。"""
    data = np.asarray(audio, dtype=np.float32)
    if data.ndim == 1:
        data = data[np.newaxis, :]
    channels = int(data.shape[0])
    frames = int(data.shape[1])
    clipped = np.clip(data.T, -1.0, 1.0)                 # (frames, channels)
    ints = np.round(clipped * 32767.0).astype('<i2')
    parent = os.path.dirname(os.path.abspath(path))
    if parent:
        os.makedirs(parent, exist_ok=True)
    with wave.open(path, 'wb') as w:
        w.setnchannels(channels)
        w.setsampwidth(2)
        w.setframerate(int(sample_rate))
        w.writeframes(ints.tobytes())
    return channels, frames


def do_render(payload):
    input_path = payload.get('inputPath') or ''
    plugin_path = payload.get('pluginPath') or ''
    out_path = payload.get('outPath') or ''
    params = payload.get('params') or {}
    preset = payload.get('preset') or ''

    if not input_path or not os.path.isfile(input_path):
        raise ValueError('inputPath 不存在：' + str(input_path))
    if not plugin_path or not os.path.exists(plugin_path):
        raise ValueError('pluginPath 不存在：' + str(plugin_path))
    if not plugin_allowed(plugin_path):
        raise ValueError('pluginPath 不在允许的 VST3 目录内：' + str(plugin_path))
    if not out_path:
        raise ValueError('缺少 outPath')
    if preset and not os.path.isfile(preset):
        raise ValueError('preset 文件不存在：' + str(preset))

    started = time.time()
    with _RENDER_LOCK:
        plugin = _get_plugin(plugin_path)
        try:
            plugin.reset()
        except Exception:  # noqa: BLE001  个别插件不实现 reset，不影响处理
            pass
        if preset:
            plugin.load_preset(preset)         # .vstpreset，插件自己解析
        applied, skipped = _apply_params(plugin, params)

        with AudioFile(input_path) as af:
            sample_rate = int(af.samplerate)
            num_in_channels = int(af.num_channels)
            audio = af.read(af.frames)         # (channels, frames) float32

        # reset=True 清掉上一首留下的延迟线/混响尾巴
        processed = plugin.process(audio, sample_rate, reset=True)

    channels, frames = _write_wav_16(out_path, processed, sample_rate)
    elapsed_ms = int((time.time() - started) * 1000)
    return {
        'ok': True,
        'outPath': out_path,
        'durationMs': int(frames / sample_rate * 1000) if sample_rate else 0,
        'elapsedMs': elapsed_ms,
        'sampleRate': sample_rate,
        'channels': channels,
        'inChannels': num_in_channels,
        'appliedParams': applied,
        'skippedParams': skipped,
        'plugin': getattr(plugin, 'name', '') or os.path.basename(plugin_path),
    }


# ---------------------------------------------------------------------------
# HTTP 面
# ---------------------------------------------------------------------------
class Handler(BaseHTTPRequestHandler):
    protocol_version = 'HTTP/1.1'
    server_version = 'LiziVstHost/1.0'

    def log_message(self, fmt, *args):  # 压掉默认的每请求一行
        pass

    def _send(self, code, obj):
        body = json.dumps(obj, ensure_ascii=False).encode('utf-8')
        try:
            self.send_response(code)
            self.send_header('Content-Type', 'application/json; charset=utf-8')
            self.send_header('Content-Length', str(len(body)))
            self.end_headers()
            self.wfile.write(body)
        except (BrokenPipeError, ConnectionResetError):
            pass

    def _read_json(self):
        try:
            n = int(self.headers.get('Content-Length') or 0)
        except ValueError:
            n = 0
        if n <= 0:
            return {}
        if n > 4 * 1024 * 1024:
            raise ValueError('请求体过大')
        raw = self.rfile.read(n)
        return json.loads(raw.decode('utf-8') or '{}')

    def do_GET(self):  # noqa: N802
        try:
            u = urlparse(self.path)
            if u.path == '/health':
                return self._send(200, {'ok': True, 'pedalboard': PB_VERSION, 'pid': os.getpid()})
            if u.path == '/plugins':
                # 2026-11-17 三种取值：
                #   无 / 0 / false / no → 只列文件系统，不加载；
                #   1 / true / yes      → 旧的全量探测（逐个 load，慢，向后兼容）；
                #   其它                → 单插件探测，只 load 这一个（可能是相对路径）。
                raw_probe = (parse_qs(u.query).get('probe') or [''])[0].strip()
                low = raw_probe.lower()
                full_probe = low in ('1', 'true', 'yes')
                off = not low or low in ('0', 'false', 'no')
                if not off and not full_probe:
                    target, inside = resolve_probe_target(raw_probe)
                    if not inside:
                        return self._send(400, {
                            'ok': False,
                            'error': 'probe 路径不在允许的 VST3 目录内：' + raw_probe,
                        })
                    return self._send(200, {'plugins': [probe_one(target)], 'probed': True})
                items = scan_plugins()
                if full_probe:
                    for entry in items:
                        probe_plugin(entry)   # 逐个 load，慢，但只在明确要求时发生
                return self._send(200, {
                    'plugins': [{k: v for k, v in e.items() if k != 'probed'} for e in items],
                    'probed': full_probe,
                    'roots': vst_roots(),
                })
            if u.path == '/':
                return self._send(200, {'ok': True, 'endpoints': ['/health', '/plugins', '/render']})
            return self._send(404, {'ok': False, 'error': 'not found: ' + u.path})
        except Exception as e:  # noqa: BLE001
            traceback.print_exc()
            return self._send(500, {'ok': False, 'error': str(e)})

    def do_POST(self):  # noqa: N802
        try:
            u = urlparse(self.path)
            if u.path == '/render':
                payload = self._read_json()
                result = do_render(payload)
                return self._send(200, result)
            return self._send(404, {'ok': False, 'error': 'not found: ' + u.path})
        except Exception as e:  # noqa: BLE001
            # 单个坏插件/坏文件只失败这一次请求，进程继续接下一单
            traceback.print_exc()
            return self._send(500, {'ok': False, 'error': str(e)})

    # 未实现的方法也回 JSON：默认实现会给一段 HTML，前端解析不了
    def _method_not_allowed(self):
        return self._send(405, {'ok': False, 'error': 'method not allowed: ' + self.command})

    do_PUT = _method_not_allowed
    do_DELETE = _method_not_allowed
    do_PATCH = _method_not_allowed
    do_OPTIONS = _method_not_allowed


# ---------------------------------------------------------------------------
# 端口文件 / 父进程守护
# ---------------------------------------------------------------------------
def write_port(port):
    tmp = PORT_FILE + '.tmp'
    with open(tmp, 'w', encoding='ascii') as f:
        f.write(str(port))
        f.flush()
        os.fsync(f.fileno())
    os.replace(tmp, PORT_FILE)


def cleanup_port():
    try:
        os.remove(PORT_FILE)
    except OSError:
        pass


def parent_alive(pid):
    if pid <= 0:
        return True
    if os.name != 'nt':
        try:
            os.kill(pid, 0)
            return True
        except OSError:
            return False
    k32 = ctypes.WinDLL('kernel32', use_last_error=True)
    k32.OpenProcess.restype = ctypes.c_void_p
    k32.OpenProcess.argtypes = [ctypes.c_uint32, ctypes.c_bool, ctypes.c_uint32]
    k32.WaitForSingleObject.argtypes = [ctypes.c_void_p, ctypes.c_uint32]
    k32.WaitForSingleObject.restype = ctypes.c_uint32
    k32.CloseHandle.argtypes = [ctypes.c_void_p]
    PROCESS_QUERY_LIMITED_INFORMATION = 0x1000
    SYNCHRONIZE = 0x00100000
    WAIT_TIMEOUT = 0x102
    h = k32.OpenProcess(SYNCHRONIZE | PROCESS_QUERY_LIMITED_INFORMATION, False, int(pid))
    if not h:
        return False          # 打不开 = 进程已经没了（ERROR_INVALID_PARAMETER）
    try:
        return k32.WaitForSingleObject(h, 0) == WAIT_TIMEOUT
    finally:
        k32.CloseHandle(h)


def start_parent_watch():
    """主服务 / start.mjs 死了必须跟着退，否则会留下一个占着端口、吃着内存的孤儿。
    不用 stdin 读 EOF 那套：Windows 上 stdio 是管道时行为不可靠。

    要盯多个 pid：Python 3.13 的 venv python.exe 自己是 launcher，os.getppid() 拿到的是
    launcher（start.mjs 被杀后它还活着）；而 VST_PARENT_PID 才是真正的主服务。
    任何一个没了都退。2026-11-17"""
    pids = []
    for key in ('VST_PARENT_PID', 'LIZI_VST_LAUNCHER_PID'):
        try:
            p = int(os.environ.get(key) or 0)
        except ValueError:
            p = 0
        if p > 0 and p != os.getpid() and p not in pids:
            pids.append(p)
    fallback = os.getppid()
    if fallback > 0 and fallback not in pids:
        pids.append(fallback)
    if not pids:
        return
    print(f'{LOG_PREFIX} 父进程守护：{pids}', flush=True)

    def watch():
        while True:
            time.sleep(2)
            dead = [p for p in pids if not parent_alive(p)]
            if dead:
                print(f'{LOG_PREFIX} 父进程 {dead[0]} 已退出，本进程跟着退出', flush=True)
                cleanup_port()
                os._exit(0)

    t = threading.Thread(target=watch, name='parent-watch', daemon=True)
    t.start()


def main():
    srv = ThreadingHTTPServer(('127.0.0.1', 0), Handler)
    srv.daemon_threads = True
    port = srv.server_address[1]
    write_port(port)
    # server.mjs 从 .port 读端口，这一行给 .log 留个可读的就绪记录
    print(f'{LOG_PREFIX} listening 127.0.0.1:{port} (pedalboard {PB_VERSION}, pid {os.getpid()})', flush=True)

    start_parent_watch()

    try:
        srv.serve_forever()
    except KeyboardInterrupt:
        pass
    finally:
        cleanup_port()


if __name__ == '__main__':
    main()
