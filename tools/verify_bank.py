# -*- coding: utf-8 -*-
"""
独立校验脚本（不复用 build_bank 的解析逻辑）：
1. 原文所有【非标题行】必须逐字出现在题库（卡片正文/标题/来源）中；
2. 原文所有【标题行】必须能对应到卡片标题 / 题号+标题 / 分类名。
全部通过则证明 docx 的每一行内容都进入了网站题库。
"""
import json
import re
import io
import sys

JS = "data/questions.js"
SRC = "_work/extracted_gfm.md"


def norm(s):
    return re.sub(r"\s+", "", s.replace("\u3000", " ").strip())


def main():
    js = io.open(JS, encoding="utf-8").read()
    start = js.index("window.QUESTION_BANK = ") + len("window.QUESTION_BANK = ")
    bank = json.loads(js[start:js.rindex(";")])
    cards = bank["cards"]

    corpus_parts = []
    for c in cards:
        corpus_parts.append(c["title"])
        if c.get("src"):
            corpus_parts.append("来源：" + c["src"])
        if c.get("grp"):
            corpus_parts.append(c["grp"])
        corpus_parts.append(c["body"])
        if c["id"] and not c["id"].startswith("R-"):
            corpus_parts.append(c["id"])  # 题号独立存在
    for cat in bank["categories"]:
        corpus_parts.append(cat["name"])
    corpus = "\n".join(corpus_parts)
    corpus_n = norm(corpus)

    lines = io.open(SRC, encoding="utf-8").read().split("\n")

    content_miss, head_miss = [], []
    for i, ln in enumerate(lines):
        t = ln.strip()
        if not t:
            continue
        if re.match(r"^#{1,6}\s", t):
            bare = re.sub(r"^#{1,6}\s+", "", t)
            nb = norm(bare)
            # 标题对应：裸文本 / 题号+裸文本 / 去掉（N题）后缀 出现在语料或分类名
            if nb in corpus_n:
                continue
            m = re.match(r"^(C\d{2}-\d{3}|[A-H]-\d+)\s*(.*)$", bare)
            if m and norm(m.group(2)) in corpus_n and norm(m.group(1)) in corpus_n:
                continue
            sys.exit(f"[FAIL] heading L{i+1} unmatched: {t[:70]!r}")
        else:
            if norm(t) not in corpus_n:
                content_miss.append((i + 1, t[:70]))

    if content_miss:
        print(f"[FAIL] {len(content_miss)} content lines missing:")
        for m in content_miss[:15]:
            print("  L%d: %r" % m)
        sys.exit(1)

    qa = [c for c in cards if c["type"] == "qa"]
    rd = [c for c in cards if c["type"] == "read"]
    total_chars = sum(len(c["body"]) for c in cards)
    print(f"[PASS] 原文 {sum(1 for l in lines if l.strip())} 个非空行全部进入题库")
    print(f"       正式题 {len(qa)} 道 + 阅读卡 {len(rd)} 张 = {len(cards)} 张卡片")
    print(f"       正文总字符 {total_chars:,}（原文正文 {len(''.join(lines)):,} 字符）")


if __name__ == "__main__":
    main()
