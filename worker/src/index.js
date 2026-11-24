import GIFTS from "../../docs/data/gifts.json";
import CASES from "../../docs/data/cases.json";
import { verifyInitData, tg } from "./tg.js";
import { sha256hex, crashFromHash, multAt, flightMs } from "./fair.js";

const G = Object.fromEntries(GIFTS.gifts.map(g => [g.id, { ...g, value: g.stars * GIFTS.rate }]));
const W = GIFTS.withdraw;
const PACKS = [5, 15, 50, 100, 250];          // Stars top-up packs
const BET_MS = 8000, COOL_MS = 4000;
const MIN_BET = 10, MAX_BET = 100000;

const json = (o, s = 200, h = {}) => new Response(JSON.stringify(o), { status: s, headers: { "content-type": "application/json", ...h } });
const fail = (m, s = 400) => json({ ok: false, error: m }, s);
const now = () => Date.now();
const rnd = (n) => { const a = new Uint32Array(1); crypto.getRandomValues(a); return a[0] / 4294967296 * n; };
const rndHex = (b = 32) => [...crypto.getRandomValues(new Uint8Array(b))].map(x => x.toString(16).padStart(2, "0")).join("");
function pick(drops) {
  const t = drops.reduce((s, d) => s + d.w, 0); let r = rnd(t);
  for (const d of drops) { if ((r -= d.w) < 0) return d; }
  return drops[drops.length - 1];
}

export default {
  async fetch(req, env) {
    const url = new URL(req.url);
    const cors = { "access-control-allow-origin": env.ALLOWED_ORIGIN || "*", "access-control-allow-headers": "authorization,content-type", "access-control-allow-methods": "GET,POST,OPTIONS", "vary": "origin" };
    if (req.method === "OPTIONS") return new Response(null, { status: 204, headers: cors });
    try {
      let res;
      if (url.pathname === "/webhook") res = await webhook(req, env);
      else if (url.pathname.startsWith("/api/")) res = await api(req, env, url);
      else res = new Response("donut-game worker");
      for (const [k, v] of Object.entries(cors)) res.headers.set(k, v);
      return res;
    } catch (e) {
      console.error(e);
      return new Response(JSON.stringify({ ok: false, error: "server" }), { status: 500, headers: { "content-type": "application/json", ...cors } });
    }
  },
};

// ───────────────────────── Telegram webhook ─────────────────────────
const T = {
  ru: { hi: "Добро пожаловать в Donut Game! 🍩\nИграть можно по кнопке ниже.", play: "Играть", paid: (n, c) => `Спасибо! +${c} donut за ${n} ⭐` },
  en: { hi: "Welcome to Donut Game! 🍩\nTap the button below to play.", play: "Play", paid: (n, c) => `Thanks! +${c} donut for ${n} ⭐` },
  uk: { hi: "Ласкаво просимо до Donut Game! 🍩\nГрати можна за кнопкою нижче.", play: "Грати", paid: (n, c) => `Дякуємо! +${c} donut за ${n} ⭐` },
};
const langOf = (c) => (["ru", "uk", "en"].includes(c) ? c : "en");

async function webhook(req, env) {
  if (env.WEBHOOK_SECRET && req.headers.get("x-telegram-bot-api-secret-token") !== env.WEBHOOK_SECRET) return new Response("no", { status: 403 });
  const up = await req.json(); const call = tg(env);
  if (up.pre_checkout_query) { await call("answerPreCheckoutQuery", { pre_checkout_query_id: up.pre_checkout_query.id, ok: true }); return json({ ok: true }); }
  const m = up.message; if (!m) return json({ ok: true });
  if (m.successful_payment) {
    const sp = m.successful_payment; const stars = sp.total_amount; const uid = m.from.id;
    const [kind, owner] = (sp.invoice_payload || "").split(":");
    if (kind === "topup" && Number(owner) === uid) {
      const ins = await env.DB.prepare("INSERT OR IGNORE INTO payments(charge_id,user_id,stars,created_at) VALUES(?,?,?,?)").bind(sp.telegram_payment_charge_id, uid, stars, now()).run();
      if (ins.meta.changes) {
        const coins = stars * GIFTS.rate;
        await env.DB.prepare("UPDATE users SET balance=balance+?, deposited_stars=deposited_stars+?, xp=xp+? WHERE id=?").bind(coins, stars, stars, uid).run();
        const l = langOf(m.from.language_code);
        await call("sendMessage", { chat_id: uid, text: T[l].paid(stars, coins) });
      }
    }
    return json({ ok: true });
  }
  if (m.text && m.text.startsWith("/start")) {
    const param = (m.text.split(" ")[1] || "").trim();
    const l = langOf(m.from.language_code);
    await ensureUser(env, m.from, param.startsWith("ref_") ? Number(param.slice(4)) : null);
    const q = param.startsWith("chk_") || param.startsWith("promo_") ? "?claim=" + encodeURIComponent(param) : "";
    await call("sendMessage", { chat_id: m.chat.id, text: T[l].hi, reply_markup: { inline_keyboard: [[{ text: T[l].play, web_app: { url: env.WEBAPP_URL + q } }]] } });
  }
  return json({ ok: true });
}

