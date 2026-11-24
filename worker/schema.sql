CREATE TABLE IF NOT EXISTS users(
  id INTEGER PRIMARY KEY, username TEXT, first_name TEXT, lang TEXT DEFAULT 'ru',
  balance INTEGER NOT NULL DEFAULT 0, is_premium INTEGER DEFAULT 0,
  ref_by INTEGER, ref_rewarded INTEGER DEFAULT 0, last_free INTEGER DEFAULT 0,
  opened INTEGER DEFAULT 0, deposited_stars INTEGER DEFAULT 0, total_won INTEGER DEFAULT 0,
  xp INTEGER DEFAULT 0, created_at INTEGER);
CREATE INDEX IF NOT EXISTS users_ref ON users(ref_by);
CREATE INDEX IF NOT EXISTS users_bal ON users(balance DESC);
CREATE TABLE IF NOT EXISTS inventory(id INTEGER PRIMARY KEY AUTOINCREMENT, user_id INTEGER, gift_id TEXT, created_at INTEGER);
CREATE INDEX IF NOT EXISTS inv_user ON inventory(user_id);
CREATE TABLE IF NOT EXISTS promos(code TEXT PRIMARY KEY, amount INTEGER, max_uses INTEGER, uses INTEGER DEFAULT 0, expires_at INTEGER, kind TEXT DEFAULT 'promo');
CREATE TABLE IF NOT EXISTS promo_claims(code TEXT, user_id INTEGER, PRIMARY KEY(code,user_id));
CREATE TABLE IF NOT EXISTS tasks(id INTEGER PRIMARY KEY AUTOINCREMENT, title TEXT, chat TEXT, url TEXT, reward INTEGER, required INTEGER DEFAULT 0, active INTEGER DEFAULT 1);
CREATE TABLE IF NOT EXISTS task_claims(task_id INTEGER, user_id INTEGER, PRIMARY KEY(task_id,user_id));
CREATE TABLE IF NOT EXISTS withdrawals(id INTEGER PRIMARY KEY AUTOINCREMENT, user_id INTEGER, kind TEXT, amount INTEGER, stars INTEGER, gift_id TEXT, status TEXT DEFAULT 'pending', created_at INTEGER);
CREATE TABLE IF NOT EXISTS payments(charge_id TEXT PRIMARY KEY, user_id INTEGER, stars INTEGER, created_at INTEGER);
CREATE TABLE IF NOT EXISTS settings(k TEXT PRIMARY KEY, v TEXT);
CREATE TABLE IF NOT EXISTS rocket_rounds(id INTEGER PRIMARY KEY, seed TEXT, hash TEXT, crash REAL, bet_end INTEGER, fly_start INTEGER, crash_at INTEGER, next_at INTEGER);
CREATE TABLE IF NOT EXISTS rocket_bets(round_id INTEGER, user_id INTEGER, amount INTEGER, cashout REAL, payout INTEGER DEFAULT 0, PRIMARY KEY(round_id,user_id));
