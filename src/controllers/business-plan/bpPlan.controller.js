// Business Plan: plans, workflow, plan lines, monthly plan, corrective actions, history.
const plan = require("../../models/business-plan/bpPlan.model");
const s = require("../../models/business-plan/bpSettings.model");
const actuals = require("../../models/business-plan/bpActuals.model");
const analytics = require("../../models/business-plan/bpAnalytics.model");
const H = require("./bpHelpers");
const AP = require("../../models/business-plan/bpApproval.model");
const WF = require("./bpWorkflow");
const T = require("../../models/business-plan/bpTargets.model");
const REV = require("../../models/business-plan/bpRevision.model");
const SP = require("../../models/business-plan/bpSheetPlan.model");
const ABS = require("../../models/business-plan/bpAbs.model");
const TER = require("../../models/business-plan/bpTerritory.model");

const { HttpError, wrap, ok } = H;

const PENDING_STATUSES = ["SUBMITTED"];

const MAX_PLAN_DAYS = 731; // two years

// ---------------------------------------------------------------------
//  LOAD + ACCESS
// ---------------------------------------------------------------------
const loadPlan = async (req, key = "id") => {
  const id = H.toId(req.params[key], "plan id");
  const p = await plan.getPlan(id);
  if (!p) throw new HttpError(404, "Business plan not found");
  const visible = await H.visibleIds(req);
  // own / team plans, or plans this user approves (an RSM / admin-level approver outside the team)
  if (!H.canViewPlan(visible, p) && !(await WF.canReadAsApprover(req, "PLAN", p.id))) {
    throw new HttpError(403, "You do not have access to this business plan");
  }
  return p;
};

// a plan is changed by the assigned employee, its creator, a CREATE_BUSINESS_PLAN
// holder above the employee, or an admin
const loadEditablePlan = async (req, statuses = H.EDITABLE) => {
  const p = await loadPlan(req);
  await H.assertCanEditPlan(req, p);
  H.assertEditable(p, statuses);
  await H.assertNotLocked(req);
  return p;
};

const ownersOf = (p) => [p.assigned_user_id, p.created_by];

// approval steps of a plan (built on first read for plans submitted before multi-level approval)
const planApproval = async (req, p) => {
  await WF.ensureSteps("PLAN", p, { employeeId: p.assigned_user_id, excludeIds: [p.created_by], pendingStatuses: PENDING_STATUSES });
  const state = await WF.getState("PLAN", p.id);
  const auth = PENDING_STATUSES.includes(p.status) ? await WF.authority(req, state, ownersOf(p)) : null;
  return { state, auth };
};

// which buttons the app should show for this user
const canDeletePlan = async (req, p) => {
  const access = await H.getAccess(req);
  if (!["DRAFT", "REJECTED"].includes(p.status)) return false;
  if (access.isAdmin || p.created_by === req.user.id) return true;
  return access.codes.has("DELETE_BUSINESS_PLAN") && (await H.canEditPlanOf(req, p));
};

const allowedActions = async (req, p, approval) => {
  const access = await H.getAccess(req);
  const canEdit = await H.canEditPlanOf(req, p);
  const { auth } = approval || (await planApproval(req, p));
  const canDecide = p.status === "SUBMITTED" && !!(auth && auth.can);
  return {
    can_edit: canEdit && H.EDITABLE.includes(p.status),
    can_submit: canEdit && H.EDITABLE.includes(p.status),
    can_approve: canDecide,
    // an approved plan in revision cannot be rejected (its approved targets stay in force):
    // the approver returns the revision instead
    can_reject: canDecide && !p.in_revision,
    can_return: canDecide,
    can_revise: canEdit && p.status === "ACTIVE",
    in_revision: !!p.in_revision,
    approval_level: canDecide && approval ? approval.state.current_level : null,
    final_if_approved: canDecide ? !!auth.final : false,
    can_reopen: canEdit && p.status === "REJECTED",
    can_close: p.status === "ACTIVE" && (access.isAdmin || (await H.canDecidePlan(req, p))),
    can_delete: await canDeletePlan(req, p),
    can_add_corrective_action: ["SUBMITTED", "UNDER_REVIEW", "ACTIVE", "DRAFT"].includes(p.status),
    can_update_progress: ["DRAFT", "UNDER_REVIEW", "ACTIVE"].includes(p.status),
  };
};

