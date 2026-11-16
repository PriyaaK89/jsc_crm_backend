// Multi-level approval used by target sheets (SHEET) and business plans (PLAN).
//
//   submit   -> chain built from the employee's reporting line; level 1 PENDING
//   approve  -> only the approver of the PENDING level may act. The next level becomes
//               PENDING; at the final level (RSM, or Admin when the line has no RSM)
//               the item is approved.
//   Admin / Super Admin may approve any item at any level: that approval is final.
//   return / reject -> open levels are SKIPPED; a resubmission starts a new round.
// Every step keeps approver, level, status, date and remark (approval history).
const db = require("../../config/db");
const A = require("../../models/business-plan/bpApproval.model");
const s = require("../../models/business-plan/bpSettings.model");
const H = require("./bpHelpers");

const { HttpError } = H;

const APPROVE_CODE = "APPROVE_BUSINESS_PLAN";

const finalRoles = async () => A.parseRoles((await s.getSettings()).final_approver_roles);

const chainFor = async (employeeId, { excludeIds = [], runner } = {}) =>
  A.buildChain(employeeId, { finalRoles: await finalRoles(), excludeIds, runner });

// Target sheet chain (D7). The targets were already approved in the Business Plan, so the
// sheet only needs the employee's reporting manager and the RSM:
//   reporting manager -> RSM (final)        when an RSM is above him
//   RSM (final)                             when the reporting manager is the RSM
//   reporting manager (final)               when there is no RSM in the line
//   Admin / Super Admin                     when the employee has no active reporting manager
// Admin / Super Admin may still approve at any level (authority()).
const sheetChainFor = async (employeeId, { excludeIds = [], runner } = {}) => {
  const full = await chainFor(employeeId, { excludeIds, runner });
  if (!full.length) return full;
  const first = full[0];
  let picked;
  if (first.approver_kind === "ADMIN" || first.approver_kind === "RSM") {
    picked = [first];
  } else {
    const rsm = full.find((l) => l.approver_kind === "RSM");
    picked = rsm ? [first, rsm] : [first];
  }
  return picked.map((l, i) => ({ ...l, level_no: i + 1, is_final: i === picked.length - 1 }));
};

// ---------------------------------------------------------------------
//  STATE
// ---------------------------------------------------------------------
const summarize = (steps) => {
  if (!steps.length) {
    return { round: 0, status: "NOT_SUBMITTED", current_level: null, total_levels: 0, current: null, pending_with: null, steps: [], history: [] };
  }
  const round = Math.max(...steps.map((x) => Number(x.round_no)));
  const cur = steps.filter((x) => Number(x.round_no) === round);
  const pending = cur.find((x) => x.status === "PENDING") || null;
  let status = "APPROVED";
  if (pending) status = "IN_PROGRESS";
  else if (cur.some((x) => x.status === "RETURNED")) status = "RETURNED";
  else if (cur.some((x) => x.status === "REJECTED")) status = "REJECTED";
  else if (!cur.some((x) => x.status === "APPROVED")) status = "CANCELLED";
  // every decision ever taken, newest first
  const history = steps
    .filter((x) => x.acted_at)
    .sort((a, b) => (a.acted_at < b.acted_at ? 1 : a.acted_at > b.acted_at ? -1 : b.id - a.id))
    .map((x) => ({
      id: x.id,
      round_no: x.round_no,
      level_no: x.level_no,
      total_levels: steps.filter((y) => y.round_no === x.round_no).length,
      approver_kind: x.approver_kind,
      status: x.status,
      status_label: x.status_label,
      acted_by: x.acted_by,
      acted_by_name: x.acted_by_name,
      acted_by_role: x.acted_by_role,
      acted_as: x.acted_as,
      acted_at: x.acted_at,
      remark: x.remark,
    }));
  return {
    round,
    status,
    current_level: pending ? pending.level_no : null,
    total_levels: cur.length,
    current: pending,
    pending_with: pending ? pending.approver_name : null,
    steps: cur,
    history,
  };
};

const getState = async (type, entityId) => summarize(await A.listSteps(type, entityId));

