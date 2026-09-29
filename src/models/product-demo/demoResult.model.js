// models/product-demo/demoResult.model.js
// Per-customer Result 1 (sowing/germination) -> Result 2 (crop growth,
// dynamic fields) -> Result 3 (final evaluation) -> customer COMPLETED,
// then demo COMPLETED once every active customer is done.
const db = require('../../config/db');
const { HttpError } = require('./httpError');
const m = require('./productDemo.model');       // canApproveDemo, log, notifyUsers, uploadResultPhotos
const cropModel = require('./crop.model');       // getCropGrowthForm

const MAX_RESULTS = 3;
const MAX_RESULT_PHOTOS = m.MAX_RESULT_PHOTOS;
const OUTCOMES = ['POSITIVE', 'NEUTRAL', 'NEGATIVE'];

function optionalNumber(v, name, { min, max } = {}) {
  if (v === undefined || v === null || v === '') return null;
  const n = Number(v);
  if (!Number.isFinite(n) || (min !== undefined && n < min) || (max !== undefined && n > max)) {
    throw new HttpError(400, `Invalid ${name}`);
  }
  return n;
}

function optionalDate(v) {
  if (v === undefined || v === null || v === '') return null;
  if (!/^\d{4}-\d{2}-\d{2}$/.test(v) || Number.isNaN(Date.parse(v))) {
    throw new HttpError(400, 'result_date must be in YYYY-MM-DD format');
  }
  return v;
}

const YES_NO_MAYBE = ['YES', 'NO', 'MAYBE'];

function optionalEnum(v, name, allowed) {
  if (v === undefined || v === null || v === '') return null;
  const val = String(v).toUpperCase();
  if (!allowed.includes(val)) throw new HttpError(400, `${name} must be one of ${allowed.join(', ')}`);
  return val;
}

// -------- access / lookups --------

async function loadDemoAndCustomer(conn, demoId, customerId, { forUpdate = false } = {}) {
  const [[demo]] = await conn.query(
    `SELECT * FROM demo_requests WHERE id = ? ${forUpdate ? 'FOR UPDATE' : ''}`,
    [demoId]
  );
  if (!demo) throw new HttpError(404, 'Demo request not found');

  const [[cust]] = await conn.query(
    `SELECT * FROM demo_request_customers
      WHERE id = ? AND demo_id = ? ${forUpdate ? 'FOR UPDATE' : ''}`,
    [customerId, demoId]
  );
  if (!cust) throw new HttpError(404, 'This customer is not part of this demo');
  if (cust.is_removed) throw new HttpError(400, 'This customer was removed from the demo and cannot receive results');

  return { demo, cust };
}

async function checkResultAccess(conn, user, demo) {
  const approver = await m.canApproveDemo(conn, user, demo);
  const involved = demo.created_by === user.id || demo.field_officer_id === user.id;
  if (!approver && !involved) throw new HttpError(403, 'Not allowed to work with this demo');
  return { approver, involved };
}

// -------- crop assignment (Part 19: chosen at result stage) --------

async function setDemoCrop(demoId, cropId, user) {
  const conn = await db.getConnection();
  try {
    await conn.beginTransaction();
    const [[demo]] = await conn.query('SELECT * FROM demo_requests WHERE id = ? FOR UPDATE', [demoId]);
    if (!demo) throw new HttpError(404, 'Demo request not found');
    const { approver } = await checkResultAccess(conn, user, demo);

    if (demo.crop_id && !approver) {
      throw new HttpError(400, 'Crop is already set for this demo. Ask an approver to change it.');
    }
    const [[crop]] = await conn.query('SELECT id FROM crops WHERE id = ? AND is_active = 1', [cropId]);
    if (!crop) throw new HttpError(400, 'Invalid or inactive crop');

    await conn.query('UPDATE demo_requests SET crop_id = ? WHERE id = ?', [cropId, demoId]);
    await m.log(conn, demoId, user.id, 'CROP_SET', `Crop set to #${cropId}`);
    await conn.commit();
  } catch (e) {
    await conn.rollback();
    throw e;
  } finally {
    conn.release();
  }
}