// ---------------------------------------------------------------------
//  HEADER VALIDATION
// ---------------------------------------------------------------------
const readHeader = async (req, body, existing) => {
  const out = {};
  const required = !existing;

  const name = H.text(body.name, "Plan name", { required, max: 200 });
  if (name !== undefined) {
    if (!name) throw new HttpError(400, "Plan name is required");
    out.name = name;
  }

  // dropdown values must be active options from Settings
  const fy = H.text(body.financial_year, "Financial year", { required, max: 20 });
  if (fy !== undefined) {
    const value = fy.replace(/^FY\s*/i, "");
    if (existing && value === existing.financial_year) out.financial_year = value;
    else if (!(await s.isActiveOption("FINANCIAL_YEAR", value))) throw new HttpError(400, "Select a valid financial year");
    else out.financial_year = value;
  }
  for (const [key, label, listKey] of [
    ["season", "Season", "SEASON"],
    ["plan_type", "Plan type", "PLAN_TYPE"],
  ]) {
    const v = H.text(body[key], label, { required, max: 60 });
    if (v === undefined) continue;
    if (existing && v === existing[key]) out[key] = v;
    else if (!(await s.isActiveOption(listKey, v))) throw new HttpError(400, `Select a valid ${label.toLowerCase()}`);
    else out[key] = v;
  }

  const start = H.date(body.start_date, "Start date", { required });
  const end = H.date(body.end_date, "End date", { required });
  if (start) out.start_date = start;
  if (end) out.end_date = end;
  const finalStart = out.start_date || (existing && existing.start_date);
  const finalEnd = out.end_date || (existing && existing.end_date);
  if (finalStart && finalEnd) {
    if (finalStart > finalEnd) throw new HttpError(400, "Start date cannot be after end date");
    const days = (new Date(`${finalEnd}T00:00:00Z`) - new Date(`${finalStart}T00:00:00Z`)) / 86400000 + 1;
    if (days > MAX_PLAN_DAYS) throw new HttpError(400, "A plan period cannot be longer than two years");
  }

  if (body.state_id !== undefined || required) {
    out.state_id = H.toId(body.state_id, "state");
    if (!(await s.getState(out.state_id))) throw new HttpError(400, "State not found");
  }
  const stateId = out.state_id || (existing && existing.state_id);

  // Territory (one per plan, of the plan's state):
  //   - a NEW selection must be active and cover at least one district
  //   - the plan's current territory may be kept even if it was deactivated / emptied later
  //   - required when the state has at least one selectable territory, except that a plan
  //     saved without a territory (legacy) keeps working while its state is unchanged
  const stateChanged = !!(existing && out.state_id && out.state_id !== existing.state_id);
  if (body.territory_id !== undefined) {
    out.territory_id = H.optId(body.territory_id, "territory");
    if (out.territory_id) {
      const t = await TER.getTerritory(out.territory_id);
      if (!t) throw new HttpError(400, "Territory not found");
      if (t.state_id !== stateId) throw new HttpError(400, "Territory does not belong to the selected state");
      const keeping = existing && Number(existing.territory_id) === t.id && !stateChanged;
      if (!keeping && !t.selectable) {
        throw new HttpError(400, t.is_active
          ? "This territory has no districts yet and cannot be selected"
          : "This territory is inactive and cannot be selected");
      }
    }
  } else if (stateChanged && existing.territory_id) {
    out.territory_id = null; // state changed: old territory no longer fits
  }
  const finalTerritory = out.territory_id !== undefined ? out.territory_id : existing ? existing.territory_id : null;
  const mustCheck = !existing || stateChanged || (out.territory_id === null && existing && existing.territory_id);
  if (!finalTerritory && mustCheck && stateId) {
    const eligible = await TER.listTerritories({ stateId, selectableOnly: true });
    if (eligible.length) throw new HttpError(400, "Select a territory for this state");
  }

  // ABS targets: only when the Advance Booking module is installed (D4)
  const absBooking = H.money(body.abs_booking_target, "ABS booking target");
  const absAdvance = H.money(body.abs_advance_target, "ABS advance target");
  if (absBooking !== undefined || absAdvance !== undefined) {
    if (!(await ABS.isInstalled())) {
      if (absBooking || absAdvance) {
        throw new HttpError(400, "ABS targets can be set only when the Advance Booking module is installed");
      }
    } else {
      if (absBooking !== undefined) out.abs_booking_target = absBooking;
      if (absAdvance !== undefined) out.abs_advance_target = absAdvance;
      const booking = absBooking ?? (existing ? Number(existing.abs_booking_target) : 0);
      const advance = absAdvance ?? (existing ? Number(existing.abs_advance_target) : 0);
      if (advance > booking) throw new HttpError(400, "ABS advance target cannot be more than the ABS booking target");
    }
  }

  if (body.assigned_user_id !== undefined || body.employee_id !== undefined || required) {
    out.assigned_user_id = H.toId(body.assigned_user_id ?? body.employee_id, "assigned employee");
    const emp = await s.getEmployee(out.assigned_user_id);
    if (!emp || Number(emp.is_active) === 0) throw new HttpError(400, "Assigned employee not found or inactive");
    const visible = await H.visibleIds(req);
    if (!H.canSeeUser(visible, out.assigned_user_id)) {
      throw new HttpError(403, "You can assign plans only to yourself or your reporting team");
    }
  }
  return out;
};

// one live plan per employee + financial year + season (new and changed plans)
const assertNoDuplicate = async ({ assignedUserId, financialYear, season, excludeId = 0 }) => {
  const dup = await plan.findLivePlan({ assignedUserId, financialYear, season, excludeId });
  if (dup) {
    throw new HttpError(
      409,
      `This employee already has a ${plan.STATUS_LABEL[dup.status] || dup.status} plan for ${season} ${financialYear} (${dup.plan_code}). Revise that plan instead of creating another one.`,
    );
  }
};

// ---------------------------------------------------------------------
//  PLANS
// ---------------------------------------------------------------------
// GET /plans?search&status&financial_year&season&state_id&territory_id&employee_id
//           &product_id&page&limit&sort_by&sort_dir&with_actuals=1
const listPlans = wrap(async (req, res) => {
  const filters = await H.scopedFilters(req);
  // ?pending_approval=1 -> plans whose current approval level is mine (admin: all pending)
  if (String(req.query.pending_approval || "") === "1") {
    filters.ids = await WF.pendingIds(req, "PLAN");
    filters.status = PENDING_STATUSES;
    filters.exclude_user_id = req.user.id;
    filters.userIds = null; // the steps already limit the list
  }
  const result = await plan.listPlans(filters, {
    page: req.query.page,
    limit: req.query.limit,
    sortBy: req.query.sort_by,
    sortDir: req.query.sort_dir,
  });
  if (req.query.with_actuals !== "0") {
    const settings = await s.getSettings();
    result.items = await analytics.enrichPlans(result.items, settings, H.todayIST());
  }
  return ok(res, result);
});

const createPlan = wrap(async (req, res) => {
  await H.assertNotLocked(req);
  const data = await readHeader(req, req.body || {}, null);
  // own plan, a plan for an employee in my reporting team (reporting manager / above), or any
  // employee for Admin / Super Admin. readHeader already refused employees outside the team.
  await H.assertCanPlanFor(req, data.assigned_user_id);
  if (data.territory_id === undefined) data.territory_id = null;
  await assertNoDuplicate({ assignedUserId: data.assigned_user_id, financialYear: data.financial_year, season: data.season });
  const state = await s.getState(data.state_id);
  const prefix = `BP-${data.financial_year.slice(0, 4)}-${plan.stateCode(state.name)}-`;
  const id = await plan.createPlan(data, req.user.id, prefix);
  const p = await plan.getPlan(id);
  return ok(res, { ...p, territory: await TER.planTerritoryView(p), actions: await allowedActions(req, p) }, "Business plan created", 201);
});

// GET /plans/:id  -> header + overview tab + allowed actions
const getPlan = wrap(async (req, res) => {
  const p = await loadPlan(req);
  // plans approved before revisions existed get their baseline revision once
  await REV.ensureBaseline(p);
  const settings = await s.getSettings();
  const overview = await analytics.planOverview(p, settings, H.todayIST());
  const approval = await planApproval(req, p);
  const [revisions, sheets, territory] = await Promise.all([
    REV.listRevisions(p.id),
    REV.linkedSheets(p.id),
    TER.planTerritoryView(p),
  ]);
  // territory: the frozen snapshot for approved / closed / rejected plans and open revisions,
  // otherwise the territory's latest version
  if (overview.plan) overview.plan.territory = territory;
  return ok(res, {
    ...overview,
    territory,
    revisions,
    linked_sheets: sheets,
    actions: await allowedActions(req, p, approval),
    approval: WF.approvalBlock(approval.state, approval.auth),
  });
});

// GET /plans/:id/revisions[/:revisionNo] — approved targets of each revision
const listRevisions = wrap(async (req, res) => {
  const p = await loadPlan(req);
  await REV.ensureBaseline(p);
  return ok(res, await REV.listRevisions(p.id));
});

const getRevision = wrap(async (req, res) => {
  const p = await loadPlan(req);
  await REV.ensureBaseline(p);
  const no = H.toId(req.params.revisionNo, "revision number");
  const r = await REV.getRevision(p.id, no);
  if (!r) throw new HttpError(404, "Revision not found");
  return ok(res, r);
});

