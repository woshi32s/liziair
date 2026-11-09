"""细看某个会话：每步的上下文、最大工具结果、失败前的最后动作。"""
import json, os, sys
import zstandard as zstd

path = sys.argv[1]
d = zstd.ZstdDecompressor()
with open(path, "rb") as f:
    try:
        data = d.stream_reader(f, read_across_frames=True).read()
    except TypeError:
        data = d.stream_reader(f).read()

recs = []
for line in data.decode("utf-8", "replace").splitlines():
    line = line.strip()
    if line:
        try:
            recs.append(json.loads(line))
        except Exception:
            pass

print(f"记录 {len(recs)} 条")
providers = set()
big = []
for r in recs:
    d_ = r.get("data") or {}
    if r["type"] == "request/context":
        providers.add(f"{d_.get('provider')}/{d_.get('model')}")
    if r["type"] == "tool/result":
        msg = d_.get("message") or {}
        ln = sum(len(p.get("text", "") or "") for p in (msg.get("content") or []))
        big.append((ln, d_.get("turn"), d_.get("step"), (msg.get("content") or [{}])[0].get("type")))
print("模型:", ", ".join(sorted(providers)))
print("\n最大的 6 个工具结果（字符数）:")
for ln, tu, st, ty in sorted(big, reverse=True)[:6]:
    print(f"  {ln:>7} 字  turn={tu} step={st} type={ty}")

print("\n每步上下文（turn/step/输入+cache）:")
prev = None
for r in recs:
    if r["type"] != "assistant/message":
        continue
    d_ = r["data"]
    u = d_.get("usage") or {}
    it = (u.get("inputTokens") or 0) + (u.get("cacheReadTokens") or 0)
    print(f"  turn={d_.get('turn'):>2} step={d_.get('step'):>2}  {it/1000:>7.1f}K  out={u.get('outputTokens') or 0}")

print("\n最后一次失败:", end=" ")
for r in reversed(recs):
    if r["type"] == "turn/end":
        print(json.dumps(r["data"], ensure_ascii=False)[:300])
        break
