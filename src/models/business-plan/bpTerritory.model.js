// Business Plan territories: one state, many districts, an insert-only version history, the
// territory coverage frozen on every Business Plan, and the state scopes of territory managers.
//
// Tables (2026_11_18_bp_territory_versions.sql on top of 2026_11_13_business_plan.sql):
//   bp_territories               id, name, state_id, is_active, current_version_no, created_by, updated_by
//   bp_territory_districts       territory_id, district_id            (the territory's CURRENT districts)
//   bp_territory_versions        one row per create / edit / activate / deactivate; never updated
//   bp_territory_manager_states  user_id, state_id, is_active, granted_by/at, revoked_by/at
//   business_plans               territory_id, territory_version_no, territory_snapshot, territory_snapshot_at
// Geography is the CRM master (geo_states, geo_districts) — the same data Assign Area uses.
const db = require("../../config/db");

const PERMISSION_CODE = "MANAGE_BP_TERRITORIES";
// a plan's territory coverage is frozen in these statuses (approved / closed / rejected history)
const FROZEN_STATUSES = ["ACTIVE", "CLOSED", "REJECTED"];
const REVISION_OPEN = "IN_REVISION";
const CHANGE_LABEL = {
  BASELINE: "Baseline (migration)",
  CREATED: "Created",
  EDITED: "Edited",
  ACTIVATED: "Activated",
  DEACTIVATED: "Deactivated",
};

const num = (v) => Number(v) || 0;
const parseJson = (value, fallback = null) => {
  if (value === null || value === undefined || value === "") return fallback;
  if (typeof value === "object") return value;
  try {
    return JSON.parse(value);
  } catch (_) {
    return fallback;
  }
};
const uniqueIds = (list) => [...new Set((list || []).map(Number).filter((x) => Number.isInteger(x) && x > 0))];

// ---------------------------------------------------------------------
//  GEOGRAPHY (geo_states / geo_districts)
// ---------------------------------------------------------------------
const getState = async (stateId, runner = db) => {
  const [rows] = await runner.query(`SELECT id, state_name AS name FROM geo_states WHERE id = ?`, [stateId]);
  return rows[0] || null;
};

// districts among `ids` that belong to `stateId`, with their names (ordered by name)
const districtsInState = async (stateId, ids, runner = db) => {
  if (!ids.length) return [];
  const [rows] = await runner.query(
    `SELECT id, district_name_english AS name, state_id
     FROM geo_districts WHERE state_id = ? AND id IN (?)
     ORDER BY district_name_english ASC, id ASC`,
    [stateId, ids],
  );
  return rows.map((r) => ({ id: num(r.id), name: r.name || `District #${r.id}` }));
};

// territory id -> [{ id, name }] (current districts, ordered by name)
const districtsByTerritory = async (territoryIds, runner = db) => {
  const out = new Map();
  if (!territoryIds.length) return out;
  const [rows] = await runner.query(
    `SELECT td.territory_id, td.district_id, d.district_name_english AS name
     FROM bp_territory_districts td
     LEFT JOIN geo_districts d ON d.id = td.district_id
     WHERE td.territory_id IN (?)
     ORDER BY d.district_name_english ASC, td.district_id ASC`,
    [territoryIds],
  );
  for (const r of rows) {
    const list = out.get(num(r.territory_id)) || [];
    list.push({ id: num(r.district_id), name: r.name || `District #${r.district_id}` });
    out.set(num(r.territory_id), list);
  }
  return out;
};