// GET /plans/:id/target-sheets — employee target sheets built on this plan
const listPlanSheets = wrap(async (req, res) => {
  const p = await loadPlan(req);
  return ok(res, await REV.linkedSheets(p.id));
});

// GET /plans/:id/approval-steps -> levels of the current round + full history
const getApprovalSteps = wrap(async (req, res) => {
  const p = await loadPlan(req);
  const approval = await planApproval(req, p);
  return ok(res, WF.approvalBlock(approval.state, approval.auth));
});

const updatePlan = wrap(async (req, res) => {
  const p = await loadEditablePlan(req);
  const data = await readHeader(req, req.body || {}, p);
  if (!Object.keys(data).length) throw new HttpError(400, "Nothing to update");
  if (p.in_revision) {
    for (const [k, label] of [["assigned_user_id", "employee"], ["financial_year", "financial year"], ["season", "season"]]) {
      if (data[k] !== undefined && String(data[k]) !== String(p[k])) {
        throw new HttpError(409, `The ${label} of an approved plan cannot change in a revision`);
      }
    }
  }
  const assignedUserId = data.assigned_user_id ?? p.assigned_user_id;
  const financialYear = data.financial_year ?? p.financial_year;
  const season = data.season ?? p.season;
  if (assignedUserId !== p.assigned_user_id || financialYear !== p.financial_year || season !== p.season) {
    await assertNoDuplicate({ assignedUserId, financialYear, season, excludeId: p.id });
  }
  await plan.updatePlanHeader(p.id, data, req.user.id);
  const updated = await plan.getPlan(p.id);
  return ok(res, { ...updated, territory: await TER.planTerritoryView(updated), actions: await allowedActions(req, updated) }, "Business plan updated");
});

// PUT /plans/:id/development — the "Edit" buttons of New Distributor Acquisition /
// New Retailer Development (also while Active: these are progress counters)
const updateDevelopment = wrap(async (req, res) => {
  const p = await loadEditablePlan(req, ["DRAFT", "UNDER_REVIEW", "ACTIVE"]);
  const b = req.body || {};
  const data = {
    new_distributor_target: H.intCount(b.new_distributor_target, "New distributor target"),
    new_retailer_target: H.intCount(b.new_retailer_target ?? b.acquisition_target, "Acquisition target"),
    retailer_contacted: H.intCount(b.retailer_contacted ?? b.contacted, "Contacted"),
    retailer_qualified: H.intCount(b.retailer_qualified ?? b.qualified, "Qualified"),
    retailer_onboarded: H.intCount(b.retailer_onboarded ?? b.onboarded, "Onboarded"),
    retailer_ordered: H.intCount(b.retailer_ordered ?? b.ordered, "Ordered"),
    retailer_expected_business: H.money(b.retailer_expected_business ?? b.expected_business, "Expected business"),
  };
  // targets are planning values: not changed once the plan is Active
  if (p.status === "ACTIVE" && (data.new_distributor_target !== undefined || data.new_retailer_target !== undefined || data.retailer_expected_business !== undefined)) {
    throw new HttpError(409, "Targets of an Active plan cannot change; only progress counts can be updated");
  }
  const merged = {
    contacted: data.retailer_contacted ?? p.retailer_contacted,
    qualified: data.retailer_qualified ?? p.retailer_qualified,
    onboarded: data.retailer_onboarded ?? p.retailer_onboarded,
    ordered: data.retailer_ordered ?? p.retailer_ordered,
  };
  if (!(merged.contacted >= merged.qualified && merged.qualified >= merged.onboarded && merged.onboarded >= merged.ordered)) {
    throw new HttpError(400, "Funnel counts must go down in order: Contacted ≥ Qualified ≥ Onboarded ≥ Ordered");
  }
  if (!Object.values(data).some((v) => v !== undefined)) throw new HttpError(400, "Nothing to update");
  await plan.updateDevelopment(p.id, data, req.user.id);
  const settings = await s.getSettings();
  return ok(res, await analytics.planOverview(await plan.getPlan(p.id), settings, H.todayIST()), "Updated");
});

const deletePlan = wrap(async (req, res) => {
  const p = await loadPlan(req);
  H.assertEditable(p, ["DRAFT", "REJECTED"]);
  if (!(await canDeletePlan(req, p))) {
    throw new HttpError(403, "Only the person who created this plan can delete it");
  }
  await plan.softDeletePlan(p.id, req.user.id);
  return ok(res, { id: p.id }, "Business plan deleted");
});

// ---------------------------------------------------------------------
//  WORKFLOW
// ---------------------------------------------------------------------
const transition = async (req, res, p, opts, message) => {
  const result = await plan.changeStatus(p.id, { ...opts, userId: req.user.id });
  if (!result.ok) {
    throw new HttpError(409, result.current ? `This plan is already ${plan.STATUS_LABEL[result.current] || result.current}` : "Business plan not found");
  }
  const updated = await plan.getPlan(p.id);
  return ok(res, { ...updated, actions: await allowedActions(req, updated) }, message);
};

const readRemark = (body, required) => {
  const remark = H.text(body && (body.remark ?? body.comment), "Comment", { max: 500 }) || "";
  if (required && remark.length < 3) throw new HttpError(400, "Please add a comment");
  return remark || null;
};

// DRAFT / UNDER_REVIEW -> SUBMITTED. Builds the approval chain from the assigned
// employee's reporting line and notifies the level-1 approver.
const submitPlan = wrap(async (req, res) => {
  const p = await loadEditablePlan(req);
  if (!(await plan.countLines(p.id))) {
    throw new HttpError(400, "Add at least one distributor, retailer or product target before submitting");
  }
  const fresh = await plan.getPlan(p.id);
  if (!(fresh.sales_target > 0)) throw new HttpError(400, "The plan's sales target is 0. Enter targets before submitting");
  const levels = await WF.chainFor(p.assigned_user_id, { excludeIds: [p.created_by] });
  const first = levels[0];
  const result = await plan.changeStatus(p.id, {
    allowedFrom: H.EDITABLE,
    to: "SUBMITTED",
    action: "SUBMITTED",
    remark: readRemark(req.body, false),
    detail: `Approval levels: ${levels.map((l) => `L${l.level_no} ${l.approver_name || l.approver_role}`).join(" → ")}`,
    approverId: first && first.approver_id ? first.approver_id : null,
    userId: req.user.id,
    extra: async (conn) => {
      // the territory version submitted for approval (latest version; a revision keeps its approved one)
      await TER.refreshPlanTerritory(conn, p.id, { wasInRevision: !!p.in_revision });
      return AP.createRound(conn, "PLAN", p.id, levels);
    },
  });
  if (!result.ok) {
    throw new HttpError(409, result.current ? `This plan is already ${plan.STATUS_LABEL[result.current] || result.current}` : "Business plan not found");
  }
  const updated = await plan.getPlan(p.id);
  const state = await WF.getState("PLAN", p.id);
  await WF.notifySubmitted(planItem(updated), state);
  return respondPlan(req, res, updated, "Submitted for approval");
});

