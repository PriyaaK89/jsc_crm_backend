// Employee Target Sheet — the employee's quarterly COMMITMENT document.
//
// Two kinds of sheet (column target_source):
//   PLAN   (every new sheet) — the sales, collection, ABS, product, distributor and retailer
//          targets are read from the APPROVED revisions of the employee's Business Plans
//          (bpSheetTargets). The sheet never stores or edits targets; anything an app sends
//          for those sections is ignored. The employee fills only territory notes, his monthly
//          activity commitments (meetings / visits), prospects, support required, remarks and
//          the declaration. A disagreement is a revision request, decided on the plan side.
//          At final approval the quarter targets are frozen into target_snapshot and a signed
//          version is stored (bp_target_sheet_versions). A later plan revision never changes a
//          signed version: the sheet is flagged and the employee acknowledges again (new version).
//   LEGACY (sheets made before this change) — typed targets, kept exactly as they were and
//          handled by the original rules. They can be moved to plan targets only on request
//          (POST /target-sheets/:id/rebase), which first stores the original JSON as a version.
//
// Status flow (both kinds):
//   DRAFT -> SUBMITTED -> (level approved, more levels left) MANAGER_APPROVED -> APPROVED
//   SUBMITTED / MANAGER_APPROVED -> RETURNED (editable, resubmit = new approval round)
// Approval chain of a PLAN sheet (D7): reporting manager -> RSM (final); RSM alone when the
// reporting manager is the RSM; reporting manager alone (final) when there is no RSM.
// Admin / Super Admin may approve at any level. LEGACY sheets keep the chain they were
// submitted with.
const db = require("../../config/db");
const sheet = require("../../models/business-plan/bpTargetSheet.model");
const s = require("../../models/business-plan/bpSettings.model");
const AP = require("../../models/business-plan/bpApproval.model");
const plan = require("../../models/business-plan/bpPlan.model");
const actuals = require("../../models/business-plan/bpActuals.model");
const QT = require("../../models/business-plan/bpSheetTargets.model");
const SP = require("../../models/business-plan/bpSheetPlan.model");
const ABS = require("../../models/business-plan/bpAbs.model");
const T = require("../../models/business-plan/bpTargets.model");
const WF = require("./bpWorkflow");
const H = require("./bpHelpers");

const { HttpError, wrap, ok } = H;

const TABLE_KEYS = ["abs", "annual", "dist", "ret", "support", "review"];
const MAX_VALUE_KEYS = 400;
const MAX_ROWS = 300;
const MAX_CELL = 1000;

const PENDING_STATUSES = ["SUBMITTED", "MANAGER_APPROVED"];
const EDITABLE_STATUSES = ["DRAFT", "RETURNED"];

// read-only in the app: filled by the server.
//   mgrName / mgrDate   = Reporting Manager (level 1 approver) — stamped when he approves
//   apprName / apprDate = Authorized Company Approver (final level: RSM or Admin) — stamped
//                         at final approval
const SERVER_KEYS = ["employeeName", "employeeCode", "designation", "mgrName", "mgrDate", "apprName", "apprDate", "totalSales"];

// PLAN sheets: the only form fields the employee may write
const PLAN_EMPLOYEE_KEYS = new Set([
  "company", "hq", "doj", "offerDate", "offerRef", "apptDate", "apptRef", "agrDate", "agrRef",
  "territoryType", "state", "districts", "hq2", "crops", "competitors", "signName", "signDate", "remarks",
  "financialYear", "quarter", "ack",
]);
// monthly activity commitments (section 3, activity rows)
const ACTIVITY_KPIS = { dm: "Distributor Meetings", rv: "Retailer / Market Visits", fm: "Farmer / Dealer Meetings" };
// PLAN sheets: table columns the employee may write (everything else in these tables is dropped)
const PLAN_TABLE_COLUMNS = {
  dist: ["name", "location", "type", "stage", "crop"], // prospect distributors (no targets)
  ret: ["name", "village", "type", "distributor"], // prospect retailers / markets (no targets)
  support: ["item", "request", "remarks"],
};

const LEGACY_REQUIRED = {
  employeeName: "Employee Name",
  employeeCode: "Employee Code",
  designation: "Designation",
  hq: "HQ / Territory",
  doj: "Date of Joining",
  periodFrom: "Business Plan Period — From",
  periodTo: "Business Plan Period — To",
  state: "State",
  districts: "District(s)",
  signName: "Employee Name / Typed Signature",
  signDate: "Employee Signature Date",
};
const PLAN_REQUIRED = {
  hq: "HQ / Territory",
  doj: "Date of Joining",
  districts: "District(s)",
  signName: "Employee Name / Typed Signature",
  signDate: "Employee Signature Date",
};

// LEGACY "3. First 3 Months Business Plan": these KPIs are mandatory for all three months
const MANDATORY_KPIS = { sales: "Sales Target", coll: "Current Sales Collection", absB: "ABS Booking Value" };
const MONTH_KEYS = ["1st Month", "2nd Month", "3rd Month"];

// cells that alone do not make a table row "filled" (defaults the app pre-fills)
const ABS_DATA_KEYS = ["product", "parties", "qty", "absValue", "advance"];
const ANNUAL_DATA_KEYS = ["product", "pack", "qty", "rate", "collection"];

const n = (v) => {
  const x = Number(String(v ?? "").replace(/,/g, "").trim());
  return Number.isFinite(x) ? x : 0;
};
const isNumber = (v) => String(v ?? "").trim() !== "" && Number.isFinite(Number(String(v).replace(/,/g, "").trim()));
const filled = (row, keys) => keys.some((k) => String(row[k] ?? "").trim() !== "");

const employeeCode = (id) => `EMP-${String(id).padStart(4, "0")}`;

// "2026-11-13" -> 11/13/2026 (mm/dd/yyyy as the app shows dates)
const appDate = (iso) => (iso ? `${iso.slice(5, 7)}/${iso.slice(8, 10)}/${iso.slice(0, 4)}` : "");

const fyStartOf = (financialYear) => {
  const y = H.fyStartYear(financialYear);
  return y ? `${y}-04-01` : null;
};

const companyName = async () => {
  try {
    const [rows] = await db.query(`SELECT company_name FROM companies ORDER BY id ASC LIMIT 1`);
    return rows[0] ? rows[0].company_name : "";
  } catch (_) {
    return "";
  }
};

// crop master + seasons for validating the ABS and annual tables (legacy sheets)
const loadDropdowns = async () => {
  const [crops, options] = await Promise.all([
    s.listCrops().catch(() => []),
    s.listOptions(),
  ]);
  const seasons = s.groupOptions(options).SEASON.map((o) => o.value);
  return { crops, seasons };
};

// ---------------------------------------------------------------------
//  BODY
// ---------------------------------------------------------------------
const readForm = (body) => {
  const rawValues = body.values && typeof body.values === "object" && !Array.isArray(body.values) ? body.values : {};
  const keys = Object.keys(rawValues);
  if (keys.length > MAX_VALUE_KEYS) throw new HttpError(400, "Too many fields in the sheet");
  const values = {};
  for (const k of keys) {
    if (SERVER_KEYS.includes(k)) continue;
    if (k.length > 60) throw new HttpError(400, "Invalid field name in the sheet");
    const v = rawValues[k] === null || rawValues[k] === undefined ? "" : String(rawValues[k]);
    if (v.length > MAX_CELL) throw new HttpError(400, `Field "${k}" is too long`);
    values[k] = v;
  }

  const rawTables = body.tables && typeof body.tables === "object" && !Array.isArray(body.tables) ? body.tables : {};
  const tables = {};
  for (const key of TABLE_KEYS) {
    const rows = rawTables[key];
    if (rows === undefined) continue;
    if (!Array.isArray(rows)) throw new HttpError(400, `Table "${key}" must be a list`);
    if (rows.length > MAX_ROWS) throw new HttpError(400, `Table "${key}" has too many rows`);
    tables[key] = rows.map((row) => {
      const clean = {};
      if (row && typeof row === "object") {
        for (const [ck, cv] of Object.entries(row).slice(0, 30)) {
          const v = cv === null || cv === undefined ? "" : String(cv);
          if (v.length > MAX_CELL) throw new HttpError(400, `A cell in table "${key}" is too long`);
          clean[String(ck).slice(0, 40)] = v;
        }
      }
      return clean;
    });
  }

  // quarter: body.financial_year / body.quarter, or the form keys financialYear / quarter
  const fyRaw = body.financial_year ?? rawValues.financialYear;
  const qRaw = body.quarter ?? rawValues.quarter;
  const financialYear = fyRaw === undefined || fyRaw === null || String(fyRaw).trim() === "" ? null : String(fyRaw).trim().replace(/^FY\s*/i, "");
  let quarter = null;
  if (qRaw !== undefined && qRaw !== null && String(qRaw).trim() !== "") {
    quarter = Number(String(qRaw).replace(/^Q/i, "").trim());
    if (![1, 2, 3, 4].includes(quarter)) throw new HttpError(400, "Quarter must be Q1, Q2, Q3 or Q4");
  }

  const ack = body.acknowledged ?? rawValues.ack;
  return { values, tables, financialYear, quarter, acknowledged: ack === true || ack === 1 || ack === "1" };
};