async function ensureUser(env, u, refBy) {
  const ex = await env.DB.prepare("SELECT * FROM users WHERE id=?").bind(u.id).first();
  if (ex) {
    await env.DB.prepare("UPDATE users SET username=?, first_name=?, is_premium=? WHERE id=?").bind(u.username || null, u.first_name || "", u.is_premium ? 1 : 0, u.id).run();
    return ex;
  }
  const ref = refBy && refBy !== u.id ? refBy : null;
  await env.DB.prepare("INSERT OR IGNORE INTO users(id,username,first_name,lang,is_premium,ref_by,created_at) VALUES(?,?,?,?,?,?,?)")
    .bind(u.id, u.username || null, u.first_name || "", langOf(u.language_code), u.is_premium ? 1 : 0, ref, now()).run();
  return env.DB.prepare("SELECT * FROM users WHERE id=?").bind(u.id).first();
}

// ───────────────────────── API ─────────────────────────
async function api(req, env, url) {
  const auth = (req.headers.get("authorization") || "").replace(/^tma /, "");
  const v = await verifyInitData(auth, env.BOT_TOKEN);
  if (!v) return fail("auth", 401);
  const param = v.start_param || "";
  let me = await ensureUser(env, v.user, param.startsWith("ref_") ? Number(param.slice(4)) : null);
  const body = req.method === "POST" ? await req.json().catch(() => ({})) : {};
  const route = url.pathname.slice(5);
  const isAdmin = String(me.id) === String(env.ADMIN_ID);
  const H = { me, env, body, isAdmin, user: v.user };
  switch (route) {
    case "me": return json(await state(H));
    case "open_case": return openCase(H);
    case "sell": return sell(H);
    case "upgrade": return upgrade(H);
    case "leaderboard": return leaderboard(H);
    case "invoice": return invoice(H);
    case "promo": return claimCode(H, "promo");
    case "check": return claimCode(H, "check");
    case "tasks": return tasks(H);
    case "task_claim": return taskClaim(H);
    case "withdraw": return withdraw(H);
    case "rocket/state": return rocketState(H);
    case "rocket/bet": return rocketBet(H);
    case "rocket/cashout": return rocketCashout(H);
  }
  if (route.startsWith("admin/")) { if (!isAdmin) return fail("forbidden", 403); return admin(H, route.slice(6)); }
  return fail("not_found", 404);
}

async function state({ me, env, isAdmin }) {
  const u = await env.DB.prepare("SELECT * FROM users WHERE id=?").bind(me.id).first();
  const inv = (await env.DB.prepare("SELECT id,gift_id FROM inventory WHERE user_id=? ORDER BY id DESC").bind(me.id).all()).results;
  const refs = await env.DB.prepare("SELECT COUNT(*) c, SUM(CASE WHEN opened>0 THEN 1 ELSE 0 END) o, SUM(CASE WHEN deposited_stars>0 THEN 1 ELSE 0 END) d FROM users WHERE ref_by=?").bind(me.id).first();
  return { ok: true, id: u.id, name: u.first_name, username: u.username, balance: u.balance, opened: u.opened, xp: u.xp, level: 1 + Math.floor(Math.sqrt(u.xp / 10)),
    premium: !!u.is_premium, free_in: Math.max(0, u.last_free + 86400000 - now()), inv, isAdmin,
    refs: { total: refs.c || 0, opened: refs.o || 0, deposited: refs.d || 0 }, bot: env.BOT_USERNAME, packs: PACKS, now: now() };
}