const planItem = (p) => ({
  type: "PLAN",
  id: p.id,
  code: p.plan_code,
  employeeName: p.assigned_user_name || "An employee",
  ownerIds: [p.assigned_user_id, p.created_by],
});

const respondPlan = async (req, res, p, message) => {
  const approval = await planApproval(req, p);
  return ok(res, { ...p, actions: await allowedActions(req, p, approval), approval: WF.approvalBlock(approval.state, approval.auth) }, message);
};

// decision: APPROVE | REJECT | RETURN — only the approver of the current level, or an admin
const decide = (decision, remarkRequired) =>
  wrap(async (req, res) => {
    const p = await loadPlan(req);
    H.assertEditable(p, PENDING_STATUSES);
    const { state, auth } = await planApproval(req, p);
    if (!auth || !auth.can) throw new HttpError(403, (auth && auth.reason) || "You are not allowed to decide this business plan");
    if (decision === "REJECT" && p.in_revision) {
      throw new HttpError(409, "This is a revision of an approved plan: return it for changes instead of rejecting it");
    }
    const remark = readRemark(req.body, remarkRequired);
    const step = state.current;
    const final = decision === "APPROVE" && auth.final;
    // final approval = a new approved revision of the targets
    const newRevision = final ? Number(p.revision_no || 0) + 1 : null;
    const level = `Level ${step.level_no} of ${state.total_levels}${auth.as === "ADMIN" && step.approver_kind !== "ADMIN" ? " (admin approval)" : ""}`;

    let opts;
    let message;
    if (decision === "APPROVE" && !final) {
      opts = { allowedFrom: PENDING_STATUSES, to: "SUBMITTED", action: "LEVEL_APPROVED", detail: level };
      message = `Approved at Level ${step.level_no}. Sent to the next approver.`;
    } else if (decision === "APPROVE") {
      opts = {
        allowedFrom: PENDING_STATUSES,
        to: "ACTIVE",
        action: "APPROVED",
        decision: true,
        detail: `${level} · revision ${newRevision}`,
        extraSets: [
          ["revision_no = ?", newRevision],
          ["revision_status = 'NONE'"],
          ["approved_sales_target = sales_target"],
          ["approved_collection_target = collection_target"],
        ],
      };
      message = newRevision > 1 ? `Plan revision ${newRevision} approved` : "Plan approved";
    } else if (decision === "REJECT") {
      opts = { allowedFrom: PENDING_STATUSES, to: "REJECTED", action: "REJECTED", decision: true, detail: level };
      message = "Plan rejected";
    } else {
      opts = { allowedFrom: PENDING_STATUSES, to: "UNDER_REVIEW", action: "RETURNED", decision: true, detail: level };
      message = "Plan returned for changes";
    }
    let nextApprover;
    const result = await plan.changeStatus(p.id, {
      ...opts,
      remark,
      userId: req.user.id,
      extra: async (conn) => {
        const r = await WF.applyDecision(conn, "PLAN", p.id, {
          expectedStepId: step.id,
          decision,
          actorId: req.user.id,
          actedAs: auth.as,
          remark,
          final,
        });
        if (r.next) {
          nextApprover = r.next.approver_id || null;
          await conn.query(`UPDATE business_plans SET approver_id = ? WHERE id = ?`, [nextApprover, p.id]);
        }
        if (final) {
          // freeze the territory the plan is approved with (name, state, district ids + names, version)
          const territorySnapshot = await TER.refreshPlanTerritory(conn, p.id, { atApproval: true, wasInRevision: !!p.in_revision });
          // immutable copy of the approved targets + consequences for target sheets
          await REV.insertRevision(conn, { ...p, territory_snapshot: territorySnapshot }, newRevision, { approvedBy: req.user.id, remark });
          r.resolvedRequests = await SP.resolveAccepted(conn, p.id, newRevision);
          const cq = H.currentQuarter();
          r.flaggedSheets = newRevision > 1
            ? await REV.flagSheetsForRevision(conn, p.id, newRevision, H.quarterBounds(cq.financial_year, cq.quarter).from)
            : [];
        }
        return r;
      },
    });
    if (!result.ok) {
      throw new HttpError(409, result.current ? `This plan is already ${plan.STATUS_LABEL[result.current] || result.current}` : "Business plan not found");
    }
    const me = await s.getEmployee(req.user.id);
    await WF.notifyDecision(planItem(p), state, {
      decision,
      actorId: req.user.id,
      actorName: me ? me.name : "the approver",
      result: result.extra,
      remark,
    });
    if (final) await notifyApprovedTargets(p, newRevision, result.extra);
    return respondPlan(req, res, await plan.getPlan(p.id), message);
  });

// after a final approval: the employee's targets are ready (first approval) or changed
// (revision); sheets signed on an older revision need a new acknowledgement
const notifyApprovedTargets = async (p, revisionNo, extra) => {
  const ex = extra || {};
  if (revisionNo === 1) {
    await AP.notify([p.assigned_user_id], {
      type: "BP_PLAN_TARGETS_READY",
      refId: p.id,
      title: "Your Business Plan targets are approved",
      message: `${p.plan_code} (${p.season} ${p.financial_year}) is approved. Its targets now appear in your quarterly Target Sheet.`,
    });
  } else {
    await AP.notify([p.assigned_user_id, p.created_by], {
      type: "BP_PLAN_REVISION",
      refId: p.id,
      title: `Business Plan revision ${revisionNo} approved`,
      message: `The revised targets of ${p.plan_code} are now in force.`,
    });
  }
  for (const sh of ex.flaggedSheets || []) {
    await AP.notify([sh.user_id], {
      type: "BP_SHEET_REACK_REQUIRED",
      refId: sh.id,
      title: "Targets changed — acknowledge your Target Sheet again",
      message: `${p.plan_code} was revised (revision ${revisionNo}). Your Target Sheet ${sh.sheet_code} keeps its signed version; please acknowledge the new targets in a new version.`,
    });
  }
  for (const rq of ex.resolvedRequests || []) {
    await AP.notify([rq.user_id], {
      type: "BP_SHEET_REVISION_DECIDED",
      refId: rq.sheet_id,
      title: "Your target revision request is resolved",
      message: `${p.plan_code} was revised (revision ${revisionNo}). Open your Target Sheet to see the new targets.`,
    });
  }
};

