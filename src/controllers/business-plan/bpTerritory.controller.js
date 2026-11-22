// Business Plan territories and territory managers.
//
// WHO MAY MANAGE (create / edit / activate / deactivate) A TERRITORY — enforced here, on every call:
//   * Admin / Super Admin (role)                          -> every state
//   * a user holding MANAGE_BP_TERRITORIES (user_permissions.is_allowed = 1)
//     AND an active scope row for the territory's state (bp_territory_manager_states)
//                                                         -> only those states
//   * everybody else (MANAGE_BUSINESS_PLAN_SETTINGS, Assign Area, plan creators, employees)
//                                                         -> nothing; they only read the
//                                                            selectable territories
// WHO MAY GRANT the permission and the state scopes: Admin / Super Admin only.
const TER = require("../../models/business-plan/bpTerritory.model");
const H = require("./bpHelpers");

const { HttpError, wrap, ok } = H;

const MAX_DISTRICTS = 500;
const MAX_STATES_PER_GRANT = 50;

// ---------------------------------------------------------------------
//  ACCESS
// ---------------------------------------------------------------------
// cached on the request: { isAdmin, hasPermission, stateIds, canManageAll, canManageAny, canManageManagers }
const territoryAccess = async (req) => {
  if (req._bpTerritoryAccess) return req._bpTerritoryAccess;
  const access = await H.getAccess(req);
  const isAdmin = !!access.isAdmin;
  const hasPermission = !isAdmin && access.codes.has(TER.PERMISSION_CODE);
  // a scope counts only together with the permission (and the permission only with a scope)
  const stateIds = hasPermission ? await TER.scopeStateIds(req.user.id) : [];
  const out = {
    isAdmin,
    hasPermission,
    stateIds,
    canManageAll: isAdmin,
    canManageAny: isAdmin || stateIds.length > 0,
    canManageManagers: isAdmin,
  };
  req._bpTerritoryAccess = out;
  return out;
};

const canManageState = (ta, stateId) => ta.canManageAll || ta.stateIds.includes(Number(stateId));

const assertManageState = (ta, stateId) => {
  if (canManageState(ta, stateId)) return;
  if (!ta.hasPermission) throw new HttpError(403, "You are not allowed to manage Business Plan territories");
  if (!ta.stateIds.length) {
    throw new HttpError(403, "You have territory-management permission but no state is assigned to you. Please contact an admin.");
  }
  throw new HttpError(403, "You are not allowed to manage territories in this state");
};

const assertManageAny = (ta) => {
  if (ta.canManageAny) return;
  assertManageState(ta, 0);
};

const assertAdmin = (ta) => {
  if (!ta.canManageManagers) throw new HttpError(403, "Only Admin or Super Admin can manage territory managers");
};

// the block the apps use to show / hide territory-management screens (also in masters.me)
const accessBlock = async (req) => {
  const ta = await territoryAccess(req);
  const states = [];
  for (const id of ta.stateIds) {
    const st = await TER.getState(id);
    if (st) states.push({ id: Number(st.id), name: st.name });
  }
  return {
    can_manage_territories: ta.canManageAny,
    can_manage_all_states: ta.canManageAll,
    has_permission: ta.isAdmin || ta.hasPermission,
    permission_without_scope: ta.hasPermission && !ta.stateIds.length,
    state_ids: ta.canManageAll ? null : ta.stateIds,
    states: ta.canManageAll ? null : states,
    can_manage_managers: ta.canManageManagers,
  };
};

// ---------------------------------------------------------------------
//  VALIDATION
// ---------------------------------------------------------------------
const readDistrictIds = (value, { required }) => {
  if (value === undefined || value === null) {
    if (required) throw new HttpError(400, "Select at least one district");
    return undefined;
  }
  if (!Array.isArray(value)) throw new HttpError(400, "district_ids must be a list");
  if (value.length > MAX_DISTRICTS) throw new HttpError(400, `A territory can have at most ${MAX_DISTRICTS} districts`);
  const ids = value.map((v) => Number(v));
  if (ids.some((n) => !Number.isInteger(n) || n <= 0)) throw new HttpError(400, "Invalid district id");
  const unique = [...new Set(ids)];
  if (!unique.length) throw new HttpError(400, "Select at least one district");
  return unique;
};

