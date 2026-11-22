#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
LIZI 形态长廊预览截图（2026-11-21）

用法（务必用 -I 运行，避免脚本目录污染 import）：
    python -I tools/capture-previews.py
    python -I tools/capture-previews.py --ids 659,660,691
    python -I tools/capture-previews.py --force

做什么：
  1) 在脚本内起一个静态服务器（默认 127.0.0.1:8765，占用则顺延），根目录 public/；
  2) 用 Playwright Chromium 打开 stages/<id>-*.html；
  3) 按宿主协议注入 init，并用页面内定时器持续发 tick / beat / live；
  4) 960x540 截图，PIL 检查灰度标准差（<5 视为纯色失败），最多 3 次
     （默认时间 0s / 12s / 24s；672、679、681 这三个形态用 16.5s 先截）；
  5) 缩到 480x270 存 JPEG quality=88 到 public/forms-labs/previews/<id>.jpg；
     若极简画面 q88 压到 8KB 以下，回退 q95 + 4:4:4（不优化 huffman）。
  已存在的预览图一律跳过（除非 --force）。

只读形态 HTML / app.js / CSS，不修改任何形态源码。
"""

import argparse
import io
import json
import os
import re
import sys
import threading
import time
import traceback
from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path

from PIL import Image, ImageStat
from playwright.sync_api import sync_playwright

ROOT = Path(__file__).resolve().parent.parent
PUBLIC = ROOT / "public"
PREVIEWS = PUBLIC / "forms-labs" / "previews"
STAGES = PUBLIC / "stages"

CAPTURE_W, CAPTURE_H = 960, 540
TARGET_W, TARGET_H = 480, 270
JPEG_QUALITY = 88
MIN_STD = 5.0
MIN_BYTES = 8 * 1024

MISSING_IDS = [
    "659", "660", "661", "662", "663", "664", "665", "666", "667", "668",
    "669", "670", "671", "672", "673", "674", "675", "676", "677", "678",
    "679", "680", "681", "682", "683", "684", "685", "686", "687", "688",
    "689", "690", "691", "692", "693", "695", "696", "697", "698", "699",
    "700",
]

# 6 句中文示例歌词（宿主协议同款字段：t / dur / text / chars）
LINES = [
    {"t": 0.0, "dur": 4.2, "text": "风从站台尽头吹来", "chars": None},
    {"t": 4.2, "dur": 3.8, "text": "把名字吹成一片海", "chars": None},
    {"t": 8.0, "dur": 4.2, "text": "列车穿过无声的夜", "chars": None},
    {"t": 12.2, "dur": 4.0, "text": "灯影落在你的侧脸", "chars": None},
    {"t": 16.2, "dur": 4.6, "text": "我们把时间慢慢唱完", "chars": None},
    {"t": 20.8, "dur": 4.2, "text": "下一站还会有光", "chars": None},
]

SONG = {
    "id": "preview",
    "name": "夜行列车",
    "title": "夜行列车",
    "album": "午夜漫游",
    "artists": "示例歌手",
    "artist": "示例歌手",
    "cover": "/site/img/00-logo.png",
    "coverUrl": "/site/img/00-logo.png",
}

ACCENT = [122, 162, 247]
DURATION = 240

# (跳转到第几秒, 注入后等待毫秒)
ATTEMPTS = [
    (0.0, 6000),
    (12.0, 3500),
    (24.0, 3500),
]

# 极简形态：默认帧只有一两行字/纯白纸，先试画面元素更多的后段歌词。
PER_ID_ATTEMPTS = {
    "672": [(16.5, 3000), (0.0, 6000), (12.0, 3500)],
    "679": [(16.5, 3000), (0.0, 6000), (12.0, 3500)],
    "681": [(16.5, 3000), (12.0, 3500), (24.0, 3500)],
}

HOST_RE = re.compile(r"\bid:\s*'(\d{3})'[^}]*?\burl:\s*'(stages/[^']+)'")


def log(msg):
    print(msg, flush=True)


def build_stage_map(ids=None):
    """从 public/app.js 提取 id -> stages/xxx.html，找不到再 glob。"""
    mapping = {}
    app_js = PUBLIC / "app.js"
    if app_js.exists():
        text = app_js.read_text(encoding="utf-8", errors="replace")
        for m in HOST_RE.finditer(text):
            mapping.setdefault(m.group(1), m.group(2))
    for sid in (ids or MISSING_IDS):
        if sid in mapping:
            continue
        cands = sorted(
            p.name for p in STAGES.glob(sid + "-*.html")
            if ".bak" not in p.name
        )
        if len(cands) == 1:
            mapping[sid] = "stages/" + cands[0]
        elif cands:
            # 优先取 app.js 里没提到的第一个，剩下的记下来
            mapping[sid] = "stages/" + cands[0]
    return mapping


class QuietHandler(SimpleHTTPRequestHandler):
    def log_message(self, fmt, *args):
        pass


def start_server(preferred=8765):
    for port in range(preferred, preferred + 40):
        try:
            srv = ThreadingHTTPServer(
                ("127.0.0.1", port),
                lambda *a, **kw: QuietHandler(*a, directory=str(PUBLIC), **kw),
            )
            srv.daemon_threads = True
            threading.Thread(target=srv.serve_forever, daemon=True).start()
            return srv, port
        except OSError:
            continue
    raise RuntimeError("8765-8804 没有可用端口")


def inject_js(offset_sec):
    payload = {
        "song": SONG,
        "accent": ACCENT,
        "lines": LINES,
        "duration": DURATION,
    }
    return """