// ACTIVE -> UNDER_REVIEW as a revision. The approved targets stay official until the revision
// is approved; the plan lines become editable; submit sends it through the same approval chain.
const revisePlan = wrap(async (req, res) => {
  const p = await loadPlan(req);
  await H.assertCanEditPlan(req, p);
  H.assertEditable(p, ["ACTIVE"]);
  await H.assertNotLocked(req);
  const remark = readRemark(req.body, true);
  await REV.ensureBaseline(p);
  const result = await plan.changeStatus(p.id, {
    allowedFrom: ["ACTIVE"],
    to: "UNDER_REVIEW",
    action: "REVISION_STARTED",
    remark,
    detail: `Revision ${Number(p.revision_no || 0) + 1} started`,
    userId: req.user.id,
    extraSets: [["revision_status = ?", plan.REVISION_OPEN]],
  });
  if (!result.ok) {
    throw new HttpError(409, result.current ? `This plan is already ${plan.STATUS_LABEL[result.current] || result.current}` : "Business plan not found");
  }
  await AP.notify([p.assigned_user_id, p.created_by].filter((id) => id !== req.user.id), {
    type: "BP_PLAN_REVISION",
    refId: p.id,
    title: "Business Plan revision started",
    message: `${p.plan_code} is being revised: ${remark}. The approved targets stay in force until the revision is approved.`,
  });
  return respondPlan(req, res, await plan.getPlan(p.id), "Revision started. Edit the targets and submit the revision for approval.");
});

const approvePlan = decide("APPROVE", false);
const rejectPlan = decide("REJECT", true);
const returnPlan = decide("RETURN", true);

// REJECTED -> DRAFT ("Revise Plan")
const reopenPlan = wrap(async (req, res) => {
  const p = await loadPlan(req);
  await H.assertCanEditPlan(req, p);
  H.assertEditable(p, ["REJECTED"]);
  await H.assertNotLocked(req);
  await assertNoDuplicate({ assignedUserId: p.assigned_user_id, financialYear: p.financial_year, season: p.season, excludeId: p.id });
  return transition(req, res, p, { allowedFrom: ["REJECTED"], to: "DRAFT", action: "REOPENED", remark: readRemark(req.body, false) }, "Plan reopened as Draft");
});

// ACTIVE -> CLOSED
const closePlan = wrap(async (req, res) => {
  const p = await loadPlan(req);
  H.assertEditable(p, ["ACTIVE"]);
  const access = await H.getAccess(req);
  if (!access.isAdmin && !(await H.canDecidePlan(req, p))) {
    throw new HttpError(403, "Only the approver or an admin can close this plan");
  }
  return transition(req, res, p, { allowedFrom: ["ACTIVE"], to: "CLOSED", action: "CLOSED", remark: readRemark(req.body, false) }, "Plan closed");
});

// ---------------------------------------------------------------------
//  DISTRIBUTOR LINES
// ---------------------------------------------------------------------
const listDistributors = wrap(async (req, res) => {
  const p = await loadPlan(req);
  return ok(res, await analytics.planDistributors(p, await s.getSettings()));
});

const readDistProducts = async (list) => {
  if (list === undefined) return undefined;
  if (!Array.isArray(list)) throw new HttpError(400, "products must be a list");
  if (list.length > 200) throw new HttpError(400, "Too many products");
  const seen = new Set();
  const out = list.map((x, i) => {
    const id = H.toId(x && x.stock_item_id, `product ${i + 1}`);
    if (seen.has(id)) throw new HttpError(400, "A product is listed twice");
    seen.add(id);
    return {
      stock_item_id: id,
      planned_qty: H.qty(x.planned_qty ?? x.qty, `Planned quantity (product ${i + 1})`) || 0,
      planned_value: H.money(x.planned_value ?? x.value, `Planned value (product ${i + 1})`) || 0,
    };
  });
  const found = await s.productsExist([...seen]);
  if (found.length !== seen.size) throw new HttpError(400, "Some products were not found");
  return out;
};

const readDistBody = async (body, existing, settings) => {
  const d = {
    annual_target: H.money(body.annual_target ?? body.annual_sales_target, "Annual sales target", { required: !existing, positive: true }),
    seasonal_target: H.money(body.seasonal_target, "Seasonal target"),
    // collection_target = ANNUAL collection target; seasonal_collection_target = this plan's season
    collection_target: H.money(body.collection_target ?? body.annual_collection_target, "Annual collection target"),
    seasonal_collection_target: H.money(body.seasonal_collection_target, "Seasonal collection target"),
    max_outstanding: H.money(body.max_outstanding ?? body.max_allowed_outstanding, "Max allowed outstanding"),
    expected_collection: H.money(body.expected_collection, "Expected collection"),
    products: await readDistProducts(body.products),
  };
  if (existing && d.annual_target !== undefined && d.annual_target <= 0) throw new HttpError(400, "Annual sales target must be greater than 0");
  const annual = d.annual_target ?? (existing ? Number(existing.annual_target) : 0);
  const seasonal = d.seasonal_target ?? (existing ? Number(existing.seasonal_target) : 0);
  if (!settings.allow_allocation_override && seasonal > annual) {
    throw new HttpError(400, `Seasonal target (${seasonal}) cannot be more than the annual target (${annual})`);
  }
  const annualColl = d.collection_target ?? (existing ? Number(existing.collection_target) : 0);
  const seasonalColl = d.seasonal_collection_target ?? (existing ? Number(existing.seasonal_collection_target) : 0);
  if (!settings.allow_allocation_override && annualColl > 0 && seasonalColl > annualColl) {
    throw new HttpError(400, `Seasonal collection target (${seasonalColl}) cannot be more than the annual collection target (${annualColl})`);
  }
  if (d.products && !settings.allow_allocation_override) {
    const planned = d.products.reduce((sum, x) => sum + x.planned_value, 0);
    if (planned > annual) {
      throw new HttpError(400, `Product planning value (${planned}) cannot be more than the annual target (${annual})`);
    }
  }
  return d;
};

const growthOf = (target, prev) => (prev > 0 ? Math.round((target / prev - 1) * 10000) / 100 : null);

const addDistributor = wrap(async (req, res) => {
  const p = await loadEditablePlan(req);
  const body = req.body || {};
  const ledgerId = H.toId(body.ledger_id ?? body.distributor_id, "distributor");
  const ledger = await s.getDistributorLedger(ledgerId);
  if (!ledger) throw new HttpError(400, "Distributor not found in the distributor master");
  if (await plan.findDistributorLine(p.id, ledgerId)) throw new HttpError(409, `${ledger.name} is already in this plan`);

  const settings = await s.getSettings();
  const d = await readDistBody(body, null, settings);
  const prev = (await actuals.getLedgerPreviousSales([ledgerId], p.start_date, p.end_date)).get(ledgerId) || 0;
  const id = await plan.saveDistributorLine(
    p.id,
    null,
    { ...d, ledger_id: ledgerId, previous_year_sales: prev, growth_percent: growthOf(d.annual_target, prev) },
    req.user.id,
    ledger.name,
  );
  const lines = await analytics.planDistributors(p, settings);
  return ok(res, { ...lines.find((l) => l.id === id), overlap_warnings: await overlapsFor(p.id, ledgerId) }, await savedMessage(p.id, ledgerId), 201);
});