// every id must be a district of the state; returns [{ id, name }]
const assertDistrictsOfState = async (stateId, ids) => {
  const found = await TER.districtsInState(stateId, ids);
  if (found.length !== ids.length) {
    const ok = new Set(found.map((d) => d.id));
    const wrong = ids.filter((id) => !ok.has(id));
    throw new HttpError(400, `These districts do not belong to the selected state: ${wrong.join(", ")}`, { invalid_district_ids: wrong });
  }
  return found;
};

const readName = (value, required) => {
  const name = H.text(value, "Territory name", { required, max: 120 });
  if (name === undefined) return undefined;
  if (!name) throw new HttpError(400, "Territory name is required");
  return name.replace(/\s+/g, " ");
};

const readRemark = (value) => H.text(value, "Remark", { max: 255 }) || null;

const readBool = (value, label) => {
  if (value === true || value === 1 || value === "1" || value === "true") return true;
  if (value === false || value === 0 || value === "0" || value === "false") return false;
  throw new HttpError(400, `${label} must be true or false`);
};

const overlapMessage = (conflicts) => {
  const parts = conflicts.slice(0, 5).map((c) => `${c.district_name} (already in "${c.territory_name}")`);
  const more = conflicts.length > 5 ? ` and ${conflicts.length - 5} more` : "";
  return `These districts are already in another active territory of this state: ${parts.join(", ")}${more}`;
};

const failFromModel = (result) => {
  if (result.reason === "NOT_FOUND") throw new HttpError(404, "Territory not found");
  if (result.reason === "DUPLICATE_NAME") throw new HttpError(409, "A territory with this name already exists in the state");
  if (result.reason === "OVERLAP") throw new HttpError(409, overlapMessage(result.conflicts), { conflicts: result.conflicts });
  if (result.reason === "NO_DISTRICTS") throw new HttpError(409, "Add at least one district before activating this territory");
  if (result.reason === "CHANGED") {
    throw new HttpError(409, `This territory was changed by somebody else (now version ${result.current}). Reload it and try again.`, { current_version_no: result.current });
  }
  throw new HttpError(409, "The territory could not be saved");
};

const loadTerritory = async (req) => {
  const id = H.toId(req.params.id, "territory id");
  const t = await TER.getTerritory(id);
  if (!t) throw new HttpError(404, "Territory not found");
  return t;
};

const withAccess = (ta, t) => ({ ...t, can_manage: canManageState(ta, t.state_id) });

// ---------------------------------------------------------------------
//  READ
// ---------------------------------------------------------------------
// GET /territories?state_id=&include_inactive=1&search=&manageable=1
//   everybody: active territories with at least one district (what a plan may select)
//   a manager: also inactive / empty territories of the states he manages (include_inactive=1)
const listTerritories = wrap(async (req, res) => {
  const ta = await territoryAccess(req);
  const stateId = H.optId(req.query.state_id, "state");
  const search = H.text(req.query.search, "search", { max: 100 }) || undefined;
  const wantAll = String(req.query.include_inactive || "") === "1";
  const manageableOnly = String(req.query.manageable || "") === "1";

  let rows;
  if (wantAll && ta.canManageAny) {
    rows = await TER.listTerritories({ stateId, includeInactive: true, search });
    // outside his states a scoped manager sees only what everybody sees
    rows = rows.filter((t) => t.selectable || canManageState(ta, t.state_id));
  } else {
    rows = await TER.listTerritories({ stateId, selectableOnly: true, search });
  }
  if (manageableOnly) rows = rows.filter((t) => canManageState(ta, t.state_id));
  return ok(res, rows.map((t) => withAccess(ta, t)));
});

// GET /territories/access -> what this user may do
const getAccess = wrap(async (req, res) => ok(res, await accessBlock(req)));