// crop -> master spelling + cropId; season -> master spelling. Unknown values stay as typed
// (old sheets) and are refused only on submit.
const normalizeRows = (tables, { crops, seasons }) => {
  const cropByName = new Map(crops.map((c) => [c.name.trim().toLowerCase(), c]));
  const cropById = new Map(crops.map((c) => [String(c.id), c]));
  const seasonByName = new Map(seasons.map((x) => [x.trim().toLowerCase(), x]));
  for (const key of ["abs", "annual"]) {
    for (const row of tables[key] || []) {
      const crop = (row.cropId && cropById.get(String(row.cropId))) || cropByName.get(String(row.crop || "").trim().toLowerCase());
      if (crop) {
        row.crop = crop.name;
        row.cropId = String(crop.id);
      } else if (row.cropId && !String(row.crop || "").trim()) {
        delete row.cropId;
      }
      const season = seasonByName.get(String(row.season || "").trim().toLowerCase());
      if (season) row.season = season;
    }
  }
};

// LEGACY totals from the annual product table (qty x rate; collection)
const totals = (tables) => {
  const annual = tables.annual || [];
  return {
    total_sales: Math.round(annual.reduce((sum, r) => sum + n(r.qty) * n(r.rate), 0) * 100) / 100,
    total_collection: Math.round(annual.reduce((sum, r) => sum + n(r.collection), 0) * 100) / 100,
  };
};

// PLAN sheets: keep only what the employee may write (targets are never stored on the sheet)
const planOnlyForm = (form) => {
  const values = {};
  for (const [k, v] of Object.entries(form.values)) {
    const activity = /^kpi\.(dm|rv|fm)\.m[123]$/.test(k);
    if (PLAN_EMPLOYEE_KEYS.has(k) || activity) values[k] = v;
  }
  const tables = {};
  for (const [key, cols] of Object.entries(PLAN_TABLE_COLUMNS)) {
    if (!form.tables[key]) continue;
    tables[key] = form.tables[key].map((row) => {
      const clean = {};
      for (const c of cols) if (row[c] !== undefined) clean[c] = row[c];
      if (key === "dist" || key === "ret") clean.type = "New"; // prospects only; plan parties come from the plan
      return clean;
    });
  }
  return { ...form, values, tables };
};

const resolveQuarter = async (form, existing) => {
  let financialYear = form.financialYear ?? (existing ? existing.financial_year : null);
  let quarter = form.quarter ?? (existing ? existing.quarter : null);
  if (financialYear && !(existing && existing.financial_year === financialYear) && !(await s.isActiveOption("FINANCIAL_YEAR", financialYear))) {
    throw new HttpError(400, "Select a valid financial year");
  }
  if ((financialYear && !quarter) || (!financialYear && quarter)) {
    throw new HttpError(400, "Select both the financial year and the quarter");
  }
  if (!financialYear) return { financialYear: null, quarter: null, bounds: null };
  const bounds = H.quarterBounds(financialYear, quarter);
  if (!bounds) throw new HttpError(400, "Select a valid financial year and quarter");
  return { financialYear, quarter, bounds };
};

// territory facts from the CRM (section 2): read-only on a PLAN sheet
const territoryValues = async (userId, financialYear) => {
  const fyStart = fyStartOf(financialYear);
  if (!fyStart) return {};
  const t = await actuals.getTerritoryStatus(userId, fyStart);
  return {
    prevSales: t.previous_year_sales.toFixed(2),
    exDist: String(t.active_distributors),
    exRet: String(t.active_retailers),
    oldOut: t.old_outstanding.toFixed(2),
  };
};

const buildRecord = async (userId, rawForm, { existing = null, source = "PLAN" } = {}) => {
  const emp = await s.getEmployee(userId);
  if (!emp) throw new HttpError(400, "Employee not found");
  const form = source === "PLAN" ? planOnlyForm(rawForm) : rawForm;
  const values = {
    ...form.values,
    employeeName: emp.name || "",
    employeeCode: employeeCode(emp.id),
    designation: emp.job_role || "",
  };
  // approval stamps stay what the workflow wrote
  if (existing) {
    for (const k of ["mgrName", "mgrDate", "apprName", "apprDate"]) {
      if (existing.values && existing.values[k]) values[k] = existing.values[k];
    }
  }

  // financial year + quarter -> the period is the quarter (From / To are not typed)
  const { financialYear, quarter, bounds } = await resolveQuarter(form, existing);
  if (bounds) {
    values.periodFrom = appDate(bounds.from);
    values.periodTo = appDate(bounds.to);
    values.financialYear = financialYear;
    values.quarter = String(quarter);
    const dup = await sheet.findQuarterSheet(userId, financialYear, quarter, existing ? existing.id : 0);
    if (dup) {
      throw new HttpError(409, `A target sheet for ${H.QUARTER_LABEL[quarter]} ${financialYear} already exists (${dup.sheet_code}). Open that sheet instead.`);
    }
  }

  const periodFrom = H.normalizeDate(values.periodFrom);
  const periodTo = H.normalizeDate(values.periodTo);
  if (periodFrom === undefined) throw new HttpError(400, "Business Plan Period — From is not a valid date");
  if (periodTo === undefined) throw new HttpError(400, "Business Plan Period — To is not a valid date");
  if (periodFrom && periodTo && periodFrom > periodTo) throw new HttpError(400, "Plan period From cannot be after To");

  let t;
  if (source === "PLAN") {
    // targets come from the approved plans; the totals are kept on the row for lists only
    const qt = bounds ? await QT.quarterTargets(userId, financialYear, quarter, bounds) : null;
    t = {
      total_sales: qt ? qt.summary.quarter_sales_target : 0,
      total_collection: qt ? qt.summary.quarter_collection_target : 0,
    };
    Object.assign(values, bounds ? await territoryValues(userId, financialYear) : {});
    const planState = qt && qt.plans.map((p) => p.state_name).filter(Boolean)[0];
    if (planState && !String(values.state || "").trim()) values.state = planState;
  } else {
    normalizeRows(form.tables, await loadDropdowns());
    t = totals(form.tables);
  }
  values.totalSales = Number(t.total_sales).toFixed(2);
  values.ack = form.acknowledged ? "1" : "0";
  const territoryType = values.territoryType === "New" ? "New" : "Existing";
  return {
    user_id: userId,
    financial_year: financialYear,
    quarter,
    period_from: periodFrom,
    period_to: periodTo,
    territory_type: territoryType,
    state: (values.state || "").slice(0, 100) || null,
    ...t,
    values,
    tables: form.tables,
    acknowledged: form.acknowledged,
    target_source: source,
  };
};