// D2: the same distributor in another plan of this employee with overlapping dates
const overlapsFor = async (planId, ledgerId) => (await plan.findOverlaps(planId)).filter((o) => o.ledger_id === ledgerId);
const savedMessage = async (planId, ledgerId) => {
  const o = await overlapsFor(planId, ledgerId);
  if (!o.length) return "Distributor plan saved";
  return `Distributor plan saved. Note: ${o[0].distributor} is also in ${o.map((x) => `${x.other_plan_code} (${x.other_season})`).join(", ")} with overlapping dates. Each plan is measured in its own dates; combined figures count each invoice once.`;
};

const updateDistributor = wrap(async (req, res) => {
  const p = await loadEditablePlan(req);
  const lineId = H.toId(req.params.lineId, "line id");
  const line = await plan.getDistributorLine(p.id, lineId);
  if (!line) throw new HttpError(404, "Distributor line not found");
  const settings = await s.getSettings();
  const d = await readDistBody(req.body || {}, line, settings);
  if (d.annual_target !== undefined) d.growth_percent = growthOf(d.annual_target, Number(line.previous_year_sales));
  await plan.saveDistributorLine(p.id, lineId, d, req.user.id, line.name);
  const lines = await analytics.planDistributors(p, settings);
  return ok(res, { ...lines.find((l) => l.id === lineId), overlap_warnings: await overlapsFor(p.id, line.ledger_id) }, await savedMessage(p.id, line.ledger_id));
});

const deleteDistributor = wrap(async (req, res) => {
  const p = await loadEditablePlan(req);
  const lineId = H.toId(req.params.lineId, "line id");
  const line = await plan.getDistributorLine(p.id, lineId);
  if (!line) throw new HttpError(404, "Distributor line not found");
  await plan.deleteDistributorLine(p.id, lineId, req.user.id, line.name);
  return ok(res, { id: lineId }, "Distributor removed from the plan");
});

// ---------------------------------------------------------------------
//  RETAILER LINES
// ---------------------------------------------------------------------
const CATEGORY_ALIASES = { POTENTIAL_RETAILER: "POTENTIAL", NEW_RETAILER: "NEW" };
const CATEGORIES = ["A", "B", "C", "POTENTIAL", "NEW"];
const FREQUENCIES = ["WEEKLY", "FORTNIGHTLY", "MONTHLY"];

const listRetailers = wrap(async (req, res) => {
  const p = await loadPlan(req);
  return ok(res, await analytics.planRetailers(p, await s.getSettings()));
});

const readRetailerBody = async (body, existing) => {
  const r = {
    category: H.oneOf(body.category, "Category", CATEGORIES, CATEGORY_ALIASES),
    sales_target: H.money(body.sales_target, "Sales target", { required: !existing, positive: true }),
    visit_frequency: H.oneOf(body.visit_frequency, "Visit frequency", FREQUENCIES),
    previous_business: H.money(body.previous_business, "Previous business"),
    reported_actual: H.money(body.reported_actual ?? body.actual, "Actual business"),
  };
  if (existing && r.sales_target !== undefined && r.sales_target <= 0) throw new HttpError(400, "Sales target must be greater than 0");
  if (body.parent_ledger_id !== undefined || body.parent_distributor_id !== undefined) {
    r.parent_ledger_id = H.optId(body.parent_ledger_id ?? body.parent_distributor_id, "parent distributor");
    if (r.parent_ledger_id && !(await s.getDistributorLedger(r.parent_ledger_id))) {
      throw new HttpError(400, "Parent distributor not found");
    }
  }
  return r;
};

const addRetailer = wrap(async (req, res) => {
  const p = await loadEditablePlan(req);
  const body = req.body || {};
  const retailerId = H.toId(body.retailer_id, "retailer");
  const retailer = await s.getRetailer(retailerId);
  if (!retailer) throw new HttpError(400, "Retailer not found");
  if (await plan.findRetailerLine(p.id, retailerId)) throw new HttpError(409, `${retailer.name} is already in this plan`);
  const r = await readRetailerBody(body, null);
  if (r.parent_ledger_id === undefined) r.parent_ledger_id = retailer.mapped_ledger_id || null;
  if (r.previous_business === undefined) {
    const last = await s.getLastRetailerBusiness(retailerId);
    r.previous_business = last ? Number(last.reported_actual) || 0 : 0;
  }
  r.growth_percent = growthOf(r.sales_target, r.previous_business);
  const id = await plan.saveRetailerLine(p.id, null, { ...r, retailer_id: retailerId }, req.user.id, retailer.name);
  const lines = await analytics.planRetailers(p, await s.getSettings());
  return ok(res, lines.find((l) => l.id === id), "Retailer plan saved", 201);
});

// Draft / Under Review: every field. Active: only the reported actual business.
const updateRetailer = wrap(async (req, res) => {
  const p = await loadEditablePlan(req, ["DRAFT", "UNDER_REVIEW", "ACTIVE"]);
  const lineId = H.toId(req.params.lineId, "line id");
  const line = await plan.getRetailerLine(p.id, lineId);
  if (!line) throw new HttpError(404, "Retailer line not found");
  const r = await readRetailerBody(req.body || {}, line);
  if (p.status === "ACTIVE") {
    const changed = Object.entries(r).filter(([k, v]) => v !== undefined && k !== "reported_actual");
    if (changed.length) throw new HttpError(409, "In an Active plan only the actual business can be updated");
  }
  if (r.sales_target !== undefined || r.previous_business !== undefined) {
    r.growth_percent = growthOf(r.sales_target ?? Number(line.sales_target), r.previous_business ?? Number(line.previous_business));
  }
  await plan.saveRetailerLine(p.id, lineId, r, req.user.id, line.name);
  const lines = await analytics.planRetailers(p, await s.getSettings());
  return ok(res, lines.find((l) => l.id === lineId), "Retailer plan saved");
});

const deleteRetailer = wrap(async (req, res) => {
  const p = await loadEditablePlan(req);
  const lineId = H.toId(req.params.lineId, "line id");
  const line = await plan.getRetailerLine(p.id, lineId);
  if (!line) throw new HttpError(404, "Retailer line not found");
  await plan.deleteRetailerLine(p.id, lineId, req.user.id, line.name);
  return ok(res, { id: lineId }, "Retailer removed from the plan");
});

// ---------------------------------------------------------------------
//  PRODUCT LINES
// ---------------------------------------------------------------------
const listProducts = wrap(async (req, res) => {
  const p = await loadPlan(req);
  return ok(res, await analytics.planProducts(p, await s.getSettings()));
});

const readAllocations = async (list) => {
  if (list === undefined) return undefined;
  if (!Array.isArray(list)) throw new HttpError(400, "allocations must be a list");
  const seen = new Set();
  const out = list.map((a, i) => {
    const stateId = H.toId(a && a.state_id, `state (row ${i + 1})`);
    if (seen.has(stateId)) throw new HttpError(400, "A state is listed twice");
    seen.add(stateId);
    return { state_id: stateId, qty: H.qty(a.qty, `Quantity (row ${i + 1})`) || 0 };
  });
  const found = await s.statesExist([...seen]);
  if (found.length !== seen.size) throw new HttpError(400, "Some states were not found");
  return out;
};