async function addXp(env, id, n) { await env.DB.prepare("UPDATE users SET xp=xp+? WHERE id=?").bind(n, id).run(); }

async function openCase({ me, env, body }) {
  const c = CASES.cases.find(x => x.id === body.id); if (!c) return fail("case");
  const u = await env.DB.prepare("SELECT * FROM users WHERE id=?").bind(me.id).first();
  if (c.daily) {
    const r = await env.DB.prepare("UPDATE users SET last_free=? WHERE id=? AND last_free<=?").bind(now(), me.id, now() - 86400000).run();
    if (!r.meta.changes) return fail("cooldown");
  } else {
    const r = await env.DB.prepare("UPDATE users SET balance=balance-? WHERE id=? AND balance>=?").bind(c.price, me.id, c.price).run();
    if (!r.meta.changes) return fail("balance");
  }
  const d = pick(c.drops); let prize;
  if (d.coins) { await env.DB.prepare("UPDATE users SET balance=balance+?, total_won=total_won+? WHERE id=?").bind(d.coins, d.coins, me.id).run(); prize = { coins: d.coins }; }
  else { await env.DB.prepare("INSERT INTO inventory(user_id,gift_id,created_at) VALUES(?,?,?)").bind(me.id, d.gift, now()).run(); prize = { gift: d.gift, value: G[d.gift].value }; }
  await env.DB.prepare("UPDATE users SET opened=opened+1, xp=xp+? WHERE id=?").bind(Math.max(1, Math.round(c.price / 30)), me.id).run();
  // referral bonus: friend opened his first case
  if (u.ref_by && !u.ref_rewarded) {
    const r = await env.DB.prepare("UPDATE users SET ref_rewarded=1 WHERE id=? AND ref_rewarded=0").bind(me.id).run();
    if (r.meta.changes) await env.DB.prepare("UPDATE users SET balance=balance+100 WHERE id=?").bind(u.ref_by).run();
  }
  const bal = (await env.DB.prepare("SELECT balance FROM users WHERE id=?").bind(me.id).first()).balance;
  return json({ ok: true, prize, balance: bal });
}

async function sell({ me, env, body }) {
  const it = await env.DB.prepare("SELECT * FROM inventory WHERE id=? AND user_id=?").bind(body.id, me.id).first();
  if (!it) return fail("item");
  const del = await env.DB.prepare("DELETE FROM inventory WHERE id=? AND user_id=?").bind(it.id, me.id).run();
  if (!del.meta.changes) return fail("item");
  const val = Math.floor(G[it.gift_id].value * W.sell_rate);
  await env.DB.prepare("UPDATE users SET balance=balance+? WHERE id=?").bind(val, me.id).run();
  return json({ ok: true, coins: val });
}

async function setting(env, k, d) { const r = await env.DB.prepare("SELECT v FROM settings WHERE k=?").bind(k).first(); return r ? r.v : d; }

async function upgrade({ me, env, body }) {
  const it = await env.DB.prepare("SELECT * FROM inventory WHERE id=? AND user_id=?").bind(body.id, me.id).first();
  const to = G[body.to]; if (!it || !to) return fail("item");
  const from = G[it.gift_id]; if (to.value <= from.value) return fail("target");
  const fixed = Number(await setting(env, "upgrade_fixed", 0));            // admin: any fixed chance 0..1 (0 = off)
  const mult = Number(await setting(env, "upgrade_mult", 0.9));
  const chance = fixed > 0 ? fixed : Math.min(0.95, mult * from.value / to.value);
  const del = await env.DB.prepare("DELETE FROM inventory WHERE id=? AND user_id=?").bind(it.id, me.id).run();
  if (!del.meta.changes) return fail("item");
  const win = rnd(1) < chance;
  if (win) await env.DB.prepare("INSERT INTO inventory(user_id,gift_id,created_at) VALUES(?,?,?)").bind(me.id, to.id, now()).run();
  return json({ ok: true, win, chance });
}