// ---------------------------------------------------------------------
//  TERRITORIES
// ---------------------------------------------------------------------
const TERRITORY_SELECT = `
  SELECT t.id, t.name, t.state_id, gs.state_name, t.is_active, t.current_version_no,
         t.created_by, cu.name AS created_by_name, t.updated_by, uu.name AS updated_by_name,
         DATE_FORMAT(t.created_at, '%Y-%m-%d %H:%i:%s') AS created_at,
         DATE_FORMAT(t.updated_at, '%Y-%m-%d %H:%i:%s') AS updated_at,
         (SELECT COUNT(*) FROM business_plans p WHERE p.territory_id = t.id AND p.is_deleted = 0) AS plans_total,
         (SELECT COUNT(*) FROM business_plans p WHERE p.territory_id = t.id AND p.is_deleted = 0
             AND p.status IN ('ACTIVE', 'CLOSED')) AS plans_approved,
         (SELECT COUNT(*) FROM business_plans p WHERE p.territory_id = t.id AND p.is_deleted = 0
             AND p.status IN ('DRAFT', 'SUBMITTED', 'UNDER_REVIEW')) AS plans_open
  FROM bp_territories t
  LEFT JOIN geo_states gs ON gs.id = t.state_id
  LEFT JOIN users cu ON cu.id = t.created_by
  LEFT JOIN users uu ON uu.id = t.updated_by`;

const shapeTerritory = (r, districts) => ({
  id: num(r.id),
  name: r.name,
  state_id: num(r.state_id),
  state_name: r.state_name || null,
  is_active: num(r.is_active) === 1,
  status: num(r.is_active) === 1 ? "ACTIVE" : "INACTIVE",
  current_version_no: num(r.current_version_no),
  district_ids: districts.map((d) => d.id),
  district_names: districts.map((d) => d.name),
  districts,
  district_count: districts.length,
  // offered in new Business Plans only when active and covering at least one district
  selectable: num(r.is_active) === 1 && districts.length > 0,
  plans_total: num(r.plans_total),
  plans_approved: num(r.plans_approved),
  plans_open: num(r.plans_open),
  created_by: r.created_by,
  created_by_name: r.created_by_name || null,
  updated_by: r.updated_by,
  updated_by_name: r.updated_by_name || null,
  created_at: r.created_at,
  updated_at: r.updated_at,
});

// { stateId, stateIds, includeInactive, selectableOnly, search, ids }
const listTerritories = async ({ stateId, stateIds, includeInactive = false, selectableOnly = false, search, ids } = {}, runner = db) => {
  const where = ["1 = 1"];
  const params = [];
  if (!includeInactive || selectableOnly) where.push("t.is_active = 1");
  if (stateId) {
    where.push("t.state_id = ?");
    params.push(stateId);
  }
  if (Array.isArray(stateIds)) {
    where.push("t.state_id IN (?)");
    params.push(stateIds.length ? stateIds : [0]);
  }
  if (Array.isArray(ids)) {
    where.push("t.id IN (?)");
    params.push(ids.length ? ids : [0]);
  }
  if (search) {
    where.push("t.name LIKE ?");
    params.push(`%${search}%`);
  }
  if (selectableOnly) where.push("EXISTS (SELECT 1 FROM bp_territory_districts td WHERE td.territory_id = t.id)");
  const [rows] = await runner.query(`${TERRITORY_SELECT} WHERE ${where.join(" AND ")} ORDER BY gs.state_name ASC, t.name ASC`, params);
  const districts = await districtsByTerritory(rows.map((r) => num(r.id)), runner);
  return rows.map((r) => shapeTerritory(r, districts.get(num(r.id)) || []));
};

const getTerritory = async (id, runner = db) => {
  const [rows] = await runner.query(`${TERRITORY_SELECT} WHERE t.id = ?`, [id]);
  if (!rows[0]) return null;
  const districts = await districtsByTerritory([num(id)], runner);
  return shapeTerritory(rows[0], districts.get(num(id)) || []);
};

const findByName = async (stateId, name, excludeId = 0, runner = db) => {
  const [rows] = await runner.query(
    `SELECT id, name FROM bp_territories WHERE state_id = ? AND name = ? AND id <> ? LIMIT 1`,
    [stateId, name, excludeId],
  );
  return rows[0] || null;
};