(() => {
  const payload = %s;
  const send = (type, p) => window.postMessage({ __c100: 1, type, payload: p }, '*');
  const base = performance.now() - %d;
  let beatIdx = -1;
  const tick = () => {
    const t = (performance.now() - base) / 1000;
    send('tick', { time: Math.round(t * 1000) / 1000, playing: true });
    const bi = Math.floor(t / 0.5);
    if (bi !== beatIdx) {
      beatIdx = bi;
      send('beat', { index: bi, level: 0.55 + 0.35 * Math.abs(Math.sin(bi * 1.7)) });
    }
    send('live', {
      bpm: 120, playing: true,
      level: 0.5 + 0.5 * Math.sin(t * 1.7),
      bass: 0.5 + 0.5 * Math.sin(t * 1.1 + 1.2),
      mid: 0.5 + 0.5 * Math.sin(t * 2.3 + 2.4),
      treble: 0.5 + 0.5 * Math.sin(t * 3.1 + 3.6),
    });
  };
  send('init', payload);
  tick();
  if (window.__previewTimer) clearInterval(window.__previewTimer);
  window.__previewTimer = setInterval(tick, 100);
  return true;
})()
""" % (json.dumps(payload, ensure_ascii=False), int(offset_sec * 1000))


def analyze_png(png_bytes):
    img = Image.open(io.BytesIO(png_bytes)).convert("RGB")
    gray = img.convert("L")
    stat = ImageStat.Stat(gray)
    std = float(stat.stddev[0])
    mean = float(stat.mean[0])
    return img, std, mean


def save_jpeg(img, dest):
    small = img.resize((TARGET_W, TARGET_H), Image.LANCZOS)
    buf = io.BytesIO()
    small.save(buf, format="JPEG", quality=JPEG_QUALITY, optimize=True)
    data = buf.getvalue()
    if len(data) < MIN_BYTES:
        # 纯白纸/纯黑舞台 + 两三个字这种极简画面，q88 4:2:0 会压到 8KB 以下。
        # 用 q95 + 4:4:4 + 不做 huffman 优化，尽量保住高频细节（仍是正常 JPEG）。
        buf = io.BytesIO()
        small.save(buf, format="JPEG", quality=95, optimize=False, subsampling=0)
        data = buf.getvalue()
    dest.parent.mkdir(parents=True, exist_ok=True)
    tmp = dest.with_suffix(".jpg.tmp")
    tmp.write_bytes(data)
    os.replace(tmp, dest)
    return len(data)


def capture_one(context, page_url, offset_sec, wait_ms):
    page = context.new_page()
    errors = []
    page.on("pageerror", lambda exc: errors.append("pageerror: " + str(exc)))
    page.on(
        "console",
        lambda msg: errors.append("console.error: " + msg.text)
        if msg.type == "error" else None,
    )
    result = {"ok": False, "reason": "", "errors": errors}
    try:
        try:
            page.goto(page_url, wait_until="load", timeout=30000)
        except Exception as e:
            result["reason"] = "page load timeout: " + str(e).split("\n")[0]
            # 页面可能已经可交互，继续尝试
        try:
            page.wait_for_timeout(350)
            page.evaluate("document.fonts && document.fonts.ready")
        except Exception:
            pass
        page.evaluate(inject_js(offset_sec))
        page.wait_for_timeout(wait_ms)
        try:
            page.evaluate(
                "() => new Promise(r => requestAnimationFrame(() => requestAnimationFrame(r)))"
            )
        except Exception:
            pass
        png = page.screenshot(type="png", full_page=False, timeout=20000)
        img, std, mean = analyze_png(png)
        result.update({"std": round(std, 2), "mean": round(mean, 2), "png": png})
        if std < MIN_STD:
            result["reason"] = "near-solid image (std %.2f, mean %.2f)" % (std, mean)
            return result
        result["img"] = img
        result["ok"] = True
        return result
    except Exception as e:
        result["reason"] = "capture error: " + str(e).split("\n")[0]
        result["errors"] = errors
        return result
    finally:
        try:
            page.close()
        except Exception:
            pass


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--ids", default="")
    ap.add_argument("--force", action="store_true")
    ap.add_argument("--port", type=int, default=8765)
    args = ap.parse_args()

    ids = [x.strip() for x in args.ids.split(",") if x.strip()] or MISSING_IDS
    stage_map = build_stage_map(ids)

    srv, port = start_server(args.port)
    base = "http://127.0.0.1:%d" % port
    log("静态服务器: %s  (public/)" % base)

    todo, missing = [], []
    for sid in ids:
        dest = PREVIEWS / (sid + ".jpg")
        if dest.exists() and not args.force:
            log("[skip] %s 已存在" % sid)
            continue
        url = stage_map.get(sid)
        if not url or not (PUBLIC / url).exists():
            missing.append(sid)
            continue
        todo.append((sid, url))

    log("待截 %d 个；无形态页 %d 个" % (len(todo), len(missing)))
    if missing:
        log("无形态页: " + ", ".join(missing))

    ok, failed = [], []
    t_start = time.time()

    with sync_playwright() as p:
        browser = p.chromium.launch(
            headless=True,
            args=[
                "--enable-unsafe-swiftshader",
                "--disable-background-timer-throttling",
                "--disable-renderer-backgrounding",
                "--disable-backgrounding-occluded-windows",
                "--hide-scrollbars",
                "--mute-audio",
                "--force-device-scale-factor=1",
            ],
        )
        context = browser.new_context(
            viewport={"width": CAPTURE_W, "height": CAPTURE_H},
            device_scale_factor=1,
            is_mobile=False,
            has_touch=False,
            locale="zh-CN",
            timezone_id="Asia/Shanghai",
            color_scheme="dark",
            reduced_motion="no-preference",
        )
        # 只允许本地服务器 / data / blob，避免外网字体或资源把加载拖死
        def route_handler(route):
            u = route.request.url
            if u.startswith(base) or u.startswith(("data:", "blob:", "about:")):
                route.continue_()
            else:
                route.abort()

        context.route("**/*", route_handler)

        for idx, (sid, rel) in enumerate(todo, 1):
            dest = PREVIEWS / (sid + ".jpg")
            page_url = base + "/" + rel
            log("[%d/%d] %s  %s" % (idx, len(todo), sid, rel))
            last_reason = ""
            last_errors = []
            done = False
            attempts = PER_ID_ATTEMPTS.get(sid, ATTEMPTS)
            for attempt_no, (offset, wait_ms) in enumerate(attempts, 1):
                res = capture_one(context, page_url, offset, wait_ms)
                last_errors = res.get("errors") or []
                if res["ok"]:
                    size = save_jpeg(res["img"], dest)
                    if size < MIN_BYTES:
                        last_reason = "JPEG too small (%d B)" % size
                        log("    attempt %d: %s" % (attempt_no, last_reason))
                        continue
                    ok.append(sid)
                    log(
                        "    ok  attempt %d  t=%.0fs  std=%.1f mean=%.1f  %d KB"
                        % (attempt_no, offset, res["std"], res["mean"], size // 1024)
                    )
                    done = True
                    break
                last_reason = res["reason"]
                log("    attempt %d failed: %s" % (attempt_no, last_reason))
            if not done:
                failed.append(
                    {
                        "id": sid,
                        "url": rel,
                        "reason": last_reason,
                        "errors": last_errors[:5],
                    }
                )

        browser.close()

    srv.shutdown()

    elapsed = time.time() - t_start
    log("")
    log("=" * 60)
    log("成功 %d / %d，失败 %d，无形态页 %d，用时 %.1fs"
        % (len(ok), len(todo), len(failed), len(missing), elapsed))
    if failed:
        log("失败明细：")
        for f in failed:
            log("  %s  %s  -> %s" % (f["id"], f["url"], f["reason"]))
            for e in f["errors"]:
                log("      " + e[:200])
    log("分辨率 %dx%d（960x540 渲染后 LANCZOS 缩放），JPEG q=%d（极简图回退 q95/4:4:4）"
        % (TARGET_W, TARGET_H, JPEG_QUALITY))
    return 1 if failed else 0


if __name__ == "__main__":
    try:
        sys.exit(main())
    except KeyboardInterrupt:
        sys.exit(130)
    except Exception:
        traceback.print_exc()
        sys.exit(2)