async function leaderboard({ me, env }) {
  const top = (await env.DB.prepare("SELECT id,first_name,username,balance FROM users ORDER BY balance DESC LIMIT 50").all()).results;
  const rank = (await env.DB.prepare("SELECT COUNT(*)+1 r FROM users WHERE balance>(SELECT balance FROM users WHERE id=?)").bind(me.id).first()).r;
  return json({ ok: true, top: top.map(t => ({ name: t.first_name || t.username || "—", balance: t.balance, me: t.id === me.id })), rank });
}

async function invoice({ me, env, body }) {
  const stars = Number(body.stars); if (!PACKS.includes(stars)) return fail("pack");
  const r = await tg(env)("createInvoiceLink", { title: `${stars * GIFTS.rate} donut`, description: `${stars} ⭐ → ${stars * GIFTS.rate} donut`,
    payload: `topup:${me.id}`, currency: "XTR", prices: [{ label: "donut", amount: stars }] });
  return r.ok ? json({ ok: true, link: r.result }) : fail("invoice");
}

async function claimCode({ me, env, body }, kind) {
  const code = String(body.code || "").trim().replace(/^(chk_|promo_)/, "").toUpperCase();
  const row = await env.DB.prepare("SELECT * FROM promos WHERE code=? AND kind=?").bind(code, kind).first();
  if (!row || (row.expires_at && row.expires_at < now())) return fail("invalid");
  const used = await env.DB.prepare("INSERT OR IGNORE INTO promo_claims(code,user_id) VALUES(?,?)").bind(`${kind}:${code}`, me.id).run();
  if (!used.meta.changes) return fail("used");
  const r = await env.DB.prepare("UPDATE promos SET uses=uses+1 WHERE code=? AND (max_uses=0 OR uses<max_uses)").bind(code).run();
  if (!r.meta.changes) { await env.DB.prepare("DELETE FROM promo_claims WHERE code=? AND user_id=?").bind(`${kind}:${code}`, me.id).run(); return fail("empty"); }
  await env.DB.prepare("UPDATE users SET balance=balance+? WHERE id=?").bind(row.amount, me.id).run();
  return json({ ok: true, coins: row.amount });
}

async function tasks({ me, env }) {
  const list = (await env.DB.prepare("SELECT t.*, (SELECT 1 FROM task_claims c WHERE c.task_id=t.id AND c.user_id=?) done FROM tasks t WHERE active=1").bind(me.id).all()).results;
  return json({ ok: true, tasks: list.map(t => ({ id: t.id, title: t.title, url: t.url, reward: t.reward, required: !!t.required, done: !!t.done })) });
}
async function taskClaim({ me, env, body }) {
  const t = await env.DB.prepare("SELECT * FROM tasks WHERE id=? AND active=1").bind(body.id).first(); if (!t) return fail("task");
  if (t.chat) {
    const r = await tg(env)("getChatMember", { chat_id: t.chat, user_id: me.id });
    if (!r.ok || !["member", "administrator", "creator"].includes(r.result.status)) return fail("not_subscribed");
  }
  const ins = await env.DB.prepare("INSERT OR IGNORE INTO task_claims(task_id,user_id) VALUES(?,?)").bind(t.id, me.id).run();
  if (!ins.meta.changes) return fail("done");
  await env.DB.prepare("UPDATE users SET balance=balance+? WHERE id=?").bind(t.reward, me.id).run();
  return json({ ok: true, coins: t.reward });
}