// districts (of the list) that are in ANOTHER ACTIVE territory of the same state
const activeConflicts = async (stateId, districtIds, excludeTerritoryId = 0, runner = db) => {
  if (!districtIds.length) return [];
  const [rows] = await runner.query(
    `SELECT td.district_id, d.district_name_english AS district_name, t.id AS territory_id, t.name AS territory_name
     FROM bp_territory_districts td
     INNER JOIN bp_territories t ON t.id = td.territory_id
     LEFT JOIN geo_districts d ON d.id = td.district_id
     WHERE t.state_id = ? AND t.is_active = 1 AND t.id <> ? AND td.district_id IN (?)
     ORDER BY d.district_name_english ASC, t.name ASC`,
    [stateId, excludeTerritoryId, districtIds],
  );
  return rows.map((r) => ({
    district_id: num(r.district_id),
    district_name: r.district_name || `District #${r.district_id}`,
    territory_id: num(r.territory_id),
    territory_name: r.territory_name,
  }));
};

// existing overlaps: districts in more than one ACTIVE territory (report; nothing is changed)
const overlapReport = async ({ stateIds } = {}, runner = db) => {
  const where = ["t.is_active = 1"];
  const params = [];
  if (Array.isArray(stateIds)) {
    where.push("t.state_id IN (?)");
    params.push(stateIds.length ? stateIds : [0]);
  }
  const [rows] = await runner.query(
    `SELECT td.district_id, d.district_name_english AS district_name, t.state_id, gs.state_name,
            t.id AS territory_id, t.name AS territory_name
     FROM bp_territory_districts td
     INNER JOIN bp_territories t ON t.id = td.territory_id
     LEFT JOIN geo_districts d ON d.id = td.district_id
     LEFT JOIN geo_states gs ON gs.id = t.state_id
     WHERE ${where.join(" AND ")}
       AND td.district_id IN (
         SELECT td2.district_id FROM bp_territory_districts td2
         INNER JOIN bp_territories t2 ON t2.id = td2.territory_id
         WHERE t2.is_active = 1
         GROUP BY td2.district_id HAVING COUNT(*) > 1
       )
     ORDER BY gs.state_name ASC, d.district_name_english ASC, t.name ASC`,
    params,
  );
  const byDistrict = new Map();
  for (const r of rows) {
    const key = num(r.district_id);
    const item = byDistrict.get(key) || {
      district_id: key,
      district_name: r.district_name || `District #${key}`,
      state_id: num(r.state_id),
      state_name: r.state_name,
      territories: [],
    };
    item.territories.push({ id: num(r.territory_id), name: r.territory_name });
    byDistrict.set(key, item);
  }
  return [...byDistrict.values()];
};

// ---------------------------------------------------------------------
//  VERSIONS (insert-only)
// ---------------------------------------------------------------------
const VERSION_SELECT = `
  SELECT v.id, v.territory_id, v.version_no, v.name, v.state_id, v.state_name, v.district_ids, v.district_names,
         v.district_count, v.is_active, v.change_type, v.remark, v.changed_by, u.name AS changed_by_name,
         DATE_FORMAT(v.changed_at, '%Y-%m-%d %H:%i:%s') AS changed_at
  FROM bp_territory_versions v
  LEFT JOIN users u ON u.id = v.changed_by`;

const shapeVersion = (r) => {
  const ids = parseJson(r.district_ids, []);
  const names = parseJson(r.district_names, []);
  return {
    id: num(r.id),
    territory_id: num(r.territory_id),
    version_no: num(r.version_no),
    name: r.name,
    state_id: num(r.state_id),
    state_name: r.state_name || null,
    district_ids: ids.map(Number),
    district_names: names.map(String),
    district_count: num(r.district_count),
    is_active: num(r.is_active) === 1,
    change_type: r.change_type,
    change_label: CHANGE_LABEL[r.change_type] || r.change_type,
    remark: r.remark || null,
    changed_by: r.changed_by,
    changed_by_name: r.changed_by_name || null,
    changed_at: r.changed_at,
  };
};

const listVersions = async (territoryId, runner = db) => {
  const [rows] = await runner.query(`${VERSION_SELECT} WHERE v.territory_id = ? ORDER BY v.version_no DESC`, [territoryId]);
  return rows.map(shapeVersion);
};

const getVersion = async (territoryId, versionNo, runner = db) => {
  const [rows] = await runner.query(`${VERSION_SELECT} WHERE v.territory_id = ? AND v.version_no = ?`, [territoryId, versionNo]);
  return rows[0] ? shapeVersion(rows[0]) : null;
};