const readProductBody = async (body, existing, settings) => {
  const d = {
    qty_target: H.qty(body.qty_target ?? body.sales_qty_target, "Sales quantity target", { required: !existing, positive: true }),
    value_target: H.money(body.value_target ?? body.sales_value_target, "Sales value target", { required: !existing, positive: true }),
    prev_year_qty: H.qty(body.prev_year_qty ?? body.previous_year_qty, "Previous year quantity"),
    prev_year_value: H.money(body.prev_year_value ?? body.previous_year_value, "Previous year value"),
    allocations: await readAllocations(body.allocations),
  };
  if (existing) {
    if (d.qty_target !== undefined && d.qty_target <= 0) throw new HttpError(400, "Enter both quantity and value targets");
    if (d.value_target !== undefined && d.value_target <= 0) throw new HttpError(400, "Enter both quantity and value targets");
  }
  // Rule: child <= parent
  const parent = d.qty_target ?? (existing ? Number(existing.qty_target) : 0);
  if (d.allocations && !settings.allow_allocation_override) {
    const child = d.allocations.reduce((sum, a) => sum + a.qty, 0);
    if (child > parent) throw new HttpError(400, `State allocation (${child}) exceeds product target (${parent})`);
  }
  if (!d.allocations && existing && d.qty_target !== undefined && !settings.allow_allocation_override) {
    const current = (await plan.listProductLines(existing.plan_id)).find((l) => l.id === existing.id);
    if (current && current.allocated_qty > d.qty_target) {
      throw new HttpError(400, `State allocation (${current.allocated_qty}) exceeds product target (${d.qty_target})`);
    }
  }
  return d;
};

const addProduct = wrap(async (req, res) => {
  const p = await loadEditablePlan(req);
  const body = req.body || {};
  const itemId = H.toId(body.stock_item_id ?? body.product_id, "product");
  const product = await s.getProduct(itemId);
  if (!product) throw new HttpError(400, "Product not found");
  if (await plan.findProductLine(p.id, itemId)) throw new HttpError(409, `${product.name} is already in this plan`);
  const settings = await s.getSettings();
  const d = await readProductBody(body, null, settings);
  const id = await plan.saveProductLine(p.id, null, { ...d, stock_item_id: itemId }, req.user.id, product.name);
  const lines = await analytics.planProducts(p, settings);
  return ok(res, lines.find((l) => l.id === id), "Product target saved", 201);
});

const updateProduct = wrap(async (req, res) => {
  const p = await loadEditablePlan(req);
  const lineId = H.toId(req.params.lineId, "line id");
  const line = await plan.getProductLine(p.id, lineId);
  if (!line) throw new HttpError(404, "Product line not found");
  const settings = await s.getSettings();
  const d = await readProductBody(req.body || {}, line, settings);
  await plan.saveProductLine(p.id, lineId, d, req.user.id, line.name);
  const lines = await analytics.planProducts(p, settings);
  return ok(res, lines.find((l) => l.id === lineId), "Product target saved");
});

const deleteProduct = wrap(async (req, res) => {
  const p = await loadEditablePlan(req);
  const lineId = H.toId(req.params.lineId, "line id");
  const line = await plan.getProductLine(p.id, lineId);
  if (!line) throw new HttpError(404, "Product line not found");
  await plan.deleteProductLine(p.id, lineId, req.user.id, line.name);
  return ok(res, { id: lineId }, "Product removed from the plan");
});

// ---------------------------------------------------------------------
//  MONTHLY PLAN
// ---------------------------------------------------------------------
const getMonthly = wrap(async (req, res) => {
  const p = await loadPlan(req);
  return ok(res, await analytics.planMonthly(p, await s.getSettings()));
});

// PUT /plans/:id/monthly { rows: [{ distributor_line_id, month: 'YYYY-MM', sales_target, collection_target }] }
const saveMonthly = wrap(async (req, res) => {
  const p = await loadEditablePlan(req);
  const rows = req.body && req.body.rows;
  if (!Array.isArray(rows) || !rows.length) throw new HttpError(400, "rows are required");
  if (rows.length > 600) throw new HttpError(400, "Too many rows");

  const months = new Set(analytics.monthsOf(p.start_date, p.end_date));
  const lines = await plan.listDistributorLines(p.id);
  const lineIds = new Set(lines.map((l) => l.id));
  // ABS rows (plan level): { month, abs_booking_target?, abs_advance_target? } — only with ABS installed
  const isAbsRow = (r) => r && (r.abs_booking_target !== undefined || r.abs_advance_target !== undefined) && r.sales_target === undefined;
  const absRows = rows.filter(isAbsRow);
  if (absRows.length) {
    if (!(await ABS.isInstalled())) throw new HttpError(400, "ABS targets can be set only when the Advance Booking module is installed");
    const seenAbs = new Set();
    const cleanAbs = absRows.map((r, i) => {
      const month = String(r.month || "").slice(0, 7);
      if (!months.has(month)) throw new HttpError(400, `ABS row ${i + 1}: month must be inside the plan period`);
      if (seenAbs.has(month)) throw new HttpError(400, `ABS row ${i + 1}: month listed twice`);
      seenAbs.add(month);
      const pick = (v, label) => (v === null || v === "" ? null : H.money(v, label) ?? null);
      return {
        month,
        abs_booking_target: pick(r.abs_booking_target, `ABS row ${i + 1}: booking target`),
        abs_advance_target: pick(r.abs_advance_target, `ABS row ${i + 1}: advance target`),
      };
    });
    await plan.saveAbsMonthly(p.id, cleanAbs, req.user.id);
  }
  const salesRows = rows.filter((r) => !isAbsRow(r));
  if (!salesRows.length) return ok(res, await analytics.planMonthly(await plan.getPlan(p.id), await s.getSettings()), "Monthly plan saved");
  const seen = new Set();
  const clean = salesRows.map((r, i) => {
    const lineId = Number(r && r.distributor_line_id) || 0;
    if (lines.length ? !lineIds.has(lineId) : lineId !== 0) {
      throw new HttpError(400, `Row ${i + 1}: distributor line does not belong to this plan`);
    }
    const month = String((r && r.month) || "").slice(0, 7);
    if (!months.has(month)) throw new HttpError(400, `Row ${i + 1}: month must be inside the plan period`);
    const key = `${lineId}:${month}`;
    if (seen.has(key)) throw new HttpError(400, `Row ${i + 1}: month listed twice`);
    seen.add(key);
    return {
      distributor_line_id: lineId,
      month,
      sales_target: H.money(r.sales_target, `Row ${i + 1}: sales target`, { required: true }),
      collection_target: H.money(r.collection_target, `Row ${i + 1}: collection target`) || 0,
    };
  });
  await plan.saveMonthlyTargets(p.id, clean, req.user.id);
  return ok(res, await analytics.planMonthly(p, await s.getSettings()), "Monthly plan saved");
});