async function withdraw({ me, env, body }) {
  const refs = await env.DB.prepare("SELECT SUM(CASE WHEN opened>0 THEN 1 ELSE 0 END) o, SUM(CASE WHEN deposited_stars>0 THEN 1 ELSE 0 END) d FROM users WHERE ref_by=?").bind(me.id).first();
  if ((refs.o || 0) < W.refs_needed || (refs.d || 0) < W.refs_deposit_needed) return fail("refs");
  const req = (await env.DB.prepare("SELECT COUNT(*) c FROM withdrawals WHERE user_id=? AND status='pending'").bind(me.id).first()).c;
  if (req) return fail("pending");
  let row;
  if (body.kind === "coins") {
    const amount = Math.floor(Number(body.amount));
    if (!(amount >= W.coins_min)) return fail("min");
    const r = await env.DB.prepare("UPDATE users SET balance=balance-? WHERE id=? AND balance>=?").bind(amount, me.id, amount).run();
    if (!r.meta.changes) return fail("balance");
    row = { kind: "coins", amount, stars: Math.floor(amount * W.coins_stars / W.coins_min), gift: null };
  } else if (body.kind === "gift") {
    const it = await env.DB.prepare("SELECT * FROM inventory WHERE id=? AND user_id=?").bind(body.id, me.id).first(); if (!it) return fail("item");
    const g = G[it.gift_id];
    if (g.nft && g.stars < W.nft_min_stars) return fail("nft_min");
    const d = await env.DB.prepare("DELETE FROM inventory WHERE id=? AND user_id=?").bind(it.id, me.id).run(); if (!d.meta.changes) return fail("item");
    row = { kind: "gift", amount: g.value, stars: g.stars, gift: g.id };
  } else return fail("kind");
  const ins = await env.DB.prepare("INSERT INTO withdrawals(user_id,kind,amount,stars,gift_id,created_at) VALUES(?,?,?,?,?,?)").bind(me.id, row.kind, row.amount, row.stars, row.gift, now()).run();
  await tg(env)("sendMessage", { chat_id: env.ADMIN_ID, text: `💸 Вывод #${ins.meta.last_row_id}\nuser: ${me.id} @${me.username || "-"}\n${row.kind === "gift" ? row.gift : row.amount + " donut"} → ${row.stars} ⭐` });
  return json({ ok: true, id: ins.meta.last_row_id });
}

// ───────────────────────── Rocket (provably fair) ─────────────────────────
async function currentRound(env) {
  let r = await env.DB.prepare("SELECT * FROM rocket_rounds ORDER BY id DESC LIMIT 1").first();
  const t = now();
  if (!r || t >= r.next_at) {
    const id = (r ? r.id : 0) + 1, seed = rndHex(32), hash = await sha256hex(seed);
    const crash = crashFromHash(await sha256hex(`${seed}:${id}`));
    const bet_end = t + BET_MS, crash_at = bet_end + flightMs(crash);
    await env.DB.prepare("INSERT OR IGNORE INTO rocket_rounds(id,seed,hash,crash,bet_end,fly_start,crash_at,next_at) VALUES(?,?,?,?,?,?,?,?)")
      .bind(id, seed, hash, crash, bet_end, bet_end, crash_at, crash_at + COOL_MS).run();
    r = await env.DB.prepare("SELECT * FROM rocket_rounds WHERE id=?").bind(id).first();
  }
  return r;
}
async function rocketState({ me, env }) {
  const r = await currentRound(env), t = now();
  const phase = t < r.bet_end ? "bet" : t < r.crash_at ? "fly" : "crashed";
  const my = await env.DB.prepare("SELECT amount,cashout,payout FROM rocket_bets WHERE round_id=? AND user_id=?").bind(r.id, me.id).first();
  const hist = (await env.DB.prepare("SELECT id,crash FROM rocket_rounds WHERE crash_at<? ORDER BY id DESC LIMIT 12").bind(t).all()).results;
  const out = { ok: true, now: t, round: r.id, phase, hash: r.hash, bet_end: r.bet_end, fly_start: r.fly_start, next_at: r.next_at, my, history: hist };
  if (phase === "crashed") { out.crash = r.crash; out.seed = r.seed; }
  return json(out);
}
async function rocketBet({ me, env, body }) {
  const amount = Math.floor(Number(body.amount));
  if (!(amount >= MIN_BET && amount <= MAX_BET)) return fail("amount");
  const r = await currentRound(env);
  if (now() >= r.bet_end) return fail("late");
  const ins = await env.DB.prepare("INSERT OR IGNORE INTO rocket_bets(round_id,user_id,amount) VALUES(?,?,?)").bind(r.id, me.id, amount).run();
  if (!ins.meta.changes) return fail("already");
  const u = await env.DB.prepare("UPDATE users SET balance=balance-? WHERE id=? AND balance>=?").bind(amount, me.id, amount).run();
  if (!u.meta.changes) { await env.DB.prepare("DELETE FROM rocket_bets WHERE round_id=? AND user_id=?").bind(r.id, me.id).run(); return fail("balance"); }
  return json({ ok: true, round: r.id });
}
async function rocketCashout({ me, env }) {
  const r = await currentRound(env), t = now();
  if (t < r.fly_start || t >= r.crash_at) return fail("late");
  const x = multAt(t - r.fly_start);
  if (x >= r.crash) return fail("late");
  const bet = await env.DB.prepare("SELECT * FROM rocket_bets WHERE round_id=? AND user_id=?").bind(r.id, me.id).first();
  if (!bet || bet.cashout) return fail("nobet");
  const payout = Math.floor(bet.amount * x);
  const u = await env.DB.prepare("UPDATE rocket_bets SET cashout=?, payout=? WHERE round_id=? AND user_id=? AND cashout IS NULL").bind(x, payout, r.id, me.id).run();
  if (!u.meta.changes) return fail("nobet");
  await env.DB.prepare("UPDATE users SET balance=balance+?, total_won=total_won+? WHERE id=?").bind(payout, Math.max(0, payout - bet.amount), me.id).run();
  await addXp(env, me.id, Math.max(1, Math.round(bet.amount / 50)));
  return json({ ok: true, x, payout });
}