const latestVersion = async (territoryId, runner = db) => {
  const [rows] = await runner.query(
    `${VERSION_SELECT} WHERE v.territory_id = ? ORDER BY v.version_no DESC LIMIT 1`,
    [territoryId],
  );
  return rows[0] ? shapeVersion(rows[0]) : null;
};

// writes the next version from the territory as it is now inside `conn` (after the change)
const insertVersion = async (conn, territoryId, { changeType, userId, remark = null }) => {
  const [[t]] = await conn.query(
    `SELECT t.id, t.name, t.state_id, gs.state_name, t.is_active, t.current_version_no
     FROM bp_territories t LEFT JOIN geo_states gs ON gs.id = t.state_id
     WHERE t.id = ?`,
    [territoryId],
  );
  const [[maxRow]] = await conn.query(`SELECT MAX(version_no) AS v FROM bp_territory_versions WHERE territory_id = ?`, [territoryId]);
  const versionNo = Math.max(num(t.current_version_no), num(maxRow && maxRow.v)) + 1;
  const districts = (await districtsByTerritory([num(territoryId)], conn)).get(num(territoryId)) || [];
  await conn.query(
    `INSERT INTO bp_territory_versions
       (territory_id, version_no, name, state_id, state_name, district_ids, district_names, district_count,
        is_active, change_type, remark, changed_by, changed_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, NOW())`,
    [
      territoryId, versionNo, t.name, t.state_id, t.state_name || null,
      JSON.stringify(districts.map((d) => d.id)), JSON.stringify(districts.map((d) => d.name)), districts.length,
      num(t.is_active) === 1 ? 1 : 0, changeType, remark ? String(remark).slice(0, 255) : null, userId || null,
    ],
  );
  await conn.query(`UPDATE bp_territories SET current_version_no = ?, updated_by = ? WHERE id = ?`, [versionNo, userId || null, territoryId]);
  return versionNo;
};

// ---------------------------------------------------------------------
//  WRITES (each one transaction: territory + districts + version)
// ---------------------------------------------------------------------
const tx = async (fn) => {
  const conn = await db.getConnection();
  try {
    await conn.beginTransaction();
    const out = await fn(conn);
    await conn.commit();
    return out;
  } catch (err) {
    await conn.rollback();
    throw err;
  } finally {
    conn.release();
  }
};

const replaceDistricts = async (conn, territoryId, districtIds) => {
  await conn.query(`DELETE FROM bp_territory_districts WHERE territory_id = ?`, [territoryId]);
  if (districtIds.length) {
    await conn.query(
      `INSERT INTO bp_territory_districts (territory_id, district_id) VALUES ?`,
      [districtIds.map((d) => [territoryId, d])],
    );
  }
};

// Locks the territories of a state (and the gap for new ones, InnoDB next-key lock on
// uq_bp_territory) so two editors cannot add the same district to two active territories.
const lockState = (conn, stateId) =>
  conn.query(`SELECT id FROM bp_territories WHERE state_id = ? FOR UPDATE`, [stateId]);

// `guardIds`: districts that must not be in another ACTIVE territory of the state
const createTerritory = ({ name, stateId, districtIds, isActive = true, userId, remark, guardIds = null }) =>
  tx(async (conn) => {
    await lockState(conn, stateId);
    if (await findByName(stateId, name, 0, conn)) return { ok: false, reason: "DUPLICATE_NAME" };
    if (isActive) {
      const conflicts = await activeConflicts(stateId, guardIds || districtIds, 0, conn);
      if (conflicts.length) return { ok: false, reason: "OVERLAP", conflicts };
    }
    const [res] = await conn.query(
      `INSERT INTO bp_territories (name, state_id, is_active, created_by, updated_by, current_version_no)
       VALUES (?, ?, ?, ?, ?, 0)`,
      [name, stateId, isActive ? 1 : 0, userId, userId],
    );
    const id = res.insertId;
    await replaceDistricts(conn, id, districtIds);
    const versionNo = await insertVersion(conn, id, { changeType: "CREATED", userId, remark });
    return { ok: true, id, versionNo };
  });