// Items submitted before multi-level approval existed have no steps yet: build them
// once, from today's hierarchy. legacyDone = { levelNo: 1, actedBy, actedAt } when the
// reporting manager had already approved (target sheet MANAGER_APPROVED).
const ensureSteps = async (type, entity, { employeeId, excludeIds = [], pendingStatuses, legacyDone = null }) => {
  if (!pendingStatuses.includes(entity.status)) return;
  const existing = await A.listSteps(type, entity.id);
  if (existing.length) return;
  let levels = await chainFor(employeeId, { excludeIds });
  if (legacyDone) {
    // the old flow always had a company approver after the manager
    if (levels.length === 1) {
      levels = [
        { ...levels[0], is_final: false },
        { approver_kind: "ADMIN", approver_id: null, approver_role: "Admin / Super Admin", level_no: 2, is_final: true },
      ];
    }
  }
  try {
    const { round } = await A.createRound(db, type, entity.id, levels);
    if (legacyDone) await A.markLevelDone(db, type, entity.id, round, 1, legacyDone);
  } catch (err) {
    if (!(err && err.code === "ER_DUP_ENTRY")) throw err; // another request built them first
  }
};

// ---------------------------------------------------------------------
//  WHO MAY ACT
// ---------------------------------------------------------------------
// ownerIds: the employee and the creator — they never approve their own item.
// returns { can, as: 'APPROVER' | 'ADMIN', final, reason }
const authority = async (req, state, ownerIds) => {
  const cur = state.current;
  if (!cur) return { can: false, reason: "This item is not waiting for approval" };
  const me = req.user.id;
  if (ownerIds.map(Number).includes(me)) return { can: false, reason: "You cannot approve your own business plan" };
  const access = await H.getAccess(req);
  if (cur.approver_kind === "ADMIN") {
    if (access.isAdmin) return { can: true, as: "ADMIN", final: true };
    // backward compatible: holders of APPROVE_BUSINESS_PLAN act for the admin level
    if (access.codes.has(APPROVE_CODE)) return { can: true, as: "APPROVER", final: !!cur.is_final };
  } else if (Number(cur.approver_id) === me) {
    return { can: true, as: "APPROVER", final: !!cur.is_final };
  }
  // Admin / Super Admin: any item, any level, final approval
  if (access.isAdmin) return { can: true, as: "ADMIN", final: true };
  return {
    can: false,
    reason: `This business plan is waiting for Level ${cur.level_no} approval by ${cur.approver_name || "another approver"}`,
  };
};

// may this user read the item although it is outside his reporting team?
const canReadAsApprover = async (req, type, entityId) => {
  if (await A.isApproverOf(type, entityId, req.user.id)) return true;
  const access = await H.getAccess(req);
  return access.codes.has(APPROVE_CODE) && (await A.hasPendingPoolStep(type, entityId));
};

// pending-my-approval ids. null = no restriction (admin sees every pending item)
const pendingIds = async (req, type) => {
  const access = await H.getAccess(req);
  return A.pendingEntityIds(type, req.user.id, { all: access.isAdmin, pool: access.codes.has(APPROVE_CODE) });
};

// ---------------------------------------------------------------------
//  IN-TRANSACTION STEP UPDATE (called from the status move, same connection)
// ---------------------------------------------------------------------
// decision: APPROVE | RETURN | REJECT. Refuses when somebody else acted first.
const applyDecision = async (conn, type, entityId, { expectedStepId, decision, actorId, actedAs, remark, final }) => {
  const step = await A.lockPendingStep(conn, type, entityId);
  if (!step || Number(step.id) !== Number(expectedStepId)) {
    throw new HttpError(409, "This business plan was already acted on. Please refresh.");
  }
  if (decision === "APPROVE") {
    await A.actOnStep(conn, step.id, { status: "APPROVED", actedBy: actorId, actedAs, remark });
    if (final) {
      await A.skipOpen(conn, type, entityId, step.round_no);
      return { final: true, next: null, step };
    }
    const next = await A.activateNext(conn, type, entityId, step.round_no, step.level_no);
    if (!next) throw new HttpError(409, "The approval chain changed. Please refresh and try again.");
    return { final: false, next, step };
  }
  await A.actOnStep(conn, step.id, { status: decision === "REJECT" ? "REJECTED" : "RETURNED", actedBy: actorId, actedAs, remark });
  await A.skipOpen(conn, type, entityId, step.round_no);
  return { final: false, next: null, step };
};

// ---------------------------------------------------------------------
//  NOTIFICATIONS
// ---------------------------------------------------------------------
const recipientsOf = async (step) => (step.approver_id ? [Number(step.approver_id)] : A.adminUserIds());