// ───────────────────────── Admin ─────────────────────────
async function admin({ env, body }, route) {
  switch (route) {
    case "give": {
      const amt = Math.floor(Number(body.amount)); const id = Number(body.user_id);
      if (!id || !amt) return fail("args");
      const r = await env.DB.prepare("UPDATE users SET balance=balance+? WHERE id=?").bind(amt, id).run();
      return json({ ok: !!r.meta.changes });
    }
    case "promo": case "check": {
      const code = (String(body.code || "").trim() || rndHex(4)).toUpperCase();
      const exp = body.days ? now() + Number(body.days) * 86400000 : 0;
      await env.DB.prepare("INSERT OR REPLACE INTO promos(code,amount,max_uses,uses,expires_at,kind) VALUES(?,?,?,0,?,?)")
        .bind(code, Math.floor(Number(body.amount)), Math.floor(Number(body.max_uses || 0)), exp, route).run();
      const link = route === "check" ? `https://t.me/${env.BOT_USERNAME}?start=chk_${code}` : null;
      return json({ ok: true, code, link });
    }
    case "task": {
      const r = await env.DB.prepare("INSERT INTO tasks(title,chat,url,reward,required) VALUES(?,?,?,?,?)").bind(body.title, body.chat || null, body.url || null, Math.floor(Number(body.reward)), body.required ? 1 : 0).run();
      return json({ ok: true, id: r.meta.last_row_id });
    }
    case "task_off": { await env.DB.prepare("UPDATE tasks SET active=0 WHERE id=?").bind(body.id).run(); return json({ ok: true }); }
    case "withdrawals": return json({ ok: true, list: (await env.DB.prepare("SELECT * FROM withdrawals WHERE status='pending' ORDER BY id").all()).results });
    case "withdraw_resolve": {
      const w = await env.DB.prepare("SELECT * FROM withdrawals WHERE id=? AND status='pending'").bind(body.id).first(); if (!w) return fail("none");
      const ok = !!body.approve;
      await env.DB.prepare("UPDATE withdrawals SET status=? WHERE id=?").bind(ok ? "done" : "rejected", w.id).run();
      if (!ok) { // refund
        if (w.kind === "coins") await env.DB.prepare("UPDATE users SET balance=balance+? WHERE id=?").bind(w.amount, w.user_id).run();
        else await env.DB.prepare("INSERT INTO inventory(user_id,gift_id,created_at) VALUES(?,?,?)").bind(w.user_id, w.gift_id, now()).run();
      }
      await tg(env)("sendMessage", { chat_id: w.user_id, text: ok ? "✅ Вывод одобрен / Withdrawal approved" : "❌ Вывод отклонён, средства возвращены / Rejected, refunded" });
      return json({ ok: true });
    }
    case "setting": { await env.DB.prepare("INSERT OR REPLACE INTO settings(k,v) VALUES(?,?)").bind(body.k, String(body.v)).run(); return json({ ok: true }); }
  }
  return fail("not_found", 404);
}
