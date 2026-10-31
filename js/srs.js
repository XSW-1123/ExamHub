/* =====================================================
 * srs.js — SM-2 间隔重复引擎 + 学习进度存储
 * 状态机: new → learn(10min→1d) → review(按遗忘曲线) ；遗忘 → relearn
 * ===================================================== */
(function () {
  "use strict";

  const STORE_KEY = "mealnow_srs_v1";
  const MIN = 60, DAY = 86400;
  const LEARN_STEPS = [10 * MIN, 1 * DAY];   // 学习步骤: 10分钟 → 1天
  const GRADUATE_DAYS = 1;                   // 毕业间隔（天）
  const EASY_DAYS = 4;                       // 简单直接毕业（天）
  const MAX_IVL = 365;                       // 最大间隔（天）
  const MASTERED_IVL = 21;                   // 间隔≥21天视为已掌握

  /* ---------- 存储 ---------- */
  function todayKey(ts) {
    const d = ts ? new Date(ts) : new Date();
    return d.getFullYear() + "-" +
      String(d.getMonth() + 1).padStart(2, "0") + "-" +
      String(d.getDate()).padStart(2, "0");
  }
  function daysBetween(k1, k2) {
    const a = new Date(k1 + "T00:00:00"), b = new Date(k2 + "T00:00:00");
    return Math.round((b - a) / 86400000);
  }

  let db = null;

  function blankDB() {
    return {
      v: 1,
      cards: {},          // id -> {st, due, ivl, ef, reps, lapses, step, star}
      log: {},            // 'YYYY-MM-DD' -> {new, rev, again}
      settings: { npd: 20, order: "seq", showSrc: 1, theme: "auto" },
      streak: { last: null, count: 0 },
      created: Date.now(),
    };
  }

  function load() {
    try {
      const raw = localStorage.getItem(STORE_KEY);
      db = raw ? JSON.parse(raw) : blankDB();
      if (!db.cards || !db.settings) db = Object.assign(blankDB(), db);
    } catch (e) { db = blankDB(); }
    return db;
  }
  function save() {
    try { localStorage.setItem(STORE_KEY, JSON.stringify(db)); }
    catch (e) { console.warn("save failed", e); }
  }

  function cardState(id) {
    return db.cards[id] || null;
  }
  function ensureCard(id) {
    if (!db.cards[id]) db.cards[id] = {
      st: "new", due: 0, ivl: 0, ef: 2.5, reps: 0, lapses: 0, step: 0,
      star: 0,
    };
    return db.cards[id];
  }

  /* ---------- SM-2 评分 ---------- */
  // g: 1忘了 2模糊 3记得 4简单
  function grade(id, g, now) {
    now = now || Date.now();
    const c = ensureCard(id);
    const isNew = c.st === "new";
    let nextDue = now, note = "";

    if (isNew || c.st === "learn" || c.st === "relearn") {
      // —— 学习阶段 ——
      if (g === 1) {
        c.step = 0;
        nextDue = now + LEARN_STEPS[0] * 1000;
        c.st = isNew ? "learn" : c.st;
        note = "10 分钟后再来";
      } else if (g === 2) {
        c.step = 0;
        nextDue = now + LEARN_STEPS[0] * 1000;
        if (!isNew) c.st = "relearn";
        else c.st = "learn";
        note = "10 分钟后再来";
      } else if (g === 3) {
        if (isNew || c.st === "learn") {
          if (c.step >= LEARN_STEPS.length - 1) { // 已完成 1d 步骤→毕业
            graduate(c, GRADUATE_DAYS, now);
            nextDue = c.due; note = "毕业！" + fmtIvl(c.ivl);
          } else {
            c.step = Math.max(c.step, 1);
            c.st = "learn";
            nextDue = now + LEARN_STEPS[c.step] * 1000;
            note = "明天见";
          }
        } else { // relearn 完成
          graduate(c, Math.max(1, Math.round(c.ivl * 0.6)), now);
          nextDue = c.due; note = fmtIvl(c.ivl) + "后复习";
        }
      } else { // g === 4 简单
        graduate(c, isNew ? EASY_DAYS : Math.max(GRADUATE_DAYS * 2, Math.round(c.ivl * 1.3)), now);
        c.ef = Math.min(3.2, c.ef + 0.1);
        nextDue = c.due; note = fmtIvl(c.ivl) + "后复习";
      }
    } else {
      // —— 复习阶段（review）——
      c.reps++;
      if (g === 1) {
        c.lapses++;
        c.ef = Math.max(1.3, c.ef - 0.2);
        c.ivl = Math.max(1, Math.round(c.ivl * 0.4));
        c.st = "relearn"; c.step = 0;
        nextDue = now + LEARN_STEPS[0] * 1000;
        note = "进入重学，10 分钟后再来";
      } else {
        if (g === 2) c.ef = Math.max(1.3, c.ef - 0.14);
        else if (g === 4) c.ef = Math.min(3.2, c.ef + 0.1);
        const mult = (g === 2) ? 1.2 : (g === 3 ? c.ef : c.ef * 1.35);
        c.ivl = Math.min(MAX_IVL, Math.max(c.ivl + 1, Math.round(c.ivl * mult)));
        c.due = now + c.ivl * DAY * 1000;
        nextDue = c.due;
        note = fmtIvl(c.ivl) + "后复习";
      }
    }

    c.reps = Math.max(c.reps, isNew ? 1 : c.reps);
    c.due = nextDue;

    // 日志
    const k = todayKey(now);
    if (!db.log[k]) db.log[k] = { nw: 0, rv: 0, ag: 0 };
    if (isNew) db.log[k].nw++; else db.log[k].rv++;
    if (g === 1) db.log[k].ag++;

    // 连续打卡
    const t = todayKey(now);
    if (db.streak.last !== t) {
      const diff = db.streak.last ? daysBetween(db.streak.last, t) : 999;
      db.streak.count = (diff === 1) ? db.streak.count + 1 : 1;
      db.streak.last = t;
    }

    save();
    return { card: c, note, nextDue };
  }

  function graduate(c, ivlDays, now) {
    c.st = "review";
    c.ivl = Math.min(MAX_IVL, Math.max(1, ivlDays));
    c.due = now + c.ivl * DAY * 1000;
    c.step = 0;
  }

  function fmtIvl(days) {
    if (days < 1) return "1天内";
    if (days === 1) return "1 天";
    if (days < 30) return days + " 天";
    if (days < 365) return (days / 30).toFixed(1) + " 个月";
    return (days / 365).toFixed(1) + " 年";
  }

  /* ---------- 队列构建 ---------- */
  // due 到期的复习卡 + 今日新卡（不超过 npd，且扣除今天已学过的新题）
  function buildQueue(allIds, opts) {
    const now = Date.now();
    const s = db.settings;
    const newIds = [], revIds = [];
    for (const id of allIds) {
      const c = db.cards[id];
      if (!c || c.st === "new") newIds.push(id);
      else if (c.due <= now) revIds.push(id);
    }
    // 顺序
    if (s.order === "rand") shuffle(newIds); else newIds.sort(byBankOrder(allIds));
    shuffle(revIds);
    // 复习优先（同 Anki：先清复习再学新）
    const budget = (opts && opts.newLimit != null)
      ? Math.max(0, opts.newLimit - todayLog().nw)
      : Math.max(0, s.npd - todayLog().nw);
    const limitedNew = newIds.slice(0, budget);
    return revIds.concat(limitedNew);
  }

  function byBankOrder(allIds) {
    const idx = new Map(allIds.map((id, i) => [id, i]));
    return (a, b) => (idx.get(a) || 0) - (idx.get(b) || 0);
  }
  function shuffle(arr) {
    for (let i = arr.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [arr[i], arr[j]] = [arr[j], arr[i]];
    }
  }

  /* ---------- 统计 ---------- */
  function stats(allIds) {
    let nw = 0, ln = 0, rv = 0, ma = 0;
    for (const id of allIds) {
      const c = db.cards[id];
      if (!c || c.st === "new") nw++;
      else if (c.st === "learn" || c.st === "relearn") ln++;
      else if (c.ivl >= MASTERED_IVL) ma++;
      else rv++;
    }
    return { fresh: nw, learning: ln, review: rv, mastered: ma, total: allIds.length };
  }

  function forecast(days) {
    const out = [];
    const t0 = new Date(); t0.setHours(0, 0, 0, 0);
    for (let d = 0; d < days; d++) {
      const lo = t0.getTime() + d * 86400000;
      const hi = lo + 86400000;
      let n = 0;
      for (const id in db.cards) {
        const c = db.cards[id];
        if (c.due > lo && c.due <= hi) n++;
      }
      out.push({ day: d, count: n });
    }
    return out;
  }

  function todayLog() {
    return db.log[todayKey()] || { nw: 0, rv: 0, ag: 0 };
  }

  /* ---------- 导出 / 导入 ---------- */
  function exportJSON() {
    return JSON.stringify(db);
  }
  function importJSON(text) {
    const obj = JSON.parse(text);
    if (!obj || !obj.cards || !obj.settings) throw new Error("文件格式不对：不是本应用导出的进度文件");
    db = obj;
    save();
  }
  function resetAll() { db = blankDB(); save(); }

  /* ---------- 设置 ---------- */
  function setSetting(k, v) { db.settings[k] = v; save(); }

  /* 学习中的卡（今日稍后到期） */
  function learningLaterToday() {
    const now = Date.now();
    const t0 = new Date(); t0.setHours(24, 0, 0, 0);
    let n = 0, nearest = 0;
    for (const id in db.cards) {
      const c = db.cards[id];
      if ((c.st === "learn" || c.st === "relearn") && c.due > now && c.due < t0.getTime()) {
        n++;
        if (!nearest || c.due < nearest) nearest = c.due;
      }
    }
    return { count: n, nearest };
  }

  window.SRS = {
    load, save, grade, cardState, ensureCard, buildQueue, stats, forecast,
    todayLog, todayKey, exportJSON, importJSON, resetAll, setSetting,
    learningLaterToday, settings: () => db.settings, db: () => db,
    fmtIvl, MASTERED_IVL,
  };
})();
