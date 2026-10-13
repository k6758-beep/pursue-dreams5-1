/* =====================================================================
 *  《畢業之後 我的夢想之旅》遊戲引擎：game.js
 *  這支程式不寫死任何招生資訊，全部從 data/ 讀取：
 *    window.ADMISSION_DATA  管道、資格規則、日期     （data/admissions.js）
 *    window.CSU_WORLDS      未來城市與科系           （data/departments.js）
 *    window.STORY           劇情、NPC、裝備、結局    （js/story.js）
 * ===================================================================== */
(() => {
"use strict";
const D = window.ADMISSION_DATA, W = window.CSU_WORLDS, T = window.STORY;
const PATHS = D.paths, PMAP = Object.fromEntries(PATHS.map(p => [p.id, p]));
const SAVE_KEY = "grad-journey-v4";
const RM = matchMedia("(prefers-reduced-motion: reduce)").matches;
const $ = s => document.querySelector(s);
const stage = $("#stage");
/* RUN：每次「上一步」或重新開始都會 +1，舊流程裡還在等待的計時器就自動停下來 */
let RUN = 0;
const wait = ms => { const t = RUN; return new Promise(r => setTimeout(() => { if (t === RUN) r(); }, RM ? Math.min(ms, 80) : ms)); };
const esc = s => String(s ?? "").replace(/[&<>"']/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
const shuffle = a => { a = a.slice(); for (let i = a.length - 1; i > 0; i--) { const j = Math.random() * (i + 1) | 0; [a[i], a[j]] = [a[j], a[i]]; } return a; };

/* ---------------- 狀態與存檔 ----------------
 * S：目前的遊戲狀態（每一步開始前自動暫存在 localStorage）
 * H：走過的步驟紀錄（每一步開始前的 S 快照），「上一步」就是把快照拿回來重玩那一步
 */
const STAT_KEYS = [["goal", "🎯", "目標明確度"], ["intel", "🧭", "升學情報"], ["prep", "🎒", "準備程度"], ["time", "⏰", "時間意識"], ["explore", "🔍", "探索力"]];
const fresh = () => ({ v: 4, step: 0, done: false, mon: 9, name: "", p: {}, mind: "", stats: { goal: 0, intel: 0, prep: 0, time: 0, explore: 0 },
  frags: [], unlocked: [], known: false, fork: "", world: "", target: "", npc: "", rechose: false, later: false,
  willing: [], equip: [], main: "", backup: "", alt: "", ending: "", saved: 0 });
let S = fresh(), H = [];
const H_MAX = 40;
const save = () => { S.saved = Date.now(); try { localStorage.setItem(SAVE_KEY, JSON.stringify({ S, H: H.slice(-H_MAX) })); } catch (e) {} };
const load = () => { try { const d = JSON.parse(localStorage.getItem(SAVE_KEY)); return d && d.S && d.S.v === 4 ? { S: d.S, H: Array.isArray(d.H) ? d.H : [] } : null; } catch (e) { return null; } };
const wipe = () => { try { localStorage.removeItem(SAVE_KEY); } catch (e) {} };

/* ---------------- 資料層：條件比對與資格判斷 ---------------- */
function match(cond, p) {
  if (!cond) return true;
  return Object.entries(cond).every(([k, want]) => {
    if (k === "any") return want.some(c => match(c, p));
    if (k === "not") return !match(want, p);
    const have = p[k];
    if (Array.isArray(want)) return want.includes(have);
    if (want && typeof want === "object") {
      if ("any" in want) return Array.isArray(have) && have.some(x => want.any.includes(x));
      if ("not" in want) return Array.isArray(want.not) ? !want.not.includes(have) : have !== want.not;
    }
    return have === want;
  });
}
function elig(id) {
  const P = PMAP[id];
  for (const r of P.rules || []) if (match(r.when, S.p)) return { st: r.st, why: r.why };
  return P.otherwise || { st: "y", why: "" };
}
const ST_TXT = { g: "可以走", y: "需要確認", r: "目前不符合" };
const passable = () => PATHS.filter(P => elig(P.id).st !== "r").map(P => P.id);

/* 日期 */
/* 真實的今天：手機的系統時間（手機會自動和網路對時）
 * 開啟遊戲時再用伺服器回應的 Date 標頭核對一次；手機日期差太多時改用網路時間。
 * 測試用：網址加上 ?today=2027-03-01 可以模擬任何一天。 */
const SIM_DAY = (() => { const q = new URLSearchParams(location.search).get("today"); return q && /^\d{4}-\d{2}-\d{2}$/.test(q) ? q : ""; })();
let TODAY = (() => { const d = SIM_DAY ? new Date(SIM_DAY + "T00:00:00") : new Date(); d.setHours(0, 0, 0, 0); return d; })();
let CLOCK = SIM_DAY ? "sim" : "device"; // sim 模擬／device 手機時間／net 已和網路對時／fixed 手機時間不準，改用網路時間
async function syncClock() {
  if (SIM_DAY || !/^https?:/.test(location.protocol)) return;
  try {
    const ctl = new AbortController(), tm = setTimeout(() => ctl.abort(), 2500);
    const r = await fetch(location.href.split("#")[0], { method: "HEAD", cache: "no-store", signal: ctl.signal });
    clearTimeout(tm);
    const srv = new Date(r.headers.get("date") || "");
    if (isNaN(srv)) return;
    CLOCK = "net";
    if (Math.abs(srv - Date.now()) > 12 * 36e5) { const d = new Date(srv); d.setHours(0, 0, 0, 0); TODAY = d; CLOCK = "fixed"; }
  } catch (e) {}
}
const clockNote = () => ({ sim: "（模擬日期）", net: "（已和網路對時）", fixed: "（你的手機日期不準，已改用網路時間）", device: "（手機日期）" }[CLOCK]);
const toDate = s => s ? new Date(s + "T00:00:00") : null;
const md = d => `${d.getMonth() + 1}/${d.getDate()}`;
const daysBetween = (a, b) => Math.round((b - a) / 864e5);
const evRange = e => e.to ? `${md(toDate(e.from))}～${md(toDate(e.to))}` : md(toDate(e.from));
const keyEvent = P => P.events.find(e => e.key) || P.events[0];
function nextEvent(P, ref = TODAY) {
  for (const e of P.events) {
    const s = toDate(e.from), en = toDate(e.to || e.from);
    if (ref < s) return { e, live: false, days: daysBetween(ref, s) };
    if (ref <= en) return { e, live: true, days: daysBetween(ref, en) };
  }
  return null;
}
/* 劇情時間：高三這一年 */
const SY = D.meta.schoolYear, START = toDate(SY.start), GRAD = toDate(SY.graduation);
const storyDate = mmdd => { const [m, d] = mmdd.split("-").map(Number); return new Date(m >= START.getMonth() + 1 ? START.getFullYear() : START.getFullYear() + 1, m - 1, d); };
const MONTHS = Array.from({ length: 12 }, (_, i) => { const d = new Date(START.getFullYear(), START.getMonth() + i, 1); return { y: d.getFullYear(), m: d.getMonth() + 1 }; });
const monthIdx = d => Math.max(0, Math.min(11, (d.getFullYear() - START.getFullYear()) * 12 + d.getMonth() - START.getMonth()));
const GRAD_IDX = monthIdx(GRAD);
const tipFor = what => ((D.tips || []).find(t => new RegExp(t.match).test(what)) || {}).tip || "";
const myRoads = () => [S.main, S.backup, S.alt].filter(Boolean);
const ROLE = ["主攻", "備選", "備援"];
const briefingHTML = (ids, cls = "") => {
  const b = D.contact.briefing, need = ids.filter(id => PMAP[id] && PMAP[id].portfolio);
  return b && need.length ? `<div class="brief ${cls}">💡 ${need.map(id => PMAP[id].icon).join("")} ${esc(b.text)} <a href="${esc(b.url)}" target="_blank" rel="noopener">看說明會資訊 ›</a></div>` : "";
};
const QR = window.QR_CODES || {};
const qrHTML = (url, cap) => QR[url] ? `<figure class="qr"><div class="qrimg">${QR[url]}</div><figcaption>${esc(cap)}</figcaption></figure>` : "";
const deptLink = d => d.url || window.CSU_DEPT_FALLBACK || window.CSU_DEPT_LINK || D.contact.site;
function guideQRs() {
  const list = [], seen = new Set(), add = (u, cap) => { if (u && QR[u] && !seen.has(u)) { seen.add(u); list.push([u, cap]); } };
  myRoads().forEach((id, i) => { if (i < 2) add(PMAP[id].url, `${ROLE[i]}・${PMAP[id].road}`); });
  add(D.contact.line, "正修官方LINE@");
  if (list.length < 3) add(window.CSU_DEPT_LINK, "正修科系介紹");
  return list.slice(0, 3);
}
const allConfirmed = () => PATHS.every(P => P.status === "confirmed");

/* 每條路的「入口」：events 裡標 gate: true 的那一項；沒有標就用第一項（通常是第一個報名）
 * 入口過了 = 今年這條路已經走不了（已截止），不要再為它準備 */
const gateOf = P => P.events.find(e => e.gate) || P.events[0];
function roadTime(id, ref = TODAY) {
  const e = gateOf(PMAP[id]), s = toDate(e.from), en = toDate(e.to || e.from);
  if (ref > en) return { st: "missed", e, days: daysBetween(en, ref) };
  if (ref >= s) return { st: "open", e, days: daysBetween(ref, en) };
  return { st: "soon", e, days: daysBetween(ref, s) };
}
const missed = id => roadTime(id).st === "missed";
const SOON_DAYS = 30;
function timeBadge(id) {
  const t = roadTime(id);
  if (t.st === "missed") return `<em class="tbadge missed">⛔ 今年已截止（${md(toDate(t.e.to || t.e.from))}）</em>`;
  if (t.st === "open") return `<em class="tbadge open">🔥 ${esc(t.e.what)}中・剩 ${t.days} 天</em>`;
  if (t.days <= SOON_DAYS) return `<em class="tbadge soon">⏳ ${t.days} 天後開始${esc(t.e.what)}</em>`;
  return "";
}
const timeText = id => { const t = roadTime(id);
  return t.st === "missed" ? `今年已截止（${evRange(t.e)}）` : t.st === "open" ? `「${t.e.what}」進行中，剩 ${t.days} 天` : `${t.days} 天後開始「${t.e.what}」（${evRange(t.e)}）`; };
/* 資料是否已全部過期（例如還沒更新到下一學年度） */
const dataExpired = () => PATHS.every(P => toDate(P.events[P.events.length - 1].to || P.events[P.events.length - 1].from) < TODAY);

/* ---------------- HUD ---------------- */
function hud() {
  $("#dayNum").textContent = S.mon;
  $("#stats").hidden = !S.mind;
  $("#stats").innerHTML = STAT_KEYS.map(([k, ic, nm]) =>
    `<div class="stat" data-k="${k}" title="${nm}"><span aria-hidden="true">${ic}</span><span class="sr">${nm}</span>
      <div class="bar"><i style="width:${S.stats[k]}%"></i></div></div>`).join("");
  $("#fragN").textContent = S.frags.length;
  $("#btnDex").disabled = S.frags.length < T.unlockAt;
  $("#btnCity").disabled = curStage() < 2 && !S.done;
  $("#btnBag").disabled = !S.equip.length;
}
function statUp(o) {
  for (const [k, v] of Object.entries(o)) {
    S.stats[k] = Math.max(0, Math.min(100, S.stats[k] + v));
    const nm = STAT_KEYS.find(x => x[0] === k);
    if (v) toast(`${nm[1]} ${nm[2]} ${v > 0 ? "+" : ""}${v}`);
  }
  hud();
  for (const k of Object.keys(o)) { const el = document.querySelector(`.stat[data-k="${k}"]`); if (el) { el.classList.add("bump"); setTimeout(() => el.classList.remove("bump"), 900); } }
}
function toast(t) { const box = $("#toasts"); while (box.children.length >= 3) box.firstElementChild.remove(); const el = document.createElement("div"); el.className = "toast"; el.textContent = t; $("#toasts").append(el); setTimeout(() => el.remove(), 1900); }

/* ---------------- 對話與選擇 ---------------- */
function faceOf(who) {
  if (who === "me") return { face: "🙋", name: S.name || "你", color: "#BFE6FF" };
  if (who === "sys") return { face: "📣", name: "", color: "#FFD84A" };
  const n = T.npcs[who]; return n ? { face: n.face, name: n.name, color: n.color } : { face: "💬", name: "", color: "#ddd" };
}
function sayBox() { let b = stage.querySelector(".dlgwrap"); if (!b) { b = document.createElement("div"); b.className = "dlgwrap"; stage.append(b); } return b; }
async function say(lines) {
  for (const [who, raw] of lines) {
    const text = raw.replace(/\{name\}/g, S.name || "你");
    const f = faceOf(who), box = sayBox();
    box.innerHTML = `<div class="dlg tap ${who === "me" ? "me" : who === "sys" ? "sys" : ""}" role="button" tabindex="0" aria-label="繼續">
      ${f.name ? `<div class="who"><span class="face" style="background:${f.color}">${f.face}</span>${esc(f.name)}</div>` : ""}
      <div class="txt" aria-live="polite"></div><span class="next" aria-hidden="true">▼</span></div>`;
    const d = box.firstElementChild, tx = d.querySelector(".txt");
    d.focus({ preventScroll: true });
    await new Promise(res => {
      let i = 0, full = false, timer;
      const finish = () => { full = true; clearInterval(timer); tx.textContent = text; };
      if (RM) finish(); else timer = setInterval(() => { tx.textContent = text.slice(0, ++i); if (i >= text.length) finish(); }, 22);
      const go = e => { if (e.type === "keydown" && !["Enter", " "].includes(e.key)) return; e.preventDefault(); if (!full) finish(); else { d.removeEventListener("click", go); d.removeEventListener("keydown", go); res(); } };
      d.addEventListener("click", go); d.addEventListener("keydown", go);
    });
  }
}
function clearDlg() { const b = stage.querySelector(".dlgwrap"); if (b) b.remove(); }
async function choose(prompt, opts, cfg = {}) {
  if (prompt) await sayPrompt(cfg.who || "sys", prompt);
  const box = document.createElement("div"); box.className = "choices" + (cfg.two ? " two" : "");
  stage.append(box);
  const sel = new Set((cfg.preset || []).map(v => opts.findIndex(o => o.v === v)).filter(i => i >= 0));
  box.innerHTML = opts.map((o, i) => `<button class="opt ${o.cls || ""}${sel.has(i) ? " sel" : ""}" data-i="${i}" ${cfg.multi ? `aria-pressed="${sel.has(i)}"` : ""}>
    ${o.icon ? `<span class="ic" aria-hidden="true">${o.icon}</span>` : ""}<span>${esc(o.label)}${o.hint ? `<span class="hint">${esc(o.hint)}</span>` : ""}</span>${o.tag ? `<span class="sttag ${o.tag.st}">${o.tag.st === "g" ? "✔" : "！"} ${esc(o.tag.text)}</span>` : ""}</button>`).join("")
    + (cfg.multi ? `<button class="cta" data-ok ${cfg.preset && cfg.preset.length ? "" : "disabled"}>${esc(cfg.okLabel || "就這些，出發")}</button>` : "");
  box.querySelector("button").focus({ preventScroll: true });
  box.scrollIntoView({ behavior: RM ? "auto" : "smooth", block: "nearest" });
  return new Promise(res => {
    box.addEventListener("click", e => {
      const b = e.target.closest("button"); if (!b) return;
      if (b.hasAttribute("data-ok")) { box.remove(); clearDlg(); return res([...sel].map(i => opts[i].v)); }
      const i = +b.dataset.i;
      if (!cfg.multi) { box.remove(); clearDlg(); return res(opts[i].v); }
      const o = opts[i];
      if (sel.has(i)) sel.delete(i); else {
        if (o.v === "none") sel.clear(); else opts.forEach((x, j) => { if (x.v === "none") sel.delete(j); });
        sel.add(i);
      }
      box.querySelectorAll(".opt").forEach(el => { const on = sel.has(+el.dataset.i); el.classList.toggle("sel", on); el.setAttribute("aria-pressed", on); });
      box.querySelector("[data-ok]").disabled = !sel.size;
      cfg.onChange && cfg.onChange([...sel].map(j => opts[j].v));
    });
  });
}
async function sayPrompt(who, text) { // 問題用：顯示後不必點擊
  const f = faceOf(who), box = sayBox();
  box.innerHTML = `<div class="dlg ${who === "sys" ? "sys" : who === "me" ? "me" : ""}">${f.name ? `<div class="who"><span class="face" style="background:${f.color}">${f.face}</span>${esc(f.name)}</div>` : ""}<div class="txt">${esc(text.replace(/\{name\}/g, S.name || "你"))}</div></div>`;
}
async function askText(prompt, ph, okLabel = "確定", skipLabel = "先跳過") {
  await sayPrompt("sys", prompt);
  const box = document.createElement("div"); box.className = "choices";
  box.innerHTML = `<input class="input" maxlength="20" placeholder="${esc(ph)}" aria-label="${esc(prompt)}"><div class="row-btns"><button class="cta" data-ok>${esc(okLabel)}</button><button class="cta ghost" data-skip>${esc(skipLabel)}</button></div>`;
  stage.append(box); const inp = box.querySelector("input"); inp.focus();
  return new Promise(res => {
    const done = v => { box.remove(); clearDlg(); res(v); };
    box.querySelector("[data-ok]").onclick = () => done(inp.value.trim());
    box.querySelector("[data-skip]").onclick = () => done("");
    inp.onkeydown = e => { if (e.key === "Enter") done(inp.value.trim()); };
  });
}
function tapBtn(html, cls = "cta") {
  const b = document.createElement("button"); b.className = cls; b.innerHTML = html; stage.append(b); b.focus({ preventScroll: true });
  return new Promise(r => b.onclick = () => { b.remove(); r(); });
}

/* ---------------- 畫面元件 ---------------- */
// 一條路分成三條：藍、綠、黃，對應下方三個選項
const FORK_SVG = `<svg class="fork" viewBox="0 0 300 150" role="img" aria-label="一條路分岔成藍、綠、黃三條路">
  <g fill="none" stroke-linecap="round">
    <path d="M150 150 L150 100" stroke="#B8C6B9" stroke-width="26"/>
    <path d="M150 104 C150 70 70 70 46 18" stroke="#7CC8FF" stroke-width="20"/>
    <path d="M150 104 L150 14" stroke="#6FE0B0" stroke-width="20"/>
    <path d="M150 104 C150 70 230 70 254 18" stroke="#FFD84A" stroke-width="20"/>
    <g stroke="#1D3A2E" stroke-width="2.5" stroke-dasharray="6 7" opacity=".7">
      <path d="M150 150 L150 104"/><path d="M150 104 C150 70 70 70 46 18"/><path d="M150 104 L150 14"/><path d="M150 104 C150 70 230 70 254 18"/>
    </g>
  </g>
  <g stroke="#F3F1E6" stroke-width="3"><circle cx="46" cy="18" r="9" fill="#7CC8FF"/><circle cx="150" cy="14" r="9" fill="#6FE0B0"/><circle cx="254" cy="18" r="9" fill="#FFD84A"/></g>
</svg>`;
function setScene(html) { stage.innerHTML = `<div class="scene">${html}</div>`; window.scrollTo(0, 0); }
const trayHTML = () => `<div class="tray" aria-hidden="true"><i class="chalk w"></i><i class="chalk y"></i><i class="chalk p"></i><i class="eraser"></i></div>`;
const boardHTML = (inner, cls = "") => `<div class="board ${cls}">${inner}</div>${trayHTML()}`;
const daysToGrad = d => daysBetween(d, GRAD);
let NOW = START; // 劇情中的「今天」
function piecesHTML() { return `<div class="pieces">${Array.from({ length: Object.keys(T.fragments).length }, (_, i) => `<i class="${i < S.frags.length ? "on" : ""}"></i>`).join("")}</div>`; }
async function gainFragment(key) {
  if (S.frags.includes(key)) return;
  S.frags.push(key); save(); hud();
  await modal(`<div class="frag"><div class="icon">🧩</div><div class="num">情報碎片 ${S.frags.length}</div><p>${esc(T.fragments[key])}</p>${piecesHTML()}</div>`, "收下");
  if (S.frags.length === T.unlockAt) {
    await modal(`<div class="frag"><div class="icon">🗺️</div><div class="num">新功能解鎖</div><p>升學路線圖鑑</p><p class="small" style="font-family:var(--sans);font-size:15px;color:var(--ink-2)">畫面上方的 🗺️ 隨時可以打開。<br>走到哪、看到哪，道路會一條條亮起來。</p></div>`, "好");
  }
}
function unlock(ids) { let n = 0; for (const id of ids) if (PMAP[id] && !S.unlocked.includes(id)) { S.unlocked.push(id); n++; } if (n) { toast(`🗺️ 解鎖 ${n} 條道路`); save(); } }
function roadRow(id, opt = {}) {
  const P = PMAP[id], open = S.unlocked.includes(id) || opt.force;
  if (!open) return `<button class="road locked" data-road="${id}" disabled><span class="ic">🔒</span><span class="t"><b>？？？之路</b><span>繼續旅程就會解鎖</span></span></button>`;
  const e = S.known ? elig(id) : null;
  const mis = missed(id);
  return `<button class="road ${opt.pop ? "pop" : ""}${mis ? " is-missed" : ""}" style="--c:${P.color};${opt.delay ? `animation-delay:${opt.delay}ms` : ""}" data-road="${id}">
    <span class="ic">${P.icon}</span><span class="t"><b>${opt.role ? `<span class="role">${opt.role}</span>` : ""}${esc(P.road)}</b><span>${esc(opt.why && e ? e.why : `${P.name}・${P.exam.label}`)}</span>${timeBadge(id)}</span>
    ${e ? `<span class="light ${e.st}" title="${ST_TXT[e.st]}" aria-label="${ST_TXT[e.st]}"></span>` : `<span class="light u" aria-hidden="true"></span>`}</button>`;
}

/* ---------------- 可拖曳的一年時間軸 ----------------
 * yearTimeline(host, ids, { idx, onMove })
 * 月份橫向排列，可以左右拖曳；下方滑桿移動「現在」的月份，顯示這個月要做什麼。
 */
function yearTimeline(host, ids, cfg = {}) {
  const evs = ids.flatMap(id => PMAP[id].events.map(e => ({ P: PMAP[id], e, mi: monthIdx(toDate(e.from)) })));
  const cell = (id, mi) => PMAP[id].events.filter(e => monthIdx(toDate(e.from)) === mi)
    .map(e => `<span class="mk" style="--c:${PMAP[id].color}" title="${esc(e.what)}">${esc(e.what)}</span>`).join("");
  host.innerHTML = `<div class="ytl">
    <div class="ystrip" tabindex="0" aria-label="一年時間軸，可以左右拖曳">
      <div class="ygrid" style="grid-template-columns:86px repeat(12,112px)">
        <div class="yh lab">月份</div>${MONTHS.map((M, i) => `<button class="yh" data-mi="${i}">${M.m}月${i === GRAD_IDX ? " 🎓" : ""}</button>`).join("")}
        ${ids.map(id => `<div class="yl lab" style="--c:${PMAP[id].color}">${PMAP[id].icon} ${esc(PMAP[id].road.replace("之路", ""))}</div>${MONTHS.map((M, i) => `<div class="yc" data-mi="${i}">${cell(id, i)}</div>`).join("")}`).join("")}
      </div>
    </div>
    <div class="yslider-wrap"><span class="small">${MONTHS[0].m}月</span><input type="range" class="yslider" min="0" max="11" step="1" value="${cfg.idx || 0}" aria-label="拖曳選擇月份"><span class="small">${MONTHS[11].m}月</span></div>
    <div class="ymonth" aria-live="polite"></div></div>`;
  const strip = host.querySelector(".ystrip"), slider = host.querySelector(".yslider"), out = host.querySelector(".ymonth");
  const set = (i, fromUser) => {
    i = +i; slider.value = i;
    host.querySelectorAll("[data-mi]").forEach(el => { const mi = +el.dataset.mi; el.classList.toggle("on", mi === i); el.classList.toggle("past", mi < i); });
    const col = host.querySelector(`.yh[data-mi="${i}"]`);
    if (col) strip.scrollTo({ left: col.offsetLeft - 86 - (strip.clientWidth - 86 - 112) / 2, behavior: RM ? "auto" : "smooth" });
    const list = evs.filter(x => x.mi === i).sort((a, b) => a.e.from.localeCompare(b.e.from));
    out.innerHTML = `<div class="ym-h">${MONTHS[i].y}年 ${MONTHS[i].m}月${i === GRAD_IDX ? "・🎓 畢業典禮" : ""}</div>` + (list.length ? list.map(x =>
      `<div class="ym-e" style="--c:${x.P.color}"><div class="dt">${evRange(x.e)}</div><div><b>${x.P.icon} ${esc(x.e.what)}</b> <span class="small muted">${esc(x.P.road)}</span>${tipFor(x.e.what) ? `<div class="tip">👉 ${esc(tipFor(x.e.what))}</div>` : ""}</div></div>`).join("")
      : `<div class="small muted">這個月，你的道路沒有重要時程。${i === GRAD_IDX ? "好好享受畢業典禮！" : ""}</div>`);
    cfg.onMove && cfg.onMove(i, fromUser);
  };
  slider.addEventListener("input", () => set(slider.value, true));
  host.querySelectorAll(".yh[data-mi]").forEach(b => b.onclick = () => set(b.dataset.mi, true));
  // 滑鼠拖曳捲動（手機用手指本來就能滑）
  let down = false, sx = 0, sl = 0;
  strip.addEventListener("pointerdown", e => { if (e.pointerType !== "mouse") return; down = true; sx = e.clientX; sl = strip.scrollLeft; strip.classList.add("drag"); });
  addEventListener("pointermove", e => { if (down) strip.scrollLeft = sl - (e.clientX - sx); });
  addEventListener("pointerup", () => { down = false; strip.classList.remove("drag"); });
  requestAnimationFrame(() => set(cfg.idx || 0, false));
  return { set };
}
/* 直式完整時間軸（以真實的今天計算） */
function eventListHTML(ids) {
  const all = ids.flatMap(id => PMAP[id].events.map(e => ({ P: PMAP[id], e }))).sort((a, b) => a.e.from.localeCompare(b.e.from));
  let marked = false;
  return `<div class="tlv">${all.map(({ P, e }) => {
    const s = toDate(e.from), en = toDate(e.to || e.from); let cls = "", tag = "";
    if (TODAY > en) { cls = "past"; tag = "已結束"; }
    else if (TODAY >= s) { cls = "now"; tag = `進行中・剩 ${daysBetween(TODAY, en)} 天`; }
    else { tag = `還有 ${daysBetween(TODAY, s)} 天`; if (!marked) { cls = "next"; marked = true; tag = "下一步・" + tag; } }
    return `<div class="tli ${cls}" style="--c:${P.color}"><div class="d">${evRange(e)}<span class="s">${tag}</span></div><div class="w">${P.icon} ${esc(e.what)} <span class="small muted">${esc(P.road)}</span></div>${tipFor(e.what) ? `<div class="h">👉 ${esc(tipFor(e.what))}</div>` : ""}</div>`;
  }).join("")}</div>`;
}
/* 加入手機行事曆（.ics） */
function downloadICS(ids) {
  const pad = n => String(n).padStart(2, "0"), ymd = d => `${d.getFullYear()}${pad(d.getMonth() + 1)}${pad(d.getDate())}`;
  const stamp = new Date().toISOString().replace(/[-:]/g, "").replace(/\.\d+/, "");
  const escI = t => String(t).replace(/[\\,;]/g, m => "\\" + m).replace(/\n/g, "\\n");
  const lines = ["BEGIN:VCALENDAR", "VERSION:2.0", "PRODID:-//CSU//grad-journey//ZH-TW", "CALSCALE:GREGORIAN", `X-WR-CALNAME:我的升學時間軸 ${D.meta.cycle}`];
  ids.forEach(id => { const P = PMAP[id]; P.events.forEach((e, k) => {
    if (toDate(e.to || e.from) < TODAY) return; // 已經過去的不放進行事曆
    const s = toDate(e.from), en = toDate(e.to || e.from); en.setDate(en.getDate() + 1);
    const est = !(e.confirmed || P.status === "confirmed");
    lines.push("BEGIN:VEVENT", `UID:${id}-${k}-${e.from}@grad-journey`, `DTSTAMP:${stamp}`, `DTSTART;VALUE=DATE:${ymd(s)}`, `DTEND;VALUE=DATE:${ymd(en)}`,
      `SUMMARY:${escI(`${P.icon} ${P.road}：${e.what}${est ? "（推估）" : ""}`)}`,
      `DESCRIPTION:${escI(`${tipFor(e.what)}\n${est ? D.meta.note + "\n" : ""}${P.url}`)}`,
      "BEGIN:VALARM", "ACTION:DISPLAY", "DESCRIPTION:升學提醒", "TRIGGER:-P3D", "END:VALARM", "END:VEVENT"); }); });
  lines.push("END:VCALENDAR");
  const a = document.createElement("a"); a.href = URL.createObjectURL(new Blob([lines.join("\r\n")], { type: "text/calendar;charset=utf-8" }));
  a.download = "我的升學時間軸.ics"; document.body.append(a); a.click(); setTimeout(() => { URL.revokeObjectURL(a.href); a.remove(); }, 1000);
  toast("📅 已下載行事曆檔，點開即可加入手機");
}

/* ---------------- Overlay：圖鑑、未來城市、通用 modal ---------------- */
const ov = $("#overlay");
function sheet(title, body, onClose) {
  ov.hidden = false; ov.style.alignItems = "";
  ov.innerHTML = `<div class="sheet" role="dialog" aria-modal="true" aria-label="${esc(title)}"><header><h2>${title}</h2><button class="x" aria-label="關閉">✕</button></header><div class="sb">${body}</div></div>`;
  const close = () => { ov.hidden = true; ov.innerHTML = ""; onClose && onClose(); };
  ov.querySelector(".x").onclick = close;
  ov.onclick = e => { if (e.target === ov) close(); };
  ov.querySelector(".x").focus();
  return { el: ov.querySelector(".sb"), close, top: () => { ov.querySelector(".sheet").scrollTop = 0; } };
}
function modal(html, btn = "好") {
  return new Promise(res => {
    ov.hidden = false;
    ov.innerHTML = `<div class="sheet" role="dialog" aria-modal="true" style="background:transparent;border:none">${html}<div style="height:12px"></div><button class="cta">${esc(btn)}</button></div>`;
    ov.style.alignItems = "center";
    const b = ov.querySelector(".cta"); b.focus();
    b.onclick = () => { ov.hidden = true; ov.innerHTML = ""; ov.style.alignItems = ""; res(); };
  });
}
const estNote = () => allConfirmed() ? "" : `<div class="note-est">📅 ${esc(D.meta.cycle)}：${esc(D.meta.note)}</div>`;
function openDex(focusId, tab = "cards") {
  const known = S.known, st = { tab, mine: false };
  const ids = () => PATHS.map(P => P.id).filter(id => !st.mine || elig(id).st !== "r");
  const tabs = () => `<div class="tabs"><button class="tab" data-t="cards" aria-pressed="${st.tab === "cards"}">📇 道路卡</button><button class="tab" data-t="cal" aria-pressed="${st.tab === "cal"}">📅 一年時間軸</button>${known ? `<button class="tab" data-m aria-pressed="${st.mine}">${st.mine ? "✅" : "☐"} 只看我能走的</button>` : ""}</div>`;
  const list = () => {
    if (st.tab === "cal") { const open = ids().filter(id => S.unlocked.includes(id)); s.el.innerHTML = `${estNote()}${tabs()}${open.length ? `<p class="small muted" style="margin:0 0 6px">左右拖曳看整年；拉動下方滑桿，看每個月要做什麼。</p><div id="dexTl"></div>` : `<p class="muted">還沒有解鎖的道路。</p>`}`; if (open.length) yearTimeline($("#dexTl"), open, { idx: monthIdx(TODAY) }); }
    else s.el.innerHTML = `${estNote()}${tabs()}<p class="small muted" style="margin:0 0 8px">已解鎖 ${S.unlocked.length}／${PATHS.length} 條道路${known ? "　🟢可以走 🟡需要確認 🔴目前不符合" : ""}</p><div class="roads">${ids().map(id => roadRow(id)).join("")}</div>`;
  };
  const s = sheet("🗺️ 升學路線圖鑑", "");
  const showDetail = id => {
    const P = PMAP[id], e = known ? elig(id) : null, nx = nextEvent(P);
    s.el.innerHTML = `<button class="opt quiet" data-back style="margin-bottom:10px">← 回到所有道路</button>
      <div class="card" style="border-left:8px solid ${P.color}"><h3>${P.icon} ${esc(P.road)}</h3><div class="meta">${esc(P.name)}</div></div>
      ${e ? `<div class="status"><span class="light ${e.st}"></span><span><b>${ST_TXT[e.st]}</b>　${esc(e.why)}</span></div>` : ""}
      <div class="status tstat ${roadTime(id).st}">📅 <span>今天 ${md(TODAY)}：<b>${esc(timeText(id))}</b>${missed(id) ? "<br>今年來不及了，不用再為它準備；下一學年度再留意。" : ""}</span></div>
      <div class="detail">
        <section><h4>適合誰</h4>${esc(P.who)}</section>
        <section><h4>基本條件</h4><ul>${P.conditions.map(c => `<li>${esc(c)}</li>`).join("")}</ul></section>
        <section><h4>要考試嗎？</h4><b>${esc(P.exam.label)}</b>　${esc(P.exam.detail)}</section>
        <section><h4>要準備什麼</h4><ul>${P.prep.map(c => `<li>${esc(c)}</li>`).join("")}</ul></section>
        <section><h4>重要時間 ${P.status !== "confirmed" ? `<span class="badge" style="color:var(--note)">推估</span>` : ""}<span class="small muted" style="font-weight:400">　倒數以今天日期計算</span></h4>
          ${P.events.map(ev => { const past = toDate(ev.to || ev.from) < TODAY, isNext = nx && nx.e === ev;
            return `<div class="ev ${isNext ? "next" : ""} ${past ? "past" : ""}"><span class="dt">${evRange(ev)}</span><span>${esc(ev.what)}${ev.confirmed ? `<span class="badge">已公告</span>` : ""}${isNext ? `<span class="badge">${nx.live ? `進行中・剩 ${nx.days} 天` : `還有 ${nx.days} 天`}</span>` : ""}</span></div>`; }).join("")}</section>
        <section><h4>可能遇到的問題</h4><ul>${P.pitfalls.map(c => `<li>${esc(c)}</li>`).join("")}</ul></section>
        <section><h4>在正修</h4>${esc(P.csu)}${briefingHTML([id])}</section>
      </div>
      <div style="height:14px"></div><a class="cta" style="text-align:center;text-decoration:none" href="${esc(P.url)}" target="_blank" rel="noopener">查看完整資訊</a>
      ${QR[P.url] ? `<div class="qrrow" style="margin-top:12px">${qrHTML(P.url, "用手機掃描，看完整資訊")}</div>` : ""}`;
    s.top();
  };
  s.el.addEventListener("click", ev => {
    const t = ev.target.closest("[data-t]"), m = ev.target.closest("[data-m]"), back = ev.target.closest("[data-back]"), b = ev.target.closest("[data-road]");
    if (t) { st.tab = t.dataset.t; list(); } else if (m) { st.mine = !st.mine; list(); } else if (back) list(); else if (b && !b.disabled) showDetail(b.dataset.road);
  });
  if (focusId) showDetail(focusId); else list();
}
function worldHTML(w) {
  return `<p class="muted" style="margin:0 0 8px">${w.icon} ${esc(w.line)}</p><div class="roads">${w.depts.map(d =>
    `<div class="dept"><b>${esc(d.name)}</b>${d.check ? ` <span class="chip warn">資料確認中</span>` : ""}<p>${esc(d.learn)}</p><div class="jobs">${d.jobs.map(j => `<span class="chip">${esc(j)}</span>`).join("")}</div>
     <div style="margin-top:6px"><a href="${esc(deptLink(d))}" target="_blank" rel="noopener" class="small deptlink">了解這個系 ›</a></div></div>`).join("")}</div>`;
}
function openCity() {
  const link = window.CSU_DEPT_LINK || D.contact.site;
  const grid = () => `<p class="city-lead">了解正修的科系選擇</p><div class="worlds">${W.map(w =>
    `<button class="world ${S.world === w.id ? "on" : ""}" data-w="${w.id}"><span class="ic">${w.icon}</span><b>${esc(w.name)}</b><span>${w.depts.length} 個科系</span></button>`).join("")}</div>
    <div style="height:14px"></div><a class="cta" style="display:block;text-align:center;text-decoration:none" href="${esc(link)}" target="_blank" rel="noopener">科系探索：把興趣與升學對焦</a>
    <figure class="cityart"><img src="assets/future-city.jpg" alt="未來城市的學科交織：工程、科技、設計、餐旅、商管、照護、觀光與電競的人們" loading="lazy" width="384" height="575"></figure>`;
  const s = sheet("🏙️ 未來城市", grid());
  s.el.addEventListener("click", e => {
    const b = e.target.closest("[data-w]"), back = e.target.closest("[data-back]"), pick = e.target.closest("[data-pick]");
    if (back) { s.el.innerHTML = grid(); return; }
    if (pick) { S.world = pick.dataset.pick; save(); toast("🎯 已設成夢想方向"); s.el.innerHTML = grid(); return; }
    if (b) { const w = W.find(x => x.id === b.dataset.w); s.el.innerHTML = `<button class="opt quiet" data-back style="margin-bottom:10px">← 回到未來城市</button><h3 style="margin:0 0 4px;font-family:var(--hand);font-size:22px">${w.icon} ${esc(w.name)}</h3>${worldHTML(w)}
      <div style="height:12px"></div>${curStage() >= 2 ? `<button class="cta" data-pick="${w.id}">${S.world === w.id ? "✔ 這是我的夢想方向" : "設成我的夢想方向"}</button>` : ""}`; s.top(); }
  });
}
function openFrags() {
  sheet("🧩 情報碎片", `${piecesHTML()}<div class="roads" style="margin-top:12px">${S.frags.length ? S.frags.map((k, i) => `<div class="card"><span class="meta">碎片 ${i + 1}</span><div style="font-family:var(--hand);font-size:19px">${esc(T.fragments[k])}</div></div>`).join("") : `<p class="muted">還沒有碎片。和同學、學長姐聊聊天就會出現。</p>`}</div>
    ${S.frags.length < T.unlockAt ? `<p class="small muted">再收集 ${T.unlockAt - S.frags.length} 片，就能解鎖升學路線圖鑑。</p>` : ""}`);
}

/* ---------------- 裝備：每一件都能用 ---------------- */
const LINKS = { dept: () => window.CSU_DEPT_LINK || D.contact.site, visit: () => D.contact.visit || D.contact.site, line: () => D.contact.line };
const EQ = id => T.equipment.find(e => e.id === id);
function useEquip(id) {
  const e = EQ(id); if (!e) return;
  const [kind, arg] = e.use.split(":");
  if (kind === "link") {
    if (arg === "line") return sheet(`${e.icon} ${e.item}`, `<p>有問題請提出！加入正修官方 LINE@（不是群組）將有一對一的專人回答。</p>
      <a class="cta" style="display:block;text-align:center;text-decoration:none;background:#06C755;color:#fff;box-shadow:0 4px 0 #04913E" href="${esc(LINKS.line())}" target="_blank" rel="noopener">💬 加入正修官方LINE${esc(D.contact.lineId)}</a>
      <a class="cta ghost" style="display:block;text-align:center;text-decoration:none;margin-top:10px" href="${esc(D.contact.telLink || "#")}">📞 ${esc(D.contact.tel)}</a>
      <div class="qrrow">${qrHTML(LINKS.line(), "正修官方LINE@")}</div>`);
    return window.open(LINKS[arg](), "_blank", "noopener");
  }
  if (kind === "dex") return openDex();
  if (kind === "city") return openCity();
  if (kind === "elig") return openElig();
  if (kind === "time") return openTime();
  if (kind === "seniors") return openSeniors();
}
function openBag() {
  const all = T.equipment, mine = all.filter(e => S.equip.includes(e.id)), rest = all.filter(e => !S.equip.includes(e.id));
  const row = e => `<button class="tool" data-eq="${e.id}"><span class="ic">${e.icon}</span><span class="t"><b>${esc(e.item)}</b><span>${esc(e.label)}</span></span><span class="go">使用 ›</span></button>`;
  const s = sheet("🎒 我的背包", `${mine.length ? `<div class="roads">${mine.map(row).join("")}</div>` : `<p class="muted">背包是空的。</p>`}
    ${rest.length ? `<p class="small muted" style="margin:14px 0 6px">沒帶出門的裝備，也可以先借來用：</p><div class="roads dim">${rest.map(row).join("")}</div>` : ""}`);
  s.el.addEventListener("click", ev => { const b = ev.target.closest("[data-eq]"); if (b) useEquip(b.dataset.eq); });
}
function openElig() {
  if (!S.known) return sheet("📜 資格卷軸", `<p>完成「背包檢查」之後，卷軸上就會出現你可以走的路。</p>`);
  const order = { g: 0, y: 1, r: 2 }, ids = PATHS.map(P => P.id).sort((a, b) => order[elig(a).st] - order[elig(b).st]);
  const s = sheet("📜 資格卷軸", `<p class="small muted" style="margin:0 0 8px">${esc(idName())}　🟢可以走 🟡需要確認 🔴目前不符合</p><div class="roads">${ids.map(id => roadRow(id, { force: true, why: true })).join("")}</div>
    <p class="small muted">${esc(D.meta.sameEducationNote)}</p>`);
  s.el.addEventListener("click", ev => { const b = ev.target.closest("[data-road]"); if (b) openDex(b.dataset.road); });
}
function openTime() {
  const ids = myRoads().length ? myRoads() : (S.known ? recommend().slice(0, 3) : PATHS.slice(0, 3).map(P => P.id));
  const s = sheet("⏰ 時間警報器", `${estNote()}<p class="small muted" style="margin:0 0 6px">${myRoads().length ? "你選的道路" : "建議先看的道路"}：拖曳看整年，拉滑桿看每個月要做什麼。</p><div id="tmTl"></div>
    <button class="cta" id="ics" style="margin-top:12px">📅 全部加入手機行事曆（提前 3 天提醒）</button>
    <h3 class="subh">完整時間軸</h3>${eventListHTML(ids)}`);
  yearTimeline($("#tmTl"), ids, { idx: monthIdx(TODAY) });
  $("#ics").onclick = () => downloadICS(ids);
}
function openSeniors() {
  const s = sheet("🧭 學長姐的手繪地圖", `<div class="roads">${T.seniorStories.map(x => `<div class="card"><div style="font-size:32px">${x.face}</div><div class="meta">${esc(x.who)}</div>
    <p style="font-family:var(--hand);font-size:19px;margin:4px 0 8px">「${esc(x.text)}」</p>${x.paths.map(id => `<button class="opt quiet" style="color:var(--ink);border-color:#bbb" data-road="${id}">${PMAP[id].icon} 看看${esc(PMAP[id].road)}</button>`).join("")}</div>`).join("")}</div>`);
  s.el.addEventListener("click", ev => { const b = ev.target.closest("[data-road]"); if (b) { unlock([b.dataset.road]); openDex(b.dataset.road); } });
}

/* ---------------- 身分 ---------------- */
function idName() {
  const p = S.p;
  let n = p.vgen === "yes" ? "高職附設普通科" : { gen: "高中普通科", comp: "綜合高中", voc: "高職" }[p.type] || "高中職";
  if (p.type === "comp") n += p.track === "pro" ? "（專門學程）" : p.track === "aca" ? "（學術學程）" : "";
  if (p.art === "yes") n += "（藝術群）";
  return n + (p.grad === "past" ? "・已畢業" : "・應屆");
}

/* ===================================================================
 *  粉筆與板擦動畫
 * =================================================================== */
const SEG = typeof Intl !== "undefined" && Intl.Segmenter ? new Intl.Segmenter("zh-Hant", { granularity: "grapheme" }) : null;
const graphemes = t => SEG ? [...SEG.segment(t)].map(x => x.segment) : [...t];
let hurry = false; // 點一下黑板：剩下的字一次寫完
function stickOf(board) {
  let st = board.querySelector(":scope > .chalkstick");
  if (!st) { st = document.createElement("i"); st.className = "chalkstick"; st.setAttribute("aria-hidden", "true"); board.append(st); }
  return st;
}
function dust(board, x, y) {
  const d = document.createElement("i"); d.className = "dust"; d.setAttribute("aria-hidden", "true");
  d.style.left = x + (Math.random() * 10 - 5) + "px"; d.style.top = y + "px"; board.append(d);
  setTimeout(() => d.remove(), 800);
}
/* 粉筆逐字書寫：一個字一個字出現，粉筆跟著移動、掉一點粉筆灰 */
async function chalkWrite(el, text, o = {}) {
  const speed = o.speed || 32, board = el.closest(".board");
  el.textContent = ""; el.setAttribute("aria-label", text);
  const stick = board && !RM ? stickOf(board) : null;
  if (stick) stick.classList.remove("rest");
  const bRect = board && board.getBoundingClientRect();
  let n = 0;
  for (const ch of graphemes(text)) {
    const s = document.createElement("span"); s.className = "cc"; s.textContent = ch; s.setAttribute("aria-hidden", "true"); el.append(s);
    if (hurry || RM) continue;
    if (stick && ch.trim()) {
      const r = s.getBoundingClientRect(), x = r.right - bRect.left, y = r.bottom - bRect.top;
      stick.style.transform = `translate(${x - 4}px,${y - 30}px) rotate(-38deg)`;
      if (++n % 3 === 0) dust(board, x, y - 4);
    }
    await wait(ch.trim() ? speed : 8);
  }
  if (stick) stick.classList.add("rest");
}
/* 依序寫出 root 裡所有 [data-chalk]，寫完再顯示 .after */
async function writeAll(root, o = {}) {
  for (const el of root.querySelectorAll("[data-chalk]")) await chalkWrite(el, el.dataset.chalk, { speed: +el.dataset.speed || o.speed });
  root.querySelectorAll(".after").forEach(el => el.classList.add("on"));
}
/* 板擦：Z 字形來回擦過黑板，留下淡淡的擦痕 */
async function eraseBoard(board) {
  if (!board) return;
  const tray = board.nextElementSibling && board.nextElementSibling.classList.contains("tray") ? board.nextElementSibling : null;
  if (RM) { board.classList.add("erase"); await wait(120); return; }
  const cover = document.createElement("div"), er = document.createElement("div"), dur = 720;
  cover.className = "wipe"; er.className = "eraser-fly"; cover.setAttribute("aria-hidden", "true"); er.setAttribute("aria-hidden", "true");
  board.append(cover, er);
  if (tray) tray.classList.add("lift");
  if (cover.animate) {
    cover.animate([{ clipPath: "inset(0 100% 0 0)" }, { clipPath: "inset(0 0% 0 0)" }], { duration: dur, easing: "linear", fill: "forwards" });
    er.animate([
      { left: "-14%", top: "8%" }, { left: "4%", top: "66%" }, { left: "20%", top: "6%" }, { left: "36%", top: "68%" },
      { left: "52%", top: "8%" }, { left: "68%", top: "66%" }, { left: "84%", top: "10%" }, { left: "104%", top: "46%" }
    ], { duration: dur, easing: "linear", fill: "forwards" });
  }
  await wait(dur + 40);
  board.classList.add("smudge");
  if (tray) tray.classList.remove("lift");
}

/* ===================================================================
 *  關卡（任務列、過場）
 * =================================================================== */
const STG = T.stages, LAST = STG.length - 1;
const stNo = i => i === LAST ? "終章" : `第 ${i + 1} 關`;
const stNoShort = i => i === LAST ? "終章" : `${i + 1}/${LAST}`;
function curStage() { return S.done ? LAST : S.step < STEPS.length ? STEPS[S.step].stage : LAST; }
/* 劇情日期如果已經比真實的今天還早，就用今天（劇情不會倒退到過去） */
function setNow(i) { const d = storyDate(STG[i].date); NOW = d < TODAY ? new Date(TODAY) : d; S.mon = NOW.getMonth() + 1; }
const nowIsReal = () => NOW.getTime() === TODAY.getTime();
const isStageStart = i => i === 0 || (STEPS[i] && STEPS[i - 1] && STEPS[i].stage !== STEPS[i - 1].stage);
const canBack = () => H.some(e => STEPS[e.i] && !STEPS[e.i].auto);

/* 畫面上方的任務列：走到第幾關、這一關要做什麼 */
function mission(at) {
  const m = $("#mission"); if (!m) return;
  const cur = at == null ? curStage() : at, done = S.done;
  $("#mtrack").innerHTML = STG.map((st, i) => `<i class="${done || i < cur ? "done" : i === cur ? "on" : ""}" title="${esc(stNo(i))}：${esc(st.title)}">${i === LAST ? "🎓" : done || i < cur ? "✓" : i + 1}</i>`).join("");
  const st = STG[cur];
  $("#mgoal").innerHTML = done
    ? `<b>🏆 旅程完成</b><span>攻略卡可以下載、隨時回來看</span>`
    : `<b>${esc(stNo(cur))}・${st.icon} ${esc(st.title)}</b><span>🎯 ${esc(st.mission)}</span>`;
  $("#btnBack").disabled = !canBack();
}
function openRoadmap() {
  const cur = curStage();
  sheet("🗺️ 旅程地圖", `<p class="small muted" style="margin:0 0 10px">高三這一年分成 ${LAST} 關＋終章。每一關都有一個任務，完成就往下一關。</p>
    <div class="rm">${STG.map((st, i) => { const state = S.done || i < cur ? "done" : i === cur ? "on" : "";
      return `<div class="rm-i ${state}"><div class="rm-n">${state === "done" ? "✓" : i === LAST ? "🎓" : i + 1}</div><div><b>${esc(stNo(i))}・${st.icon} ${esc(st.title)}</b>${state === "on" ? `<span class="rm-now">現在在這裡</span>` : ""}
        <div class="rm-g">🎯 ${esc(st.mission)}</div><div class="rm-w">💡 ${esc(st.why)}</div></div></div>`; }).join("")}</div>
    <p class="small muted">↩ 上一步：回到前一個選擇重新選　💾 暫存：每一步都會自動存檔</p>`);
}

/* 每一關結束時，黑板上寫的「這一關你拿到了什麼」 */
const CLEAR = {
  me: () => { const M = T.mindsets.find(x => x.id === S.mind); return [`${M ? M.icon : "🙋"} ${S.name || "你"}・${idName()}`, M ? `出發時的你：「${M.title}」` : "", "上方能力值會隨著你的選擇成長"]; },
  talk: () => [S.npc ? `你和${T.npcs[S.npc].name}聊到很晚` : "", "原來每個人對「畢業之後」的想法都不一樣"],
  roads: () => ["去同一個系，通常不只一條路", `已解鎖 ${S.unlocked.length} 條道路・🧩 情報 ${S.frags.length} 片`],
  bag: () => { const ids = PATHS.map(P => P.id), g = ids.filter(id => elig(id).st === "g").length, y = ids.filter(id => elig(id).st === "y").length;
    const k = ids.filter(id => elig(id).st !== "r" && missed(id)).length;
    return [`🟢 可以直接走 ${g} 條`, `🟡 需要再確認 ${y} 條`, k ? `⛔ 其中 ${k} 條今年已截止` : "", "點上方 🗺️ 隨時看每條路的細節"]; },
  time: () => { const n = passable().filter(id => !missed(id)).map(id => ({ P: PMAP[id], n: nextEvent(PMAP[id]) })).filter(x => x.n).sort((a, b) => a.n.days - b.n.days)[0];
    const k = passable().filter(missed).length;
    return [...(n ? [`今天 ${md(TODAY)}，你最近的關卡：`, `${n.P.icon} ${n.P.road}「${n.n.e.what}」`, n.n.live ? `進行中・剩 ${n.n.days} 天` : `${evRange(n.n.e)}・還有 ${n.n.days} 天`] : ["今年還來得及的路不多了，記得問問老師"]),
      k ? `⛔ 有 ${k} 條路今年已截止，不用再準備` : ""]; },
  will: () => { const r = liveRec().slice(0, 3); return [`你願意準備 ${S.willing.length} 件事`, "最適合你探索的道路：", r.map(id => `${PMAP[id].icon}${PMAP[id].road}`).join("、")]; },
  plan: () => myRoads().length ? [...myRoads().map((id, i) => `${ROLE[i]}：${PMAP[id].icon} ${PMAP[id].road}`), S.equip.length ? `背包裡有 ${S.equip.length} 件裝備` : ""]
    : ["你決定再多探索一下，也很好", S.equip.length ? `背包裡有 ${S.equip.length} 件裝備` : ""]
};

/* 過場：上一關完成 → 下一關任務 → 板擦擦掉 → 粉筆寫下日期倒數 */
async function stageBoard(prev, next) {
  hurry = false;
  const B = STG[next], lines = prev == null ? [] : (CLEAR[STG[prev].id] ? CLEAR[STG[prev].id]() : []).filter(Boolean);
  setScene(boardHTML(`${prev == null ? "" : `<div class="stamp">✔ ${esc(stNo(prev))} 完成</div>
      <div class="tb-done">${lines.map(l => `<div class="tb-line" data-chalk="${esc(l)}" data-speed="20"></div>`).join("")}</div><div class="tb-sep" aria-hidden="true"></div>`}
    <div class="tb-next">
      <div class="tb-k" data-chalk="${prev == null ? "" : "下一關　"}${esc(stNo(next))}${next === LAST ? "" : `／共 ${LAST} 關`}"></div>
      <div class="tb-title" data-chalk="${B.icon} ${esc(B.title)}" data-speed="60"></div>
      <div class="tb-goal" data-chalk="🎯 任務：${esc(B.mission)}"></div>
      <div class="tb-why after">💡 ${esc(B.why)}</div>
    </div>`, "trans"));
  const board = stage.querySelector(".board");
  board.addEventListener("pointerdown", () => { hurry = true; });
  await writeAll(board);
  await tapBtn(next === LAST ? "前往終章：畢業典禮 ›" : prev == null ? `開始${stNo(next)} ›` : `前往${stNo(next)} ›`);
  hurry = false;
  await eraseBoard(board);
  setNow(next); hud(); mission();
  board.style.minHeight = "";
  const dg = daysToGrad(NOW);
  board.innerHTML = `<div class="label" data-chalk="${nowIsReal() ? `今天 ${md(NOW)}` : `劇情快轉到 ${md(NOW)}`}　${dg > 0 ? "距離畢業典禮" : ""}"></div>
    ${dg > 0 ? `<div class="big"><span data-chalk="${dg}" data-speed="120"></span><span class="unit">天</span></div>` : `<div class="big" style="font-size:44px"><span data-chalk="🎓 畢業典禮已經過了"></span></div>`}
    <div class="tb-real after">📅 真實的今天是 ${TODAY.getFullYear()}/${md(TODAY)}${nowIsReal() ? "，劇情跟著真實日期走" : "；所有報名倒數都以今天計算"}</div>`;
  board.classList.add("count");
  await writeAll(board);
  await wait(650);
}

/* 每一步共用的小黑板背景 */
const miniBoard = (icon, text) => `<div class="board mini"><span class="mb-ic">${icon}</span><span class="mb-t">${esc(text)}</span></div>`;
const SKIP = "__skip__";

/* ===================================================================
 *  步驟（每個 step 都可以「上一步」回來重選）
 *  auto: true = 沒有選擇的展示畫面，按「上一步」時會直接跳過
 * =================================================================== */
function qStep(q, stg, who) {
  return { stage: stg, fn: async () => {
    if (q.when && !match(q.when, S.p)) return SKIP;
    setScene(miniBoard(STG[stg].icon, STG[stg].mission));
    if (q.multi) { S.p[q.id] = await choose(q.text, q.opts.map(o => ({ ...o })), { multi: true, who, okLabel: "好了" }); return; }
    const j = await choose(q.text, q.opts.map((o, i) => ({ ...o, v: i })), { who });
    const o = q.opts[j]; S.p[q.id] = o.v; if (o.set) Object.assign(S.p, o.set);
  } };
}
const qSteps = (stg, stage, who) => D.questions.filter(q => q.stage === stg).map(q => qStep(q, stage, who));

/* 第1關 我是誰 */
async function stName() {
  setScene(miniBoard("🪪", "先讓大家認識你"));
  S.name = await askText("同學都叫你什麼？", "例如：阿翔、小魚", "就叫我這個", "隨便啦");
}
async function stMind() {
  setScene(miniBoard("🪪", "沒有對錯，選最像你的"));
  const m = await choose("說真的，畢業之後要去哪，你現在比較像哪一種？", T.mindsets.map(x => ({ v: x.id, icon: x.icon, label: x.label, hint: `「${x.quote}」` })));
  const M = T.mindsets.find(x => x.id === m); S.mind = m;
  S.stats = { ...M.stats }; hud();
  if (m === "A" || m === "E") S.target = await askText(m === "A" ? "想去的學校或科系是？（可以不填）" : "爸媽希望你讀的是？（可以不填）", "例如：正修 數位多媒體設計系");
  else S.target = "";
}

/* 第2關 聽聽大家怎麼想 */
async function stChat() {
  setScene(`<div class="phone"><div class="bar"><span class="room">三年八班 🎓（42）</span><span>22:47</span></div><div class="msgs" id="msgs"></div></div>`);
  const msgs = $("#msgs");
  const add = (who, text, mine) => { const f = faceOf(who); const el = document.createElement("div"); el.className = "msg" + (mine ? " mine" : "");
    el.innerHTML = `${mine ? "" : `<span class="face" style="background:${f.color}">${f.face}</span>`}<div>${mine ? "" : `<div class="n">${esc(f.name)}</div>`}<div class="b">${esc(text)}</div></div>`;
    msgs.append(el); msgs.scrollTop = msgs.scrollHeight; requestAnimationFrame(() => el.classList.add("on")); };
  for (const m of T.groupChat) { await wait(380); add(m.who, m.text); }
  await wait(300);
  const who = await choose("你要點開誰的訊息？", T.groupChat.map(m => ({ v: m.who, icon: T.npcs[m.who].face, label: T.npcs[m.who].name, hint: m.text })));
  S.npc = who;
  const g = T.groupChat.find(m => m.who === who);
  add("me", g.opener, true); await wait(500); add(who, g.reply); await wait(600);
  const k = await choose(`你想回${T.npcs[who].name}什麼？`, g.options.map((o, i) => ({ v: i, icon: o.icon, label: o.label })));
  const o = g.options[k];
  add("me", o.label, true); await wait(500); add(who, o.resp); await wait(700);
  statUp({ ...(o.stat || { explore: 4 }), time: 5 });
  await tapBtn("繼續 ›");
}

/* 第3關 發現升學道路 */
async function stSenior() {
  setScene(miniBoard("🧢", "放學的走廊"));
  const first = PATHS.map(keyEvent).map(e => toDate(e.from)).sort((a, b) => a - b)[0];
  await say([["senior", "欸，學弟妹！我以前以為成績好就好，畢業前再想就來得及。"],
    ["senior", `結果最早的報名，在畢業典禮前 ${Math.round(daysBetween(first, GRAD) / 30)} 個月就開始了，我差點錯過！`]]);
  await gainFragment("grade");
  await say([["senior", `其實光是到正修，就有大概 ${PATHS.length} 條路。你想先往哪裡走？`]]);
  setScene(boardHTML(`<div class="sub">前面有三條路</div>${FORK_SVG}`));
  S.fork = await choose("", [
    { v: "blue", cls: "blue", icon: "🟦", label: "我已經知道我要去哪裡", hint: "看看去同一個系有幾條路" },
    { v: "green", cls: "green", icon: "🟩", label: "我想先探索", hint: "逛逛未來城市，找有興趣的方向" },
    { v: "yellow", cls: "yellow", icon: "🟨", label: "我想看看別人怎麼選", hint: "聽學長姐的升學故事" }]);
}
async function stFork() {
  if (S.fork === "blue") {
    if (!S.target) { setScene(miniBoard("🟦", "說出你的目的地")); S.target = await askText("你想去的學校或科系是？（可以不填）", "例如：正修 餐飲管理系"); }
    setScene(miniBoard("🟦", "同一個目的地，好幾條路"));
    await say([["senior", `${S.target ? `${S.target}？不錯欸。` : "有目標就很好。"}不過考試只是其中一條路。`],
      ["senior", "同一個系，可能走申請、甄選、繁星、技優、單招……看你的身分和你準備了什麼。"]]);
    statUp({ goal: 10, intel: 8 });
    await gainFragment("manyRoads");
  } else if (S.fork === "green") {
    for (;;) {
      setScene(miniBoard("🟩", "走廊盡頭的門後，是一座未來城市"));
      const wid = await choose("你想先逛哪個世界？", W.map(w => ({ v: w.id, icon: w.icon, label: w.name, hint: w.line })), { two: true });
      const w = W.find(x => x.id === wid);
      setScene(`<h3 class="title" style="font-size:24px;margin-bottom:8px">${w.icon} ${esc(w.name)}</h3>${worldHTML(w)}`);
      const d = await choose("", [{ v: "pick", icon: "✨", label: "就是這個方向", hint: "設成我的夢想方向" }, { v: "more", icon: "↩", label: "換一個世界看看", cls: "quiet" }]);
      if (d === "pick") { S.world = wid; break; }
    }
    statUp({ explore: 15, goal: 6 });
    await gainFragment("explore");
  } else {
    setScene(`<p class="center muted" style="margin:0">學生餐廳裡，幾個回來看老師的學長姐</p><div class="roads">${T.seniorStories.map((s, i) =>
      `<div class="card pop" style="animation-delay:${i * 160}ms"><div style="display:flex;gap:10px;align-items:center"><span style="font-size:34px">${s.face}</span><span class="meta">${esc(s.who)}</span></div>
       <p style="font-family:var(--hand);font-size:19px;margin:4px 0 0">「${esc(s.text)}」</p></div>`).join("")}</div>`);
    T.seniorStories.forEach(s => unlock(s.paths));
    await tapBtn("聽完了 ›");
    statUp({ intel: 12, explore: 5 });
    await gainFragment("others");
  }
}

/* 第4關 背包檢查：問題來自 data/admissions.js（stage: "backpack"），問完揭曉燈號 */
async function stReveal() {
  S.known = true;
  const ids = PATHS.map(P => P.id);
  unlock(ids.filter(id => elig(id).st !== "r"));
  setScene(`<p class="center muted" style="margin:0">${esc(idName())}・你的升學路線</p><div class="roads">${ids.map((id, i) => roadRow(id, { force: true, pop: true, delay: i * 120 })).join("")}</div>
    <p class="small muted center" style="margin:0">點任何一條路，都能看它的細節</p>`);
  stage.querySelectorAll("[data-road]").forEach(b => b.onclick = () => openDex(b.dataset.road));
  await wait(ids.length * 120 + 300);
  const g = ids.filter(id => elig(id).st === "g").length, y = ids.filter(id => elig(id).st === "y").length;
  statUp({ intel: 20 });
  const k = ids.filter(id => elig(id).st !== "r" && missed(id)).length;
  await say([["senior", `你有 ${g} 條路可以直接走，${y} 條要再確認。紅燈不是你不行，是那條路現在還不屬於你，像考到乙級證照，有些路就會打開。`],
    ...(k ? [["senior", `還有，今天已經 ${md(TODAY)} 了，其中 ${k} 條今年的報名已經截止（標 ⛔ 的那些），就別再花時間準備它們了。`]] : [])]);
  clearDlg();
  await gainFragment("identity");
  await gainFragment("sameEdu");
  await tapBtn("看完了，繼續 ›");
}

/* 第5關 看清楚時間 */
async function stTime() {
  setScene(miniBoard("🏀", "週末的球場"));
  const r = await choose("欸，週末去打球啦！升學的事之後再說～", [{ v: "later", icon: "👌", label: "好啊，之後再決定" }, { v: "check", icon: "📅", label: "我先看一下時間" }], { who: "datou" });
  S.later = r === "later";
  const live = passable().filter(id => !missed(id)), gone = passable().filter(missed);
  const mine = live.map(id => ({ P: PMAP[id], n: nextEvent(PMAP[id]) })).filter(x => x.n).sort((a, b) => a.n.days - b.n.days).slice(0, 5);
  setScene(`<p class="center muted small" style="margin:0">${S.later ? "你繼續往前走，前面的路卻開始出現倒數計時……" : "你打開手機，把升學的時間一個個找出來"}</p>
    <p class="center small" style="margin:0">📅 真實的今天 ${TODAY.getFullYear()}/${md(TODAY)}${daysToGrad(TODAY) > 0 ? `，距離畢業典禮還有 ${daysToGrad(TODAY)} 天` : ""}</p>
    <div class="countdown">${mine.length ? mine.map(({ P, n }, i) => `<div class="cd pop ${n.days <= SOON_DAYS ? "hot" : ""}" style="animation-delay:${i * 140}ms"><div class="d">${n.days}<small> 天</small></div><div class="w">${P.icon} ${esc(P.road)}<span>${n.live ? "進行中・剩下" : "距離"}「${esc(n.e.what)}」（${evRange(n.e)}）</span></div></div>`).join("")
      : `<div class="cd"><div class="w">你的道路今年的時程都已經過了，下一年度的日期公告後會更新。</div></div>`}</div>
    ${gone.length ? `<div class="gone"><b>⛔ 今年已經錯過（不用再準備）</b>${gone.map(id => `<div>${PMAP[id].icon} ${esc(PMAP[id].road)}<span>　${esc(gateOf(PMAP[id]).what)} 已在 ${md(toDate(gateOf(PMAP[id]).to || gateOf(PMAP[id]).from))} 截止</span></div>`).join("")}</div>` : ""}`);
  await wait(mine.length * 140 + 300);
  await say([["sys", S.later ? "原來時間真的會影響選擇。" : "原來有些路，比想像中早很多就開始了。"],
    ...(gone.length ? [["sys", "已經截止的路就先放下，把力氣留給還來得及的路。"]] : [])]);
  clearDlg();
  statUp({ time: S.later ? 22 : 18 });
  await gainFragment("timing");
}

/* 第6關 我願意準備 */
async function stRethink() {
  const M = T.mindsets.find(x => x.id === S.mind);
  setScene(`<div class="card"><div class="meta">開學時的你</div><div style="font-family:var(--hand);font-size:22px">${M.icon} 「${esc(M.quote)}」</div></div>`);
  // 開學時「還有很多時間」「到時候再看看」「完全不知道」的人，沒有「更確定了」可以選
  const canSure = !["C", "D", "F"].includes(S.mind);
  const r = await choose("走到這裡，你的想法有變嗎？", [...(canSure ? [{ v: "same", icon: "📌", label: "沒變，我更確定了" }] : []), { v: "change", icon: "🔄", label: "有變，我想換個方向" }, { v: "thinking", icon: "💭", label: "我還在想" }]);
  S.rechose = r === "change";
  if (r === "change") {
    S.world = await choose("那你現在比較想往哪個世界走？", W.map(w => ({ v: w.id, icon: w.icon, label: w.name })), { two: true });
    statUp({ explore: 10, goal: 8 });
  } else if (r === "same") statUp({ goal: 10 }); else statUp({ explore: 5 });
}
async function stWilling() {
  setScene(`<div class="willpanel" id="wp" aria-live="polite"></div>`);
  const wp = $("#wp");
  const upd = sel => {
    const roads = passable().filter(id => (PMAP[id].tags || []).some(t => sel.includes(t)));
    wp.innerHTML = sel.length
      ? `<div class="wp-h">你的準備，對應到 <b>${roads.filter(id => !missed(id)).length}</b> 條今年還來得及的道路</div><div class="wp-roads">${roads.map(id => `<span class="wp-r${missed(id) ? " missed" : ""}" style="--c:${PMAP[id].color}">${PMAP[id].icon} ${esc(PMAP[id].road)}${missed(id) ? "（今年已截止）" : `<i class="light ${elig(id).st}"></i>`}</span>`).join("") || `<span class="small">（這些準備和你目前的道路關係不大，也沒關係）</span>`}</div>`
      : `<div class="wp-h">💡 每選一樣，下面就會亮出它對應的道路</div>`;
  };
  upd([]);
  S.willing = await choose("為了提早拿到入學門票、增加錄取機會，你還願意準備什麼？（可複選）", D.willing.map(w => ({ v: w.id, icon: w.icon, label: w.label })), { multi: true, okLabel: "就這些", onChange: upd });
  statUp({ prep: 6 + S.willing.length * 2 });
}
async function stRecommend() {
  const rec = liveRec().slice(0, 3);
  unlock(rec);
  setScene(`<p class="center muted" style="margin:0">依你的身分和願意準備的事，最適合你探索的道路</p><div class="roads">${rec.map((id, i) => roadRow(id, { pop: true, delay: i * 200 })).join("")}</div>`);
  stage.querySelectorAll("[data-road]").forEach(b => b.onclick = () => openDex(b.dataset.road));
  await wait(700);
  await say([["datou", "欸我聽說，就算前面的都沒趕上，畢業後的 8 月還有單獨招生跟進修部？"], ["sys", "大頭難得說對了一次。"]]);
  clearDlg();
  await gainFragment("later");
}
function recommend() {
  const fit = id => { const t = PMAP[id].tags || []; return t.length && S.willing.length ? t.filter(x => S.willing.includes(x)).length / t.length : 0; };
  // later: true 的道路（例如進修部），玩家沒選相關意願時排到最後
  const pushBack = id => { const l = PMAP[id].later; return !!l && !(typeof l === "string" ? S.willing.includes(l) : fit(id)); };
  return passable().map(id => ({ id, s: (elig(id).st === "g" ? 2 : 1) + fit(id) * 3 - (pushBack(id) ? 10 : 0) - (missed(id) ? 20 : 0) })).sort((a, b) => b.s - a.s).map(x => x.id);
}

/* 第7關 寫下升學策略（主攻、備選、備援）＋出發前帶什麼 */
const roadOpt = id => { const t = roadTime(id);
  return { v: id, icon: PMAP[id].icon, label: PMAP[id].road, hint: `${PMAP[id].name}・${t.st === "open" ? `🔥 報名中，剩 ${t.days} 天` : `${t.days} 天後開始`}`, tag: { st: elig(id).st, text: ST_TXT[elig(id).st] } }; };
const liveRec = () => recommend().filter(id => !missed(id));
const goneNote = () => { const g = passable().filter(missed); return g.length ? `<div class="gone small"><b>⛔ 今年已截止，不列入策略：</b>${g.map(id => `${PMAP[id].icon}${esc(PMAP[id].road)}`).join("、")}</div>` : ""; };
function strategyHTML() {
  const r = myRoads();
  return `<div class="plan-slots">${ROLE.map((role, i) => { const id = r[i]; return `<div class="slot ${id ? "on" : ""}" style="${id ? `--c:${PMAP[id].color}` : ""}"><span class="role">${role}</span>${id ? `${PMAP[id].icon} ${esc(PMAP[id].road)}` : "？"}</div>`; }).join("")}</div>`;
}
async function stMain() {
  S.main = S.backup = S.alt = "";
  setScene(`<p class="center muted small" style="margin:0">你在筆記本上寫下高三的升學策略……</p>${strategyHTML()}${goneNote()}`);
  S.main = await choose(liveRec().length ? "🥇 我的主攻道路是？" : "你可以走的路今年都已截止了，建議先問老師或正修 LINE@", [...liveRec().map(roadOpt), { v: "", icon: "🔭", label: "我還想再探索，先不決定", cls: "quiet" }]);
}
async function stBackup() {
  if (!S.main) return SKIP;
  S.backup = S.alt = "";
  const r2 = liveRec().filter(id => id !== S.main); if (!r2.length) return SKIP;
  setScene(`<p class="center muted small" style="margin:0">主攻沒走通也不怕</p>${strategyHTML()}`);
  S.backup = await choose("🥈 如果主攻沒走通，備選是？", [...r2.slice(0, 5).map(roadOpt), { v: "", icon: "⏭️", label: "先不設備選", cls: "quiet" }]);
}
async function stAlt() {
  if (!S.backup) return SKIP;
  S.alt = "";
  const r3 = liveRec().filter(id => id !== S.main && id !== S.backup); if (!r3.length) return SKIP;
  setScene(`<p class="center muted small" style="margin:0">再多一份保險</p>${strategyHTML()}`);
  S.alt = await choose("🥉 再加一條備援？", [...r3.slice(0, 5).map(roadOpt), { v: "", icon: "⏭️", label: "先不設備援", cls: "quiet" }]);
}
async function stEquip() {
  unlock(myRoads());
  if (myRoads().length) statUp({ goal: 10, prep: 4 + myRoads().length * 2 });
  setScene(`${myRoads().length ? `<p class="center muted small" style="margin:0">我的升學策略</p>${strategyHTML()}${briefingHTML(myRoads())}` : ""}
    ${boardHTML(`<div style="font-size:40px">🎒</div><div class="sub">出發前，你願意帶什麼？</div>`)}`);
  S.equip = await choose("", T.equipment.map(e => ({ v: e.id, icon: e.icon, label: e.label, hint: `裝備：${e.item}` })), { multi: true, okLabel: "裝進背包（之後隨時可以拿出來用）" });
  const add = {}; for (const id of S.equip) for (const [k, v] of Object.entries(EQ(id).stat)) add[k] = (add[k] || 0) + v;
  statUp(add);
  toast("🎒 裝備可以在畫面上方隨時使用");
}

/* 終章：時光快轉＋畢業典禮 */
async function stSkip() {
  const ids = myRoads().length ? myRoads() : liveRec().slice(0, 3);
  setScene(`<h3 class="title" style="font-size:24px">⏩ 時光快轉</h3>
    <p class="center muted small" style="margin:4px 0 10px">想看看這一年會經過哪些關卡，就拖拖看下方滑桿；也可以直接前往畢業典禮。</p>
    <div id="skipTl"></div><button class="cta" id="toGrad" style="margin-top:12px">🎓 前往畢業典禮</button>`);
  const btn = $("#toGrad");
  await new Promise(res => {
    yearTimeline($("#skipTl"), ids, { idx: monthIdx(TODAY), onMove: i => { S.mon = MONTHS[i].m; hud(); } });
    btn.onclick = res;
  });
  statUp({ time: 8 });
}
function decideEnding() {
  if (S.rechose || (S.later && ["C", "D"].includes(S.mind))) return "C";
  if (!S.main) return "D";
  if (S.mind === "A" || (S.target && S.stats.goal >= 60)) return "A";
  if (S.equip.length >= 4 && S.stats.time >= 50) return "E";
  return S.world ? "B" : "E";
}
async function stCeremony() {
  NOW = GRAD < TODAY ? new Date(TODAY) : GRAD; S.mon = NOW.getMonth() + 1; hud();
  S.ending = decideEnding(); unlock(PATHS.map(P => P.id));
  hurry = false;
  setScene(`<div class="ceremony"><div class="gate">🏫</div><div style="font-family:var(--hand);font-size:22px;margin-top:6px">畢業典禮</div><div class="crowd">🎓🧑‍🎓👩‍🎓🎓🧑‍🎓👩‍🎓</div></div>
    ${boardHTML(`<div class="fins">${T.finale.map((t, i, a) => `<p class="fin${i === a.length - 1 ? " strong" : ""}" style="font-size:${(16 + i * (12 / Math.max(1, a.length - 1))).toFixed(1)}px" data-chalk="${esc(t)}" data-speed="55"></p>`).join("")}</div>`, "finale")}`);
  const board = stage.querySelector(".board");
  board.addEventListener("pointerdown", () => { hurry = true; });
  for (const p of board.querySelectorAll("[data-chalk]")) { await chalkWrite(p, p.dataset.chalk, { speed: 55 }); await wait(hurry ? 0 : 320); }
  await wait(600);
  if (S.npc) await say([[S.npc, T.farewell[S.npc]]]);
  clearDlg();
  const E = T.endings[S.ending];
  setScene(`<div class="ending"><div class="k">ENDING ${S.ending}</div><h2>${esc(E.title)}</h2><p style="margin:6px 0 0">${esc(E.line)}</p></div>
    <p class="motto">${esc(T.motto)}</p>
    <div id="endBtns"><button class="cta" data-go="guide">🏆 查看我的畢業冒險攻略</button><button class="cta ghost" data-go="city">🏙️ 探索正修科技大學</button><button class="cta ghost" data-go="again">重新開始</button></div>`);
  const box = $("#endBtns");
  for (;;) {
    const go = await new Promise(r => box.onclick = e => { const b = e.target.closest("[data-go]"); if (b) r(b.dataset.go); });
    if (go === "city") { openCity(); continue; }
    if (go === "again") { if (confirm("確定要重新開始嗎？目前的進度會被清除。")) { wipe(); title(); return new Promise(() => {}); } continue; }
    return;
  }
}

const STEPS = [
  { stage: 0, fn: stName },
  ...qSteps("create", 0),
  { stage: 0, fn: stMind },
  { stage: 1, fn: stChat },
  { stage: 2, fn: stSenior },
  { stage: 2, fn: stFork },
  ...qSteps("backpack", 3, "senior"),
  { stage: 3, fn: stReveal, auto: true },
  { stage: 4, fn: stTime },
  { stage: 5, fn: stRethink },
  { stage: 5, fn: stWilling },
  { stage: 5, fn: stRecommend, auto: true },
  { stage: 6, fn: stMain },
  { stage: 6, fn: stBackup },
  { stage: 6, fn: stAlt },
  { stage: 6, fn: stEquip },
  { stage: 7, fn: stSkip, auto: true },
  { stage: 7, fn: stCeremony, auto: true }
];

/* ===================================================================
 *  流程控制：run（往前走）、goBack（上一步）
 * =================================================================== */
/* 攻略卡上「重新寫升學策略」：回到第 7 關選主攻（有紀錄就用當時的狀態） */
function replan() {
  const k = STEPS.findIndex(x => x.fn === stMain), at = H.findIndex(e => e.i === k);
  if (at >= 0) { try { S = JSON.parse(H[at].s); H = H.slice(0, at); } catch (e) {} }
  S.done = false; S.main = S.backup = S.alt = "";
  run(k);
}
function closeOverlay() { ov.hidden = true; ov.innerHTML = ""; ov.style.alignItems = ""; }
async function run(from, opt = {}) {
  const my = ++RUN; closeOverlay(); showHud(true);
  let i = from;
  if (opt.intro && i < STEPS.length) { S.step = i; save(); mission(); await stageBoard(null, STEPS[i].stage); if (my !== RUN) return; }
  while (i < STEPS.length) {
    const st = STEPS[i];
    S.step = i; setNow(st.stage); hud(); mission(); save();
    const snap = JSON.stringify(S);
    const r = await st.fn();
    if (my !== RUN) return;
    if (r !== SKIP) { H.push({ i, s: snap }); if (H.length > H_MAX) H.shift(); }
    i++;
    if (i < STEPS.length && STEPS[i].stage !== st.stage) {
      S.step = i; save(); mission(st.stage + 1);
      await stageBoard(st.stage, STEPS[i].stage);
      if (my !== RUN) return;
    }
  }
  S.done = true; S.step = STEPS.length; save();
  guideCard();
}
function goBack() {
  if (!canBack()) return;
  let e;
  while (H.length) { e = H.pop(); if (!STEPS[e.i].auto) break; }
  try { S = JSON.parse(e.s); } catch (err) { return; }
  S.done = false;
  clearDlg();
  toast("↩ 回到上一步");
  run(e.i);
}

/* ---------------- 暫存：本機自動存檔＋續玩連結 ---------------- */
const b64u = {
  enc: u8 => { let s = ""; u8.forEach(b => s += String.fromCharCode(b)); return btoa(s).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, ""); },
  dec: t => { t = t.replace(/-/g, "+").replace(/_/g, "/"); while (t.length % 4) t += "="; const s = atob(t); return Uint8Array.from(s, c => c.charCodeAt(0)); }
};
async function pipe(u8, Stream) { return new Uint8Array(await new Response(new Blob([u8]).stream().pipeThrough(new Stream("deflate-raw"))).arrayBuffer()); }
async function makeCode() {
  const raw = new TextEncoder().encode(JSON.stringify({ S, H: H.slice(-H_MAX) }));
  if (window.CompressionStream) { try { return "z" + b64u.enc(await pipe(raw, CompressionStream)); } catch (e) {} }
  return "p" + b64u.enc(raw);
}
async function readCode(code) {
  code = String(code || "").trim().replace(/^.*#save=/, "");
  const kind = code[0], body = b64u.dec(code.slice(1));
  const u8 = kind === "z" ? await pipe(body, DecompressionStream) : body;
  const d = JSON.parse(new TextDecoder().decode(u8));
  const st = d && d.S ? d.S : d, hist = d && Array.isArray(d.H) ? d.H : []; // 舊格式只有 S
  if (!st || st.v !== 4) throw new Error("bad");
  return { S: st, H: hist };
}
const linkFor = code => location.href.split("#")[0] + "#save=" + code;
async function copyText(t) {
  try { await navigator.clipboard.writeText(t); return true; } catch (e) {
    const ta = document.createElement("textarea"); ta.value = t; document.body.append(ta); ta.select();
    let ok = false; try { ok = document.execCommand("copy"); } catch (e2) {} ta.remove(); return ok;
  }
}
const timeTxt = ms => { if (!ms) return "還沒有"; const d = new Date(ms); return `${d.getMonth() + 1}/${d.getDate()} ${String(d.getHours()).padStart(2, "0")}:${String(d.getMinutes()).padStart(2, "0")}`; };
function whereTxt() { const c = curStage(); return S.done ? "旅程完成・攻略卡" : `${stNo(c)}・${STG[c].title}（${S.mon}月）`; }
function openSave() {
  const s = sheet("💾 暫存進度", `<div class="card"><div class="meta">目前進度</div><b>${esc(whereTxt())}</b>
      <div class="small" style="color:var(--ink-2)">每走一步都會自動存在這台裝置。最後暫存：<span id="svT">${timeTxt(S.saved)}</span></div></div>
    <button class="cta" id="svNow" style="margin-top:12px">💾 立即暫存</button>
    <h3 class="subh">換手機、換電腦接著玩</h3>
    <p class="small muted" style="margin:0 0 8px">複製「續玩連結」傳到 LINE 或記事本，之後在任何裝置打開連結，就能從這裡繼續，「↩ 上一步」也一起帶走。</p>
    <p class="small muted" style="margin:0 0 8px">⚠️ 在 LINE、IG 裡直接開啟遊戲時，關掉視窗可能會清掉暫存，建議先複製續玩連結。</p>
    <button class="cta ghost" id="svLink">🔗 複製續玩連結</button>
    <input class="input" id="svOut" readonly hidden style="margin-top:8px;font-size:13px" aria-label="續玩連結">
    <details class="svin"><summary>📥 我有續玩連結，要接著玩</summary>
      <textarea class="input" id="svIn" rows="3" placeholder="把續玩連結貼在這裡" style="margin-top:8px;font-size:13px"></textarea>
      <button class="cta" id="svLoad" style="margin-top:8px">載入進度</button></details>
    <button class="cta ghost" id="svHome" style="margin-top:14px">🏠 回到標題畫面（進度會保留）</button>`);
  $("#svNow").onclick = () => { save(); $("#svT").textContent = timeTxt(S.saved); toast("💾 已暫存"); };
  $("#svLink").onclick = async () => { save(); const url = linkFor(await makeCode()); const out = $("#svOut"); out.hidden = false; out.value = url; out.select();
    toast(await copyText(url) ? "🔗 已複製續玩連結" : "請長按上方連結複製"); };
  $("#svLoad").onclick = async () => {
    try { const d = await readCode($("#svIn").value); s.close(); startFrom(d.S, d.H); }
    catch (e) { toast("⚠️ 連結不完整，請再複製一次"); }
  };
  $("#svHome").onclick = () => { save(); s.close(); title(); };
}
function startFrom(state, hist = []) {
  S = state; H = hist; save();
  toast("📥 已載入進度");
  if (S.done || S.step >= STEPS.length) { S.done = true; showHud(true); guideCard(); }
  else run(S.step, { intro: isStageStart(S.step) });
}
function showHud(on) { $("#hud").hidden = !on; if (on) { hud(); mission(); } }

/* 回來玩的人：先提醒「你的道路」今天的狀態，避免為已截止的路準備 */
function remindHTML(sv) {
  let h = "";
  if (dataExpired()) h += `<div class="remind warn">⚠️ 這份招生資料（${esc(D.meta.cycle)}）的日期都已經過了，等學校更新下一學年度資料後再來玩，結果會更準。</div>`;
  if (!sv) return h;
  const ids = myRoads(); if (!ids.length) return h;
  const rows = ids.map((id, i) => { const t = roadTime(id); return `<div class="rm-r ${t.st}"><span>${ROLE[i]}・${PMAP[id].icon} ${esc(PMAP[id].road)}</span><b>${t.st === "missed" ? "⛔ 已截止" : t.st === "open" ? `🔥 報名中・剩 ${t.days} 天` : `⏳ ${t.days} 天後開始`}</b></div>`; }).join("");
  const anyMissed = ids.some(missed);
  return h + `<div class="remind"><div class="rm-h">📅 今天 ${md(TODAY)}，你的升學策略</div>${rows}${anyMissed ? `<div class="small" style="margin-top:6px">有道路已經截止了，打開攻略卡可以「重新寫升學策略」。</div>` : ""}</div>`;
}

/* ===================================================================
 *  標題畫面
 * =================================================================== */
async function title() {
  const my = ++RUN; closeOverlay();
  const sv = load();
  S = sv ? sv.S : fresh(); H = sv ? sv.H : [];
  showHud(false); hurry = false;
  setScene(`<header class="marquee">
      <div class="sign"><h1 class="logo"><span class="l1">畢業之後</span><span class="l2">我的夢想之旅</span></h1></div>
      <div class="sticker">高中職畢業生的<b>升學 RPG</b></div>
    </header>
    ${boardHTML(`${daysToGrad(TODAY) > 0 ? `<div class="label" data-chalk="今天 ${md(TODAY)}・距離畢業典禮"></div><div class="big"><span data-chalk="${daysToGrad(TODAY)}" data-speed="110"></span><span class="unit">天</span></div>`
        : `<div class="label" data-chalk="今天 ${md(TODAY)}"></div><div class="big" style="font-size:40px"><span data-chalk="${esc(D.meta.cycle)}畢業典禮已經過了"></span></div>`}
      <div class="tb-real after">📅 ${TODAY.getFullYear()}/${md(TODAY)} ${esc(clockNote())}</div>
      <div class="chatter">${T.openingChatter.map(c => `<div class="line"><b>${esc(T.npcs[c.who].name)}</b>${esc(c.text)}</div>`).join("")}</div>`, "hero")}`);
  const board = stage.querySelector(".board");
  board.addEventListener("pointerdown", () => { hurry = true; });
  await writeAll(board);
  for (const l of stage.querySelectorAll(".chatter .line")) { await wait(hurry ? 0 : 450); l.classList.add("on"); }
  await wait(hurry ? 0 : 300);
  if (my !== RUN) return;
  stage.insertAdjacentHTML("beforeend", `${remindHTML(sv)}<p class="ask-big">你呢？<br>畢業之後，你要去哪裡？</p>
    <p class="howto">共 ${LAST} 關＋終章，約 10 分鐘。每一關都有一個任務；隨時可以 ↩ 回上一步、💾 暫存。</p>`);
  const box = document.createElement("div"); stage.append(box);
  const going = sv && !S.done && (S.step > 0 || H.length);
  box.innerHTML = going
    ? `<button class="cta" data-go="resume">繼續旅程（${esc(whereTxt())}）</button><button class="cta ghost" data-go="new">重新開始</button>`
    : sv && S.done ? `<button class="cta" data-go="guide">查看我的畢業冒險攻略</button><button class="cta ghost" data-go="new">重新開始</button>`
    : `<button class="cta" data-go="new">開始我的旅程</button>`;
  box.insertAdjacentHTML("beforeend", `<button class="linkbtn" data-go="code">📥 我有續玩連結</button>`);
  box.querySelector("button").focus({ preventScroll: true });
  for (;;) {
    const go = await new Promise(r => box.onclick = e => { const b = e.target.closest("[data-go]"); if (b) r(b.dataset.go); });
    if (my !== RUN) return;
    if (go === "code") { openSave(); const d = ov.querySelector("details"); if (d) d.open = true; continue; }
    if (go === "new") { if ((going || (sv && S.done)) && !confirm("確定要重新開始嗎？目前的進度會被清除。")) continue; wipe(); S = fresh(); H = []; return run(0, { intro: true }); }
    if (go === "guide") { showHud(true); return guideCard(); }
    if (go === "resume") { toast("歡迎回來！"); return run(S.step, { intro: isStageStart(S.step) }); }
  }
}

/* 🏆 我的畢業冒險攻略 */
/* 我要準備：依主攻、備選、備援分開；後面的道路只列「前面沒有的」項目，減輕壓力 */
function prepGroups(ids) {
  const seen = new Set(), chosen = myRoads().length > 0, key = t => t.replace(/（.*?）/g, "").trim();
  let briefed = false;
  return ids.map((id, i) => {
    const P = PMAP[id], items = P.prep.filter(t => !seen.has(key(t))), shared = P.prep.length - items.length;
    P.prep.forEach(t => seen.add(key(t)));
    const brief = !!P.portfolio && !briefed; if (brief) briefed = true;
    return { id, P, role: chosen ? ROLE[i] : "建議", items, shared, first: i === 0, brief };
  });
}
function guideData() {
  const E = T.endings[S.ending] || T.endings.D, M = T.mindsets.find(x => x.id === S.mind) || T.mindsets[5];
  const w = W.find(x => x.id === S.world), roads = myRoads(), main = PMAP[S.main];
  const ids = roads.length ? roads : (S.known ? recommend().slice(0, 3) : []);
  const nx = ids.map(id => ({ P: PMAP[id], n: nextEvent(PMAP[id]) })).filter(x => x.n).sort((a, b) => a.n.days - b.n.days)[0];
  return { E, M, w, ids, main,
    rows: [
      ["我的角色", `${idName()}\n${M.title}`],
      ["夢想方向", w ? `${w.icon} ${w.name}` : "還在探索中"],
      ["我的目標", S.target || "還沒設定，沒關係"],
      ["升學情報", `解鎖 ${S.unlocked.length}／${PATHS.length} 條道路、${S.frags.length} 片情報`],
      ["升學道路", roads.length ? roads.map((id, i) => `${ROLE[i]}：${PMAP[id].icon} ${PMAP[id].road}（${PMAP[id].name}）`).join("\n") : "繼續探索中（建議先看下方道路）"],
      ["下一步", nx ? `${nx.n.live ? `進行中・剩 ${nx.n.days} 天` : `${nx.n.days} 天後`}：${nx.P.icon} ${nx.P.road}「${nx.n.e.what}」（${evRange(nx.n.e)}）` : ids.length ? "本學年度時程已過，留意下一年度簡章" : "先打開圖鑑，挑一條路看看"],
      ["我的裝備", S.equip.length ? S.equip.map(id => `${EQ(id).icon} ${EQ(id).item}`).join("、") : "輕裝出發"]
    ] };
}
function guideCard() {
  RUN++; S.done = true; showHud(true); closeOverlay();
  const g = guideData(), groups = prepGroups(g.ids);
  const gone = g.ids.filter(missed), urgent = g.ids.filter(id => { const t = roadTime(id); return t.st !== "missed" && t.days <= (t.st === "open" ? SOON_DAYS : 14); });
  const alert = gone.length || urgent.length ? `<div class="galert ${gone.length ? "warn" : ""}">
      <div class="ga-h">📅 今天 ${TODAY.getFullYear()}/${md(TODAY)} 的提醒</div>
      ${gone.map(id => `<div>⛔ ${PMAP[id].icon} ${esc(PMAP[id].road)}：${esc(timeText(id))}，不用再為它準備了。</div>`).join("")}
      ${urgent.map(id => `<div>🔥 ${PMAP[id].icon} ${esc(PMAP[id].road)}：${esc(timeText(id))}</div>`).join("")}
      ${gone.length ? `<button class="cta small-cta" id="replan">✏️ 重新寫升學策略</button>` : ""}</div>` : "";
  setScene(`${alert}<div class="guide" id="guide"><h2>🏆 我的畢業冒險攻略</h2><p class="center" style="margin:0 0 8px;color:var(--ink-2)">${esc(S.name || "我")}・ENDING ${S.ending}「${esc(g.E.title)}」</p>
    ${g.rows.map(([k, v]) => k === "我的裝備" && S.equip.length
      ? `<div class="row"><b>${k}</b><div class="eqs">${S.equip.map(id => `<button class="eqbtn" data-eq="${id}">${EQ(id).icon} ${esc(EQ(id).item)} <small>使用 ›</small></button>`).join("")}</div></div>`
      : `<div class="row"><b>${k}</b><span>${esc(v).replace(/\n/g, "<br>")}${k === "下一步" ? `<small class="note">以今天 ${md(TODAY)} 計算</small>` : ""}</span></div>`).join("")}
    <div class="row"><b>我的能力</b><div class="sbars">${STAT_KEYS.slice(0, 4).map(([k, ic, nm]) => `<div class="sb"><span>${ic} ${nm}</span><div class="bar"><i style="width:${S.stats[k]}%"></i></div><span>${S.stats[k]}</span></div>`).join("")}</div></div>
    ${g.ids.length ? `<h3 class="gh">📋 我要準備</h3><p class="prep-lead">先把${groups[0].role === "建議" ? "第一條路" : "主攻"}準備好就好；其他道路只列出還需要「額外」準備的東西。</p>
    ${groups.map(gp => `<div class="pgroup ${gp.first ? "main" : "sub"}" style="--c:${gp.P.color}">
      <div class="pg-h"><span class="role">${gp.role}</span>${gp.P.icon} ${esc(gp.P.road)}${gp.first ? "" : `<span class="pg-n">${gp.items.length ? `再多 ${gp.items.length} 項` : "不用另外準備"}</span>`}</div>
      ${gp.items.length ? `<ul class="preps">${gp.items.map(t => `<li>${esc(t)}</li>`).join("")}</ul>` : ""}
      ${gp.shared ? `<div class="pg-shared">✔ 另有 ${gp.shared} 項和前面的道路共用，不用重複準備</div>` : ""}
      ${gp.brief ? briefingHTML(g.ids, "in-paper") : ""}</div>`).join("")}
    <h3 class="gh">🗓️ 完整時間軸 ${allConfirmed() ? "" : `<span class="badge" style="color:#8a6a00">含推估</span>`}</h3>
    <div id="gTl" class="on-paper"></div>${eventListHTML(g.ids)}
    <button class="cta small-cta" id="ics">📅 全部加入手機行事曆</button>` : ""}
    <p class="close">${esc(g.E.line)}</p>
    ${guideQRs().length ? `<div class="qrrow">${guideQRs().map(([u, c]) => qrHTML(u, c)).join("")}</div>` : ""}
    <p class="foot">${esc(D.meta.cycle)}${allConfirmed() ? "" : "・日期含推估，以正式簡章為準"}　正修官方LINE${esc(D.contact.lineId)}・${esc(D.contact.tel)}</p></div>
    <div style="height:6px"></div>
    <button class="cta" id="dl">下載攻略卡圖片</button>
    <div class="row-btns" style="margin-top:10px"><button class="cta ghost" id="dex">🗺️ 升學路線圖鑑</button><button class="cta ghost" id="city">🏙️ 探索正修科技大學</button></div>
    <button class="cta ghost" id="again" style="margin-top:10px">重新開始</button>`);
  if (g.ids.length) { yearTimeline($("#gTl"), g.ids, { idx: monthIdx(TODAY) }); $("#ics").onclick = () => downloadICS(g.ids); }
  stage.querySelectorAll("[data-eq]").forEach(b => b.onclick = () => useEquip(b.dataset.eq));
  $("#dl").onclick = downloadCard;
  if ($("#replan")) $("#replan").onclick = replan; $("#dex").onclick = () => openDex(S.main || undefined); $("#city").onclick = openCity;
  $("#again").onclick = () => { if (confirm("確定要重新開始嗎？目前的攻略會被清除。")) { wipe(); title(); } };
}
/* 攻略卡轉圖片（Canvas）：先畫內容，再依實際高度裝框 */
async function downloadCard() {
  const g = guideData(), Wd = 1080, pad = 80, c = document.createElement("canvas"), x = c.getContext("2d");
  c.width = Wd; c.height = 9000;
  const hand = getComputedStyle(document.body).getPropertyValue("--hand"), sans = getComputedStyle(document.body).getPropertyValue("--sans");
  const wrap = (t, maxW, font) => { x.font = font; const out = []; for (const para of String(t).split("\n")) { let line = ""; for (const ch of para) { if (x.measureText(line + ch).width > maxW) { out.push(line); line = ch; } else line += ch; } out.push(line); } return out; };
  const dash = y => { x.strokeStyle = "#DAD6C5"; x.setLineDash([8, 8]); x.beginPath(); x.moveTo(pad, y); x.lineTo(Wd - pad, y); x.stroke(); x.setLineDash([]); };
  const head = (t, y) => { x.textAlign = "left"; x.fillStyle = "#1D3A2E"; x.font = `bold 40px ${hand}`; x.fillText(t, pad, y); return y + 56; };
  x.fillStyle = "#1F2A25"; x.textAlign = "center"; x.font = `bold 64px ${hand}`; x.fillText("🏆 我的畢業冒險攻略", Wd / 2, 150);
  x.font = `34px ${sans}`; x.fillStyle = "#4F5D56"; x.fillText(`${S.name || "我"}・ENDING ${S.ending}「${g.E.title}」`, Wd / 2, 214);
  let y = 290; x.textAlign = "left";
  for (const [k, v] of g.rows) {
    const lines = wrap(v, Wd - pad * 2 - 200, `32px ${sans}`);
    x.fillStyle = "#4F5D56"; x.font = `bold 28px ${sans}`; x.fillText(k, pad, y);
    x.fillStyle = "#1F2A25"; x.font = `32px ${sans}`; lines.forEach((l, i) => x.fillText(l, pad + 200, y + i * 46));
    y += lines.length * 46 + 10; dash(y); y += 42;
  }
  for (const [k, ic, nm] of STAT_KEYS.slice(0, 4)) {
    x.fillStyle = "#1F2A25"; x.font = `30px ${sans}`; x.fillText(`${ic} ${nm}`, pad, y);
    x.fillStyle = "#ECE9DB"; x.fillRect(pad + 300, y - 22, 520, 20); x.fillStyle = "#24483A"; x.fillRect(pad + 300, y - 22, 5.2 * S.stats[k], 20);
    x.fillStyle = "#1F2A25"; x.fillText(String(S.stats[k]), pad + 850, y); y += 56;
  }
  if (g.ids.length) {
    y += 30; y = head("📋 我要準備", y);
    for (const gp of prepGroups(g.ids)) {
      const big = gp.first, fs = big ? 30 : 26, lh = big ? 42 : 36;
      x.fillStyle = gp.P.color; x.fillRect(pad, y - 30, 10, 40);
      x.fillStyle = "#1F2A25"; x.font = `bold ${big ? 32 : 28}px ${sans}`;
      x.fillText(`${gp.role}｜${gp.P.icon} ${gp.P.road}${gp.first ? "" : gp.items.length ? `（再多 ${gp.items.length} 項）` : "（不用另外準備）"}`, pad + 24, y); y += lh + 4;
      for (const t of gp.items) { const ls = wrap(t, Wd - pad * 2 - 80, `${fs}px ${sans}`); x.font = `${fs}px ${sans}`; x.fillStyle = big ? "#1F2A25" : "#4F5D56"; x.fillText("□", pad + 24, y); ls.forEach((l, i) => x.fillText(l, pad + 64, y + i * lh)); y += ls.length * lh + 4; }
      if (gp.shared) { x.font = `24px ${sans}`; x.fillStyle = "#1D7A4E"; x.fillText(`✔ 另有 ${gp.shared} 項和前面的道路共用`, pad + 24, y); y += 36; }
      if (gp.brief && D.contact.briefing) { const ls = wrap(`💡 ${D.contact.briefing.text}`, Wd - pad * 2 - 40, `24px ${sans}`); x.font = `24px ${sans}`; x.fillStyle = "#8A5A00"; ls.forEach((l, i) => x.fillText(l, pad + 24, y + i * 34)); y += ls.length * 34; }
      y += 22;
    }
    y += 30; y = head(`🗓️ 完整時間軸${allConfirmed() ? "" : "（含推估）"}`, y);
    const all = g.ids.flatMap(id => PMAP[id].events.map(e => ({ P: PMAP[id], e }))).sort((a, b) => a.e.from.localeCompare(b.e.from));
    for (const { P, e } of all) {
      const past = toDate(e.to || e.from) < TODAY;
      x.fillStyle = P.color; x.fillRect(pad, y - 26, 10, 34);
      x.fillStyle = past ? "#A8A79E" : "#4F5D56"; x.font = `bold 28px ${sans}`; x.fillText(evRange(e), pad + 26, y);
      const ls = wrap(`${P.icon} ${e.what}`, Wd - pad * 2 - 260, `28px ${sans}`); x.fillStyle = past ? "#A8A79E" : "#1F2A25"; x.font = `28px ${sans}`;
      ls.forEach((l, i) => x.fillText(l, pad + 250, y + i * 38)); y += ls.length * 38 + 10;
    }
  }
  y += 50; x.textAlign = "center"; x.fillStyle = "#1F2A25"; x.font = `44px ${hand}`; wrap(g.E.line, Wd - pad * 2 - 40, `44px ${hand}`).forEach(l => { x.fillText(l, Wd / 2, y); y += 64; });
  const qrs = guideQRs(), imgs = await Promise.all(qrs.map(([u]) => new Promise(r => { const im = new Image(); im.onload = () => r(im); im.onerror = () => r(null); im.src = "data:image/svg+xml;charset=utf-8," + encodeURIComponent(QR[u]); })));
  if (qrs.length) {
    // 一列最多兩個 QR Code，間距拉開，避免手機相機同時掃到兩個
    const sz = 220, gap = 200, rowH = sz + 110; y += 10;
    for (let r = 0; r < qrs.length; r += 2) {
      const row = qrs.slice(r, r + 2), tot = row.length * sz + (row.length - 1) * gap; let qx = (Wd - tot) / 2;
      row.forEach(([u, cap], j) => { const im = imgs[r + j]; if (im) x.drawImage(im, qx, y, sz, sz); x.font = `24px ${sans}`; x.fillStyle = "#4F5D56";
        wrap(cap, sz + 60, `24px ${sans}`).forEach((l, k) => x.fillText(l, qx + sz / 2, y + sz + 36 + k * 30)); qx += sz + gap; });
      y += rowH;
    }
    y += 10;
  }
  x.font = `24px ${sans}`; x.fillStyle = "#4F5D56"; x.fillText(`${D.meta.cycle}${allConfirmed() ? "" : "・日期含推估，以正式簡章為準"}　正修官方LINE${D.contact.lineId}`, Wd / 2, y + 10);
  const H = y + 90, out = document.createElement("canvas"), o = out.getContext("2d");
  out.width = Wd; out.height = H;
  o.fillStyle = "#1D3A2E"; o.fillRect(0, 0, Wd, H); o.fillStyle = "#FFD84A"; o.fillRect(30, 30, Wd - 60, H - 60); o.fillStyle = "#FFFEF8"; o.fillRect(46, 46, Wd - 92, H - 92);
  o.drawImage(c, 0, 0);
  const a = document.createElement("a"); a.download = "我的畢業冒險攻略.png"; a.href = out.toDataURL("image/png"); a.click();
}

/* ---------------- 啟動 ---------------- */
$("#btnDex").onclick = () => openDex();
$("#btnCity").onclick = openCity;
$("#btnFrag").onclick = openFrags;
$("#btnBag").onclick = openBag;
$("#btnBack").onclick = goBack;
$("#btnSave").onclick = openSave;
$("#mgoal").onclick = openRoadmap;
document.addEventListener("keydown", e => { if (e.key === "Escape" && !ov.hidden) { const x = ov.querySelector(".x"); if (x) x.click(); } });
async function boot() {
  await syncClock();
  if (!D || !W || !T) { stage.innerHTML = `<div class="card">資料檔沒有載入成功。請確認 data/admissions.js、data/departments.js、js/story.js 都有上傳。</div>`; return; }
  // 從「續玩連結」打開：載入進度後把網址上的進度碼清掉
  if (location.hash.startsWith("#save=")) {
    try { const d = await readCode(location.hash); S = d.S; H = d.H; save(); toast("📥 已載入續玩進度"); } catch (e) { toast("⚠️ 續玩連結不完整"); }
    history.replaceState(null, "", location.pathname + location.search);
  }
  await title();
}
boot();
})();