// GET /territories/overlaps?state_id= -> districts in more than one ACTIVE territory (report only)
const listOverlaps = wrap(async (req, res) => {
  const ta = await territoryAccess(req);
  assertManageAny(ta);
  const stateId = H.optId(req.query.state_id, "state");
  if (stateId) assertManageState(ta, stateId);
  const stateIds = stateId ? [stateId] : ta.canManageAll ? undefined : ta.stateIds;
  return ok(res, await TER.overlapReport({ stateIds }));
});

// GET /territories/:id -> details (districts with ids and names)
const getTerritory = wrap(async (req, res) => {
  const ta = await territoryAccess(req);
  const t = await loadTerritory(req);
  const manage = canManageState(ta, t.state_id);
  if (!t.selectable && !manage) throw new HttpError(404, "Territory not found");
  const out = withAccess(ta, t);
  if (manage) {
    // districts of this territory that are also in another active territory (existing overlaps)
    out.overlaps = await TER.activeConflicts(t.state_id, t.district_ids, t.id);
  }
  return ok(res, out);
});

// GET /territories/:id/versions -> full history (managers of the state)
const listVersions = wrap(async (req, res) => {
  const ta = await territoryAccess(req);
  const t = await loadTerritory(req);
  assertManageState(ta, t.state_id);
  return ok(res, { territory: withAccess(ta, t), versions: await TER.listVersions(t.id) });
});

// GET /territories/:id/versions/:versionNo
const getVersion = wrap(async (req, res) => {
  const ta = await territoryAccess(req);
  const t = await loadTerritory(req);
  assertManageState(ta, t.state_id);
  const v = await TER.getVersion(t.id, H.toId(req.params.versionNo, "version number"));
  if (!v) throw new HttpError(404, "Version not found");
  return ok(res, v);
});

// ---------------------------------------------------------------------
//  WRITE
// ---------------------------------------------------------------------
// POST /territories  { name, state_id, district_ids: [], is_active?: true, remark? }
const createTerritory = wrap(async (req, res) => {
  const ta = await territoryAccess(req);
  assertManageAny(ta);
  const body = req.body || {};
  const stateId = H.toId(body.state_id, "state");
  assertManageState(ta, stateId);
  if (!(await TER.getState(stateId))) throw new HttpError(400, "State not found");
  const name = readName(body.name, true);
  const districtIds = readDistrictIds(body.district_ids, { required: true });
  await assertDistrictsOfState(stateId, districtIds);
  const isActive = body.is_active === undefined ? true : readBool(body.is_active, "is_active");
  const result = await TER.createTerritory({
    name,
    stateId,
    districtIds,
    isActive,
    userId: req.user.id,
    remark: readRemark(body.remark),
  });
  if (!result.ok) failFromModel(result);
  return ok(res, withAccess(ta, await TER.getTerritory(result.id)), "Territory created", 201);
});