// `expectVersion`: the version the editor started from (optimistic check; null = no check)
const updateTerritory = (id, { name, stateId, districtIds, isActive, userId, remark, changeType = "EDITED", expectVersion = null, guardIds = [] }) =>
  tx(async (conn) => {
    await lockState(conn, stateId);
    const [[row]] = await conn.query(`SELECT id, state_id, current_version_no FROM bp_territories WHERE id = ? FOR UPDATE`, [id]);
    if (!row) return { ok: false, reason: "NOT_FOUND" };
    if (num(row.state_id) !== num(stateId)) await lockState(conn, row.state_id);
    if (expectVersion !== null && num(row.current_version_no) !== num(expectVersion)) {
      return { ok: false, reason: "CHANGED", current: num(row.current_version_no) };
    }
    if (await findByName(stateId, name, id, conn)) return { ok: false, reason: "DUPLICATE_NAME" };
    if (isActive && guardIds.length) {
      const conflicts = await activeConflicts(stateId, guardIds, id, conn);
      if (conflicts.length) return { ok: false, reason: "OVERLAP", conflicts };
    }
    await conn.query(`UPDATE bp_territories SET name = ?, state_id = ?, is_active = ? WHERE id = ?`, [name, stateId, isActive ? 1 : 0, id]);
    await replaceDistricts(conn, id, districtIds);
    const versionNo = await insertVersion(conn, id, { changeType, userId, remark });
    return { ok: true, versionNo };
  });

// activation is refused when the territory has no districts or any of its districts is in
// another active territory of the state (checked under the state lock)
const setStatus = (id, { isActive, userId, remark }) =>
  tx(async (conn) => {
    const [[pre]] = await conn.query(`SELECT state_id FROM bp_territories WHERE id = ?`, [id]);
    if (!pre) return { ok: false, reason: "NOT_FOUND" };
    await lockState(conn, pre.state_id);
    const [[row]] = await conn.query(`SELECT id, state_id, is_active FROM bp_territories WHERE id = ? FOR UPDATE`, [id]);
    if (!row) return { ok: false, reason: "NOT_FOUND" };
    if ((num(row.is_active) === 1) === Boolean(isActive)) return { ok: false, reason: "UNCHANGED" };
    if (isActive) {
      const districts = (await districtsByTerritory([num(id)], conn)).get(num(id)) || [];
      if (!districts.length) return { ok: false, reason: "NO_DISTRICTS" };
      const conflicts = await activeConflicts(row.state_id, districts.map((d) => d.id), id, conn);
      if (conflicts.length) return { ok: false, reason: "OVERLAP", conflicts };
    }
    await conn.query(`UPDATE bp_territories SET is_active = ? WHERE id = ?`, [isActive ? 1 : 0, id]);
    const versionNo = await insertVersion(conn, id, { changeType: isActive ? "ACTIVATED" : "DEACTIVATED", userId, remark });
    return { ok: true, versionNo };
  });

// ---------------------------------------------------------------------
//  BUSINESS PLAN SNAPSHOT
// ---------------------------------------------------------------------
const snapshotFromVersion = (v, source = "TERRITORY_VERSION") => ({
  schema: 1,
  territory_id: v.territory_id,
  version_no: v.version_no,
  name: v.name,
  state_id: v.state_id,
  state_name: v.state_name,
  district_ids: v.district_ids,
  district_names: v.district_names,
  is_active: v.is_active ? 1 : 0,
  source,
  captured_at: new Date().toISOString().slice(0, 19).replace("T", " "),
});