const TYPES = {
  SHEET: { noun: "Target Sheet", pending: "BP_SHEET_SUBMITTED", level: "BP_SHEET_LEVEL_APPROVED", approved: "BP_SHEET_APPROVED", returned: "BP_SHEET_RETURNED", rejected: "BP_SHEET_RETURNED" },
  PLAN: { noun: "Business Plan", pending: "BP_PLAN_SUBMITTED", level: "BP_PLAN_LEVEL_APPROVED", approved: "BP_PLAN_APPROVED", returned: "BP_PLAN_RETURNED", rejected: "BP_PLAN_REJECTED" },
};

// item = { type, id, code, employeeId, employeeName, ownerIds }
const notifySubmitted = async (item, state) => {
  const t = TYPES[item.type];
  if (!state.current) return;
  await A.notify(await recipientsOf(state.current), {
    type: t.pending,
    refId: item.id,
    title: `${t.noun} submitted for approval`,
    message: `${item.employeeName}'s ${t.noun} (${item.code}) is waiting for your approval — Level ${state.current.level_no} of ${state.total_levels}.`,
  });
};

const notifyDecision = async (item, state, { decision, actorId, actorName, result, remark }) => {
  const t = TYPES[item.type];
  const owners = [...new Set(item.ownerIds.map(Number))];
  await A.clearActionNotifications(item.id, [t.pending]);
  const step = result.step;
  if (decision === "APPROVE" && result.final) {
    const earlier = state.steps.filter((x) => x.acted_by && Number(x.acted_by) !== Number(actorId)).map((x) => Number(x.acted_by));
    await A.notify([...owners, ...earlier], {
      type: t.approved,
      refId: item.id,
      title: `${t.noun} approved`,
      message: `${item.employeeName}'s ${t.noun} (${item.code}) received final approval from ${actorName}.`,
    });
    return;
  }
  if (decision === "APPROVE") {
    const next = result.next;
    const nextState = await getState(item.type, item.id);
    const nextStep = nextState.current || next;
    const nextName = nextStep.approver_name || "Admin / Super Admin";
    await A.notify(owners, {
      type: t.level,
      refId: item.id,
      title: `${t.noun} approved at Level ${step.level_no}`,
      message: `${item.employeeName}'s ${t.noun} (${item.code}) was approved by ${actorName} (Level ${step.level_no} of ${state.total_levels}). It is now with ${nextName} for Level ${nextStep.level_no} approval.`,
    });
    await A.notify(await recipientsOf(nextStep), {
      type: t.pending,
      refId: item.id,
      title: `${t.noun} awaiting your approval`,
      message: `${item.employeeName}'s ${t.noun} (${item.code}) was approved by ${actorName} at Level ${step.level_no} and needs your approval — Level ${nextStep.level_no} of ${state.total_levels}.`,
    });
    return;
  }
  const rejected = decision === "REJECT";
  await A.notify(owners, {
    type: rejected ? t.rejected : t.returned,
    refId: item.id,
    title: rejected ? `${t.noun} rejected` : `${t.noun} returned for changes`,
    message: `${item.employeeName}'s ${t.noun} (${item.code}) was ${rejected ? "rejected" : "returned"} by ${actorName} at Level ${step.level_no}${remark ? `: ${remark}` : "."}`,
  });
};

// the `approval` block returned with a sheet / plan
const approvalBlock = (state, auth) => ({
  round: state.round,
  status: state.status,
  current_level: state.current_level,
  total_levels: state.total_levels,
  pending_with: state.pending_with,
  pending_role: state.current ? state.current.approver_role : null,
  can_act: !!(auth && auth.can),
  acting_as: auth && auth.can ? auth.as : null,
  final_if_approved: !!(auth && auth.can && auth.final),
  blocked_reason: auth && !auth.can ? auth.reason : null,
  steps: state.steps.map((x) => ({
    id: x.id,
    level_no: x.level_no,
    approver_kind: x.approver_kind,
    approver_id: x.approver_id,
    approver_name: x.approver_name,
    approver_role: x.approver_role,
    is_final: x.is_final,
    status: x.status,
    status_label: x.status_label,
    acted_by_name: x.acted_by_name,
    acted_as: x.acted_as,
    acted_at: x.acted_at,
    remark: x.remark,
  })),
  history: state.history,
});

module.exports = {
  TYPES,
  chainFor,
  sheetChainFor,
  summarize,
  getState,
  ensureSteps,
  authority,
  canReadAsApprover,
  pendingIds,
  applyDecision,
  notifySubmitted,
  notifyDecision,
  approvalBlock,
};
