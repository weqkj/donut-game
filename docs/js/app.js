import { api, admin, DEMO, startParam } from "./api.js";
import { BOT_USERNAME } from "./config.js";
import { LANGS, t, setLang } from "./i18n.js";
import { crashFromHash, sha256hex, multAt } from "./fair.js";

const $ = (s, r = document) => r.querySelector(s);
const app = $("#app");
const esc = (s) => String(s ?? "").replace(/[&<>"']/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
const fmt = (n) => Math.floor(n).toLocaleString("ru-RU").replace(/ /g, " ");
const tgw = window.Telegram && window.Telegram.WebApp;
if (tgw) { try { tgw.ready(); tgw.expand(); tgw.setHeaderColor("#000000"); tgw.setBackgroundColor("#000000"); tgw.disableVerticalSwipes && tgw.disableVerticalSwipes(); } catch {} }
const ls = { get: (k) => { try { return localStorage.getItem(k); } catch { return null; } }, set: (k, v) => { try { localStorage.setItem(k, v); } catch {} } };

let URLS = {}, GIFTS = null, CASES = null, me = null, tab = "cases";
const STAR = `<img class="st" src="assets/icons/star.svg" alt="⭐">`;
const haptic = (k = "light") => { try { tgw.HapticFeedback.impactOccurred(k); } catch {} };
function toast(msg) { const el = $("#toast"); el.textContent = msg; el.classList.add("show"); clearTimeout(toast.t); toast.t = setTimeout(() => el.classList.remove("show"), 2400); }

// ───────── assets & animations ─────────
const anim = (key, cls = "dog") => `<img class="anim ${cls}" data-k="${key}" src="${URLS[key] || ""}" alt="" draggable="false">`;
const rocketImg = (variant) => `<img class="rk" data-loop="1" src="${URLS["rockets/" + variant] || ""}" alt="">`;
// tap = play again from the start (animations play once, except rocket)
document.addEventListener("click", (e) => {
  const img = e.target.closest && e.target.closest("img.anim"); if (!img) return;
  const c = img.cloneNode(); img.replaceWith(c); haptic();
});
const giftById = (id) => GIFTS.gifts.find(g => g.id === id);
const gv = (g) => g.stars * GIFTS.rate;
const giftImg = (g, cls = "") => g.img && URLS[g.img] ? `<img class="gift anim ${cls}" data-k="${g.img}" src="${URLS[g.img]}" alt="">` : `<div class="gift ph">${g.nft ? "💠" : "🎁"}</div>`;

async function preload() {
  const man = await (await fetch("assets/manifest.json")).json();
  GIFTS = await (await fetch("data/gifts.json")).json(); CASES = await (await fetch("data/cases.json")).json();
  const keys = Object.keys(man); let done = 0;
  await Promise.all(keys.map(async (k) => {
    try { const b = await (await fetch(man[k].file)).blob(); URLS[k] = URL.createObjectURL(b); } catch {}
    done++; const bar = $(".bar i"); if (bar) bar.style.width = Math.round(done / keys.length * 100) + "%";
  }));
}

// ───────── boot ─────────
async function boot() {
  const tu = tgw && tgw.initDataUnsafe && tgw.initDataUnsafe.user;
  const saved = ls.get("dg_lang"); setLang(saved || (tu && tu.language_code) || "ru");
  app.innerHTML = `<div class="center"><div style="font-size:64px">🍩</div><h1>Donut Game</h1><div class="bar"><i></i></div><p id="ld">${t("loading")}</p></div>`;
  await preload();
  if (!saved) return langScreen();
  main();
}
function langScreen() {
  app.innerHTML = `<div class="center">${anim("dog/sit")}<h1>${t("choose")}</h1><div class="col" style="width:100%;max-width:320px">
    ${Object.entries(LANGS).map(([k, v]) => `<button class="btn ghost wide" data-lang="${k}">${v}</button>`).join("")}</div></div>`;
  app.onclick = (e) => { const b = e.target.closest("[data-lang]"); if (!b) return; ls.set("dg_lang", b.dataset.lang); setLang(b.dataset.lang); main(); };
}
// ───────── guided tour on the real interface ─────────
const TOUR = [["dog/hi", "hi", null], ["dog/happy", "t_cases", "cases"], ["dog/podium", "t_top", "top"], ["dog/trot", "t_profile", "profile"], ["dog/yep", "t_games", "games"]];
function tour(i) {
  document.querySelectorAll("#tour").forEach(e => e.remove());
  document.querySelectorAll(".hl").forEach(e => e.classList.remove("hl"));
  if (i >= TOUR.length) { ls.set("dg_tut", "1"); return; }
  const [dog, key, tb] = TOUR[i], last = i === TOUR.length - 1;
  if (tb && tab !== tb) { tab = tb; render(); }
  const btn = tb && document.querySelector(`[data-tab="${tb}"]`), r = btn && btn.getBoundingClientRect();
  if (tb === "cases") { const f = $(".case.free"); f && f.classList.add("hl"); }
  const o = document.createElement("div"); o.id = "tour";
  const bottom = r ? innerHeight - r.top + 20 : null;
  o.innerHTML = `${r ? `<div class="spot" style="left:${r.left - 4}px;top:${r.top - 4}px;width:${r.width + 8}px;height:${r.height + 8}px"></div>` : `<div class="dim"></div>`}
    <div class="tcard" style="${r ? `bottom:${bottom}px` : "top:50%;transform:translate(-50%,-50%)"}">${anim(dog, "dog sm2")}<div class="bubble"><p>${t(key)}</p></div>
    <div class="row"><button class="btn sm" data-tn>${last ? t("go") : t("next")}</button>${last ? "" : `<button class="btn sm ghost" data-ts>${t("skip")}</button>`}</div>
    ${r ? `<i class="arrow" style="left:${r.left + r.width / 2}px"></i>` : ""}</div>`;
  o.onclick = (e) => { e.stopPropagation(); if (e.target.closest("[data-tn]")) { if (last) { tab = "cases"; render(); } tour(i + 1); } else if (e.target.closest("[data-ts]")) { tab = "cases"; render(); tour(TOUR.length); } };
  document.body.appendChild(o);
}

// ───────── main shell ─────────
async function main() {
  me = await api("me"); if (!me.ok) { app.innerHTML = `<div class="center"><h2>${t("err")}</h2></div>`; return; }
  app.onclick = onClick;
  if (me.need_sub && me.need_sub.length) return gate();
  render();
  if (!ls.get("dg_tut")) tour(0);
  const sp = startParam();
  if (sp.startsWith("chk_") || sp.startsWith("promo_")) { const r = await api(sp.startsWith("chk_") ? "check" : "promo", { code: sp }); toast(r.ok ? `${t("got")}: +${fmt(r.coins)} 🍩` : t(r.error === "used" ? "used" : "bad_code")); refresh(); }
}
async function refresh() { me = await api("me"); document.querySelectorAll(".bal").forEach(e => e.textContent = fmt(me.balance)); return me; }
const TABS = () => [["cases", "📦", t("cases")], ["top", "🏆", t("top")], ["profile", "🐶", t("profile")], ["games", "🚀", t("games")], ...(me.isAdmin ? [["admin", "⚙️", t("admin")]] : [])];
function render() {
  stopRocket();
  app.innerHTML = `<div class="top"><div class="chip">🍩 <span class="bal">${fmt(me.balance)}</span></div><div class="chip">${t("level")} ${me.level}</div></div>
    <div class="view" id="view"></div>
    <div class="nav">${TABS().map(([k, ic, n]) => `<button data-tab="${k}" class="${k === tab ? "on" : ""}"><b>${ic}</b>${n}</button>`).join("")}</div>`;
  ({ cases: viewCases, top: viewTop, profile: viewProfile, games: viewGames, admin: viewAdmin })[tab]($("#view"));
}

function sheet(html) {
  const m = document.createElement("div"); m.className = "modal"; m.innerHTML = `<div class="sheet">${html}<button class="btn ghost wide" data-close>${t("close")}</button></div>`;
  m.onclick = (e) => { if (e.target === m || e.target.closest("[data-close]")) m.remove(); };
  document.body.appendChild(m); return m;
}

function gate() {
  app.innerHTML = `<div class="center">${anim("dog/sideeye")}<h1>${t("sub_need")}</h1><div class="col" style="width:100%;max-width:340px">
    ${me.need_sub.map(k => `<a class="btn ghost wide" style="text-decoration:none;display:block" href="${esc(k.url)}" target="_blank">${esc(k.title)}</a>`).join("")}
    <button class="btn wide" id="subchk">${t("check")}</button></div></div>`;
  $("#subchk").onclick = async () => { me = await api("me"); if (me.need_sub && me.need_sub.length) return toast(t("sub_no")); render(); if (!ls.get("dg_tut")) tour(0); };
}

// ───────── cases ─────────
const CASE_IC = { free: "🎁", starter: "📦", gold: "🏆", diamond: "💎" };
const rar = (v, nft) => (nft || v >= 2000 ? "gold" : v >= 1000 ? "purple" : v >= 300 ? "blue" : "grey");
const dropInfo = (d) => { if (d.coins) return { coins: d.coins, value: d.coins, r: rar(d.coins) }; const g = giftById(d.gift); return { g, value: gv(g), r: rar(gv(g), g.nft) }; };
const tile = (d, extra = "") => { const i = dropInfo(d);
  return `<div class="tile r-${i.r} ${extra}">${i.g ? giftImg(i.g) : `<div class="coin">🍩</div>`}<b>${i.g ? esc(i.g.name) : fmt(i.coins)}</b><small>${i.g ? i.g.stars + " " + STAR : "donut"}</small></div>`; };
function previewImgs(c) {
  const gs = c.drops.filter(d => d.gift).map(d => giftById(d.gift)).filter(g => g.img && URLS[g.img]).sort((a, b) => gv(b) - gv(a)).slice(0, 3);
  return gs.length ? `<div class="stack">${gs.map((g, i) => `<img class="gift" style="--i:${i}" src="${URLS[g.img]}" alt="">`).join("")}</div>` : "";
}
function viewCases(v) {
  const fr = me.free_in, tm = Math.ceil(fr / 60000), hrs = Math.floor(tm / 60), mins = tm % 60;
  v.innerHTML = `<div class="case free" data-case="free"><div class="shine"></div>${anim("dog/sorry", "dog sm")}<div style="flex:1"><h3>${t("free")}</h3><p>${fr ? `${t("wait")} ${hrs}${t("h")} ${mins}${t("m")}` : t("free_d")}</p></div><button class="btn sm" style="background:#000;color:#fff" ${fr ? "disabled" : ""}>${t("open")}</button></div>
    <div class="grid">${CASES.cases.filter(c => !c.daily).map(c => `<div class="case c-${c.id}" data-case="${c.id}"><div class="shine"></div><div class="ic">${CASE_IC[c.id]}</div>${previewImgs(c)}<h3>${c.id.toUpperCase()}</h3>${dropsPreview(c)}<button class="btn sm wide">🍩 ${fmt(c.price)}</button></div>`).join("")}</div>`;
}
function dropsPreview(c) {
  const coins = c.drops.filter(d => d.coins).map(d => d.coins), gifts = c.drops.filter(d => d.gift);
  return `<div class="drops">${coins.length ? `<span>🍩 ${fmt(Math.min(...coins))}–${fmt(Math.max(...coins))}</span>` : ""}${gifts.length ? `<span>🎁 ×${gifts.length}</span>` : ""}</div>`;
}
// case page: contents + chances
function casePage(c) {
  const tw = c.drops.reduce((s, d) => s + d.w, 0);
  const list = c.drops.slice().sort((a, b) => dropInfo(b).value - dropInfo(a).value);
  const m = sheet(`<div class="bigcase">${CASE_IC[c.id]}</div><h2>${c.id.toUpperCase()}</h2>
    <div class="dgrid">${list.map(d => `<div class="dcell">${tile(d)}<span class="pct">${(d.w / tw * 100).toFixed(d.w / tw < .1 ? 1 : 0)}%</span></div>`).join("")}</div>
    <button class="btn wide" id="goopen">${c.daily ? t("open") : "🍩 " + fmt(c.price) + " · " + t("open")}</button>`);
  m.querySelector("#goopen").onclick = () => { m.remove(); runCase(c); };
}
async function runCase(c) {
  const r = await api("open_case", { id: c.id });
  if (!r.ok) return toast(r.error === "cooldown" ? t("cooldown") : r.error === "balance" ? t("nobal") : t("err"));
  haptic("medium"); await refresh(); document.querySelectorAll(".bal").forEach(e => e.textContent = fmt(me.balance));
  const p = r.prize, win = p.gift ? { gift: p.gift } : { coins: p.coins };
  // roulette strip: random items with the winner at a fixed slot
  const tw = c.drops.reduce((s, d) => s + d.w, 0), pickD = () => { let x = Math.random() * tw; for (const d of c.drops) if ((x -= d.w) < 0) return d; return c.drops[0]; };
  const N = 44, W = 40, strip = Array.from({ length: N }, (_, i) => (i === W ? win : pickD()));
  const m = document.createElement("div"); m.className = "modal spin";
  m.innerHTML = `<div class="roul"><div class="vp"><div class="rail">${strip.map(d => tile(d)).join("")}</div><div class="ptr"></div></div><p>${c.id.toUpperCase()}</p></div>`;
  document.body.appendChild(m);
  const rail = m.querySelector(".rail"), vp = m.querySelector(".vp"), tw_ = 104;
  const target = W * tw_ + tw_ / 2 - vp.clientWidth / 2 + (Math.random() * 50 - 25);
  rail.getBoundingClientRect(); rail.style.transition = "transform 5.2s cubic-bezier(.08,.75,.12,1)"; rail.style.transform = `translateX(${-target}px)`;
  const tick = setInterval(() => haptic("light"), 220);
  await new Promise(res => setTimeout(res, 5400)); clearInterval(tick); m.remove();
  const g = p.gift ? giftById(p.gift) : null;
  haptic("heavy");
  sheet(`${anim(c.daily ? "dog/sorry" : g ? "dog/box" : "dog/happy")}${g ? `<h2>${t("got_gift")}</h2><div class="tile r-${rar(gv(g), g.nft)}" style="width:150px;padding:14px">${giftImg(g)}<b>${esc(g.name)}</b><small>${g.stars} ${STAR}</small></div>` : `<h2>${t("got_coins")}</h2><h1>🍩 +${fmt(p.coins)}</h1>`}${c.daily ? `<p>${t("free_msg")}</p>` : ""}`);
  if (tab === "cases") render();
}

// ───────── leaderboard ─────────
async function viewTop(v) {
  v.innerHTML = `<div class="row" style="justify-content:center">${anim("dog/podium", "dog sm")}</div>`;
  const r = await api("leaderboard"); if (!r.ok || tab !== "top") return;
  v.innerHTML = `<div class="card row">${anim("dog/podium", "dog sm")}<div><h2>${t("top")}</h2><p>${t("rank")}: #${r.rank}</p></div></div>
    ${r.top.length < 5 ? `<p style="text-align:center">${t("lb_note")}</p>` : ""}
    ${r.top.map((x, i) => `<div class="item ${x.me ? "me" : ""}"><span class="rank">${i + 1}</span><span class="n">${esc(x.name)}</span><b>🍩 ${fmt(x.balance)}</b></div>`).join("")}`;
}

// ───────── profile ─────────
function viewProfile(v) {
  const link = `https://t.me/${me.bot || BOT_USERNAME}?start=ref_${me.id}`;
  v.innerHTML = `<div class="card row">${anim("dog/trot", "dog sm")}<div style="flex:1;min-width:0"><h2>${esc(me.name || "Player")}</h2><p>${t("level")} ${me.level} · XP ${me.xp}</p></div></div>
   <div class="card col"><div class="row" style="justify-content:space-between"><h3>${t("balance")}</h3><h2>🍩 <span class="bal">${fmt(me.balance)}</span></h2></div>
     <p>${t("topup_d")}</p><div class="seg">${(me.packs || [5, 15, 50]).map(s => `<button data-pay="${s}">${s} ${STAR}</button>`).join("")}</div>
     <button class="btn ghost wide" data-w="coins">${t("w_coins")}</button><p style="font-size:11px">${t("w_rules")}</p></div>
   <div class="card col"><h3>${t("gifts")}</h3>${me.inv.length ? `<div class="grid">${me.inv.map(i => { const g = giftById(i.gift_id); return `<div class="item" style="flex-direction:column;text-align:center;gap:6px">${giftImg(g)}<span class="n" style="max-width:100%">${esc(g.name)}</span><span class="pill">${g.stars} ${STAR} · 🍩${fmt(gv(g))}</span><div class="row wrap" style="justify-content:center"><button class="btn sm ghost" data-sell="${i.id}">${t("sell")}</button><button class="btn sm ghost" data-upg="${i.id}">⬆</button><button class="btn sm ghost" data-w="gift:${i.id}">💸</button></div></div>`; }).join("")}</div>` : `<p>${t("nogifts")}</p>`}</div>
   <div class="card col"><h3>${t("refs")}</h3><p>${t("refs_d")}</p><div class="row wrap"><span class="pill">👥 ${me.refs.total}</span><span class="pill">📦 ${me.refs.opened}/5</span><span class="pill">${STAR} ${me.refs.deposited}/1</span></div>
     <button class="btn ghost wide" data-copy="${esc(link)}">${t("copy")}</button></div>
   <div class="card col"><h3>${t("promo")}</h3><div class="row"><input id="promo" placeholder="CODE" autocapitalize="characters"><button class="btn" data-promo>${t("apply")}</button></div></div>
   <div class="card col" id="tasks"></div>`;
  loadTasks();
}
async function loadTasks() {
  const r = await api("tasks"), box = $("#tasks"); if (!box || !r.ok || !r.tasks.length) { box && box.remove(); return; }
  box.innerHTML = `<h3>${t("tasks")}</h3>` + r.tasks.map(k => `<div class="item"><span class="n">${esc(k.title)}</span><b>+${fmt(k.reward)}</b>${k.done ? `<span class="pill">${t("done")}</span>` : `${k.url ? `<a class="btn sm ghost" style="text-decoration:none" href="${esc(k.url)}" target="_blank">${t("go_task")}</a>` : ""}<button class="btn sm" data-task="${k.id}">${t("check")}</button>`}</div>`).join("");
}
async function pay(stars) {
  const r = await api("invoice", { stars });
  if (!r.ok) return toast(t("err"));
  if (r.demo) { await refresh(); toast(`+${fmt(stars * 18)} 🍩 (demo)`); return render(); }
  try { tgw.openInvoice(r.link, async (s) => { if (s === "paid") { await new Promise(r => setTimeout(r, 1200)); await refresh(); sheet(`${anim("dog/deposit")}<h2>${t("topup")}</h2><h1>+${fmt(stars * 18)} 🍩</h1>`); render(); } }); } catch { location.href = r.link; }
}
const errMap = { refs: "w_refs", pending: "w_pending", min: "w_min", nft_min: "w_nft", balance: "nobal" };
async function doWithdraw(spec) {
  let body;
  if (spec === "coins") { const a = Number(prompt(t("w_coins") + " (≥ 15000)", "15000")); if (!a) return; body = { kind: "coins", amount: a }; }
  else body = { kind: "gift", id: Number(spec.split(":")[1]) };
  const r = await api("withdraw", body); if (r.ok) { toast(t("w_ok")); await refresh(); render(); } else toast(t(errMap[r.error] || "err"));
}
function upgradeSheet(id) {
  const it = me.inv.find(i => i.id === id), from = gv(giftById(it.gift_id));
  const targets = GIFTS.gifts.filter(g => gv(g) > from).sort((a, b) => gv(a) - gv(b));
  const m = sheet(`<h2>${t("upg_pick")}</h2>${targets.length ? targets.map(g => `<div class="item wide" style="width:100%"><span class="n">${esc(g.name)} · ${g.stars} ${STAR}</span><span class="pill">${t("chance")} ≈${Math.round(Math.min(95, 90 * from / gv(g)))}%</span><button class="btn sm" data-do-upg="${g.id}">⬆</button></div>`).join("") : `<p>—</p>`}`);
  m.addEventListener("click", async (e) => {
    const b = e.target.closest("[data-do-upg]"); if (!b) return;
    const r = await api("upgrade", { id, to: b.dataset.doUpg }); m.remove();
    if (!r.ok) return toast(t("err")); await refresh();
    sheet(`${anim(r.win ? "dog/happy" : "dog/cry")}<h2>${t(r.win ? "upg_win" : "upg_lose")}</h2><p>${t("chance")}: ${Math.round(r.chance * 100)}%</p>`); render();
  });
}

// ───────── rocket ─────────
const VARIANTS = ["classic", "fish", "ice", "banana"];
let RK = null;
function stopRocket() { if (RK) { clearInterval(RK.poll); cancelAnimationFrame(RK.raf); RK = null; } }
const pos = (p) => ({ l: 18 + 68 * Math.pow(p, 0.85), b: 16 + 62 * Math.pow(p, 0.75) });
function viewGames(v) {
  v.innerHTML = `<div class="card row" style="justify-content:space-between"><h2>🚀 ${t("rocket")}</h2>${DEMO ? `<span class="pill">${t("demo")}</span>` : ""}</div>
    <div class="hist" id="hist"></div>
    <div class="sky" id="sky"><svg viewBox="0 0 100 100" preserveAspectRatio="none"><polyline id="trail" fill="none" stroke="#ffffff55" stroke-width=".8" stroke-dasharray="2 2" vector-effect="non-scaling-stroke"/></svg><div class="mult" id="mult">x1.00</div><div id="rkwrap"></div></div>
    <p id="status" style="text-align:center"></p>
    <div class="card col"><div class="row"><input id="bet" type="number" inputmode="numeric" min="10" value="100" placeholder="${t("bet")}"><button class="btn" id="act" style="min-width:150px">${t("place")}</button></div>
      <div class="seg">${[50, 100, 500, 1000].map(n => `<button data-chip="${n}">${n}</button>`).join("")}<button data-chip="max">MAX</button></div></div>
    <p class="small" id="fair"></p>`;
  RK = { st: null, off: 0, variant: null, round: 0, shown: 0, poll: null, raf: 0 };
  const poll = async () => {
    const s = await api("rocket/state"); if (!s.ok || !RK) return;
    RK.off = s.now - Date.now(); const prev = RK.st; RK.st = s;
    if (s.round !== RK.round) { RK.round = s.round; RK.variant = VARIANTS[s.round % VARIANTS.length]; $("#rkwrap").innerHTML = rocketImg(RK.variant); $("#fair").innerHTML = `${t("hash")}: ${s.hash}`; }
    $("#hist").innerHTML = s.history.slice().reverse().map(h => `<span class="${h.crash >= 2 ? "hi" : ""}">x${h.crash.toFixed(2)}</span>`).join("");
    if (s.phase === "crashed" && RK.shown !== s.round) { RK.shown = s.round; onCrash(s); }
  };
  RK.poll = setInterval(poll, 700); poll();
  const loop = () => { if (!RK) return; draw(); RK.raf = requestAnimationFrame(loop); }; loop();
}
async function onCrash(s) {
  const my = s.my; haptic("heavy");
  const ok = (await sha256hex(s.seed)) === s.hash && crashFromHash(await sha256hex(`${s.seed}:${s.round}`)) === s.crash;
  const f = $("#fair"); if (f) f.innerHTML = `${ok ? "✅ " + t("fair_ok") : "⚠️"}<br>seed: ${s.seed}<br>${t("hash")}: ${s.hash}`;
  if (my && my.amount) { await refresh(); if (my.cashout) sheet(`${anim("dog/happy")}<h2>${t("you_won")} x${my.cashout.toFixed(2)}</h2><h1>+${fmt(my.payout)} 🍩</h1>`); else sheet(`${anim("dog/angry")}<h2>${t("crashed")} x${s.crash.toFixed(2)}</h2><p>${t("you_lost")}: ${fmt(my.amount)} 🍩</p>`); }
}
function draw() {
  const s = RK && RK.st; if (!s) return;
  const sn = Date.now() + RK.off, mult = $("#mult"), act = $("#act"), st = $("#status"), rk = $(".rk"); if (!mult) return;
  let x = 1, phase = s.phase;
  if (phase === "bet" && sn >= s.bet_end) phase = "fly";
  if (phase === "fly") x = multAt(sn - s.fly_start);
  if (s.phase === "crashed") { x = s.crash; phase = "crashed"; }
  if (phase === "fly" && s.crash_known) x = Math.min(x, s.crash);
  const p = x <= 1 ? 0 : Math.min(1, Math.log(x) / Math.log(100)), q = pos(p);
  mult.textContent = "x" + x.toFixed(2); mult.className = "mult" + (phase === "crashed" ? " crash" : s.my && s.my.cashout ? " win" : "");
  if (rk) { rk.style.left = q.l + "%"; rk.style.bottom = q.b + "%"; rk.style.opacity = phase === "crashed" ? .25 : 1; }
  const pts = []; for (let i = 0; i <= 24; i++) { const z = pos(p * i / 24); pts.push(`${z.l},${100 - z.b}`); } $("#trail").setAttribute("points", pts.join(" "));
  const my = s.my, placed = my && my.amount && !my.cashout;
  if (phase === "bet") { st.textContent = `${t("betting")} · ${Math.max(0, Math.ceil((s.bet_end - sn) / 1000))}s`; act.textContent = my && my.amount ? `✓ ${fmt(my.amount)} 🍩` : t("place"); act.disabled = !!(my && my.amount); act.dataset.mode = "bet"; }
  else if (phase === "fly") { st.textContent = t("flying"); if (placed) { act.textContent = `${t("cash")} · ${fmt(my.amount * x)} 🍩`; act.disabled = false; act.dataset.mode = "cash"; } else { act.textContent = my && my.cashout ? `✓ x${my.cashout.toFixed(2)}` : t("place"); act.disabled = true; act.dataset.mode = "bet"; } }
  else { st.textContent = `${t("crashed")} x${s.crash.toFixed(2)}`; act.textContent = t("place"); act.disabled = true; act.dataset.mode = "bet"; }
}
async function rocketAct() {
  const act = $("#act"); if (!act || act.disabled) return; haptic("medium");
  if (act.dataset.mode === "cash") { const r = await api("rocket/cashout"); if (!r.ok) toast(t("late")); else { toast(`x${r.x.toFixed(2)} → +${fmt(r.payout)} 🍩`); } await refresh(); return; }
  const amount = Math.floor(Number($("#bet").value)); const r = await api("rocket/bet", { amount });
  if (!r.ok) return toast(r.error === "balance" ? t("nobal") : t("late")); await refresh();
}

// ───────── admin ─────────
function viewAdmin(v) {
  const f = (id, ph, type = "text") => `<input id="${id}" placeholder="${ph}" type="${type}">`;
  v.innerHTML = `<div class="card col"><h3>Give coins</h3>${f("a_uid", "user id", "number")}${f("a_amt", "amount", "number")}<button class="btn" data-a="give">OK</button></div>
   <div class="card col"><h3>Promo / Check</h3>${f("p_code", "CODE (empty = random)")}${f("p_amt", "amount", "number")}${f("p_max", "max uses (0 = ∞)", "number")}${f("p_days", "days valid (empty = ∞)", "number")}
     <div class="row"><button class="btn" data-a="promo">Promo</button><button class="btn ghost" data-a="check">Check</button></div><p class="small" id="a_out"></p></div>
   <div class="card col"><h3>Task</h3>${f("t_title", "title")}${f("t_chat", "@channel (bot must be admin)")}${f("t_url", "https://t.me/...")}${f("t_rew", "reward", "number")}<button class="btn" data-a="task">Create</button></div>
   <div class="card col"><h3>Upgrade chance</h3>${f("u_fix", "fixed chance 0..1 (0 = auto)", "number")}<button class="btn" data-a="upg">Set</button></div>
   <div class="card col"><h3>Withdrawals</h3><button class="btn ghost" data-a="wlist">Load</button><div id="wl" class="col"></div></div>`;
}
async function adminAct(a) {
  const g = (id) => ($("#" + id) || {}).value;
  let r;
  if (a === "give") r = await admin("give", { user_id: g("a_uid"), amount: g("a_amt") });
  if (a === "promo" || a === "check") { r = await admin(a, { code: g("p_code"), amount: g("p_amt"), max_uses: g("p_max"), days: g("p_days") }); if (r.ok) $("#a_out").innerHTML = `${esc(r.code)}${r.link ? "<br>" + esc(r.link) : ""}`; }
  if (a === "task") r = await admin("task", { title: g("t_title"), chat: g("t_chat"), url: g("t_url"), reward: g("t_rew") });
  if (a === "upg") r = await admin("setting", { k: "upgrade_fixed", v: g("u_fix") || 0 });
  if (a === "wlist") { r = await admin("withdrawals"); if (r.ok) $("#wl").innerHTML = r.list.map(w => `<div class="item"><span class="n">#${w.id} u${w.user_id} ${w.kind === "gift" ? esc(w.gift_id) : fmt(w.amount) + "🍩"} → ${w.stars}⭐</span><button class="btn sm" data-wr="${w.id}:1">✓</button><button class="btn sm ghost" data-wr="${w.id}:0">✕</button></div>`).join("") || "<p>—</p>"; return; }
  toast(r && r.ok ? "OK" : t("err"));
}

// ───────── events ─────────
async function onClick(e) {
  const T = (s) => e.target.closest(s);
  let b;
  if ((b = T("[data-tab]"))) { tab = b.dataset.tab; haptic(); return render(); }
  if ((b = T("[data-case]"))) { const c = CASES.cases.find(x => x.id === b.dataset.case); if (c.daily && me.free_in) return toast(t("cooldown")); return casePage(c); }
  if ((b = T("[data-pay]"))) return pay(Number(b.dataset.pay));
  if ((b = T("[data-sell]"))) { const r = await api("sell", { id: Number(b.dataset.sell) }); if (r.ok) { toast(`+${fmt(r.coins)} 🍩`); await refresh(); render(); } return; }
  if ((b = T("[data-upg]"))) return upgradeSheet(Number(b.dataset.upg));
  if ((b = T("[data-w]"))) return doWithdraw(b.dataset.w);
  if ((b = T("[data-copy]"))) { try { await navigator.clipboard.writeText(b.dataset.copy); } catch {} return toast(t("copied")); }
  if (T("[data-promo]")) { const code = $("#promo").value.trim(); if (!code) return; let r = await api("promo", { code }); if (!r.ok && r.error === "invalid") r = await api("check", { code });
    if (r.ok) { toast(`${t("got")}: +${fmt(r.coins)} 🍩`); await refresh(); render(); } else toast(t(r.error === "used" ? "used" : "bad_code")); return; }
  if ((b = T("[data-task]"))) { const r = await api("task_claim", { id: Number(b.dataset.task) }); if (r.ok) { toast(`+${fmt(r.coins)} 🍩`); await refresh(); render(); } else toast(t("err")); return; }
  if ((b = T("[data-chip]"))) { $("#bet").value = b.dataset.chip === "max" ? Math.max(10, me.balance) : b.dataset.chip; return; }
  if (T("#act")) return rocketAct();
  if ((b = T("[data-a]"))) return adminAct(b.dataset.a);
  if ((b = T("[data-wr]"))) { const [id, ap] = b.dataset.wr.split(":"); const r = await admin("withdraw_resolve", { id: Number(id), approve: ap === "1" }); toast(r.ok ? "OK" : t("err")); return adminAct("wlist"); }
}

boot();