// -------- Result-2 form (Part 22 GET) --------

async function getStageForm(demoId, customerId, user, stage) {
  const { demo, cust } = await loadDemoAndCustomer(db, demoId, customerId);
  await checkResultAccess(db, user, demo);

  if (!demo.crop_id) {
    return { crop_required: true, crop: null, fields: [], saved_values: [] };
  }
  const [[crop]] = await db.query('SELECT id, crop_name FROM crops WHERE id = ?', [demo.crop_id]);
  const fields = await cropModel.getCropGrowthForm(demo.crop_id, { resultStage: stage });

  const [[existingResult]] = await db.query(
    'SELECT id FROM demo_results WHERE demo_request_customer_id = ? AND result_no = ?',
    [customerId, stage]
  );
  let saved_values = [];
  if (existingResult) {
    const [vals] = await db.query(
      'SELECT crop_growth_field_mapping_id, field_value FROM demo_result_growth_values WHERE demo_result_id = ?',
      [existingResult.id]
    );
    saved_values = vals;
  }
  return { crop_required: false, crop, fields, saved_values, customer_results_count: cust.results_count };
}

async function getGrowthFieldsForm(demoId, customerId, user) {
  return getStageForm(demoId, customerId, user, 2);
}

async function getFinalEvaluationForm(demoId, customerId, user) {
  return getStageForm(demoId, customerId, user, 3);
}

// -------- validate + save dynamic growth values --------

async function validateAndPrepareGrowthValues(conn, cropId, growthValues, stage) {
  const fields = await cropModel.getCropGrowthForm(cropId, { resultStage: stage });
  const byMappingId = new Map(fields.map((f) => [f.mapping_id, f]));

  const submitted = Array.isArray(growthValues) ? growthValues : [];
  const seen = new Set();
  const prepared = [];

  for (const gv of submitted) {
    const mappingId = Number(gv.mapping_id);
    if (seen.has(mappingId)) throw new HttpError(400, `Duplicate value for field mapping ${mappingId}`);
    seen.add(mappingId);

    const field = byMappingId.get(mappingId);
    if (!field) throw new HttpError(400, `Field mapping ${mappingId} does not belong to this crop`);

    let raw = gv.value;
    if (raw === undefined || raw === null || raw === '') {
      if (field.is_required) throw new HttpError(400, `${field.field_name} is required`);
      continue; // skip empty optional fields
    }

    let stored;
    if (field.input_type === 'NUMBER') {
      const n = Number(raw);
      if (!Number.isFinite(n)) throw new HttpError(400, `${field.field_name} must be a number`);
      if (field.min_value !== null && n < field.min_value) throw new HttpError(400, `${field.field_name} must be >= ${field.min_value}`);
      if (field.max_value !== null && n > field.max_value) throw new HttpError(400, `${field.field_name} must be <= ${field.max_value}`);
      stored = field.decimal_places !== null ? n.toFixed(field.decimal_places) : String(n);
    } else if (field.input_type === 'BOOLEAN') {
      if (!['0', '1', 'true', 'false', 0, 1, true, false].includes(raw)) {
        throw new HttpError(400, `${field.field_name} must be true/false`);
      }
      stored = ['1', 'true', 1, true].includes(raw) ? '1' : '0';
    } else if (field.input_type === 'DATE') {
      stored = optionalDate(String(raw));
      if (!stored) throw new HttpError(400, `${field.field_name} must be a valid date`);
    } else if (field.input_type === 'DROPDOWN') {
      const valid = (field.options || []).some((o) => o.option_value === String(raw));
      if (!valid) throw new HttpError(400, `${field.field_name}: invalid option`);
      stored = String(raw);
    } else {
      stored = String(raw).slice(0, 255);
    }

    prepared.push({ mapping_id: mappingId, field_value: stored });
  }

  const missingRequired = fields.filter((f) => f.is_required && !seen.has(f.mapping_id));
  if (missingRequired.length) {
    throw new HttpError(400, `Missing required field(s): ${missingRequired.map((f) => f.field_name).join(', ')}`);
  }

  return prepared;
}

