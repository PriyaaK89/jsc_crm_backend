const db = require("../config/db");
const cfg = require("./chat.config");
const { getTeamIds, getManagerIds } = require("./chat.hierarchy");

const norm = (s) => String(s || "").trim().toLowerCase().replace(/[\s-]+/g, "_");
const httpError = (status, message) => Object.assign(new Error(message), { status });

const getChatUser = async (userId) => {
  const [rows] = await db.query(
    `SELECT u.id, u.name, u.profile_image, u.is_active,
            r.name AS role, jr.name AS job_role, jr.level
     FROM users u
     LEFT JOIN roles r ON r.id = u.role_id
     LEFT JOIN job_roles jr ON jr.id = u.job_role_id
     WHERE u.id = ?`,
    [userId]
  );
  return rows[0];
};

// ---------------------------------------------------------------------------
// TODO (plug in YOUR permission system): return true if this user has the given
// permission key. Keys used: cfg.PERMISSION_MESSAGE_ANYONE, cfg.PERMISSION_CREATE_GROUP
// Until wired, only admin/super_admin (and job roles in config) get these powers.
// ---------------------------------------------------------------------------
const userHasPermission = async (user, permissionKey) => {
  return false;
};

const getChatCapabilities = async (userId) => {
  const user = await getChatUser(userId);
  if (!user || !user.is_active) throw httpError(403, "User not found or inactive");

  const isUnrestricted = cfg.UNRESTRICTED_ROLES.includes(norm(user.role));
  const canMessageAnyone =
    isUnrestricted || (await userHasPermission(user, cfg.PERMISSION_MESSAGE_ANYONE));
  const canCreateGroup =
    isUnrestricted ||
    (await userHasPermission(user, cfg.PERMISSION_CREATE_GROUP)) ||
    cfg.GROUP_CREATOR_JOB_ROLES.includes(norm(user.job_role));

  return { user, canMessageAnyone, canCreateGroup };
};

const getRelationSets = async (userId) => {
  const [team, managers] = await Promise.all([getTeamIds(userId), getManagerIds(userId)]);
  return { team: new Set(team), managers: new Set(managers) };
};

const getActiveUserIds = async (ids) => {
  if (!ids.length) return new Set();
  const [rows] = await db.query(
    `SELECT id FROM users WHERE is_active = 1 AND id IN (${ids.map(() => "?").join(",")})`,
    ids
  );
  return new Set(rows.map((r) => r.id));
};

// Can `userId` start a direct chat with `targetId`?
const assertCanMessage = async (caps, userId, targetId) => {
  const active = await getActiveUserIds([targetId]);
  if (!active.has(targetId)) throw httpError(404, "User not found or inactive");
  if (caps.canMessageAnyone) return;
  const { team, managers } = await getRelationSets(userId);
  if (!team.has(targetId) && !managers.has(targetId)) {
    throw httpError(403, "You can only chat with your reporting line or your team");
  }
};

// Can `userId` add these users to a group? (admins/permitted: anyone; others: own team only)
const assertCanAddUsers = async (caps, userId, ids) => {
  const active = await getActiveUserIds(ids);
  for (const id of ids) {
    if (!active.has(id)) throw httpError(404, `User ${id} not found or inactive`);
  }
  if (caps.canMessageAnyone) return;
  const { team } = await getRelationSets(userId);
  for (const id of ids) {
    if (!team.has(id)) throw httpError(403, "You can only add members from your own team");
  }
};

module.exports = {
  httpError,
  getChatUser,
  getChatCapabilities,
  getRelationSets,
  assertCanMessage,
  assertCanAddUsers,
};