// ---------------------------------------------------------------------
//  SUBMIT VALIDATION  -> list of { field, message } (first one is shown as the message)
// ---------------------------------------------------------------------
const legacySubmitErrors = (sh, { crops, seasons }) => {
  const errors = [];
  const v = sh.values || {};
  const t = sh.tables || {};
  const add = (field, message) => errors.push({ field, message });

  if (!sh.financial_year || !sh.quarter) add("quarter", "Select the financial year and quarter of this business plan");
  for (const [key, label] of Object.entries(LEGACY_REQUIRED)) {
    if (!String(v[key] || "").trim()) add(key, `Please fill: ${label}`);
  }

  // all three months of the quarter: Sales, Collection and ABS
  const b = sh.financial_year && sh.quarter ? H.quarterBounds(sh.financial_year, sh.quarter) : null;
  const monthName = (m) => (b ? `${MONTH_KEYS[m - 1]} (${b.months[m - 1].label})` : MONTH_KEYS[m - 1]);
  for (let m = 1; m <= 3; m++) {
    for (const [k, label] of Object.entries(MANDATORY_KPIS)) {
      const raw = v[`kpi.${k}.m${m}`];
      if (!isNumber(raw) || n(raw) <= 0) add(`kpi.${k}.m${m}`, `${monthName(m)}: ${label} is required (enter an amount greater than 0)`);
    }
  }

  // ABS plan: crop + season on every filled row, and at least one row per month
  const cropNames = new Set(crops.map((c) => c.name.trim().toLowerCase()));
  const seasonNames = new Set(seasons.map((x) => x.trim().toLowerCase()));
  const checkCropSeason = (key, title, rows, dataKeys) => {
    rows.forEach((r, i) => {
      if (!filled(r, dataKeys)) return;
      const crop = String(r.crop || "").trim();
      const season = String(r.season || "").trim();
      if (!crop) add(`${key}.${i}.crop`, `${title} row ${i + 1}: select a crop`);
      else if (cropNames.size && !cropNames.has(crop.toLowerCase())) add(`${key}.${i}.crop`, `${title} row ${i + 1}: "${crop}" is not in the crop master. Select a crop from the list`);
      if (!season) add(`${key}.${i}.season`, `${title} row ${i + 1}: select a season`);
      else if (!seasonNames.has(season.toLowerCase())) add(`${key}.${i}.season`, `${title} row ${i + 1}: select a valid season (${seasons.join(", ")})`);
    });
  };
  const absRows = t.abs || [];
  checkCropSeason("abs", "ABS Plan", absRows, ABS_DATA_KEYS);
  for (let m = 1; m <= 3; m++) {
    const has = absRows.some((r) => String(r.month || "").trim() === MONTH_KEYS[m - 1] && String(r.crop || "").trim() && n(r.absValue) > 0);
    if (!has) add(`abs.month${m}`, `ABS Plan: add at least one row for ${monthName(m)} with crop, season and ABS value`);
  }
  checkCropSeason("annual", "Annual Crop Plan", t.annual || [], ANNUAL_DATA_KEYS);

  if (!sh.acknowledged) add("ack", "Please fill: Acknowledgement checkbox");
  return errors;
};

// PLAN sheet: the employee's own parts + the plan targets must exist
const planSubmitErrors = (sh, qt, blockingRequests) => {
  const errors = [];
  const v = sh.values || {};
  const add = (field, message) => errors.push({ field, message });
  if (!sh.financial_year || !sh.quarter) add("quarter", "Select the financial year and quarter");
  if (qt && !qt.plans.length) {
    add("plans", `No approved Business Plan covers ${H.QUARTER_LABEL[sh.quarter]} ${sh.financial_year}. Your manager must prepare and approve your Business Plan first.`);
  }
  if (blockingRequests > 0) {
    add("revision", "You have a target revision request that is not settled yet. Wait for the decision (and the plan revision) before submitting.");
  }
  for (const [key, label] of Object.entries(PLAN_REQUIRED)) {
    if (!String(v[key] || "").trim()) add(key, `Please fill: ${label}`);
  }
  const b = sh.financial_year && sh.quarter ? H.quarterBounds(sh.financial_year, sh.quarter) : null;
  const monthName = (m) => (b ? `${MONTH_KEYS[m - 1]} (${b.months[m - 1].label})` : MONTH_KEYS[m - 1]);
  for (let m = 1; m <= 3; m++) {
    for (const [k, label] of Object.entries(ACTIVITY_KPIS)) {
      const raw = v[`kpi.${k}.m${m}`];
      if (!isNumber(raw) || n(raw) < 0 || !Number.isInteger(n(raw))) {
        add(`kpi.${k}.m${m}`, `${monthName(m)}: enter your ${label} commitment (a whole number, 0 or more)`);
      }
    }
  }
  if (!sh.acknowledged) add("ack", "Please tick the acknowledgement of the targets and terms");
  return errors;
};

// ---------------------------------------------------------------------
//  ACCESS
// ---------------------------------------------------------------------
const loadSheet = async (req) => {
  const id = H.toId(req.params.id, "sheet id");
  const sh = await sheet.getSheet(id);
  if (!sh) throw new HttpError(404, "Target sheet not found");
  const visible = await H.visibleIds(req);
  // own sheet, team sheet (manager / RSM above the employee), admin, or an approver of it
  const allowed = sh.user_id === req.user.id || H.canSeeUser(visible, sh.user_id) || (await WF.canReadAsApprover(req, "SHEET", sh.id));
  if (!allowed) throw new HttpError(403, "You do not have access to this target sheet");
  return sh;
};

const isOwner = (req, sh) => sh.user_id === req.user.id || sh.created_by === req.user.id;
const ownersOf = (sh) => [sh.user_id, sh.created_by];

const sheetApproval = async (req, sh) => {
  await WF.ensureSteps("SHEET", sh, {
    employeeId: sh.user_id,
    excludeIds: sh.created_by !== sh.user_id ? [sh.created_by] : [],
    pendingStatuses: PENDING_STATUSES,
    legacyDone: sh.status === "MANAGER_APPROVED" && sh.manager_approved_by
      ? { actedBy: sh.manager_approved_by, actedAt: sh.manager_approved_at }
      : null,
  });
  const state = await WF.getState("SHEET", sh.id);
  const auth = PENDING_STATUSES.includes(sh.status) ? await WF.authority(req, state, ownersOf(sh)) : null;
  return { state, auth };
};

const actionsFor = async (req, sh, { state, auth }) => {
  const can = !!(auth && auth.can);
  const cur = state.current;
  const access = await H.getAccess(req);
  const owner = isOwner(req, sh);
  const plan = !sh.is_legacy;
  return {
    can_edit: owner && EDITABLE_STATUSES.includes(sh.status),
    can_submit: owner && EDITABLE_STATUSES.includes(sh.status),
    // a plan revision approved after submission: the approvers return the sheet
    can_approve: can && !(plan && sh.targets_outdated),
    can_return: can,
    can_delete: owner && EDITABLE_STATUSES.includes(sh.status),
    can_request_revision: plan && sh.user_id === req.user.id,
    can_reacknowledge: plan && owner && sh.status === "APPROVED" && sh.targets_outdated,
    can_rebase: !plan && (owner || access.isAdmin) && ["DRAFT", "RETURNED", "APPROVED"].includes(sh.status),
    can_edit_review: plan && sh.user_id === req.user.id && sh.status === "APPROVED",
    is_legacy: !plan,
    targets_outdated: !!sh.targets_outdated,
    // MANAGER = level 1 (reporting manager); COMPANY = final level (RSM / admin); LEVEL = in between
    approval_stage: can ? (auth.final ? "COMPANY" : cur.level_no === 1 ? "MANAGER" : "LEVEL") : null,
    approval_level: can ? cur.level_no : null,
    total_levels: state.total_levels,
    final_if_approved: can ? !!auth.final : false,
  };
};

const withQuarter = (sh) => {
  const b = sh.financial_year && sh.quarter ? H.quarterBounds(sh.financial_year, sh.quarter) : null;
  return {
    ...sh,
    quarter_label: sh.quarter ? H.QUARTER_LABEL[sh.quarter] : null,
    quarter_months: b ? b.months.map((m) => m.label) : null,
  };
};