// -------- add a result (resultNo = 1, 2 or 3) --------

async function addResultForCustomer({ demoId, customerId, resultNo, body, files, user }) {
  resultNo = Number(resultNo);
  if (![1, 2, 3].includes(resultNo)) throw new HttpError(400, 'result number must be 1, 2 or 3');

  const b = body || {};
  files = files || [];

  if (!OUTCOMES.includes(b.outcome)) throw new HttpError(400, `outcome must be one of ${OUTCOMES.join(', ')}`);
  if (files.length > MAX_RESULT_PHOTOS) throw new HttpError(400, `Maximum ${MAX_RESULT_PHOTOS} photos allowed per result`);
  if (files.some((f) => !(f.mimetype || '').startsWith('image/'))) throw new HttpError(400, 'Only image files are allowed as result photos');

  const resultDate = optionalDate(b.result_date);
  const germination = optionalNumber(b.germination_pct, 'germination_pct', { min: 0, max: 100 });
  const yieldValue = optionalNumber(b.yield_value, 'yield_value', { min: 0 });
  const yieldUnit = (b.yield_unit || '').trim() || null;
  const remarks = (b.remarks || '').trim() || null;

  const conn = await db.getConnection();
  try {
    await conn.beginTransaction();

    const { demo, cust } = await loadDemoAndCustomer(conn, demoId, customerId, { forUpdate: true });
    await checkResultAccess(conn, user, demo);

    if (!['APPROVED', 'IN_PROGRESS'].includes(demo.status)) {
      throw new HttpError(400, `Results can be added only after approval (current status: ${demo.status})`);
    }
    if (cust.results_count >= MAX_RESULTS) throw new HttpError(400, `This customer already has all ${MAX_RESULTS} results`);
    if (resultNo !== cust.results_count + 1) {
      throw new HttpError(400, `Results must be submitted in order — next expected result is ${cust.results_count + 1}`);
    }

    // Result 2: dynamic crop-growth fields
    let growthPrepared = [];
    let extraCols = {};

    if (resultNo === 2 || resultNo === 3) {
      let cropIdForResult = demo.crop_id;
      if (!cropIdForResult) {
        if (!b.crop_id) throw new HttpError(400, `Set a crop for this demo before submitting Result ${resultNo}`);
        const [[crop]] = await conn.query('SELECT id FROM crops WHERE id = ? AND is_active = 1', [b.crop_id]);
        if (!crop) throw new HttpError(400, 'Invalid or inactive crop');
        await conn.query('UPDATE demo_requests SET crop_id = ? WHERE id = ?', [b.crop_id, demoId]);
        cropIdForResult = Number(b.crop_id);
      }
      const growthValues = typeof b.growth_values === 'string' ? JSON.parse(b.growth_values) : b.growth_values;
      growthPrepared = await validateAndPrepareGrowthValues(conn, cropIdForResult, growthValues, resultNo);
    }

     if (resultNo === 3) {
      extraCols = {
        harvest_date: optionalDate(b.harvest_date),
        crop_stage: (b.crop_stage || '').trim().slice(0, 50) || null,
        final_crop_condition: (b.final_crop_condition || '').trim().slice(0, 50) || null,
        harvested_area: optionalNumber(b.harvested_area, 'harvested_area', { min: 0 }),
        harvested_area_unit: (b.harvested_area_unit || '').trim().slice(0, 20) || null,
        total_production: optionalNumber(b.total_production, 'total_production', { min: 0 }),
        production_unit: (b.production_unit || '').trim().slice(0, 20) || null,
        satisfaction_rating: optionalNumber(b.satisfaction_rating, 'satisfaction_rating', { min: 1, max: 5 }),
        would_use_again: optionalEnum(b.would_use_again, 'would_use_again', YES_NO_MAYBE),
        would_recommend: optionalEnum(b.would_recommend, 'would_recommend', YES_NO_MAYBE),
        purchase_intention: optionalEnum(b.purchase_intention, 'purchase_intention', YES_NO_MAYBE),
        expected_next_qty: optionalNumber(b.expected_next_qty, 'expected_next_qty', { min: 0 }),
        expected_next_unit: (b.expected_next_unit || '').trim().slice(0, 20) || null,
        customer_feedback: (b.customer_feedback || '').trim() || null,
      };
    }


   

    const photos = await m.uploadResultPhotos(files);
    const ec = extraCols;

    const [ins] = await conn.query(
      `INSERT INTO demo_results
        (demo_id, demo_request_customer_id, result_no, result_date, outcome,
         germination_pct, yield_value, yield_unit, remarks, photos,
         harvest_date, crop_stage, final_crop_condition, harvested_area, harvested_area_unit,
         total_production, production_unit, satisfaction_rating, would_use_again, would_recommend,
         purchase_intention, expected_next_qty, expected_next_unit, customer_feedback,
         created_by)
       VALUES (?,?,?,COALESCE(?, CURDATE()),?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
      [
        demoId, customerId, resultNo, resultDate, b.outcome, germination, yieldValue, yieldUnit, remarks, JSON.stringify(photos),
        ec.harvest_date ?? null, ec.crop_stage ?? null, ec.final_crop_condition ?? null,
        ec.harvested_area ?? null, ec.harvested_area_unit ?? null,
        ec.total_production ?? null, ec.production_unit ?? null,
        ec.satisfaction_rating ?? null, ec.would_use_again ?? null, ec.would_recommend ?? null,
        ec.purchase_intention ?? null, ec.expected_next_qty ?? null, ec.expected_next_unit ?? null,
        ec.customer_feedback ?? null,
        user.id,
      ]
    );
    const resultId = ins.insertId;

    if ((resultNo === 2 || resultNo === 3) && growthPrepared.length) {
      const values = growthPrepared.map((g) => [resultId, g.mapping_id, g.field_value]);
      await conn.query(
        'INSERT INTO demo_result_growth_values (demo_result_id, crop_growth_field_mapping_id, field_value) VALUES ?',
        [values]
      );
    }

    const newCustomerStatus = resultNo >= MAX_RESULTS ? 'COMPLETED' : 'IN_PROGRESS';
    await conn.query(
      'UPDATE demo_request_customers SET results_count = ?, result_status = ? WHERE id = ?',
      [resultNo, newCustomerStatus, customerId]
    );

    // demo-level status progression
    const [[{ total, done }]] = await conn.query(
      `SELECT COUNT(*) AS total, SUM(result_status = 'COMPLETED') AS done
         FROM demo_request_customers WHERE demo_id = ? AND is_removed = 0`,
      [demoId]
    );
    let newDemoStatus = demo.status;
    if (Number(done) > 0 && Number(done) === Number(total)) {
      newDemoStatus = 'COMPLETED';
    } else if (demo.status === 'APPROVED') {
      newDemoStatus = 'IN_PROGRESS';
    }
    if (newDemoStatus !== demo.status) {
      await conn.query('UPDATE demo_requests SET status = ? WHERE id = ?', [newDemoStatus, demoId]);
    }

    await m.log(
      conn, demoId, user.id, 'RESULT_ADDED',
      `Customer #${customerId}: result ${resultNo} of ${MAX_RESULTS} (${b.outcome})`
    );

    const approverIds = await m.getApproverIds(conn, user.id);
    await conn.commit();

    const notifyIds = [...approverIds, demo.created_by, demo.field_officer_id].filter((id) => id && id !== user.id);
    m.notifyUsers(notifyIds, {
      demoId,
      type: 'DEMO_RESULT',
      title: `Demo result ${resultNo} of ${MAX_RESULTS}`,
      message: `${demo.demo_no}: customer #${customerId} — ${b.outcome}${newDemoStatus === 'COMPLETED' ? ' (demo closed)' : ''}`,
    }).catch((e) => console.error('[demo notify]', e));

    return {
      result_id: resultId,
      result_no: resultNo,
      customer_status: newCustomerStatus,
      demo_status: newDemoStatus,
      photo_count: photos.length,
    };
  } catch (e) {
    await conn.rollback();
    throw e;
  } finally {
    conn.release();
  }
}

