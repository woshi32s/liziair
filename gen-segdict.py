"""gen-segdict.py —— 从 jieba 词表生成 public/segdict.bin

为什么是二进制而不是 JSON：
  · 33 万个词存成 JSON 文本要 3.38 MB，进 JS 后是十几~二十几 MB 的字符串对象；
  · 这里只存**排序后的 32 位哈希**，1.26 MB，前端 `new Uint32Array(buffer)` 直接用，
    不需要切分/建表，内存就是这 1.26 MB。

格式：
  · little-endian uint32 × N，按数值升序，可直接二分查找；
  · 哈希算法 = FNV-1a 32 位，对**UTF-16 码元**逐位异或（和 segment.js 里完全一致）。
  · 只收 2~4 字词（单字不成词，5 字以上极少出现在歌词里，且会让最长匹配过长）。

重新生成：
  python gen-segdict.py
"""
import jieba
import os
import struct

OUT = os.path.join(os.path.dirname(os.path.abspath(__file__)), "public", "segdict.bin")
MIN_LEN, MAX_LEN = 2, 4


def fnv1a(s: str) -> int:
    h = 2166136261
    for ch in s:
        h ^= ord(ch)
        h = (h * 16777619) & 0xFFFFFFFF
    return h


def main() -> None:
    jieba.setLogLevel(60)
    src = jieba.get_dict_file().name
    words = set()
    with open(src, encoding="utf-8") as f:
        for line in f:
            parts = line.split()
            if len(parts) >= 2 and MIN_LEN <= len(parts[0]) <= MAX_LEN:
                words.add(parts[0])

    hashes = sorted({fnv1a(w) for w in words})
    with open(OUT, "wb") as f:
        f.write(struct.pack("<%dI" % len(hashes), *hashes))

    print(f"词条 {len(words)}  唯一哈希 {len(hashes)}  文件 {os.path.getsize(OUT) / 1048576:.2f} MB")


if __name__ == "__main__":
    main()