// the quarter targets a PLAN sheet shows: frozen at approval, live otherwise
const sheetTargets = async (sh) => {
  if (sh.is_legacy || !sh.financial_year || !sh.quarter) return null;
  if (sh.status === "APPROVED" && sh.target_snapshot) {
    return { ...sh.target_snapshot, frozen: true, frozen_at: sh.snapshot_at };
  }
  const qt = await QT.quarterTargets(sh.user_id, sh.financial_year, sh.quarter, H.quarterBounds(sh.financial_year, sh.quarter));
  return { ...qt, frozen: false };
};

const respond = async (req, res, sh, message, status = 200) => {
  const approval = await sheetApproval(req, sh);
  const [targets, requests, versions, links] = await Promise.all([
    sheetTargets(sh),
    sh.is_legacy ? Promise.resolve([]) : SP.listRequestsForSheet(sh.id),
    SP.listVersions(sh.id),
    SP.listLinks(sh.id),
  ]);
  const out = {
    ...withQuarter(sh),
    plan_targets: targets,
    linked_plans: links,
    revision_requests: requests,
    versions,
    actions: await actionsFor(req, sh, approval),
    approval: WF.approvalBlock(approval.state, approval.auth),
  };
  delete out.target_snapshot;
  return ok(res, out, message, status);
};

const sheetItem = (sh) => ({
  type: "SHEET",
  id: sh.id,
  code: sh.sheet_code,
  employeeName: sh.employee_name || "An employee",
  ownerIds: ownersOf(sh),
});

// ---------------------------------------------------------------------
//  ENDPOINTS
// ---------------------------------------------------------------------
// GET /target-sheets/prefill?financial_year&quarter -> values the app shows read-only,
// the quarter (default: today's) and its approved plan targets
const prefill = wrap(async (req, res) => {
  const emp = await s.getEmployee(req.user.id);
  if (!emp) throw new HttpError(404, "Employee not found");
  const cq = H.currentQuarter();
  const financialYear = H.text(req.query.financial_year, "financial_year", { max: 20 }) || cq.financial_year;
  const quarter = req.query.quarter ? Number(String(req.query.quarter).replace(/^Q/i, "")) : cq.quarter;
  const bounds = H.quarterBounds(financialYear, quarter);
  if (!bounds) throw new HttpError(400, "Select a valid financial year and quarter");
  const [qt, territory] = await Promise.all([
    QT.quarterTargets(req.user.id, financialYear, quarter, bounds),
    territoryValues(req.user.id, financialYear),
  ]);
  return ok(res, {
    company: await companyName(),
    employeeName: emp.name,
    employeeCode: employeeCode(emp.id),
    designation: emp.job_role || "",
    hq: emp.headquarter || "",
    doj: emp.date_of_joining ? appDate(String(emp.date_of_joining).slice(0, 10)) : "",
    state: (qt.plans.map((p) => p.state_name).filter(Boolean)[0]) || emp.state || "",
    reportingManager: emp.reporting_manager || "",
    signName: emp.name,
    financialYear,
    quarter: String(quarter),
    ...territory,
    plan_targets: qt,
  });
});

// GET /target-sheets/quarter-targets?financial_year&quarter&user_id -> approved plan targets of a quarter
const getQuarterTargets = wrap(async (req, res) => {
  const financialYear = H.text(req.query.financial_year, "financial_year", { required: true, max: 20 });
  const quarter = Number(String(req.query.quarter || "").replace(/^Q/i, ""));
  const bounds = H.quarterBounds(financialYear, quarter);
  if (!bounds) throw new HttpError(400, "Select a valid financial year and quarter");
  let userId = req.user.id;
  if (req.query.user_id !== undefined && Number(req.query.user_id) !== req.user.id) {
    userId = H.toId(req.query.user_id, "employee");
    const visible = await H.visibleIds(req);
    if (!H.canSeeUser(visible, userId)) throw new HttpError(403, "You can see only your own or your team's targets");
  }
  return ok(res, await QT.quarterTargets(userId, financialYear, quarter, bounds));
});

// GET /target-sheets?scope=mine|team|pending|all&status&financial_year&quarter&search&page&limit
//   pending = sheets whose current approval level is mine (admin: every pending sheet)
const listSheets = wrap(async (req, res) => {
  const access = await H.getAccess(req);
  const scope = String(req.query.scope || "mine").toLowerCase();
  let userIds;
  let ids;
  let status = H.oneOf(req.query.status, "status", Object.keys(sheet.STATUS_LABEL));
  if (scope === "mine") userIds = [req.user.id];
  else if (scope === "team") {
    const visible = await H.visibleIds(req);
    userIds = visible === null ? null : visible.filter((id) => id !== req.user.id);
  } else if (scope === "pending") {
    ids = await WF.pendingIds(req, "SHEET");
    userIds = null;
    status = status || PENDING_STATUSES;
  } else if (scope === "all") {
    if (!H.hasCode(access, "APPROVE_BUSINESS_PLAN")) throw new HttpError(403, "You do not have permission to view all target sheets");
    userIds = null;
  } else throw new HttpError(400, "scope must be mine, team, pending or all");

  let quarter;
  if (req.query.quarter !== undefined && req.query.quarter !== "") {
    quarter = Number(String(req.query.quarter).replace(/^Q/i, ""));
    if (![1, 2, 3, 4].includes(quarter)) throw new HttpError(400, "quarter must be 1, 2, 3 or 4");
  }
  const result = await sheet.listSheets({
    userIds,
    ids,
    status,
    financialYear: H.text(req.query.financial_year, "financial_year", { max: 20 }) || undefined,
    quarter,
    search: H.text(req.query.search, "search", { max: 100 }),
    page: req.query.page,
    limit: req.query.limit,
  });
  result.items = result.items.map(withQuarter);
  return ok(res, result);
});

const getSheet = wrap(async (req, res) => {
  const sh = await loadSheet(req);
  return respond(req, res, sh);
});

// GET /target-sheets/:id/approval-history -> levels of the current round + every decision
const getSheetHistory = wrap(async (req, res) => {
  const sh = await loadSheet(req);
  const approval = await sheetApproval(req, sh);
  return ok(res, WF.approvalBlock(approval.state, approval.auth));
});

// POST /target-sheets { values, tables, acknowledged, financial_year, quarter, user_id? }
const createSheet = wrap(async (req, res) => {
  const body = req.body || {};
  let userId = req.user.id;
  if (body.user_id !== undefined && Number(body.user_id) !== req.user.id) {
    userId = H.toId(body.user_id, "employee");
    const visible = await H.visibleIds(req);
    if (!H.canSeeUser(visible, userId)) throw new HttpError(403, "You can create sheets only for yourself or your team");
  }
  const record = await buildRecord(userId, readForm(body), { source: "PLAN" });
  const id = await sheet.createSheet(record, req.user.id);
  return respond(req, res, await sheet.getSheet(id), "Draft saved", 201);
});

const updateSheet = wrap(async (req, res) => {
  const sh = await loadSheet(req);
  if (!isOwner(req, sh)) throw new HttpError(403, "Only the employee can edit this sheet");
  if (!EDITABLE_STATUSES.includes(sh.status)) {
    throw new HttpError(409, `This sheet is ${sh.status_label}; it can be edited only as Draft or Returned`);
  }
  const record = await buildRecord(sh.user_id, readForm(req.body || {}), { existing: sh, source: sh.target_source });
  await sheet.updateSheet(sh.id, record);
  return respond(req, res, await sheet.getSheet(sh.id), "Draft saved");
});

