# -*- coding: utf-8 -*-
"""
把 pandoc 从 docx 提取的 GFM markdown 解析为背题网站的题库数据。

设计要点：
- 每张卡片的内容 = 原文的一个【精确行区间切片】，不做任何改写；
  这样可以用"行覆盖校验"证明文档每一行都进了题库（标题行成为卡片标题）。
- 正式题目（## C00-001）→ type=qa；第0章/附录等说明内容 → type=read（阅读卡），
  阅读卡同样可以背诵/标记，保证"所有内容都在网站里"。
"""
import re
import json
import sys
import io
import os
import subprocess

SRC = "_work/extracted_gfm.md"
OUT = "data/questions.js"

QA_HEADING = re.compile(r"^C(\d{2})-(\d{3})\s*(.*)$")
SUB_QA_HEADING = re.compile(r"^([A-H])-(\d+)\s+(.*)$")
CHAPTER_COUNT = re.compile(r"（(\d+)\s*题）")
SRC_LINE = re.compile(r"^来源：(.*)$")


def main():
    # 数据源不存在时自动用 pandoc 从 docx 重新提取
    if not os.path.exists(SRC):
        os.makedirs("_work", exist_ok=True)
        cmd = ["pandoc", "MealNow面试题库（整合版）.docx", "-t", "gfm",
               "--wrap=none", "-o", SRC]
        print("[..] extracting docx via pandoc:", " ".join(cmd))
        subprocess.run(cmd, check=True)
    text = io.open(SRC, "r", encoding="utf-8").read()
    lines = text.split("\n")
    n = len(lines)

    # ---------- 1. 找出所有标题行 ----------
    heads = []  # (line_idx, level, text)
    for i, ln in enumerate(lines):
        m = re.match(r"^(#{1,6})\s+(.*)$", ln)
        if m:
            heads.append((i, len(m.group(1)), m.group(2).strip()))
    assert heads, "no headings found"
    head_idx_set = {h[0] for h in heads}
    first_head = heads[0][0]

    covered = [False] * n

    def claim(lo, hi):
        """认领内容行区间 [lo, hi)。标题行不算内容（它们成为卡片标题）。"""
        for k in range(lo, hi):
            if k in head_idx_set:
                continue
            assert not covered[k], f"line {k+1} claimed twice: {lines[k][:60]!r}"
            covered[k] = True

    for (i, lv, t) in heads:
        covered[i] = True  # 标题行视为已覆盖（成为卡片标题/边界）

    cards = []
    categories = []  # [{name, short}]

    def chapter_idx(name, short):
        for idx, c in enumerate(categories):
            if c["name"] == name:
                return idx
        categories.append({"name": name, "short": short})
        return len(categories) - 1

    def short_name(title):
        t = CHAPTER_COUNT.sub("", title)
        return t.strip() or title

    def extract_src(body):
        """抽出'来源：xxx'行，返回 (src, 新body)"""
        for bi, bl in enumerate(body.split("\n")):
            sm = SRC_LINE.match(bl.strip())
            if sm:
                rest = body.split("\n")
                rest[bi] = ""
                return sm.group(1).strip(), "\n".join(rest).lstrip("\n")
        return "", body

    def add(cat_idx, title, body, ctype, src="", chapter=None, qid=None, grp=None):
        cards.append({
            "id": qid, "cat": cat_idx, "title": title.strip(),
            "body": body, "type": ctype, "src": src, "chapter": chapter,
            "grp": grp,
        })

    # ---------- 2. 前言（文档首页 meta，第一个 # 标题之前） ----------
    preamble = lines[:first_head]
    if any(l.strip() for l in preamble):
        claim(0, first_head)
        ci = chapter_idx("关于本文档", "关于本文档")
        add(ci, "MealNow 面试题库 · 文档首页", "\n".join(preamble), "read")

    # ---------- 3. 逐章处理（一级标题为章界） ----------
    lv1 = [(i, t) for (i, lv, t) in heads if lv == 1]
    for j, (h_idx, h_text) in enumerate(lv1):
        h_end = lv1[j + 1][0] if j + 1 < len(lv1) else n
        subs = [(i, lv, t) for (i, lv, t) in heads if h_idx < i < h_end]

        if h_text == "目录":
            body = "\n".join(lines[h_idx + 1:h_end])
            if body.strip():
                claim(h_idx + 1, h_end)
                ci = chapter_idx("关于本文档", "关于本文档")
                add(ci, "文档目录（原文）", body, "read", chapter=h_text)
            continue

        ci = chapter_idx(h_text, short_name(h_text))
        is_appendix_a = h_text.startswith("附录 A")

        if is_appendix_a:
            groups = [(i, t) for (i, lv, t) in subs if lv == 2]
            # 组前导读
            g_first = groups[0][0] if groups else h_end
            intro = "\n".join(lines[h_idx + 1:g_first])
            if intro.strip():
                claim(h_idx + 1, g_first)
                add(ci, f"「{short_name(h_text)}」· 本章导读", intro, "read", chapter=h_text)
            for gi, (g_idx, g_text) in enumerate(groups):
                g_end = groups[gi + 1][0] if gi + 1 < len(groups) else h_end
                qs = [(i, t) for (i, lv, t) in subs if g_idx < i < g_end and lv == 3]
                q_first = qs[0][0] if qs else g_end
                g_intro = "\n".join(lines[g_idx + 1:q_first])
                if g_intro.strip():
                    claim(g_idx + 1, q_first)
                    add(ci, f"附录A · {g_text}（组说明）", g_intro, "read", chapter=h_text)
                for qi, (q_idx, q_text) in enumerate(qs):
                    q_next = qs[qi + 1][0] if qi + 1 < len(qs) else g_end
                    body = "\n".join(lines[q_idx + 1:q_next])
                    claim(q_idx + 1, q_next)
                    m = SUB_QA_HEADING.match(q_text)
                    qid = q_text.split()[0] if m else None
                    src, body = extract_src(body)
                    add(ci, q_text, body, "qa", src, h_text, qid, grp=g_text)
        elif subs:
            # 普通章：导读 + 二级小节（题目或阅读卡）；三级标题留在小节正文里
            sub2 = [(i, t) for (i, lv, t) in subs if lv == 2]
            first_sub = sub2[0][0] if sub2 else h_end
            intro = "\n".join(lines[h_idx + 1:first_sub])
            if intro.strip():
                claim(h_idx + 1, first_sub)
                add(ci, f"「{short_name(h_text)}」· 本章导读", intro, "read", chapter=h_text)
            for si, (s_idx, s_text) in enumerate(sub2):
                s_end = sub2[si + 1][0] if si + 1 < len(sub2) else h_end
                body = "\n".join(lines[s_idx + 1:s_end])
                claim(s_idx + 1, s_end)
                m = QA_HEADING.match(s_text)
                if m:
                    qid = f"C{m.group(1)}-{m.group(2)}"
                    src, body = extract_src(body)
                    add(ci, m.group(3), body, "qa", src, h_text, qid)
                else:
                    add(ci, s_text, body, "read", chapter=h_text)
        else:
            # 无小节的章（附录 B/C/D）→ 整章一张阅读卡
            body = "\n".join(lines[h_idx + 1:h_end])
            if body.strip():
                claim(h_idx + 1, h_end)
                add(ci, short_name(h_text), body, "read", chapter=h_text)

    # ---------- 4. 行覆盖校验：除标题行外每行必须被认领 ----------
    missing = [i + 1 for i, c in enumerate(covered) if not c and lines[i].strip()]
    if missing:
        print(f"[FAIL] {len(missing)} lines not covered. first 20: {missing[:20]}")
        for ln in missing[:5]:
            print(f"  L{ln}: {lines[ln-1][:80]!r}")
        sys.exit(1)
    print(f"[OK] coverage: all non-heading lines covered ({n} lines total)")

    # ---------- 5. 数量校验 ----------
    qa_cards = [c for c in cards if c["type"] == "qa"]
    read_cards = [c for c in cards if c["type"] == "read"]
    per_chapter = {}
    for c in qa_cards:
        per_chapter[c["chapter"]] = per_chapter.get(c["chapter"], 0) + 1
    bad = []
    for chap, cnt in per_chapter.items():
        m = CHAPTER_COUNT.search(chap)
        if m and int(m.group(1)) != cnt:
            bad.append((chap, int(m.group(1)), cnt))
    if bad:
        print("[FAIL] chapter count mismatch:")
        for chap, exp, got in bad:
            print(f"  {chap}: expected {exp}, got {got}")
        sys.exit(1)
    print(f"[OK] qa cards: {len(qa_cards)}, read cards: {len(read_cards)}")
    for chap, cnt in per_chapter.items():
        print(f"   {cnt:3d}  {chap}")

    appa = [c for c in qa_cards if c["chapter"].startswith("附录 A")]
    assert len(appa) == 43, f"appendix A expected 43, got {len(appa)}"

    dup = len(qa_cards) - len({c["id"] for c in qa_cards if c["id"]})
    if dup:
        print(f"[WARN] {dup} duplicate qa ids")

    # ---------- 6. 组装输出 ----------
    for i, c in enumerate(cards):
        if c["id"] is None:
            c["id"] = f"R-{i+1:03d}"

    doc_meta = {
        "title": "MealNow 面试题库",
        "subtitle": "两篇飞书八股文全量合并 · 逐题结合项目 · 面试官视角查漏",
        "source": "《史上最全八股文》（17 子篇） + 《面试专题》（14 子篇）",
        "project": "MealNow 点餐/预约系统（Spring Boot 3.3.6 + Java 21 + MySQL + Redis/Redisson + Vue3 + uni-app）",
        "date": "2026-09-28",
    }

    cats_out = [{"name": c["name"], "short": c["short"],
                 "count": sum(1 for x in cards if x["cat"] == i)}
                for i, c in enumerate(categories)]

    cards_out = [{"id": c["id"], "cat": c["cat"], "title": c["title"],
                  "body": c["body"], "type": c["type"], "src": c["src"],
                  "grp": c["grp"]}
                 for c in cards]

    os.makedirs("data", exist_ok=True)
    payload = json.dumps({"meta": doc_meta, "categories": cats_out,
                          "cards": cards_out}, ensure_ascii=False,
                         separators=(",", ":"))
    with io.open(OUT, "w", encoding="utf-8") as f:
        f.write("/* 自动生成：MealNow 面试题库数据（来自 MealNow面试题库（整合版）.docx） */\n")
        f.write("window.QUESTION_BANK = ")
        f.write(payload)
        f.write(";\n")
    print(f"[OK] wrote {OUT} ({os.path.getsize(OUT)/1024:.0f} KB), "
          f"{len(cards_out)} cards, {len(cats_out)} categories")


if __name__ == "__main__":
    main()
