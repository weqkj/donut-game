// Provably fair "rocket". Identical file lives in worker/src/fair.js — keep them in sync.
export const RATE = 0.2;          // multiplier = e^(RATE * seconds)
export const MAX_X = 100;         // hard cap
export const EDGE_MOD = 25;       // 1/25 = 4% instant crash at 1.00x

export async function sha256hex(str) {
  const buf = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(str));
  return [...new Uint8Array(buf)].map(b => b.toString(16).padStart(2, "0")).join("");
}

// hex = sha256(serverSeed + ":" + roundId)
export function crashFromHash(hex) {
  const h = parseInt(hex.slice(0, 13), 16);        // 52 bits
  if (h % EDGE_MOD === 0) return 1;
  const e = 2 ** 52;
  const x = Math.floor((100 * e - h) / (e - h)) / 100;
  return Math.min(MAX_X, Math.max(1, x));
}

export async function crashPoint(serverSeed, roundId) {
  return crashFromHash(await sha256hex(`${serverSeed}:${roundId}`));
}

export const multAt = (ms) => Math.min(MAX_X, Math.floor(Math.exp(RATE * ms / 1000) * 100) / 100);
export const flightMs = (crash) => crash <= 1 ? 0 : Math.ceil(Math.log(crash) / RATE * 1000);