// POST /target-sheets/:id/submit  (optionally with the latest form in the body)
const submitSheet = wrap(async (req, res) => {
  let sh = await loadSheet(req);
  if (!isOwner(req, sh)) throw new HttpError(403, "Only the employee can submit this sheet");
  if (!EDITABLE_STATUSES.includes(sh.status)) throw new HttpError(409, `This sheet is already ${sh.status_label}`);

  const body = req.body || {};
  if (body.values || body.tables) {
    await sheet.updateSheet(sh.id, await buildRecord(sh.user_id, readForm(body), { existing: sh, source: sh.target_source }));
    sh = await sheet.getSheet(sh.id);
  }

  let levels;
  let qt = null;
  if (sh.is_legacy) {
    const errors = legacySubmitErrors(sh, await loadDropdowns());
    if (errors.length) {
      throw new HttpError(400, errors.length === 1 ? errors[0].message : `${errors[0].message} (and ${errors.length - 1} more)`, { errors });
    }
    levels = await WF.chainFor(sh.user_id, { excludeIds: sh.created_by !== sh.user_id ? [sh.created_by] : [] });
  } else {
    qt = sh.financial_year && sh.quarter ? await QT.quarterTargets(sh.user_id, sh.financial_year, sh.quarter, H.quarterBounds(sh.financial_year, sh.quarter)) : null;
    const errors = planSubmitErrors(sh, qt, await SP.countBlocking(sh.id));
    if (errors.length) {
      throw new HttpError(400, errors.length === 1 ? errors[0].message : `${errors[0].message} (and ${errors.length - 1} more)`, { errors });
    }
    levels = await WF.sheetChainFor(sh.user_id, { excludeIds: sh.created_by !== sh.user_id ? [sh.created_by] : [] });
  }
  const first = levels[0];
  // a resubmitted sheet starts clean: earlier approval stamps are cleared
  const values = { ...sh.values, mgrName: "", mgrDate: "", apprName: "", apprDate: "" };
  const r = await sheet.moveSheet(sh.id, {
    allowedFrom: EDITABLE_STATUSES,
    to: "SUBMITTED",
    sets: [
      "submitted_at = NOW()", "manager_id = ?", "return_remark = NULL", "manager_approved_by = NULL",
      "manager_approved_at = NULL", "approved_by = NULL", "approved_at = NULL", "form_values = ?",
      "targets_outdated = 0", "outdated_reason = NULL",
    ],
    params: [first && first.approver_id ? first.approver_id : null, JSON.stringify(values)],
    extra: async (conn) => {
      await AP.createRound(conn, "SHEET", sh.id, levels);
      // the plan revisions this sheet was submitted on
      if (qt) await SP.replaceLinks(conn, sh.id, qt.links);
    },
  });
  if (!r.ok) throw new HttpError(409, "This sheet was already submitted");
  const updated = await sheet.getSheet(sh.id);
  await WF.notifySubmitted(sheetItem(updated), await WF.getState("SHEET", sh.id));
  return respond(req, res, updated, first && first.approver_name ? `Submitted for approval to ${first.approver_name}` : "Submitted for approval");
});

// POST /target-sheets/:id/approve — the approver of the current level, or an admin (final).
const approveSheet = wrap(async (req, res) => {
  const sh = await loadSheet(req);
  if (!PENDING_STATUSES.includes(sh.status)) throw new HttpError(409, `This sheet is ${sh.status_label}`);
  if (!sh.is_legacy && sh.targets_outdated) {
    throw new HttpError(409, "The Business Plan targets changed after this sheet was submitted. Return it so the employee acknowledges the new targets.");
  }
  const { state, auth } = await sheetApproval(req, sh);
  if (!auth || !auth.can) throw new HttpError(403, (auth && auth.reason) || "You are not allowed to approve this sheet");
  const step = state.current;
  const final = !!auth.final;
  const me = await s.getEmployee(req.user.id);
  const myName = me ? me.name : "";
  const today = appDate(H.todayIST());
  const values = { ...sh.values };
  const sets = [];
  const params = [];

  // Reporting Manager Name / Date: the level-1 approver (the employee's reporting manager)
  if (step.level_no === 1 && auth.as === "APPROVER" && step.approver_kind !== "ADMIN") {
    values.mgrName = myName;
    values.mgrDate = today;
    sets.push("manager_approved_by = ?", "manager_approved_at = NOW()");
    params.push(req.user.id);
  }
  // Authorized Company Approver / Date: the final approval (RSM or admin)
  if (final) {
    values.apprName = myName;
    values.apprDate = today;
    sets.push("approved_by = ?", "approved_at = NOW()");
    params.push(req.user.id);
  }
  // PLAN sheet, final approval: freeze the quarter targets (signed version)
  let snapshot = null;
  if (final && !sh.is_legacy) {
    snapshot = await QT.quarterTargets(sh.user_id, sh.financial_year, sh.quarter, H.quarterBounds(sh.financial_year, sh.quarter));
    if (!snapshot.plans.length) throw new HttpError(409, "No approved Business Plan covers this quarter any more; return the sheet");
    sets.push("target_snapshot = ?", "snapshot_at = NOW()", "total_sales = ?", "total_collection = ?");
    params.push(JSON.stringify(snapshot), snapshot.summary.quarter_sales_target, snapshot.summary.quarter_collection_target);
    values.totalSales = Number(snapshot.summary.quarter_sales_target).toFixed(2);
  }
  sets.push("form_values = ?");
  params.push(JSON.stringify(values));

  const remark = H.text(req.body && (req.body.remark ?? req.body.comment), "Comment", { max: 500 }) || null;
  const result = await sheet.moveSheet(sh.id, {
    allowedFrom: PENDING_STATUSES,
    to: final ? "APPROVED" : "MANAGER_APPROVED",
    sets,
    params,
    extra: async (conn) => {
      const r = await WF.applyDecision(conn, "SHEET", sh.id, {
        expectedStepId: step.id,
        decision: "APPROVE",
        actorId: req.user.id,
        actedAs: auth.as,
        remark,
        final,
      });
      if (snapshot) {
        await SP.replaceLinks(conn, sh.id, snapshot.links);
        const [[row]] = await conn.query(
          `SELECT manager_approved_by, DATE_FORMAT(manager_approved_at, '%Y-%m-%d %H:%i:%s') AS manager_approved_at,
                  DATE_FORMAT(approved_at, '%Y-%m-%d %H:%i:%s') AS approved_at
           FROM bp_target_sheets WHERE id = ?`,
          [sh.id],
        );
        await SP.insertVersion(conn, {
          sheet_id: sh.id,
          version_no: sh.version_no,
          target_source: "PLAN",
          archived_reason: "APPROVED",
          values,
          tables: sh.tables,
          target_snapshot: snapshot,
          plan_links: snapshot.links,
          manager_approved_by: row ? row.manager_approved_by : null,
          manager_approved_at: row ? row.manager_approved_at : null,
          approved_by: req.user.id,
          approved_at: row ? row.approved_at : null,
          created_by: req.user.id,
        });
      }
      return r;
    },
  });
  if (!result.ok) throw new HttpError(409, "This sheet was already decided");
  await WF.notifyDecision(sheetItem(sh), state, { decision: "APPROVE", actorId: req.user.id, actorName: myName || "the approver", result: result.extra, remark });
  const updated = await sheet.getSheet(sh.id);
  const message = final
    ? "Target sheet approved (final approval)"
    : `Approved at Level ${step.level_no}. Sent to ${updated.pending_with || "the next approver"} for Level ${step.level_no + 1}.`;
  return respond(req, res, updated, message);
});

const returnSheet = wrap(async (req, res) => {
  const sh = await loadSheet(req);
  if (!PENDING_STATUSES.includes(sh.status)) throw new HttpError(409, `This sheet is ${sh.status_label}`);
  const { state, auth } = await sheetApproval(req, sh);
  if (!auth || !auth.can) throw new HttpError(403, (auth && auth.reason) || "You are not allowed to return this sheet");
  const remark = H.text(req.body && (req.body.remark ?? req.body.comment), "Comment", { max: 500 }) || "";
  if (remark.length < 3) throw new HttpError(400, "Please add a comment");
  const r = await sheet.moveSheet(sh.id, {
    allowedFrom: PENDING_STATUSES,
    to: "RETURNED",
    sets: ["return_remark = ?"],
    params: [remark],
    extra: (conn) => WF.applyDecision(conn, "SHEET", sh.id, {
      expectedStepId: state.current.id,
      decision: "RETURN",
      actorId: req.user.id,
      actedAs: auth.as,
      remark,
      final: false,
    }),
  });
  if (!r.ok) throw new HttpError(409, "This sheet was already decided");
  const me = await s.getEmployee(req.user.id);
  await WF.notifyDecision(sheetItem(sh), state, { decision: "RETURN", actorId: req.user.id, actorName: me ? me.name : "the approver", result: r.extra, remark });
  return respond(req, res, await sheet.getSheet(sh.id), "Returned to the employee");
});