// Keeps business_plans.territory_* in step with the rules:
//   Draft / Submitted / Returned (UNDER_REVIEW) -> latest version of the territory
//   a revision of an approved plan -> keeps the approved coverage while the territory is unchanged
//   Active / Closed / Rejected -> frozen (never refreshed), unless `atApproval` (final approval)
// Returns the snapshot now stored on the plan (or null).
const refreshPlanTerritory = async (runner, planId, { atApproval = false, wasInRevision = null } = {}) => {
  const [[p]] = await runner.query(
    `SELECT id, status, revision_status, territory_id, territory_version_no, territory_snapshot FROM business_plans WHERE id = ?`,
    [planId],
  );
  if (!p) return null;
  const snap = parseJson(p.territory_snapshot, null);
  if (!atApproval && FROZEN_STATUSES.includes(p.status)) return snap;
  const inRevision = wasInRevision === null ? p.revision_status === REVISION_OPEN : Boolean(wasInRevision);
  if (!p.territory_id) {
    if (p.territory_snapshot !== null || p.territory_version_no !== null) {
      await runner.query(
        `UPDATE business_plans SET territory_version_no = NULL, territory_snapshot = NULL, territory_snapshot_at = NULL WHERE id = ?`,
        [planId],
      );
    }
    return null;
  }
  if (inRevision && snap && num(snap.territory_id) === num(p.territory_id)) return snap;
  const v = await latestVersion(p.territory_id, runner);
  if (!v) return snap;
  if (snap && num(snap.territory_id) === v.territory_id && num(snap.version_no) === v.version_no) return snap;
  const next = snapshotFromVersion(v);
  await runner.query(
    `UPDATE business_plans SET territory_version_no = ?, territory_snapshot = ?, territory_snapshot_at = NOW() WHERE id = ?`,
    [v.version_no, JSON.stringify(next), planId],
  );
  return next;
};

// what a plan screen shows: the frozen snapshot (approved / closed / rejected, or a revision on the
// same territory), otherwise the territory's latest version (what the next save / submit will store)
const planTerritoryView = async (p) => {
  if (!p.territory_id) return null;
  const snap = parseJson(p.territory_snapshot, null);
  const frozen = FROZEN_STATUSES.includes(p.status) || (p.in_revision && snap && num(snap.territory_id) === num(p.territory_id));
  const latest = await latestVersion(p.territory_id);
  const current = await getTerritory(p.territory_id);
  const base = frozen && snap ? snap : latest || snap;
  if (!base) {
    return {
      territory_id: num(p.territory_id),
      name: current ? current.name : p.territory_name || null,
      state_id: current ? current.state_id : p.state_id,
      state_name: current ? current.state_name : p.state_name || null,
      district_ids: current ? current.district_ids : [],
      district_names: current ? current.district_names : [],
      version_no: null,
      frozen: false,
      source: "LIVE",
      latest_version_no: null,
      updated_since: false,
      territory_is_active: current ? current.is_active : false,
    };
  }
  return {
    territory_id: num(base.territory_id),
    name: base.name,
    state_id: num(base.state_id),
    state_name: base.state_name || null,
    district_ids: (base.district_ids || []).map(Number),
    district_names: (base.district_names || []).map(String),
    version_no: num(base.version_no),
    frozen: Boolean(frozen && snap),
    source: frozen && snap ? "SNAPSHOT" : "LATEST_VERSION",
    captured_at: frozen && snap ? snap.captured_at || null : null,
    latest_version_no: latest ? latest.version_no : null,
    updated_since: Boolean(frozen && snap && latest && latest.version_no > num(snap.version_no)),
    territory_is_active: current ? current.is_active : false,
    latest_name: latest ? latest.name : null,
    latest_district_names: latest ? latest.district_names : [],
  };
};

// ---------------------------------------------------------------------
//  TERRITORY MANAGERS (MANAGE_BP_TERRITORIES + state scopes)
// ---------------------------------------------------------------------
const permissionRow = async (runner = db) => {
  const [rows] = await runner.query(`SELECT id, code FROM permissions WHERE code = ? LIMIT 1`, [PERMISSION_CODE]);
  return rows[0] || null;
};

// active state scopes of a user
const scopeStateIds = async (userId, runner = db) => {
  const [rows] = await runner.query(
    `SELECT state_id FROM bp_territory_manager_states WHERE user_id = ? AND is_active = 1 ORDER BY state_id`,
    [userId],
  );
  return rows.map((r) => num(r.state_id));
};

