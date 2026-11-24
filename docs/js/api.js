import { API_URL } from "./config.js";
import { crashPoint, sha256hex, multAt, flightMs } from "./fair.js";

export const DEMO = !API_URL;
const tgw = window.Telegram && window.Telegram.WebApp;
export const initData = () => (tgw && tgw.initData) || "";
export const startParam = () => (tgw && tgw.initDataUnsafe && tgw.initDataUnsafe.start_param) || new URLSearchParams(location.search).get("claim") || "";

async function real(route, body) {
  const r = await fetch(`${API_URL}/api/${route}`, { method: body ? "POST" : "GET",
    headers: { authorization: "tma " + initData(), "content-type": "application/json" }, body: body ? JSON.stringify(body) : undefined });
  return r.json();
}

// ───────── offline demo (so the site works on GitHub Pages without a server) ─────────
let G = null, C = null;
const load = async () => { if (!G) { G = await (await fetch("data/gifts.json")).json(); C = await (await fetch("data/cases.json")).json(); } };
const S = (() => { try { const s = JSON.parse(localStorage.getItem("dg_demo")); if (s) return s; } catch {} return { balance: 1000, inv: [], opened: 0, last_free: 0, xp: 0, nid: 1 }; })();
const save = () => { try { localStorage.setItem("dg_demo", JSON.stringify(S)); } catch {} };
const gv = (id) => G.gifts.find(g => g.id === id).stars * G.rate;
const pick = (drops) => { let r = Math.random() * drops.reduce((s, d) => s + d.w, 0); for (const d of drops) if ((r -= d.w) < 0) return d; return drops.at(-1); };
let R = null; // current demo round
const BET = 8000, COOL = 4000;
async function demoRound() {
  const t = Date.now();
  if (!R || t >= R.next_at) {
    const id = (R ? R.round : 0) + 1, seed = [...crypto.getRandomValues(new Uint8Array(16))].map(b => b.toString(16).padStart(2, "0")).join("");
    const crash = await crashPoint(seed, id), bet_end = t + BET, crash_at = bet_end + flightMs(crash);
    R = { round: id, seed, crash, hash: await sha256hex(seed), bet_end, fly_start: bet_end, crash_at, next_at: crash_at + COOL, my: null, history: R ? [...R.history, { id: R.round, crash: R.crash }].slice(-12) : [] };
  }
  return R;
}
const demo = {
  async me() { await load(); const t = Date.now();
    return { ok: true, id: 1, name: "Demo", balance: S.balance, opened: S.opened, xp: S.xp, level: 1 + Math.floor(Math.sqrt(S.xp / 10)), premium: false,
      free_in: Math.max(0, S.last_free + 86400000 - t), inv: S.inv, isAdmin: true, refs: { total: 0, opened: 0, deposited: 0 }, packs: [5, 15, 50, 100, 250], now: t }; },
  async open_case({ id }) { await load(); const c = C.cases.find(x => x.id === id);
    if (c.daily) { if (Date.now() - S.last_free < 86400000) return { ok: false, error: "cooldown" }; S.last_free = Date.now(); }
    else { if (S.balance < c.price) return { ok: false, error: "balance" }; S.balance -= c.price; }
    const d = pick(c.drops); let prize;
    if (d.coins) { S.balance += d.coins; prize = { coins: d.coins }; } else { S.inv.unshift({ id: S.nid++, gift_id: d.gift }); prize = { gift: d.gift, value: gv(d.gift) }; }
    S.opened++; S.xp += Math.max(1, Math.round(c.price / 30)); save(); return { ok: true, prize, balance: S.balance }; },
  async sell({ id }) { await load(); const i = S.inv.findIndex(x => x.id === id); if (i < 0) return { ok: false };
    const v = Math.floor(gv(S.inv[i].gift_id) * G.withdraw.sell_rate); S.inv.splice(i, 1); S.balance += v; save(); return { ok: true, coins: v }; },
  async upgrade({ id, to }) { await load(); const i = S.inv.findIndex(x => x.id === id); if (i < 0) return { ok: false };
    const f = gv(S.inv[i].gift_id), tv = gv(to); if (tv <= f) return { ok: false, error: "target" };
    const chance = Math.min(0.95, 0.9 * f / tv), win = Math.random() < chance; S.inv.splice(i, 1);
    if (win) S.inv.unshift({ id: S.nid++, gift_id: to }); save(); return { ok: true, win, chance }; },
  async leaderboard() { return { ok: true, top: [{ name: "Demo", balance: S.balance, me: true }], rank: 1 }; },
  async invoice({ stars }) { S.balance += stars * 18; save(); return { ok: true, demo: true }; },
  async promo({ code }) { if (String(code).toUpperCase() === "DEMO") { S.balance += 100; save(); return { ok: true, coins: 100 }; } return { ok: false, error: "invalid" }; },
  async check(b) { return demo.promo(b); },
  async tasks() { return { ok: true, tasks: [] }; },
  async task_claim() { return { ok: false }; },
  async withdraw() { return { ok: false, error: "refs" }; },
  async "rocket/state"() { const r = await demoRound(), t = Date.now();
    const phase = t < r.bet_end ? "bet" : t < r.crash_at ? "fly" : "crashed";
    const o = { ok: true, now: t, round: r.round, phase, hash: r.hash, bet_end: r.bet_end, fly_start: r.fly_start, next_at: r.next_at, my: r.my, history: r.history };
    if (phase === "crashed") { o.crash = r.crash; o.seed = r.seed; } return o; },
  async "rocket/bet"({ amount }) { const r = await demoRound(); amount = Math.floor(amount);
    if (Date.now() >= r.bet_end) return { ok: false, error: "late" }; if (r.my) return { ok: false, error: "already" };
    if (amount < 10 || amount > S.balance) return { ok: false, error: "balance" }; S.balance -= amount; r.my = { amount, cashout: null, payout: 0 }; save(); return { ok: true }; },
  async "rocket/cashout"() { const r = await demoRound(), t = Date.now();
    if (t < r.fly_start || t >= r.crash_at || !r.my || r.my.cashout) return { ok: false, error: "late" };
    const x = multAt(t - r.fly_start); if (x >= r.crash) return { ok: false, error: "late" };
    const payout = Math.floor(r.my.amount * x); r.my.cashout = x; r.my.payout = payout; S.balance += payout; S.xp += 1; save(); return { ok: true, x, payout }; },
};

export const api = (route, body) => (DEMO ? (demo[route] ? demo[route](body || {}) : Promise.resolve({ ok: false })) : real(route, body || (["me", "leaderboard", "tasks", "rocket/state"].includes(route) ? null : {})).catch(() => ({ ok: false, error: "network" })));
export const admin = (route, body) => (DEMO ? Promise.resolve({ ok: true, code: "DEMO", link: "demo" }) : real("admin/" + route, body));