const deleteSheet = wrap(async (req, res) => {
  const sh = await loadSheet(req);
  if (!isOwner(req, sh)) throw new HttpError(403, "Only the employee can delete this sheet");
  if (!EDITABLE_STATUSES.includes(sh.status)) throw new HttpError(409, "Only a Draft or Returned sheet can be deleted");
  if (sh.version_no > 1) throw new HttpError(409, "This sheet has signed versions; it cannot be deleted");
  await sheet.softDeleteSheet(sh.id);
  return ok(res, { id: sh.id }, "Target sheet deleted");
});

// ---------------------------------------------------------------------
//  VERSIONS: re-acknowledge after a plan revision, move a legacy sheet to plan targets
// ---------------------------------------------------------------------
// POST /target-sheets/:id/reacknowledge — APPROVED + targets changed -> new version (DRAFT).
// The signed version stays in bp_target_sheet_versions, unchanged.
const reacknowledge = wrap(async (req, res) => {
  const sh = await loadSheet(req);
  if (sh.is_legacy) throw new HttpError(409, "This is a legacy sheet; use 'Move to Business Plan targets' instead");
  if (!isOwner(req, sh)) throw new HttpError(403, "Only the employee can acknowledge new targets");
  if (sh.status !== "APPROVED" || !sh.targets_outdated) throw new HttpError(409, "Only an approved sheet whose targets changed needs a new acknowledgement");
  const values = { ...sh.values, mgrName: "", mgrDate: "", apprName: "", apprDate: "", ack: "0" };
  const r = await sheet.moveSheet(sh.id, {
    allowedFrom: ["APPROVED"],
    to: "DRAFT",
    sets: [
      "version_no = version_no + 1", "targets_outdated = 0", "outdated_reason = NULL", "target_snapshot = NULL",
      "snapshot_at = NULL", "acknowledged = 0", "manager_approved_by = NULL", "manager_approved_at = NULL",
      "approved_by = NULL", "approved_at = NULL", "return_remark = NULL", "form_values = ?",
    ],
    params: [JSON.stringify(values)],
  });
  if (!r.ok) throw new HttpError(409, "This sheet changed meanwhile; refresh and try again");
  return respond(req, res, await sheet.getSheet(sh.id), `Version ${sh.version_no + 1} created with the revised targets. Review, acknowledge and submit it.`);
});

// POST /target-sheets/:id/rebase — controlled move of a LEGACY sheet to plan targets.
// Its original JSON (values + tables) is first stored as a version; nothing is lost.
const rebaseSheet = wrap(async (req, res) => {
  const sh = await loadSheet(req);
  const access = await H.getAccess(req);
  if (!sh.is_legacy) throw new HttpError(409, "This sheet already uses Business Plan targets");
  if (!isOwner(req, sh) && !access.isAdmin) throw new HttpError(403, "Only the employee or an admin can move this sheet to Business Plan targets");
  if (!["DRAFT", "RETURNED", "APPROVED"].includes(sh.status)) {
    throw new HttpError(409, `This sheet is ${sh.status_label}; it can be moved after the approvers decide`);
  }
  if (!sh.financial_year || !sh.quarter) throw new HttpError(409, "This old sheet has no quarter; it cannot be linked to plan targets");
  const kept = planOnlyForm({ values: sh.values || {}, tables: sh.tables || {}, acknowledged: false });
  const values = { ...kept.values, mgrName: "", mgrDate: "", apprName: "", apprDate: "", ack: "0" };
  const conn = await db.getConnection();
  try {
    await conn.beginTransaction();
    const [[row]] = await conn.query(`SELECT status, version_no, target_source FROM bp_target_sheets WHERE id = ? FOR UPDATE`, [sh.id]);
    if (!row || row.target_source === "PLAN" || row.status !== sh.status) throw new HttpError(409, "This sheet changed meanwhile; refresh and try again");
    await SP.insertVersion(conn, {
      sheet_id: sh.id,
      version_no: sh.version_no,
      target_source: "LEGACY",
      archived_reason: sh.status === "APPROVED" ? "LEGACY_APPROVED" : "LEGACY_REBASE",
      values: sh.values,
      tables: sh.tables,
      target_snapshot: null,
      plan_links: [],
      manager_approved_by: sh.manager_approved_by,
      manager_approved_at: sh.manager_approved_at,
      approved_by: sh.approved_by,
      approved_at: sh.approved_at,
      created_by: req.user.id,
    });
    await conn.query(
      `UPDATE bp_target_sheets
       SET target_source = 'PLAN', version_no = version_no + 1, status = 'DRAFT', acknowledged = 0,
           manager_approved_by = NULL, manager_approved_at = NULL, approved_by = NULL, approved_at = NULL,
           return_remark = NULL, targets_outdated = 0, outdated_reason = NULL, target_snapshot = NULL, snapshot_at = NULL,
           form_values = ?, form_tables = ?
       WHERE id = ?`,
      [JSON.stringify(values), JSON.stringify(kept.tables), sh.id],
    );
    await conn.commit();
  } catch (err) {
    await conn.rollback();
    throw err;
  } finally {
    conn.release();
  }
  return respond(req, res, await sheet.getSheet(sh.id), "The old sheet is kept as a version. This sheet now uses your approved Business Plan targets.");
});

// GET /target-sheets/:id/versions/:no — one signed (or archived legacy) version
const getVersion = wrap(async (req, res) => {
  const sh = await loadSheet(req);
  const no = H.toId(req.params.versionNo, "version number");
  const v = await SP.getVersion(sh.id, no);
  if (!v) throw new HttpError(404, "Version not found");
  return ok(res, v);
});

// ---------------------------------------------------------------------
//  TARGET REVISION REQUESTS (employee disagrees with a target)
// ---------------------------------------------------------------------
const REQUEST_AREAS = ["SALES", "COLLECTION", "ABS", "PRODUCT", "DISTRIBUTOR", "RETAILER", "DEVELOPMENT", "OTHER"];

const readRequestItems = (list) => {
  if (list === undefined || list === null) return [];
  if (!Array.isArray(list)) throw new HttpError(400, "items must be a list");
  if (list.length > 50) throw new HttpError(400, "Too many items");
  return list.map((x, i) => {
    const area = H.oneOf(x && x.area, `Item ${i + 1}: area`, REQUEST_AREAS) || "OTHER";
    return {
      area,
      label: H.text(x && x.label, `Item ${i + 1}: target`, { max: 200 }) || "",
      current: x && x.current !== undefined && x.current !== null ? String(x.current).slice(0, 40) : "",
      proposed: x && x.proposed !== undefined && x.proposed !== null ? String(x.proposed).slice(0, 40) : "",
      remark: H.text(x && x.remark, `Item ${i + 1}: remark`, { max: 300 }) || "",
    };
  });
};