const SCOPE_SELECT = `
  SELECT s.id, s.user_id, s.state_id, gs.state_name, s.is_active, s.remark,
         s.granted_by, gu.name AS granted_by_name, DATE_FORMAT(s.granted_at, '%Y-%m-%d %H:%i:%s') AS granted_at,
         s.revoked_by, ru.name AS revoked_by_name, DATE_FORMAT(s.revoked_at, '%Y-%m-%d %H:%i:%s') AS revoked_at
  FROM bp_territory_manager_states s
  LEFT JOIN geo_states gs ON gs.id = s.state_id
  LEFT JOIN users gu ON gu.id = s.granted_by
  LEFT JOIN users ru ON ru.id = s.revoked_by`;

const shapeScope = (r) => ({
  id: num(r.id),
  user_id: num(r.user_id),
  state_id: num(r.state_id),
  state_name: r.state_name || null,
  is_active: num(r.is_active) === 1,
  granted_by_name: r.granted_by_name || null,
  granted_at: r.granted_at,
  revoked_by_name: r.revoked_by_name || null,
  revoked_at: r.revoked_at,
  remark: r.remark || null,
});

const USER_SELECT = `
  SELECT u.id, u.name, u.is_active, r.name AS role, jr.name AS job_role
  FROM users u
  LEFT JOIN roles r ON r.id = u.role_id
  LEFT JOIN job_roles jr ON jr.id = u.job_role_id`;

const getUser = async (userId, runner = db) => {
  const [rows] = await runner.query(`${USER_SELECT} WHERE u.id = ?`, [userId]);
  return rows[0] || null;
};

const hasPermission = async (userId, runner = db) => {
  const [rows] = await runner.query(
    `SELECT 1 FROM user_permissions up INNER JOIN permissions p ON p.id = up.permission_id
     WHERE up.user_id = ? AND p.code = ? AND up.is_allowed = 1 LIMIT 1`,
    [userId, PERMISSION_CODE],
  );
  return rows.length > 0;
};

// users with the permission and / or any scope row (current and revoked)
const listManagers = async () => {
  const perm = await permissionRow();
  const [users] = await db.query(
    `${USER_SELECT}
     WHERE (r.name IS NULL OR r.name NOT IN ('ADMIN', 'SUPER_ADMIN'))
       AND (EXISTS (SELECT 1 FROM user_permissions up WHERE up.user_id = u.id AND up.permission_id = ? AND up.is_allowed = 1)
            OR EXISTS (SELECT 1 FROM bp_territory_manager_states s WHERE s.user_id = u.id))
     ORDER BY u.name ASC`,
    [perm ? perm.id : 0],
  );
  if (!users.length) return [];
  const ids = users.map((u) => num(u.id));
  const [scopes] = await db.query(`${SCOPE_SELECT} WHERE s.user_id IN (?) ORDER BY gs.state_name ASC`, [ids]);
  const [granted] = await db.query(
    `SELECT user_id FROM user_permissions WHERE permission_id = ? AND is_allowed = 1 AND user_id IN (?)`,
    [perm ? perm.id : 0, ids],
  );
  const grantedSet = new Set(granted.map((g) => num(g.user_id)));
  const byUser = new Map();
  for (const s of scopes) {
    const list = byUser.get(num(s.user_id)) || [];
    list.push(shapeScope(s));
    byUser.set(num(s.user_id), list);
  }
  return users.map((u) => {
    const list = byUser.get(num(u.id)) || [];
    const permissionGranted = grantedSet.has(num(u.id));
    const active = list.filter((x) => x.is_active);
    return {
      user_id: num(u.id),
      name: u.name,
      role: u.role || null,
      job_role: u.job_role || null,
      user_is_active: num(u.is_active) === 1,
      permission_granted: permissionGranted,
      active_states: active.map((x) => ({ state_id: x.state_id, state_name: x.state_name })),
      scopes: list,
      // what the user can actually do now
      can_manage_now: permissionGranted && num(u.is_active) === 1 && active.length > 0,
    };
  });
};

const getManager = async (userId) => (await listManagers()).find((m) => m.user_id === num(userId)) || null;

// Admin / Super Admin (manage every state by role; shown for information)
const listAdmins = async () => {
  const [rows] = await db.query(
    `${USER_SELECT} WHERE r.name IN ('ADMIN', 'SUPER_ADMIN') AND u.is_active = 1 ORDER BY r.name DESC, u.name ASC`,
  );
  return rows.map((u) => ({ user_id: num(u.id), name: u.name, role: u.role, job_role: u.job_role || null }));
};