// -------- read results for one customer --------

const parsePhotos = (v) => {
  if (!v) return [];
  if (typeof v === 'string') { try { return JSON.parse(v); } catch { return []; } }
  return v;
};

async function attachExtras(row) {
  const photos = parsePhotos(row.photos);
  const photo_urls = await Promise.all(photos.map((p) => m.signPathSafe ? m.signPathSafe(p) : null));
  let growth_values = [];
  if (row.result_no === 2) {
    const [vals] = await db.query(
      `SELECT v.field_value, fm.field_id, f.field_code, f.field_name, f.input_type, fm.unit_override, f.default_unit
         FROM demo_result_growth_values v
         JOIN crop_growth_field_mapping fm ON fm.id = v.crop_growth_field_mapping_id
         JOIN crop_growth_fields f ON f.id = fm.field_id
        WHERE v.demo_result_id = ?
        ORDER BY fm.display_order ASC`,
      [row.id]
    );
    growth_values = vals.map((v) => ({ ...v, unit: v.unit_override || v.default_unit }));
  }
  return { ...row, photos, photo_urls, growth_values };
}

async function getResultsForCustomer(demoId, customerId, user) {
  const { demo } = await loadDemoAndCustomer(db, demoId, customerId);
  await checkResultAccess(db, user, demo);

  const [rows] = await db.query(
    `SELECT r.*, u.name AS submitted_by_name
       FROM demo_results r LEFT JOIN users u ON u.id = r.created_by
      WHERE r.demo_request_customer_id = ?
      ORDER BY r.result_no`,
    [customerId]
  );
  return Promise.all(rows.map(attachExtras));
}