// POST /target-sheets/:id/revision-requests { plan_id?, items: [...], remark }
const createRevisionRequest = wrap(async (req, res) => {
  const sh = await loadSheet(req);
  if (sh.is_legacy) throw new HttpError(409, "Legacy sheets have typed targets; move the sheet to Business Plan targets first");
  if (sh.user_id !== req.user.id) throw new HttpError(403, "Only the employee can request a target revision");
  const body = req.body || {};
  const remark = H.text(body.remark ?? body.comment, "Remark", { required: true, max: 1000 }) || "";
  if (remark.length < 5) throw new HttpError(400, "Explain which target you disagree with and why");
  const items = readRequestItems(body.items);
  const qt = await QT.quarterTargets(sh.user_id, sh.financial_year, sh.quarter, H.quarterBounds(sh.financial_year, sh.quarter));
  if (!qt.plans.length) throw new HttpError(409, "No approved Business Plan covers this quarter yet");
  let planId = body.plan_id !== undefined && body.plan_id !== null && body.plan_id !== "" ? H.toId(body.plan_id, "plan") : null;
  if (planId && !qt.plans.some((p) => p.plan_id === planId)) throw new HttpError(400, "That plan is not one of this sheet's plans");
  if (!planId) {
    if (qt.plans.length > 1) throw new HttpError(400, "This quarter uses more than one plan: choose the plan the request is about");
    planId = qt.plans[0].plan_id;
  }
  const id = await SP.createRequest({ sheetId: sh.id, planId, userId: req.user.id, items, remark });
  const p = await plan.getPlan(planId);
  const emp = await s.getEmployee(sh.user_id);
  const recipients = [...new Set([p && p.created_by, emp && emp.reporting_under].filter((x) => x && x !== req.user.id))];
  await AP.notify(recipients.length ? recipients : await AP.adminUserIds(), {
    type: "BP_SHEET_REVISION_REQUESTED",
    refId: sh.id,
    title: "Target revision requested",
    message: `${emp ? emp.name : "An employee"} asks to revise targets of ${p ? p.plan_code : "a plan"} (${sh.quarter_label || `Q${sh.quarter}`} ${sh.financial_year}): ${remark}`,
  });
  return ok(res, await SP.getRequest(id), "Revision request sent. The plan targets change only if the Business Plan is revised and approved.", 201);
});

// who may decide a request: admin, whoever may change the plan (creator, CREATE_BUSINESS_PLAN
// above the employee) or the employee's reporting manager — never the employee himself
const canDecideRequest = async (req, rq) => {
  if (rq.user_id === req.user.id || rq.requested_by === req.user.id) return false;
  const access = await H.getAccess(req);
  if (access.isAdmin) return true;
  const p = rq.plan_id ? await plan.getPlan(rq.plan_id) : null;
  if (p && (await H.canEditPlanOf(req, p))) return true;
  const emp = await s.getEmployee(rq.user_id);
  return !!(emp && emp.reporting_under === req.user.id);
};

// GET /target-revision-requests?scope=mine|pending|all
const listRevisionRequests = wrap(async (req, res) => {
  const scope = String(req.query.scope || "mine").toLowerCase();
  if (scope === "mine") return ok(res, await SP.listRequests({ userIds: [req.user.id] }));
  if (scope === "pending" || scope === "all") {
    const visible = await H.visibleIds(req);
    const rows = await SP.listRequests({
      userIds: visible === null ? null : visible.filter((id) => id !== req.user.id),
      status: scope === "pending" ? ["OPEN"] : undefined,
    });
    const out = [];
    for (const rq of rows) {
      const canDecide = rq.status === "OPEN" && (await canDecideRequest(req, rq));
      if (scope === "all" || canDecide) out.push({ ...rq, can_decide: canDecide });
    }
    return ok(res, out);
  }
  throw new HttpError(400, "scope must be mine, pending or all");
});

// POST /target-revision-requests/:requestId/decide { decision: ACCEPT | DECLINE, comment }
const decideRevisionRequest = wrap(async (req, res) => {
  const id = H.toId(req.params.requestId, "request id");
  const rq = await SP.getRequest(id);
  if (!rq) throw new HttpError(404, "Revision request not found");
  if (rq.status !== "OPEN") throw new HttpError(409, `This request is already ${rq.status_label}`);
  if (!(await canDecideRequest(req, rq))) throw new HttpError(403, "You cannot decide this revision request");
  const decision = String((req.body && req.body.decision) || "").toUpperCase();
  if (!["ACCEPT", "DECLINE"].includes(decision)) throw new HttpError(400, "decision must be ACCEPT or DECLINE");
  const comment = H.text(req.body && (req.body.comment ?? req.body.remark), "Comment", { max: 500 }) || "";
  if (decision === "DECLINE" && comment.length < 3) throw new HttpError(400, "Give the reason for declining");
  const moved = await SP.moveRequest(id, { from: ["OPEN"], to: decision === "ACCEPT" ? "ACCEPTED" : "DECLINED", userId: req.user.id, remark: comment });
  if (!moved) throw new HttpError(409, "This request was already decided");
  await AP.notify([rq.user_id], {
    type: "BP_SHEET_REVISION_DECIDED",
    refId: rq.sheet_id,
    title: decision === "ACCEPT" ? "Target revision accepted" : "Target revision declined",
    message: decision === "ACCEPT"
      ? `Your request on ${rq.plan_code || "the plan"} was accepted. The targets change when the plan revision is approved.${comment ? ` ${comment}` : ""}`
      : `Your request on ${rq.plan_code || "the plan"} was declined: ${comment}`,
  });
  return ok(res, await SP.getRequest(id), decision === "ACCEPT" ? "Accepted. Revise the Business Plan to change the targets." : "Declined");
});

// POST /target-revision-requests/:requestId/cancel — the employee withdraws an open request
const cancelRevisionRequest = wrap(async (req, res) => {
  const id = H.toId(req.params.requestId, "request id");
  const rq = await SP.getRequest(id);
  if (!rq) throw new HttpError(404, "Revision request not found");
  if (rq.requested_by !== req.user.id) throw new HttpError(403, "Only the employee who asked can cancel this request");
  const moved = await SP.moveRequest(id, { from: ["OPEN"], to: "CANCELLED", userId: req.user.id, remark: "Cancelled by the employee" });
  if (!moved) throw new HttpError(409, `This request is already ${rq.status_label}`);
  return ok(res, await SP.getRequest(id), "Request cancelled");
});

// ---------------------------------------------------------------------
//  MONTHLY PERFORMANCE REVIEW (actuals from CRM transactions only)
// ---------------------------------------------------------------------
const REVIEW_KPIS = [
  { kpi: "SALES", label: "Sales", unit: "money", source: "Sales invoices (net of GST, cancelled excluded)" },
  { kpi: "COLLECTION", label: "Total Collection", unit: "money", source: "Receipts (each receipt line once)" },
  { kpi: "CURRENT_COLLECTION", label: "Current Sales Collection", unit: "money", source: "Collection minus old outstanding recovery", info: true },
  { kpi: "OLD_RECOVERY", label: "Old Outstanding Recovery", unit: "money", source: "Receipts allocated against bills dated before 1 April of the financial year", info: true },
  { kpi: "ABS_BOOKING", label: "ABS Booking Value", unit: "money", source: "Approved Advance Bookings (net value)", abs: true },
  { kpi: "ABS_ADVANCE", label: "ABS Advance Collection", unit: "money", source: "Posted ABS advances (already part of Total Collection)", abs: true },
  { kpi: "NEW_DISTRIBUTORS", label: "New Active Distributors", unit: "count", source: "Distributors under you with their first invoice in the month" },
  { kpi: "NEW_RETAILERS", label: "New Retailers", unit: "count", source: "Retailers created by you" },
  { kpi: "DISTRIBUTOR_MEETINGS", label: "Distributor Meetings", unit: "count", source: "Visit records (distributor visits)", activity: "dm" },
  { kpi: "RETAILER_VISITS", label: "Retailer / Market Visits", unit: "count", source: "Visit records (retailer visits)", activity: "rv" },
  { kpi: "FARMER_MEETINGS", label: "Farmer / Dealer Meetings", unit: "count", source: "Visit records (farmer visits)", activity: "fm" },
];
const pctOf = (a, t) => (Number(t) > 0 ? Math.round((Number(a) / Number(t)) * 100) : null);