// users an admin can make a territory manager (active, not Admin / Super Admin)
const candidates = async (search) => {
  const where = ["u.is_active = 1", "(r.name IS NULL OR r.name NOT IN ('ADMIN', 'SUPER_ADMIN'))"];
  const params = [];
  if (search) {
    where.push("u.name LIKE ?");
    params.push(`%${search}%`);
  }
  const [rows] = await db.query(`${USER_SELECT} WHERE ${where.join(" AND ")} ORDER BY u.name ASC LIMIT 30`, params);
  return rows.map((u) => ({ user_id: num(u.id), name: u.name, role: u.role || null, job_role: u.job_role || null }));
};

// grant / revoke the one permission only (other permissions of the user are not touched)
const setPermission = (userId, granted) =>
  tx(async (conn) => {
    const perm = await permissionRow(conn);
    if (!perm) return { ok: false, reason: "NO_PERMISSION_ROW" };
    const [rows] = await conn.query(
      `SELECT permission_id, is_allowed FROM user_permissions WHERE user_id = ? AND permission_id = ? FOR UPDATE`,
      [userId, perm.id],
    );
    if (rows.length) {
      if ((num(rows[0].is_allowed) === 1) === Boolean(granted)) return { ok: true, changed: false };
      await conn.query(`UPDATE user_permissions SET is_allowed = ? WHERE user_id = ? AND permission_id = ?`, [granted ? 1 : 0, userId, perm.id]);
    } else {
      if (!granted) return { ok: true, changed: false };
      await conn.query(`INSERT INTO user_permissions (user_id, permission_id, is_allowed) VALUES (?, ?, 1)`, [userId, perm.id]);
    }
    return { ok: true, changed: true };
  });

// assign states (a revoked scope is re-activated; an active one is left as it is)
const grantScopes = (userId, stateIds, byUserId, remark = null) =>
  tx(async (conn) => {
    const added = [];
    for (const stateId of stateIds) {
      const [rows] = await conn.query(
        `SELECT id, is_active FROM bp_territory_manager_states WHERE user_id = ? AND state_id = ? FOR UPDATE`,
        [userId, stateId],
      );
      if (rows.length && num(rows[0].is_active) === 1) continue;
      if (rows.length) {
        await conn.query(
          `UPDATE bp_territory_manager_states
           SET is_active = 1, granted_by = ?, granted_at = NOW(), revoked_by = NULL, revoked_at = NULL, remark = ?
           WHERE id = ?`,
          [byUserId, remark, rows[0].id],
        );
      } else {
        await conn.query(
          `INSERT INTO bp_territory_manager_states (user_id, state_id, is_active, granted_by, granted_at, remark)
           VALUES (?, ?, 1, ?, NOW(), ?)`,
          [userId, stateId, byUserId, remark],
        );
      }
      added.push(stateId);
    }
    return added;
  });

const revokeScope = async (userId, stateId, byUserId) => {
  const [res] = await db.query(
    `UPDATE bp_territory_manager_states SET is_active = 0, revoked_by = ?, revoked_at = NOW()
     WHERE user_id = ? AND state_id = ? AND is_active = 1`,
    [byUserId, userId, stateId],
  );
  return num(res && res.affectedRows) > 0;
};

module.exports = {
  PERMISSION_CODE,
  FROZEN_STATUSES,
  CHANGE_LABEL,
  uniqueIds,
  parseJson,
  getState,
  districtsInState,
  districtsByTerritory,
  listTerritories,
  getTerritory,
  findByName,
  activeConflicts,
  overlapReport,
  listVersions,
  getVersion,
  latestVersion,
  createTerritory,
  updateTerritory,
  setStatus,
  snapshotFromVersion,
  refreshPlanTerritory,
  planTerritoryView,
  permissionRow,
  scopeStateIds,
  getUser,
  hasPermission,
  listManagers,
  getManager,
  listAdmins,
  candidates,
  setPermission,
  grantScopes,
  revokeScope,
};
