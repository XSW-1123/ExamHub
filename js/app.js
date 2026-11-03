/* =====================================================
 * app.js — 界面逻辑
 * 依赖: window.QUESTION_BANK (data/questions.js), marked, window.SRS
 * ===================================================== */
(function () {
  "use strict";

  const BANK = window.QUESTION_BANK;
  const SRS = window.SRS;
  const $ = (s) => document.querySelector(s);
  const $$ = (s) => document.querySelectorAll(s);

  /* ---------- 基础索引 ---------- */
  const cards = BANK.cards;
  const cats = BANK.categories;
  const byId = new Map(cards.map(c => [c.id, c]));
  const allIds = cards.map(c => c.id);
  const CAT_ALL = "__all__";

  SRS.load();

  /* ---------- Markdown 渲染（保真展示层） ---------- */
  marked.setOptions({ gfm: true, breaks: true });

  const ENT = { "&lt;": "<", "&gt;": ">", "&quot;": '"', "&#39;": "'", "&amp;": "&" };
  const CODE_HINT = /[;{}=]|\/\/|=>|<\/|\b(public|private|protected|return|if|else|for|while|switch|new|import|class|void|static|final|int|long|String|var|def|func|SELECT|select|INSERT|UPDATE|DELETE|FROM|WHERE|JOIN)\b|\(\)|\[\]/;
  const ESCAPE_RE = /\\([\\`*_{}[\]()#+\-.!|~>])/g;

  function unescapeMd(s) {
    return s.replace(ESCAPE_RE, "$1").replace(/&lt;|&gt;|&quot;|&#39;|&amp;/g, m => ENT[m]);
  }

  // 原文档中代码是引用段落形式：把"看起来是代码"的连续引用块转成代码块，其余保持引用
  function prettyMd(srcText) {
    const lines = srcText.split("\n");
    const out = [];
    let i = 0;
    while (i < lines.length) {
      if (/^>/.test(lines[i])) {
        let j = i;
        while (j < lines.length && /^>/.test(lines[j])) j++;
        const block = lines.slice(i, j).map(l => l.replace(/^>\s?/, ""));
        const nonEmpty = block.filter(l => l.trim());
        const codeish = nonEmpty.filter(l => CODE_HINT.test(l)).length;
        const bullets = nonEmpty.filter(l => /^[·•]/.test(l.trim())).length;
        if (nonEmpty.length >= 4 && codeish / nonEmpty.length >= 0.5 &&
            bullets / nonEmpty.length < 0.25) {
          out.push("```");
          block.forEach(l => {
            if (!l.trim()) return; // 源文档在每行代码间插了空引用行，去掉保持代码紧凑
            out.push(unescapeMd(l.replace(/\\$/, "")));
          });
          out.push("```");
        } else {
          // 引用块：合并中间的空引用行，避免碎片化
          const squeezed = [];
          block.forEach((l, k) => {
            if (!l.trim() && (k === 0 || k === block.length - 1 ||
              !block[k - 1].trim() || (k + 1 < block.length && !block[k + 1].trim()))) return;
            squeezed.push(l);
          });
          squeezed.forEach(l => out.push("> " + l));
        }
        i = j;
      } else {
        out.push(lines[i]);
        i++;
      }
    }
    return out.join("\n");
  }

  function renderMd(body, showSrc, src) {
    let html = marked.parse(prettyMd(body));
    if (showSrc && src) {
      html = '<div class="src-line">📖 来源：' + esc(src) + "</div>" + html;
    }
    return html;
  }
  function esc(s) {
    return String(s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
  }

  /* ---------- 状态 ---------- */
  const App = {
    view: "study",
    mode: "srs",           // srs | custom | star
    queue: [], qi: 0,
    session: { nw: 0, rv: 0 },
    revealed: false,
    current: null,
    custom: { cat: CAT_ALL, shuffle: true },
    browse: { cat: CAT_ALL, q: "", page: 0 },
    pageSize: 60,
    modalId: null,
  };

  function toast(msg, ms) {
    const t = $("#toast");
    t.textContent = msg;
    t.classList.add("show");
    clearTimeout(t._tm);
    t._tm = setTimeout(() => t.classList.remove("show"), ms || 1800);
  }

  /* ---------- 视图切换 ---------- */
  function switchView(v) {
    App.view = v;
    $$(".view").forEach(el => el.classList.add("hidden"));
    $("#view-" + v).classList.remove("hidden");
    $$(".tab").forEach(b => b.classList.toggle("active", b.dataset.view === v));
    if (v === "study") {
      if (App.qi >= App.queue.length) startSession(false);
      else renderStudy();
    }
    if (v === "browse") renderBrowse(true);
    if (v === "stats") renderStats();
    if (v === "me") renderMe();
    window.scrollTo(0, 0);
  }
  $$(".tab").forEach(b => b.addEventListener("click", () => switchView(b.dataset.view)));

  /* ---------- 卡片状态 ---------- */
  function stateOf(id) {
    const c = SRS.cardState(id);
    if (!c || c.st === "new") return { key: "new", label: "未学" };
    if (c.st === "learn" || c.st === "relearn") return { key: "learn", label: "学习中" };
    if (c.ivl >= SRS.MASTERED_IVL) return { key: "mastered", label: "已掌握" };
    return { key: "review", label: "复习中" };
  }
  function paintStateChip(elId, id) {
    const el = $("#" + elId);
    const s = stateOf(id);
    el.className = "chip state-chip " + s.key;
    el.textContent = s.label;
  }
  function paintStar(elId, id) {
    const el = $("#" + elId);
    const c = SRS.cardState(id);
    const on = !!(c && c.star);
    el.textContent = on ? "★" : "☆";
    el.classList.toggle("on", on);
  }

  /* =====================================================
   * 学习页
   * ===================================================== */
  function currentQueueIds() {
    if (App.mode === "srs") return SRS.buildQueue(allIds);
    if (App.mode === "star") {
      return allIds.filter(id => {
        const c = SRS.cardState(id);
        return c && c.star;
      });
    }
    // custom
    let ids = allIds;
    if (App.custom.cat !== CAT_ALL) {
      const ci = +App.custom.cat;
      ids = cards.filter(c => c.cat === ci).map(c => c.id);
    }
    ids = ids.slice();
    if (App.custom.shuffle) {
      for (let i = ids.length - 1; i > 0; i--) {
        const j = Math.floor(Math.random() * (i + 1));
        [ids[i], ids[j]] = [ids[j], ids[i]];
      }
    }
    return ids;
  }

  function startSession() {
    App.queue = currentQueueIds();
    App.qi = 0;
    renderStudy();
  }

  function renderStudy() {
    updateStreakChip();
    const total = App.queue.length;
    const done = Math.min(App.qi, total);
    $("#study-progress").style.width = (total ? (done / total) * 100 : 100) + "%";

    const tl = SRS.todayLog();
    $("#study-queue-info").textContent =
      total ? ("本轮剩余 " + (total - done) + " / " + total + " 张") : "本轮无待学卡片";
    $("#study-done-info").textContent = "今日新学 " + tl.nw + " · 复习 " + tl.rv;

    if (done >= total) { showEmpty(); return; }
    $("#card-empty").classList.add("hidden");
    $("#flashcard").classList.remove("hidden");

    const id = App.queue[App.qi];
    const card = byId.get(id);
    App.current = card;
    App.revealed = false;

    $("#card-cat").textContent = (cats[card.cat] || {}).short || "";
    $("#card-id").textContent = card.id;
    paintStateChip("card-state", id);
    paintStar("card-star", id);
    $("#card-title").textContent = card.title;
    $("#card-front").classList.remove("hidden");
    $("#card-back").classList.add("hidden");
  }

  function showEmpty() {
    $("#flashcard").classList.add("hidden");
    $("#card-empty").classList.remove("hidden");
    const later = SRS.learningLaterToday();
    const tl = SRS.todayLog();
    if (later.count > 0) {
      const mins = Math.max(1, Math.round((later.nearest - Date.now()) / 60000));
      $("#empty-emoji").textContent = "⏳";
      $("#empty-title").textContent = "本轮完成，还有 " + later.count + " 张在学习中";
      $("#empty-desc").textContent = "最快 " + mins + " 分钟后到期，点下面的按钮刷新队列继续。";
    } else {
      $("#empty-emoji").textContent = "🎉";
      $("#empty-title").textContent = "本轮任务完成！";
      $("#empty-desc").textContent = "今日已新学 " + tl.nw + " 张、复习 " + tl.rv + " 张。";
    }
    $("#study-progress").style.width = "100%";
    $("#study-queue-info").textContent = "本轮结束";
  }

  function reveal() {
    if (!App.current || App.revealed) return;
    const card = App.current;
    App.revealed = true;
    $("#card-cat2").textContent = (cats[card.cat] || {}).short || "";
    $("#card-id2").textContent = card.id;
    paintStar("card-star2", card.id);
    const s = SRS.settings();
    $("#card-body").innerHTML = renderMd(card.body, s.showSrc == 1, card.src);
    $("#card-front").classList.add("hidden");
    $("#card-back").classList.remove("hidden");
    $("#card-body").scrollTop = 0;
  }

  function doGrade(g) {
    if (!App.current || !App.revealed) return;
    const id = App.current.id;
    const before = SRS.cardState(id);
    const isNew = !before || before.st === "new";
    SRS.grade(id, g);
    App.qi++;
    renderStudy();
  }

  /* ---------- 学习模式 tab ---------- */
  $$(".mode-tab").forEach(b => b.addEventListener("click", () => {
    $$(".mode-tab").forEach(x => x.classList.remove("active"));
    b.classList.add("active");
    App.mode = b.dataset.mode;
    $("#custom-bar").classList.toggle("hidden", App.mode !== "custom");
    startSession();
  }));

  $("#btn-reveal").addEventListener("click", reveal);
  $("#card-title").addEventListener("click", reveal);
  $("#flashcard").addEventListener("click", (e) => {
    if (e.target.closest(".grade-bar") || e.target.closest(".star-btn") ||
        e.target.closest("#btn-reveal") || e.target.closest("a") ||
        e.target.closest("button") || e.target.closest("pre") ||
        e.target.closest(".card-body")) return;
    if (!App.revealed) reveal();
  });
  $$(".grade").forEach(b => b.addEventListener("click", () => doGrade(+b.dataset.g)));
  $("#card-star").addEventListener("click", () => toggleStar(App.current.id, () => {
    paintStar("card-star", App.current.id); paintStar("card-star2", App.current.id);
  }));
  $("#card-star2").addEventListener("click", () => toggleStar(App.current.id, () => {
    paintStar("card-star", App.current.id); paintStar("card-star2", App.current.id);
  }));

  $("#empty-more").addEventListener("click", () => {
    startSession();
    if (App.queue.length === 0) {
      toast(App.mode === "srs" ? "暂时没有到期卡片，稍后再来 🌿" : "该范围内没有卡片");
    }
  });

  /* ---------- 自由刷题 ---------- */
  function fillCatSelect() {
    const sel = $("#custom-cat");
    sel.innerHTML = '<option value="' + CAT_ALL + '">全部分类（' + allIds.length + " 张）</option>" +
      cats.map((c, i) => '<option value="' + i + '">' + esc(c.short) + "（" + c.count + "）</option>").join("");
    sel.value = App.custom.cat;
  }
  $("#custom-start").addEventListener("click", () => {
    App.custom.cat = $("#custom-cat").value;
    App.custom.shuffle = $("#custom-shuffle").checked;
    startSession();
    if (App.queue.length === 0) toast("该范围内没有卡片");
  });

  /* =====================================================
   * 收藏
   * ===================================================== */
  function toggleStar(id, after) {
    const c = SRS.ensureCard(id);
    c.star = c.star ? 0 : 1;
    SRS.save();
    if (after) after();
    if (App.modalId === id && !$("#modal").classList.contains("hidden")) {
      paintStar("m-star", id);
    }
    toast(c.star ? "已加入收藏夹 ⭐" : "已取消收藏");
  }

  /* =====================================================
   * 题库浏览
   * ===================================================== */
  function fillCatChips() {
    const sc = $("#cat-scroller");
    sc.innerHTML = '<button class="cat-chip-btn" data-cat="' + CAT_ALL + '">全部 ' + allIds.length + "</button>" +
      cats.map((c, i) =>
        '<button class="cat-chip-btn" data-cat="' + i + '">' + esc(c.short) + " " + c.count + "</button>"
      ).join("");
    sc.querySelectorAll(".cat-chip-btn").forEach(b =>
      b.addEventListener("click", () => {
        App.browse.cat = b.dataset.cat;
        App.browse.page = 0;
        renderBrowse(true);
      }));
  }

  function searchPool() {
    let ids = allIds;
    if (App.browse.cat !== CAT_ALL) {
      const ci = +App.browse.cat;
      ids = cards.filter(c => c.cat === ci).map(c => c.id);
    }
    const q = App.browse.q.trim().toLowerCase();
    if (!q) return ids;
    const res = [];
    for (const id of ids) {
      const c = byId.get(id);
      if (c.title.toLowerCase().includes(q) || c.id.toLowerCase().includes(q) ||
          (c.src || "").toLowerCase().includes(q) || c.body.toLowerCase().includes(q)) {
        res.push(id);
      }
    }
    return res;
  }

  let searchTimer = null;
  $("#search-input").addEventListener("input", (e) => {
    clearTimeout(searchTimer);
    searchTimer = setTimeout(() => {
      App.browse.q = e.target.value;
      App.browse.page = 0;
      renderBrowse(false);
    }, 180);
  });

  function renderBrowse(resetScroll) {
    updateStreakChip();
    $$("#cat-scroller .cat-chip-btn").forEach(b =>
      b.classList.toggle("active", b.dataset.cat === App.browse.cat));

    const pool = searchPool();
    $("#browse-meta").textContent = "共 " + pool.length + " 张卡片" +
      (App.browse.q ? "（含正文关键词搜索）" : "");
    const slice = pool.slice(0, (App.browse.page + 1) * App.pageSize);
    const ul = $("#q-list");
    ul.innerHTML = slice.map(id => {
      const c = byId.get(id);
      const st = stateOf(id);
      const stt = SRS.cardState(id);
      const cat = cats[c.cat] || { short: "" };
      return '<li class="q-item" data-id="' + id + '">' +
        '<span class="q-dot ' + st.key + '"></span>' +
        '<div class="q-main"><div class="q-title">' + esc(c.title) + "</div>" +
        '<div class="q-sub"><span>' + esc(cat.short) + "</span><span>" + c.id + "</span>" +
        (c.src ? "<span>" + esc(c.src) + "</span>" : "") + "</div></div>" +
        '<span class="q-star ' + (stt && stt.star ? "on" : "off") + '">' + (stt && stt.star ? "★" : "☆") + "</span>" +
        "</li>";
    }).join("");
    ul.querySelectorAll(".q-item").forEach(li =>
      li.addEventListener("click", () => openModal(li.dataset.id)));

    const old = ul.querySelector(".load-more");
    if (old) old.remove();
    if (slice.length < pool.length) {
      const btn = document.createElement("button");
      btn.className = "load-more";
      btn.textContent = "显示更多（还有 " + (pool.length - slice.length) + " 张）";
      btn.addEventListener("click", () => { App.browse.page++; renderBrowse(false); });
      ul.appendChild(btn);
    }
    if (resetScroll) window.scrollTo(0, 0);
  }

  /* =====================================================
   * 详情弹层
   * ===================================================== */
  function openModal(id) {
    const c = byId.get(id);
    if (!c) return;
    App.modalId = id;
    $("#m-cat").textContent = (cats[c.cat] || {}).short || "";
    $("#m-id").textContent = c.id;
    paintStateChip("m-state", id);
    paintStar("m-star", id);
    $("#m-title").textContent = c.title;
    $("#m-src").textContent =
      (c.src ? "📖 来源：" + c.src : "") + (c.grp ? (c.src ? "　·　" : "") + c.grp : "");
    const s = SRS.settings();
    $("#m-body").innerHTML = renderMd(c.body, false, null); // 来源已在上方单独展示
    const acts = $("#m-actions");
    acts.innerHTML = "";
    const st = SRS.cardState(id);
    if (st && st.st !== "new") {
      const rb = document.createElement("button");
      rb.className = "btn small";
      rb.textContent = "↺ 重置此卡进度";
      rb.addEventListener("click", () => {
        const db = SRS.db();
        delete db.cards[id];
        SRS.save();
        toast("已重置为未学");
        closeModal();
        if (App.view === "browse") renderBrowse(false);
        if (App.view === "study") startSession();
      });
      acts.appendChild(rb);
    }
    const kb = document.createElement("button");
    kb.className = "btn small ghost";
    const masteredNow = st && st.st === "review" && st.ivl >= SRS.MASTERED_IVL;
    kb.textContent = masteredNow ? "✏️ 改回复习中" : "✅ 标记为已掌握";
    kb.addEventListener("click", () => {
      const cur = SRS.ensureCard(id);
      if (masteredNow) {
        cur.ivl = 7;
        cur.due = Date.now() + 7 * 86400000;
        toast("已改回复习中");
      } else {
        cur.st = "review";
        cur.ivl = SRS.MASTERED_IVL;
        cur.due = Date.now() + cur.ivl * 86400000;
        toast("已标记为已掌握 ✅");
      }
      SRS.save();
      openModal(id);
    });
    acts.appendChild(kb);

    $("#modal").classList.remove("hidden");
    document.body.style.overflow = "hidden";
  }
  function closeModal() {
    $("#modal").classList.add("hidden");
    document.body.style.overflow = "";
    App.modalId = null;
  }
  $("#modal-close").addEventListener("click", closeModal);
  $("#modal-mask").addEventListener("click", closeModal);
  $("#m-star").addEventListener("click", () => {
    if (!App.modalId) return;
    toggleStar(App.modalId, null);
    paintStateChip("m-state", App.modalId);
    paintStar("m-star", App.modalId);
    if (App.view === "browse") renderBrowse(false);
  });

  /* =====================================================
   * 统计页
   * ===================================================== */
  function renderStats() {
    updateStreakChip();
    const st = SRS.stats(allIds);
    const tl = SRS.todayLog();
    const cells = [
      ["总卡片", st.total, ""],
      ["已掌握", st.mastered, "hl"],
      ["学习/复习中", st.learning + st.review, ""],
      ["连续打卡", SRS.db().streak.count + " 天", "hl"],
    ];
    $("#stat-grid").innerHTML = cells.map(([l, v, hl]) =>
      '<div class="stat-cell ' + hl + '"><b>' + v + "</b><span>" + l + "</span></div>").join("");

    const fc = SRS.forecast(7);
    const max = Math.max(1, ...fc.map(f => f.count));
    const names = ["今天", "明天"];
    $("#forecast").innerHTML = fc.map((f, i) => {
      const h = Math.max(4, Math.round(f.count / max * 76));
      const d = new Date(); d.setDate(d.getDate() + i);
      const label = i < 2 ? names[i] : (d.getMonth() + 1) + "/" + d.getDate();
      return '<div class="fc-col"><div class="fc-bar" style="height:' + h + 'px"><i>' +
        (f.count || "") + "</i></div><span class='fc-day'>" + label + "</span></div>";
    }).join("");

    const rows = cats.map((c, i) => {
      const ids = cards.filter(x => x.cat === i).map(x => x.id);
      const s = SRS.stats(ids);
      const pct = s.total ? Math.round((s.mastered / s.total) * 100) : 0;
      return { name: c.short, pct, done: s.mastered, total: s.total };
    }).filter(r => r.total > 0).sort((a, b) => b.pct - a.pct);
    $("#cat-stats").innerHTML = rows.map(r =>
      '<div class="cs-row"><span class="cs-name" title="' + esc(r.name) + '">' + esc(r.name) +
      '</span><div class="cs-track"><div class="cs-fill" style="width:' + r.pct + '%"></div></div>' +
      '<span class="cs-num">' + r.done + "/" + r.total + " · " + r.pct + "%</span></div>").join("");

    const hm = $("#heatmap");
    const cellsH = [];
    const t0 = new Date(); t0.setHours(0, 0, 0, 0);
    for (let d = 29; d >= 0; d--) {
      const k = SRS.todayKey(t0.getTime() - d * 86400000);
      const log = SRS.db().log[k];
      const n = log ? log.nw + log.rv : 0;
      const lv = n === 0 ? 0 : n < 5 ? 1 : n < 15 ? 2 : n < 40 ? 3 : 4;
      cellsH.push('<div class="hm-cell l' + lv + '" title="' + k + "：" + n + ' 张"></div>');
    }
    hm.innerHTML = cellsH.join("") +
      '<div class="hm-legend" style="grid-column:1/-1">少 <i class="hm-cell l0"></i><i class="hm-cell l1"></i><i class="hm-cell l2"></i><i class="hm-cell l3"></i><i class="hm-cell l4"></i> 多（今日 ' + (tl.nw + tl.rv) + " 张）</div>";
  }

  /* =====================================================
   * 我的（设置/数据）
   * ===================================================== */
  function renderMe() {
    const s = SRS.settings();
    $("#npd").value = s.npd;
    $("#npd-val").textContent = s.npd;
    $("#new-order").value = s.order;
    $("#show-src").value = String(s.showSrc);
    $("#theme-sel").value = s.theme;
    $("#about-meta").innerHTML =
      "📚 " + esc(BANK.meta.title) + " — " + esc(BANK.meta.subtitle) + "<br>" +
      "🗂 题库共 " + allIds.length + " 张（正式题 " + cards.filter(c => c.type === "qa").length +
      " + 阅读卡 " + cards.filter(c => c.type === "read").length + "）<br>" +
      "🏷 来源：" + esc(BANK.meta.source) + "<br>" +
      "🍽 对应项目：" + esc(BANK.meta.project) + "<br>" +
      "📅 文档生成日期：" + esc(BANK.meta.date);
  }

  $("#npd").addEventListener("input", (e) => {
    $("#npd-val").textContent = e.target.value;
    SRS.setSetting("npd", +e.target.value);
  });
  $("#new-order").addEventListener("change", (e) => SRS.setSetting("order", e.target.value));
  $("#show-src").addEventListener("change", (e) => SRS.setSetting("showSrc", +e.target.value));
  $("#theme-sel").addEventListener("change", (e) => { SRS.setSetting("theme", e.target.value); applyTheme(); });

  $("#btn-export").addEventListener("click", () => {
    const blob = new Blob([SRS.exportJSON()], { type: "application/json" });
    const a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    a.download = "mealnow-srs-backup-" + SRS.todayKey() + ".json";
    a.click();
    URL.revokeObjectURL(a.href);
    toast("已导出备份文件 ⬇️");
  });
  $("#btn-import").addEventListener("click", () => $("#import-file").click());
  $("#import-file").addEventListener("change", (e) => {
    const f = e.target.files[0];
    if (!f) return;
    const r = new FileReader();
    r.onload = () => {
      try {
        SRS.importJSON(r.result);
        toast("导入成功 ✅");
        applyTheme();
        startSession();
      } catch (err) { toast("导入失败：" + err.message, 3000); }
    };
    r.readAsText(f);
    e.target.value = "";
  });
  $("#btn-reset").addEventListener("click", () => {
    if (confirm("确定清空全部学习进度吗？此操作不可恢复（建议先导出备份）。")) {
      SRS.resetAll();
      startSession();
      toast("进度已清空");
    }
  });

  /* ---------- 主题 ---------- */
  function applyTheme() {
    const t = SRS.settings().theme || "auto";
    const dark = t === "dark" || (t === "auto" &&
      window.matchMedia("(prefers-color-scheme: dark)").matches);
    document.documentElement.setAttribute("data-theme", dark ? "dark" : "light");
    syncThemeColor();
  }
  // 安装为应用后，标题栏 / 状态栏跟随主题取色
  function syncThemeColor() {
    const meta = $("#meta-theme-color");
    if (!meta) return;
    const bg = getComputedStyle(document.documentElement).getPropertyValue("--bg").trim();
    if (bg) meta.setAttribute("content", bg);
  }
  $("#theme-btn").addEventListener("click", () => {
    const order = ["auto", "light", "dark"];
    const cur = SRS.settings().theme || "auto";
    const next = order[(order.indexOf(cur) + 1) % 3];
    SRS.setSetting("theme", next);
    applyTheme();
    toast("主题：" + (next === "auto" ? "跟随系统" : next === "light" ? "浅色" : "深色"));
    if (App.view === "me") renderMe();
  });
  window.matchMedia("(prefers-color-scheme: dark)").addEventListener("change", applyTheme);

  /* ---------- 打卡 ---------- */
  function updateStreakChip() {
    $("#streak-num").textContent = SRS.db().streak.count || 0;
  }

  /* ---------- 键盘快捷键 ---------- */
  document.addEventListener("keydown", (e) => {
    if (e.target.tagName === "INPUT" || e.target.tagName === "SELECT" || e.target.tagName === "TEXTAREA") return;
    if (!$("#modal").classList.contains("hidden")) {
      if (e.key === "Escape") closeModal();
      return;
    }
    if (App.view !== "study") return;
    if (e.key === " ") { e.preventDefault(); if (!App.revealed) reveal(); }
    else if (App.revealed && ["1", "2", "3", "4"].includes(e.key)) doGrade(+e.key);
    else if (e.key.toLowerCase() === "s" && App.current) toggleStar(App.current.id, () => {
      paintStar("card-star", App.current.id); paintStar("card-star2", App.current.id);
    });
  });

  /* =====================================================
   * PWA：Service Worker 注册 + 安装引导（桌面 / 手机）
   * ===================================================== */
  const SECURE = location.protocol === "https:" ||
    location.hostname === "localhost" || location.hostname === "127.0.0.1";
  const standaloneQuery = window.matchMedia("(display-mode: standalone)");
  const isStandalone = () => standaloneQuery.matches || window.navigator.standalone === true;

  const UA = navigator.userAgent;
  const IS_IOS = /iPad|iPhone|iPod/.test(UA) ||
    (navigator.platform === "MacIntel" && navigator.maxTouchPoints > 1);
  const IS_ANDROID = /Android/.test(UA);
  const IS_MOBILE = IS_IOS || IS_ANDROID || /Mobile/.test(UA);
  // 微信 / QQ / 钉钉等 App 内置浏览器：连安装入口都没有，必须先跳系统浏览器
  const IS_INAPP = /MicroMessenger|QQ\/|DingTalk|Weibo|AlipayClient|BaiduBoxApp|Quark/i.test(UA);
  // 没实现 PWA 安装的常见国产浏览器：最多给"添加书签到桌面"这种快捷方式
  const NO_PWA = /MQQBrowser|UCBrowser|HeyTapBrowser|VivoBrowser|HuaweiBrowser|MiuiBrowser|baiduboxapp|baidubrowser|QIHU|SogouMobileBrowser|LieBao|LenovoBrowser|MeizuBrowser/i.test(UA);

  const HINT_KEY = "examhub:install-hint-dismissed";
  let installEvent = null;

  function hintDismissed() {
    try { return localStorage.getItem(HINT_KEY) === "1"; } catch (e) { return false; }
  }
  function dismissHint() {
    try { localStorage.setItem(HINT_KEY, "1"); } catch (e) { /* 隐私模式忽略 */ }
    $("#install-banner").classList.add("hidden");
  }

  /* 各平台安装方式；state 决定是否显示安装按钮与手机引导条。
     注意顺序：只要浏览器真的给出了 beforeinstallprompt，就优先走一键安装，
     不用"名单"去拦——名单只用来解释那些不装 PWA 的浏览器。 */
  function installGuide() {
    if (isStandalone()) {
      return { state: "installed", tip: "已在应用模式下运行，无需再次安装。", short: "" };
    }
    if (IS_INAPP) {
      return {
        state: "inapp",
        tip: "当前是微信 / QQ 等内置浏览器，装不了。先点右上角「···」→「在浏览器打开」，再按浏览器里的方式添加。",
        short: "",
      };
    }
    if (installEvent) {
      return {
        state: "prompt",
        tip: "点下面的按钮即可安装：桌面 / 主屏会多一个 ExamHub 图标，独立窗口打开，断网也能刷题。",
        short: "装到桌面，断网也能背题",
      };
    }
    if (NO_PWA && IS_MOBILE) {
      return {
        state: "nopwa",
        tip: "QQ 浏览器、UC、夸克这类浏览器没有实现「安装 PWA」，最多给一个桌面快捷方式（点开还是浏览器界面）。想装成独立 App：在应用商店装 Edge 或 Chrome，用它打开本站 → 菜单 →「安装应用 / 添加到主屏幕」。",
        short: "QQ 等浏览器装不了，换 Edge / Chrome",
      };
    }
    if (!SECURE) {
      return {
        state: "insecure",
        tip: "当前地址不是 https，浏览器不允许安装。手机请改用 https://xsw-1123.github.io/ExamHub/ ；局域网 http 只能当网页看。",
        short: "",
      };
    }
    if (IS_IOS) {
      return {
        state: "ios",
        tip: "Safari：点底部「分享」→「添加到主屏幕」→ 右上角「添加」。装好后请从桌面图标打开，它的进度与 Safari 里是分开的。",
        short: "Safari 分享 → 添加到主屏幕",
      };
    }
    if (IS_ANDROID) {
      return {
        state: "android",
        tip: "当前浏览器没给安装入口。用 Chrome / Edge 打开本站：点右上角「⋮」→「安装应用」或「添加到主屏幕」。",
        short: "Chrome / Edge 菜单 → 安装应用",
      };
    }
    return {
      state: "desktop",
      tip: "当前浏览器没有给出安装入口：点地址栏右侧的安装图标，或换 Chrome / Edge 打开本页。",
      short: "",
    };
  }

  function updateInstallUI() {
    const g = installGuide();

    const btn = $("#btn-install");
    const tip = $("#install-tip");
    if (btn && tip) {
      tip.textContent = g.tip;
      btn.classList.toggle("hidden", g.state !== "prompt");
    }

    const steps = $("#install-steps");
    if (steps) {
      const list =
        g.state === "ios"
          ? ["用 Safari 打开本页（微信 / QQ 内置浏览器不行）", "点底部「分享」按钮",
             "选「添加到主屏幕」，右上角「添加」", "从新出现的 ExamHub 图标打开"]
          : g.state === "android"
            ? ["用 Chrome / Edge 打开本站", "点右上角「⋮」", "选「安装应用」或「添加到主屏幕」"]
            : g.state === "nopwa"
              ? ["在应用商店装 Edge（或 Chrome）", "用它打开 https://xsw-1123.github.io/ExamHub/",
                 "菜单 →「添加到手机 / 安装应用」",
                 "留在本浏览器也行：菜单「添加书签」勾选发送到桌面，但那只是快捷方式"]
              : [];
      steps.innerHTML = list.map((s) => "<li>" + esc(s) + "</li>").join("");
      steps.hidden = list.length === 0;
    }

    // 手机上的安装引导条：能装、或需要解释为什么装不了时才出现
    const banner = $("#install-banner");
    if (!banner) return;
    const RELEVANT = ["prompt", "ios", "android", "nopwa"];
    const show = IS_MOBILE && RELEVANT.includes(g.state) && !hintDismissed();
    banner.classList.toggle("hidden", !show);
    if (!show) return;
    $("#install-banner-text").textContent = g.short;
    $("#install-banner-yes").textContent = g.state === "prompt" ? "安装" : "看步骤";
  }

  async function doInstall() {
    if (!installEvent) { updateInstallUI(); return; }
    installEvent.prompt();
    const choice = await installEvent.userChoice;
    installEvent = null;
    updateInstallUI();
    toast(choice && choice.outcome === "accepted" ? "正在安装 ExamHub…" : "已取消安装");
  }

  $("#btn-install").addEventListener("click", doInstall);
  $("#install-banner-yes").addEventListener("click", () => {
    if (installEvent) { doInstall(); return; }
    dismissHint();
    switchView("me");
    const panel = $("#install-panel");
    if (panel) setTimeout(() => panel.scrollIntoView({ behavior: "smooth", block: "center" }), 80);
  });
  $("#install-banner-no").addEventListener("click", dismissHint);

  window.addEventListener("beforeinstallprompt", (e) => {
    e.preventDefault();
    installEvent = e;
    updateInstallUI();
  });
  window.addEventListener("appinstalled", () => {
    installEvent = null;
    try { localStorage.setItem(HINT_KEY, "1"); } catch (e) { /* ignore */ }
    $("#install-banner").classList.add("hidden");
    toast("ExamHub 已安装");
    updateInstallUI();
  });
  standaloneQuery.addEventListener("change", updateInstallUI);

  function registerSW() {
    if (!("serviceWorker" in navigator) || !SECURE) return;
    navigator.serviceWorker.register("sw.js", { scope: "./" }).then((reg) => {
      reg.addEventListener("updatefound", () => {
        const sw = reg.installing;
        if (!sw) return;
        sw.addEventListener("statechange", () => {
          // 已有一个页面受控，说明这是更新而不是首次安装
          if (sw.state === "installed" && navigator.serviceWorker.controller) {
            toast("已缓存新版本，重新打开后生效", 3200);
          }
        });
      });
    }).catch(() => { /* file:// 或受限环境，静默降级 */ });
  }

  /* ---------- 启动 ---------- */
  function init() {
    applyTheme();
    fillCatSelect();
    fillCatChips();
    $("#brand-sub").textContent = allIds.length + " 张卡片 · SM-2 间隔重复";
    startSession();
    updateInstallUI();
    registerSW();
  }
  init();
})();