// PUT /territories/:id  { name?, state_id?, district_ids?, remark?, expected_version_no? }
// Status changes use POST /territories/:id/status (so each one is its own version).
const updateTerritory = wrap(async (req, res) => {
  const ta = await territoryAccess(req);
  assertManageAny(ta);
  const t = await loadTerritory(req);
  assertManageState(ta, t.state_id);
  const body = req.body || {};

  if (body.is_active !== undefined && readBool(body.is_active, "is_active") !== t.is_active) {
    throw new HttpError(400, "Use Activate / Deactivate to change the status of a territory");
  }
  const stateId = body.state_id === undefined ? t.state_id : H.toId(body.state_id, "state");
  if (stateId !== t.state_id) {
    assertManageState(ta, stateId);
    if (!(await TER.getState(stateId))) throw new HttpError(400, "State not found");
    if (t.plans_total > 0) {
      throw new HttpError(409, `This territory is used by ${t.plans_total} business plan(s); its state cannot change. Create a new territory instead.`);
    }
  }
  const name = readName(body.name, false) ?? t.name;
  let districtIds = readDistrictIds(body.district_ids, { required: false });
  if (districtIds === undefined) {
    if (stateId !== t.state_id) throw new HttpError(400, "Select the districts of the new state");
    districtIds = t.district_ids;
  }
  if (!districtIds.length) throw new HttpError(400, "Select at least one district");
  await assertDistrictsOfState(stateId, districtIds);

  const expectVersion = body.expected_version_no === undefined || body.expected_version_no === null || body.expected_version_no === ""
    ? null
    : Number(body.expected_version_no);
  if (expectVersion !== null && (!Number.isInteger(expectVersion) || expectVersion < 0)) {
    throw new HttpError(400, "Invalid expected_version_no");
  }

  const current = new Set(stateId === t.state_id ? t.district_ids : []);
  const added = districtIds.filter((id) => !current.has(id));
  const sameSet = districtIds.length === t.district_ids.length && districtIds.every((id) => t.district_ids.includes(id));
  if (name === t.name && stateId === t.state_id && sameSet) {
    return ok(res, { ...withAccess(ta, t), changed: false }, "No changes to save");
  }

  const result = await TER.updateTerritory(t.id, {
    name,
    stateId,
    districtIds,
    isActive: t.is_active,
    userId: req.user.id,
    remark: readRemark(body.remark),
    expectVersion,
    // only NEW districts are checked: overlaps that already existed are kept (and reported)
    guardIds: added,
  });
  if (!result.ok) failFromModel(result);
  const saved = await TER.getTerritory(t.id);
  const overlapWarnings = saved.is_active ? await TER.activeConflicts(saved.state_id, saved.district_ids, saved.id) : [];
  return ok(
    res,
    { ...withAccess(ta, saved), changed: true, overlap_warnings: overlapWarnings },
    overlapWarnings.length
      ? `Territory updated (version ${result.versionNo}). ${overlapWarnings.length} district(s) were already in another active territory and were kept.`
      : `Territory updated (version ${result.versionNo})`,
  );
});

const changeStatus = async (req, res, isActive, remark) => {
  const ta = await territoryAccess(req);
  assertManageAny(ta);
  const t = await loadTerritory(req);
  assertManageState(ta, t.state_id);
  if (t.is_active === isActive) {
    return ok(res, { ...withAccess(ta, t), changed: false }, isActive ? "Territory is already active" : "Territory is already inactive");
  }
  const result = await TER.setStatus(t.id, { isActive, userId: req.user.id, remark });
  if (!result.ok && result.reason === "UNCHANGED") {
    return ok(res, { ...withAccess(ta, await TER.getTerritory(t.id)), changed: false }, "No change");
  }
  if (!result.ok) failFromModel(result);
  return ok(
    res,
    { ...withAccess(ta, await TER.getTerritory(t.id)), changed: true },
    isActive
      ? `Territory activated (version ${result.versionNo})`
      : `Territory deactivated (version ${result.versionNo}). Existing business plans keep it; it is no longer offered for new plans.`,
  );
};

// POST /territories/:id/status  { is_active: true|false, remark? }
const setStatus = wrap(async (req, res) => {
  const body = req.body || {};
  if (body.is_active === undefined) throw new HttpError(400, "is_active is required");
  return changeStatus(req, res, readBool(body.is_active, "is_active"), readRemark(body.remark));
});

// DELETE /territories/:id -> deactivate (territories are never deleted)
const deactivateTerritory = wrap(async (req, res) => changeStatus(req, res, false, readRemark((req.body || {}).remark)));

// ---------------------------------------------------------------------
//  TERRITORY MANAGERS (Admin / Super Admin only)
// ---------------------------------------------------------------------
const loadTargetUser = async (req) => {
  const userId = H.toId(req.params.userId, "user id");
  const user = await TER.getUser(userId);
  if (!user) throw new HttpError(404, "User not found");
  if (["ADMIN", "SUPER_ADMIN"].includes(user.role)) {
    throw new HttpError(400, "Admin and Super Admin already manage territories in every state");
  }
  return user;
};

// GET /territory-managers
const listManagers = wrap(async (req, res) => {
  assertAdmin(await territoryAccess(req));
  const [managers, admins] = await Promise.all([TER.listManagers(), TER.listAdmins()]);
  return ok(res, { permission_code: TER.PERMISSION_CODE, managers, admins });
});