const buildReview = async (sh) => {
  if (sh.is_legacy) return null;
  const bounds = H.quarterBounds(sh.financial_year, sh.quarter);
  if (!bounds) return null;
  const targets = await sheetTargets(sh);
  const months = targets.months.map((m) => m.month);
  const planIds = (sh.status === "APPROVED" && targets.links ? targets.links : targets.plans.map((p) => ({ plan_id: p.plan_id }))).map((l) => l.plan_id);
  const fyStart = fyStartOf(sh.financial_year);
  const [combined, activity, absEnabled, reasons] = await Promise.all([
    actuals.getCombinedMonthly(planIds, bounds.from, bounds.to, fyStart),
    actuals.getEmployeeActivityMonthly(sh.user_id, bounds.from, bounds.to),
    ABS.isInstalled(),
    plan.listSheetReviewActions(sh.id),
  ]);
  const absMonthly = absEnabled ? await ABS.monthlyActuals(sh.user_id, bounds.from, bounds.to) : new Map();
  const reasonMap = new Map(reasons.map((r) => [`${String(r.review_month || "").slice(0, 7)}|${r.kpi}`, r]));
  const v = sh.values || {};
  const devMonth = (key) => Math.round((Number(targets.development[key] || 0) / 3) * 100) / 100;

  const rows = [];
  months.forEach((ym, i) => {
    const c = combined.get(ym) || { sales: 0, collection: 0, old_recovery: 0, current_collection: 0 };
    const a = activity.get(ym) || {};
    const ab = absMonthly.get(ym) || { booking: 0, advance: 0 };
    for (const k of REVIEW_KPIS) {
      if (k.abs && !absEnabled) continue;
      let target = null;
      let actual = 0;
      switch (k.kpi) {
        case "SALES": target = targets.kpis.sales[i]; actual = c.sales; break;
        case "COLLECTION": target = targets.kpis.collection[i]; actual = c.collection; break;
        case "CURRENT_COLLECTION": actual = c.current_collection; break;
        case "OLD_RECOVERY": actual = c.old_recovery; break;
        case "ABS_BOOKING": target = targets.kpis.abs_booking[i]; actual = ab.booking; break;
        case "ABS_ADVANCE": target = targets.kpis.abs_advance[i]; actual = ab.advance; break;
        case "NEW_DISTRIBUTORS": target = devMonth("quarter_new_distributor_target"); actual = a.new_distributors || 0; break;
        case "NEW_RETAILERS": target = devMonth("quarter_new_retailer_target"); actual = a.new_retailers || 0; break;
        case "DISTRIBUTOR_MEETINGS": target = isNumber(v[`kpi.dm.m${i + 1}`]) ? n(v[`kpi.dm.m${i + 1}`]) : null; actual = a.distributor_visits || 0; break;
        case "RETAILER_VISITS": target = isNumber(v[`kpi.rv.m${i + 1}`]) ? n(v[`kpi.rv.m${i + 1}`]) : null; actual = a.retailer_visits || 0; break;
        case "FARMER_MEETINGS": target = isNumber(v[`kpi.fm.m${i + 1}`]) ? n(v[`kpi.fm.m${i + 1}`]) : null; actual = a.farmer_visits || 0; break;
        default: break;
      }
      const r = reasonMap.get(`${ym}|${k.kpi}`);
      const percent = pctOf(actual, target);
      rows.push({
        month: ym,
        label: T.monthLabel(ym),
        kpi: k.kpi,
        kpi_label: k.label,
        unit: k.unit,
        target_kind: k.activity ? "COMMITMENT" : target === null ? "NONE" : "PLAN",
        target,
        actual,
        achievement_percent: percent,
        gap: target !== null && Number(target) > 0 && actual < target,
        source: k.source,
        verified: true,
        reason: r ? r.reason : null,
        action_required: r ? r.action_required : null,
        corrective_action_id: r ? r.id : null,
        due_date: r ? r.due_date : null,
      });
    }
  });
  // employee-reported retailer business (not verified): shown for information only (D5)
  const [ret] = await db.query(
    `SELECT COALESCE(SUM(reported_actual), 0) AS amount FROM bp_retailer_lines WHERE plan_id IN (?)`,
    [planIds.length ? planIds : [0]],
  );
  return {
    months: targets.months,
    abs_enabled: absEnabled,
    frozen_targets: !!targets.frozen,
    rows,
    reported_retailer_business: {
      amount: Number((ret[0] && ret[0].amount) || 0),
      verified: false,
      note: "Reported by the employee in the Business Plan; not from transactions and not part of any achievement.",
    },
    rules: [
      "Actual figures come from CRM transactions and visit records; they cannot be typed or overwritten.",
      "When plans overlap, an invoice or receipt is counted once.",
      "ABS advances are receipts: they are already inside Total Collection.",
      "You enter only the reason for a gap and the corrective action.",
    ],
  };
};

const getReview = wrap(async (req, res) => {
  const sh = await loadSheet(req);
  if (sh.is_legacy) throw new HttpError(409, "Legacy sheets have a typed review; move the sheet to Business Plan targets to use the CRM review");
  return ok(res, await buildReview(sh));
});

// PUT /target-sheets/:id/review { items: [{ month: 'YYYY-MM', kpi, reason, action_required, due_date? }] }
// Only reasons and corrective actions are accepted; any target / actual in the body is ignored.
const saveReview = wrap(async (req, res) => {
  const sh = await loadSheet(req);
  if (sh.is_legacy) throw new HttpError(409, "Legacy sheets have a typed review");
  if (sh.user_id !== req.user.id) throw new HttpError(403, "Only the employee writes the review reasons");
  if (sh.status !== "APPROVED") throw new HttpError(409, "The monthly review starts after the sheet is approved");
  const items = req.body && req.body.items;
  if (!Array.isArray(items) || !items.length) throw new HttpError(400, "items are required");
  if (items.length > 60) throw new HttpError(400, "Too many items");
  const bounds = H.quarterBounds(sh.financial_year, sh.quarter);
  const months = new Set(bounds.months.map((m) => `${m.year}-${String(m.month).padStart(2, "0")}`));
  const kpis = new Map(REVIEW_KPIS.map((k) => [k.kpi, k]));
  const links = await SP.listLinks(sh.id);
  if (!links.length) throw new HttpError(409, "This sheet has no linked Business Plan");
  const clean = [];
  for (const [i, x] of items.entries()) {
    const month = String((x && x.month) || "").slice(0, 7);
    if (!months.has(month)) throw new HttpError(400, `Item ${i + 1}: month must be in the sheet's quarter`);
    const k = kpis.get(String((x && x.kpi) || "").toUpperCase());
    if (!k) throw new HttpError(400, `Item ${i + 1}: unknown KPI`);
    const reason = H.text(x.reason, `Item ${i + 1}: reason`, { required: true, max: 100 });
    if (!(await s.isActiveOption("GAP_REASON", reason))) throw new HttpError(400, `Item ${i + 1}: select a reason from the list`);
    const action = H.text(x.action_required ?? x.action, `Item ${i + 1}: corrective action`, { required: true, max: 1000 });
    if (!action) throw new HttpError(400, `Item ${i + 1}: describe the corrective action`);
    clean.push({
      plan_id: links[0].plan_id,
      sheet_id: sh.id,
      review_month: `${month}-01`,
      kpi: k.kpi,
      scope_label: `${sh.sheet_code} · ${k.label} · ${T.monthLabel(month)}`.slice(0, 200),
      reason,
      action_required: action,
      responsible_user_id: sh.user_id,
      due_date: H.date(x.due_date, `Item ${i + 1}: due date`) || null,
    });
  }
  for (const c of clean) await plan.saveSheetReviewAction(c, req.user.id);
  return ok(res, await buildReview(await sheet.getSheet(sh.id)), "Review saved");
});

module.exports = {
  prefill,
  getQuarterTargets,
  listSheets,
  getSheet,
  getSheetHistory,
  createSheet,
  updateSheet,
  submitSheet,
  approveSheet,
  returnSheet,
  deleteSheet,
  reacknowledge,
  rebaseSheet,
  getVersion,
  createRevisionRequest,
  listRevisionRequests,
  decideRevisionRequest,
  cancelRevisionRequest,
  getReview,
  saveReview,
  // for tests
  _totals: totals,
  _readForm: readForm,
  _submitErrors: legacySubmitErrors,
  _planOnlyForm: planOnlyForm,
};
