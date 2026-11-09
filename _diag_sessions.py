"""诊断最近的 DSH 会话：上下文多大、最后为什么停、有没有报错。"""
import json, os, sys, glob, datetime
import zstandard as zstd

ROOT = r"C:\Users\86186\.dsh\sessions\--E-DSHdesktop--"


def read_session(path):
    d = zstd.ZstdDecompressor()
    with open(path, "rb") as f:
        try:
            reader = d.stream_reader(f, read_across_frames=True)
        except TypeError:
            reader = d.stream_reader(f)
        data = reader.read()
    recs = []
    for line in data.decode("utf-8", "replace").splitlines():
        line = line.strip()
        if not line:
            continue
        try:
            recs.append(json.loads(line))
        except Exception:
            pass
    return recs


def summarize(path):
    recs = read_session(path)
    turns = {}
    max_total = 0
    last_usage = None
    last_end = None
    errors = []
    for r in recs:
        t = r.get("type")
        d = r.get("data") or {}
        if t == "assistant/message":
            u = d.get("usage") or {}
            it = u.get("inputTokens") or 0
            ct = u.get("cacheReadTokens") or 0
            if it + ct > max_total:
                max_total = it + ct
            last_usage = u
        elif t == "turn/end":
            turns[d.get("turn")] = json.dumps(d.get("reason"), ensure_ascii=False)
            last_end = d.get("reason")
        elif t in ("session/error", "error"):
            errors.append(json.dumps(d, ensure_ascii=False)[:120])
    reason = (last_end or {}).get("reason") or {}
    kind = (last_end or {}).get("kind")
    detail = ""
    if kind == "error":
        detail = (last_end.get("error") or {}).get("message", "")
    elif kind == "aborted":
        detail = json.dumps(reason, ensure_ascii=False)
    elif kind == "maxTokens":
        detail = "输出 token 上限"
    return {
        "name": os.path.basename(os.path.dirname(path)),
        "recs": len(recs),
        "turns": len(turns),
        "max_ctx": max_total,
        "last_kind": kind,
        "detail": detail,
        "last_usage": last_usage,
        "mtime": datetime.datetime.fromtimestamp(os.path.getmtime(path)).strftime("%m-%d %H:%M"),
    }


rows = []
for p in glob.glob(os.path.join(ROOT, "*", "session.v4.jsonl.zstd")):
    rows.append(summarize(p))
rows.sort(key=lambda r: r["mtime"], reverse=True)

print(f"{'会话':<14}{'记录':>6}{'轮':>4}{'峰值上下文':>12}  {'最后结束':<34} 时间")
print("-" * 100)
for r in rows[:12]:
    ctx = f"{r['max_ctx']/1000:.0f}K" if r["max_ctx"] else "-"
    print(f"{r['name'][8:20]:<14}{r['recs']:>6}{r['turns']:>4}{ctx:>12}  {str(r['last_kind'])+' '+str(r['detail'])[:24]:<34} {r['mtime']}")