const resetMonthly = wrap(async (req, res) => {
  const p = await loadEditablePlan(req);
  await plan.resetMonthlyTargets(p.id, req.user.id);
  return ok(res, await analytics.planMonthly(p, await s.getSettings()), "Monthly plan reset to the default split");
});

// ---------------------------------------------------------------------
//  COLLECTION / ACHIEVEMENT / VARIANCE TABS
// ---------------------------------------------------------------------
const tab = (fn) =>
  wrap(async (req, res) => {
    const p = await loadPlan(req);
    return ok(res, await fn(p, await s.getSettings(), H.todayIST()));
  });

const getCollection = tab(analytics.planCollection);
const getAchievement = tab(analytics.planAchievement);
const getVariance = tab(analytics.planVariance);

// ---------------------------------------------------------------------
//  CORRECTIVE ACTIONS
// ---------------------------------------------------------------------
const CA_OPEN_STATUSES = ["DRAFT", "SUBMITTED", "UNDER_REVIEW", "ACTIVE"];
const PRIORITIES = ["HIGH", "MEDIUM", "LOW"];
const CA_STATUSES = ["OPEN", "IN_PROGRESS", "CLOSED"];

const listCorrectiveActions = wrap(async (req, res) => {
  const p = await loadPlan(req);
  const status = H.oneOf(req.query.status, "status", CA_STATUSES);
  return ok(res, await plan.listCorrectiveActions(p.id, { status }));
});

const readActionBody = async (req, p, body, existing) => {
  const a = {};
  if (body.distributor_line_id !== undefined) {
    a.distributor_line_id = H.optId(body.distributor_line_id, "distributor line");
    if (a.distributor_line_id) {
      const line = await plan.getDistributorLine(p.id, a.distributor_line_id);
      if (!line) throw new HttpError(400, "Distributor line does not belong to this plan");
      a.scope_label = line.name;
    } else {
      a.scope_label = "General";
    }
  }
  if (body.scope_label !== undefined && a.scope_label === undefined) {
    a.scope_label = H.text(body.scope_label, "Scope", { max: 200 }) || "General";
  }
  const reason = H.text(body.reason, "Reason for gap", { required: !existing, max: 100 });
  if (reason !== undefined) {
    if (!(existing && reason === existing.reason) && !(await s.isActiveOption("GAP_REASON", reason))) {
      throw new HttpError(400, "Select a reason for the gap");
    }
    a.reason = reason;
  }
  const action = H.text(body.action_required ?? body.action, "Action required", { required: !existing, max: 1000 });
  if (action !== undefined) {
    if (!action) throw new HttpError(400, "Describe the corrective action");
    a.action_required = action;
  }
  if (body.responsible_user_id !== undefined) {
    a.responsible_user_id = H.optId(body.responsible_user_id, "responsible person");
    if (a.responsible_user_id) {
      const visible = await H.visibleIds(req);
      const emp = await s.getEmployee(a.responsible_user_id);
      const allowed = H.canSeeUser(visible, a.responsible_user_id) || a.responsible_user_id === p.assigned_user_id;
      if (!emp || !allowed) throw new HttpError(400, "Responsible person must be in your reporting team");
    }
  }
  if (body.due_date !== undefined) a.due_date = H.date(body.due_date, "Due date");
  if (body.follow_up_date !== undefined) a.follow_up_date = H.date(body.follow_up_date, "Follow-up date");
  a.priority = H.oneOf(body.priority, "Priority", PRIORITIES);
  a.status = H.oneOf(body.status, "Status", CA_STATUSES);
  if (body.manager_comment !== undefined) a.manager_comment = H.text(body.manager_comment, "Manager comment", { max: 1000 }) || null;
  return a;
};

const addCorrectiveAction = wrap(async (req, res) => {
  const p = await loadPlan(req);
  H.assertEditable(p, CA_OPEN_STATUSES);
  const a = await readActionBody(req, p, req.body || {}, null);
  const id = await plan.saveCorrectiveAction(p.id, null, a, req.user.id);
  return ok(res, await plan.getCorrectiveAction(p.id, id), "Corrective action saved", 201);
});

const updateCorrectiveAction = wrap(async (req, res) => {
  const p = await loadPlan(req);
  H.assertEditable(p, CA_OPEN_STATUSES);
  const id = H.toId(req.params.actionId, "action id");
  const existing = await plan.getCorrectiveAction(p.id, id);
  if (!existing) throw new HttpError(404, "Corrective action not found");
  const a = await readActionBody(req, p, req.body || {}, existing);
  await plan.saveCorrectiveAction(p.id, id, a, req.user.id);
  return ok(res, await plan.getCorrectiveAction(p.id, id), "Corrective action saved");
});

const deleteCorrectiveAction = wrap(async (req, res) => {
  const p = await loadPlan(req);
  H.assertEditable(p, CA_OPEN_STATUSES);
  const id = H.toId(req.params.actionId, "action id");
  const existing = await plan.getCorrectiveAction(p.id, id);
  if (!existing) throw new HttpError(404, "Corrective action not found");
  const access = await H.getAccess(req);
  if (!access.isAdmin && existing.created_by !== req.user.id) {
    throw new HttpError(403, "Only the person who logged this action can delete it; close it instead");
  }
  await plan.deleteCorrectiveAction(p.id, id, req.user.id);
  return ok(res, { id }, "Corrective action deleted");
});

// ---------------------------------------------------------------------
//  APPROVAL HISTORY + AUDIT LOG
// ---------------------------------------------------------------------
const getHistory = wrap(async (req, res) => {
  const p = await loadPlan(req);
  return ok(res, await plan.listActivity(p.id, { approvalOnly: true, page: req.query.page, limit: req.query.limit }));
});

const getAuditLog = wrap(async (req, res) => {
  const p = await loadPlan(req);
  return ok(res, await plan.listActivity(p.id, { page: req.query.page, limit: req.query.limit }));
});

module.exports = {
  listPlans,
  createPlan,
  getPlan,
  listRevisions,
  getRevision,
  listPlanSheets,
  revisePlan,
  updatePlan,
  updateDevelopment,
  deletePlan,
  submitPlan,
  approvePlan,
  rejectPlan,
  returnPlan,
  reopenPlan,
  closePlan,
  listDistributors,
  addDistributor,
  updateDistributor,
  deleteDistributor,
  listRetailers,
  addRetailer,
  updateRetailer,
  deleteRetailer,
  listProducts,
  addProduct,
  updateProduct,
  deleteProduct,
  getMonthly,
  saveMonthly,
  resetMonthly,
  getCollection,
  getAchievement,
  getVariance,
  listCorrectiveActions,
  addCorrectiveAction,
  updateCorrectiveAction,
  deleteCorrectiveAction,
  getHistory,
  getApprovalSteps,
  getAuditLog,
};
