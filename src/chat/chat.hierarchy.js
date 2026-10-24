const db = require("../config/db");

// Small TTL cache so the chat list does not re-walk the tree on every call.
const TTL_MS = 30 * 1000;
const cache = new Map();
const getCached = (key) => {
  const hit = cache.get(key);
  if (hit && hit.exp > Date.now()) return hit.val;
  cache.delete(key);
  return null;
};
const setCached = (key, val) => cache.set(key, { val, exp: Date.now() + TTL_MS });

// All subordinates (any depth), level by level: 1 query per level, not per user.
const getTeamIds = async (userId) => {
  userId = Number(userId);
  const key = `team:${userId}`;
  const hit = getCached(key);
  if (hit) return hit;

  const seen = new Set([userId]);
  const result = [];
  let frontier = [userId];

  while (frontier.length) {
    const [rows] = await db.query(
      `SELECT id FROM users WHERE reporting_under IN (${frontier.map(() => "?").join(",")})`,
      frontier
    );
    frontier = [];
    for (const r of rows) {
      if (!seen.has(r.id)) {
        seen.add(r.id);
        result.push(r.id);
        frontier.push(r.id);
      }
    }
  }
  setCached(key, result);
  return result;
};

// Reporting chain upwards: direct manager, manager's manager, ...
const getManagerIds = async (userId) => {
  userId = Number(userId);
  const key = `mgr:${userId}`;
  const hit = getCached(key);
  if (hit) return hit;

  const seen = new Set([userId]);
  const result = [];
  let current = userId;

  for (let i = 0; i < 20; i++) {
    const [rows] = await db.query("SELECT reporting_under FROM users WHERE id = ?", [current]);
    const next = rows[0] && rows[0].reporting_under;
    if (!next || seen.has(next)) break;
    seen.add(next);
    result.push(next);
    current = next;
  }
  setCached(key, result);
  return result;
};

module.exports = { getTeamIds, getManagerIds };