// GET /territory-managers/candidates?search=
const listCandidates = wrap(async (req, res) => {
  assertAdmin(await territoryAccess(req));
  const search = H.text(req.query.search, "search", { max: 100 }) || undefined;
  return ok(res, await TER.candidates(search));
});

// GET /territory-managers/:userId -> permission + current and revoked scopes
const getManager = wrap(async (req, res) => {
  assertAdmin(await territoryAccess(req));
  const user = await loadTargetUser(req);
  const m = await TER.getManager(user.id);
  return ok(res, m || {
    user_id: Number(user.id),
    name: user.name,
    role: user.role || null,
    job_role: user.job_role || null,
    user_is_active: Number(user.is_active) === 1,
    permission_granted: false,
    active_states: [],
    scopes: [],
    can_manage_now: false,
  });
});

// POST /territory-managers/:userId/permission  { granted: true|false }
const setPermission = wrap(async (req, res) => {
  assertAdmin(await territoryAccess(req));
  const user = await loadTargetUser(req);
  if (user.id === req.user.id) throw new HttpError(403, "You cannot change your own permissions");
  const body = req.body || {};
  if (body.granted === undefined) throw new HttpError(400, "granted is required");
  const granted = readBool(body.granted, "granted");
  if (granted && Number(user.is_active) !== 1) throw new HttpError(400, "This user is inactive");
  const result = await TER.setPermission(user.id, granted);
  if (!result.ok) {
    throw new HttpError(409, `Permission ${TER.PERMISSION_CODE} is not installed. Run the territory migration first.`);
  }
  const m = await TER.getManager(user.id);
  const message = granted
    ? m && m.active_states.length
      ? "Territory-management permission granted"
      : "Territory-management permission granted. Assign at least one state — without a state the user cannot manage any territory."
    : "Territory-management permission revoked. The user can no longer manage territories (assigned states are kept but have no effect).";
  return ok(res, m, result.changed ? message : "No change");
});

// POST /territory-managers/:userId/states  { state_ids: [], remark? }
const grantStates = wrap(async (req, res) => {
  assertAdmin(await territoryAccess(req));
  const user = await loadTargetUser(req);
  if (user.id === req.user.id) throw new HttpError(403, "You cannot change your own access");
  if (Number(user.is_active) !== 1) throw new HttpError(400, "This user is inactive");
  const body = req.body || {};
  if (!Array.isArray(body.state_ids) || !body.state_ids.length) throw new HttpError(400, "Select at least one state");
  if (body.state_ids.length > MAX_STATES_PER_GRANT) throw new HttpError(400, `Select at most ${MAX_STATES_PER_GRANT} states at a time`);
  const stateIds = [...new Set(body.state_ids.map((v) => H.toId(v, "state")))];
  for (const id of stateIds) {
    if (!(await TER.getState(id))) throw new HttpError(400, `State ${id} not found`);
  }
  const added = await TER.grantScopes(user.id, stateIds, req.user.id, readRemark(body.remark));
  const m = await TER.getManager(user.id);
  let message = added.length ? `${added.length} state(s) assigned` : "These states were already assigned";
  if (m && !m.permission_granted) message += `. Note: the user does not have ${TER.PERMISSION_CODE} yet, so the states have no effect until it is granted.`;
  return ok(res, m, message);
});

// POST /territory-managers/:userId/states/:stateId/revoke
const revokeState = wrap(async (req, res) => {
  assertAdmin(await territoryAccess(req));
  const user = await loadTargetUser(req);
  if (user.id === req.user.id) throw new HttpError(403, "You cannot change your own access");
  const stateId = H.toId(req.params.stateId, "state");
  const done = await TER.revokeScope(user.id, stateId, req.user.id);
  if (!done) throw new HttpError(404, "This state is not assigned to the user");
  return ok(res, await TER.getManager(user.id), "State scope revoked");
});

module.exports = {
  territoryAccess,
  canManageState,
  accessBlock,
  listTerritories,
  getAccess,
  listOverlaps,
  getTerritory,
  listVersions,
  getVersion,
  createTerritory,
  updateTerritory,
  setStatus,
  deactivateTerritory,
  listManagers,
  listCandidates,
  getManager,
  setPermission,
  grantStates,
  revokeState,
};