// All active customers of a demo with their result progress (for the
// admin/employee "who still needs a result" view).
async function listDemoCustomersWithProgress(demoId) {
  const [rows] = await db.query(
    `SELECT dc.id, dc.party_type, dc.party_id, dc.is_primary, dc.parent_customer_id,
            dc.allocated_qty, dc.results_count, dc.result_status,
            c.name AS party_name, c.firm_name AS party_firm_name
       FROM demo_request_customers dc
       JOIN customers c ON c.id = dc.party_id
      WHERE dc.demo_id = ? AND dc.is_removed = 0
      ORDER BY dc.is_primary DESC, dc.id ASC`,
    [demoId]
  );
  return rows;
}

// Employee-facing: every (demo, customer) pair still awaiting a result,
// across all of this employee's approved/in-progress demos.
async function getMyPendingResultCustomers(userId, { search = '', page = 1, limit = 50 } = {}) {
  const lim = Math.min(Number(limit) || 50, 100);
  const off = (Math.max(Number(page), 1) - 1) * lim;
  const where = [
    "d.status IN ('APPROVED','IN_PROGRESS')",
    "dc.is_removed = 0",
    "dc.result_status != 'COMPLETED'",
    '(d.created_by = ? OR d.field_officer_id = ?)',
  ];
  const vals = [userId, userId];
  if (search) {
    where.push('(d.demo_no LIKE ? OR c.name LIKE ?)');
    vals.push(`%${search}%`, `%${search}%`);
  }
  const [rows] = await db.query(
    `SELECT dc.id AS demo_customer_id, dc.party_type, dc.results_count, dc.results_count + 1 AS next_result_no,
            c.name AS party_name, c.firm_name AS party_firm_name,
            d.id AS demo_id, d.demo_no, d.demo_type, d.village, d.district, d.approved_at, d.followup_reminder_date
       FROM demo_request_customers dc
       JOIN demo_requests d ON d.id = dc.demo_id
       JOIN customers c ON c.id = dc.party_id
      WHERE ${where.join(' AND ')}
      ORDER BY (d.followup_reminder_date IS NULL), d.followup_reminder_date ASC, d.approved_at DESC
      LIMIT ? OFFSET ?`,
    [...vals, lim, off]
  );
  return rows;
}

module.exports = {
  HttpError, MAX_RESULTS, MAX_RESULT_PHOTOS,
  setDemoCrop, getGrowthFieldsForm, addResultForCustomer,
  getResultsForCustomer, listDemoCustomersWithProgress, getMyPendingResultCustomers, getFinalEvaluationForm
};