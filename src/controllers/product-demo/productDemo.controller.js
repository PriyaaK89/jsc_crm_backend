// controllers/demoController.js
// STEP 3: business logic for the Product Demo module

const m = require('../../models/product-demo/productDemo.model');

const { db, HttpError, MAX_RESULTS, MAX_RESULT_PHOTOS, RESULT_ELIGIBLE_STATUSES, PARTY_TABLE, PARTY_NAME_COL } = m;

const DEMO_TYPES = ['FARMER_FIELD', 'RETAILER_COUNTER', 'DISTRIBUTOR_TRIAL', 'COMPETITOR_COMPARISON'];
const SOIL_TYPES = ['LOAMY', 'SANDY', 'CLAY', 'BLACK_COTTON'];
const IRRIGATION = ['IRRIGATED', 'RAINFED'];
const OUTCOMES = ['POSITIVE', 'NEUTRAL', 'NEGATIVE'];

// multipart/form-data sends arrays as JSON strings
const parseItems = (raw) => {
  if (raw === undefined) return undefined;
  if (typeof raw !== 'string') return raw;
  try { return JSON.parse(raw); } catch { throw new HttpError(400, 'items must be valid JSON'); }
};

function validateBody(b, { partial = false } = {}) {
  if (!partial && (!b.party_id || !b.demo_type)) {
    throw new HttpError(400, 'party_id and demo_type are required');
  }
  if (b.demo_type !== undefined && !DEMO_TYPES.includes(b.demo_type)) {
    throw new HttpError(400, `demo_type must be one of ${DEMO_TYPES.join(', ')}`);
  }
  if (b.soil_type && !SOIL_TYPES.includes(b.soil_type)) throw new HttpError(400, 'Invalid soil_type');
  if (b.irrigation_type && !IRRIGATION.includes(b.irrigation_type)) {
    throw new HttpError(400, 'Invalid irrigation_type');
  }

  // On create: required when the switch is on. On edit: only check what was sent.
  const sponsorOn = ['true', '1', 1, true].includes(b.is_distributor_sponsored);
  if (sponsorOn && !partial && !b.distributor_ledger_id) {
    if (!(b.distributor_name || '').trim()) throw new HttpError(400, 'Distributor / Firm name is required');
    if (!(b.distributor_contact || '').trim()) throw new HttpError(400, 'Contact person is required');
  }
  if (b.sponsorship_share_pct !== undefined && b.sponsorship_share_pct !== null && b.sponsorship_share_pct !== '') {
    const n = Number(b.sponsorship_share_pct);
    if (!Number.isFinite(n) || n < 0 || n > 100) {
      throw new HttpError(400, 'Sponsorship share % must be between 0 and 100');
    }
  }

}

function optionalDate(v) {
  if (v === undefined || v === null || v === '') return null;
  if (!/^\d{4}-\d{2}-\d{2}$/.test(v) || Number.isNaN(Date.parse(v))) {
    throw new HttpError(400, 'result_date must be in YYYY-MM-DD format');
  }
  return v;
}

function optionalNumber(v, name, { min, max } = {}) {
  if (v === undefined || v === null || v === '') return null;
  const n = Number(v);
  if (!Number.isFinite(n) || (min !== undefined && n < min) || (max !== undefined && n > max)) {
    throw new HttpError(400, `Invalid ${name}`);
  }
  return n;
}

// One place to turn errors into responses and roll back
async function run(res, conn, fn) {
  try {
    await fn();
  } catch (err) {
    if (conn) { try { await conn.rollback(); } catch (_) { /* ignore */ } }
    if (err instanceof HttpError) return res.status(err.status).json({ success: false, message: err.message });
    console.error('[demo]', err);
    return res.status(500).json({ success: false, message: 'Something went wrong' });
  } finally {
    if (conn) conn.release();
  }
}

// ------------------------------------------------------------------ CREATE
// Employee raises a demo request from the Flutter app.
exports.createDemo = async (req, res) => {
  const conn = await db.getConnection();
  await run(res, conn, async () => {
    const b = { ...req.body };
    b.product = typeof req.body.product === 'string' ? JSON.parse(req.body.product) : req.body.product;
    b.selections = typeof req.body.selections === 'string' ? JSON.parse(req.body.selections) : req.body.selections;

    if (!b.demo_type || !DEMO_TYPES.includes(b.demo_type)) {
      throw new HttpError(400, `demo_type must be one of ${DEMO_TYPES.join(', ')}`);
    }
    if (b.soil_type && !SOIL_TYPES.includes(b.soil_type)) throw new HttpError(400, 'Invalid soil_type');
    if (b.irrigation_type && !IRRIGATION.includes(b.irrigation_type)) throw new HttpError(400, 'Invalid irrigation_type');

    const sponsorOn = ['true', '1', 1, true].includes(b.is_distributor_sponsored);
    if (sponsorOn && !b.distributor_ledger_id) {
      if (!(b.distributor_name || '').trim()) throw new HttpError(400, 'Distributor / Firm name is required');
      if (!(b.distributor_contact || '').trim()) throw new HttpError(400, 'Contact person is required');
    }
    if (b.sponsorship_share_pct !== undefined && b.sponsorship_share_pct !== null && b.sponsorship_share_pct !== '') {
      const n = Number(b.sponsorship_share_pct);
      if (!Number.isFinite(n) || n < 0 || n > 100) throw new HttpError(400, 'Sponsorship share % must be between 0 and 100');
    }

    const isAdminRole = ['ADMIN', 'SUPER_ADMIN'].includes(req.user.role);
    const [[me]] = await conn.query('SELECT reporting_under FROM users WHERE id = ?', [req.user.id]);
    b.field_officer_id = (me && me.reporting_under) || null;
    if (typeof b.distributor_name === 'string') b.distributor_name = b.distributor_name.trim();
    if (typeof b.distributor_contact === 'string') b.distributor_contact = b.distributor_contact.trim();

    const uploaded = await m.uploadProofs(req.files); // MinIO first, then DB

    await conn.beginTransaction();

    const { demoId, demoNo, total, productQty } = await m.insertDemo(conn, b, req.user.id);

    const rows = await dc.resolveSelections(b.selections, req.user.id, isAdminRole);
    const allocation = dc.validateAllocationTotal(rows, productQty);
    await dc.insertDemoCustomers(conn, demoId, rows, req.user.id);

    await m.saveProofs(conn, demoId, uploaded, req.user.id);
    await m.log(
      conn, demoId, req.user.id, 'CREATED',
      `Customers: ${rows.length}, allocated ${allocation.allocated_qty}/${allocation.requested_qty}`
    );

    const approverIds = await m.getApproverIds(conn, req.user.id);
    const managerIds = await m.getManagerIds(conn, [req.user.id]);
    const notifyIds = [...new Set([...approverIds, ...managerIds])].filter((id) => id !== req.user.id);

    await conn.commit();

    m.notifyUsers(notifyIds, {
      demoId,
      type: 'DEMO_SUBMITTED',
      title: 'New demo request',
      message: `${demoNo} (₹${total}) is waiting for your approval`,
    }).catch((e) => console.error('[demo notify]', e));

    res.status(201).json({
      success: true,
      message: 'Demo request submitted',
      data: { id: demoId, demo_no: demoNo, allocation },
    });
  });
};

// -------------------------------------------------------------------- LIST
// Approvers see everything; others see demos they created or are assigned to.
exports.listDemos = async (req, res) => {
  await run(res, null, async () => {
    const { status, party_id, page = 1, limit = 20 } = req.query;

    const approver = await m.canApprove(db, req.user);
    const isManager = await m.hasDirectReports(db, req.user.id);

    const where = [];
    const vals = [];
    if (!approver) {
      where.push(`(d.created_by = ? OR d.field_officer_id = ?
        OR d.created_by IN (SELECT id FROM users WHERE reporting_under = ?)
        OR d.field_officer_id IN (SELECT id FROM users WHERE reporting_under = ?))`);
      vals.push(req.user.id, req.user.id, req.user.id, req.user.id);
    }
    if (!approver) { where.push('(d.created_by = ? OR d.field_officer_id = ?)'); vals.push(req.user.id, req.user.id); }
    if (status) { where.push('d.status = ?'); vals.push(status); }
    if (party_id) { where.push('d.party_id = ?'); vals.push(party_id); }
    const w = where.length ? `WHERE ${where.join(' AND ')}` : '';
    const lim = Math.min(Number(limit) || 20, 100);
    const off = (Math.max(Number(page), 1) - 1) * lim;

    const [rows] = await db.query(
      `SELECT d.id, d.demo_no, d.party_id, p.${PARTY_NAME_COL} AS party_name, d.demo_type,
              d.total_value, d.status, d.results_count, d.created_by, cu.name AS created_by_name,
              d.followup_reminder_date, d.created_at
         FROM demo_requests d
         LEFT JOIN ${PARTY_TABLE} p ON p.id = d.party_id
         LEFT JOIN users cu ON cu.id = d.created_by
         ${w}
        ORDER BY d.id DESC
        LIMIT ? OFFSET ?`,
      [...vals, lim, off]
    );
    // res.json({ success: true, data: rows, can_approve: approver });
        res.json({ success: true, data: rows, can_approve: approver || isManager });
  });
};

exports.getDemo = async (req, res) => {
  await run(res, null, async () => {
    const demo = await m.getDemoFull(db, req.params.id);
    if (!demo) throw new HttpError(404, 'Demo request not found');
    // const approver = await m.canApprove(db, req.user);
        const approver = await m.canApproveDemo(db, req.user, demo);
    const involved = demo.created_by === req.user.id || demo.field_officer_id === req.user.id;
    if (!approver && !involved) throw new HttpError(403, 'Not allowed to view this demo');

    const canAddResult =
      (approver || involved) &&
      RESULT_ELIGIBLE_STATUSES.includes(demo.status) &&
      demo.results_count < MAX_RESULTS;

    res.json({
      success: true,
      data: {
        ...demo,
        can_add_result: canAddResult,
        next_result_no: demo.results_count + 1,
        max_result_photos: MAX_RESULT_PHOTOS,
      },
      can_approve: approver,
    });
  });
};

// ------------------------------------------------------------------- EDIT
// Approvers can edit until the demo is REJECTED/COMPLETED.
// The creator can edit only while it is still PENDING_APPROVAL.
exports.updateDemo = async (req, res) => {
  const conn = await db.getConnection();
  await run(res, conn, async () => {
    const b = { ...req.body };
    b.product = req.body.product !== undefined
      ? (typeof req.body.product === 'string' ? JSON.parse(req.body.product) : req.body.product)
      : undefined;
    b.selections = req.body.selections !== undefined
      ? (typeof req.body.selections === 'string' ? JSON.parse(req.body.selections) : req.body.selections)
      : undefined;

    validateBody(b, { partial: true });
    if (typeof b.distributor_name === 'string') b.distributor_name = b.distributor_name.trim();
    if (typeof b.distributor_contact === 'string') b.distributor_contact = b.distributor_contact.trim();

    const isAdminRole = ['ADMIN', 'SUPER_ADMIN'].includes(req.user.role);

    await conn.beginTransaction();
    const [[demo]] = await conn.query('SELECT * FROM demo_requests WHERE id = ? FOR UPDATE', [req.params.id]);
    if (!demo) throw new HttpError(404, 'Demo request not found');

    const approver = await m.canApproveDemo(conn, req.user, demo);
    const ownerEdit = demo.created_by === req.user.id && demo.status === 'PENDING_APPROVAL';
    const approverEdit = approver && !['REJECTED', 'COMPLETED'].includes(demo.status);
    if (!ownerEdit && !approverEdit) throw new HttpError(403, 'You cannot edit this demo in its current status');

    const changes = [];

    // ---- product ----
    let productQty = await m.getSingleItemQty(demo.id);
    if (b.product !== undefined) {
      const before = productQty;
      const { qty } = await m.replaceSingleItem(conn, demo.id, b.product);
      productQty = qty;
      changes.push(`product qty ${before} -> ${qty}`);
    }

    // ---- customer selections (add/remove is always soft) ----
    let allocation = null;
    if (b.selections !== undefined) {
      const rows = await dc.resolveSelections(b.selections, req.user.id, isAdminRole);
      const mergeResult = await dc.mergeDemoCustomers(conn, demo.id, rows, req.user.id);
      allocation = dc.validateAllocationTotal(mergeResult.rows, productQty);
      changes.push(`customers: +${mergeResult.added} reactivated:${mergeResult.reactivated} updated:${mergeResult.updated} removed:${mergeResult.removed}`);
    } else if (b.product !== undefined) {
      // product qty changed but selections didn't — still re-validate the total
      const activeRows = await dc.getDemoCustomers(demo.id);
      allocation = dc.validateAllocationTotal(activeRows, productQty);
    }

    // ---- ordinary fields ----
    await m.updateFields(conn, demo.id, b);

    const uploaded = await m.uploadProofs(req.files);
    await m.saveProofs(conn, demo.id, uploaded, req.user.id);

    const actorIsAdmin = demo.created_by !== req.user.id;
    await m.log(
      conn, demo.id, req.user.id, actorIsAdmin ? 'EDITED_BY_ADMIN' : 'EDITED',
      [b.edit_remarks, ...changes].filter(Boolean).join(' | ') || null
    );
    await conn.commit();

    if (actorIsAdmin) {
      m.notifyUsers([demo.created_by, demo.field_officer_id].filter((id) => id !== req.user.id), {
        demoId: demo.id,
        type: 'DEMO_EDITED',
        title: 'Demo request edited',
        message: `${demo.demo_no} was updated by an approver`,
      }).catch((e) => console.error('[demo notify]', e));
    }

    res.json({ success: true, message: 'Demo request updated', allocation });
  });
};

// ---------------------------------------------------------- APPROVE/REJECT
async function decide(req, res, action) {
  const conn = await db.getConnection();
  await run(res, conn, async () => {
    // const remarks = (req.body.remarks || '').trim();
    const remarks = ((req.body && req.body.remarks) || '').trim();

    if (action === 'REJECTED' && !remarks) throw new HttpError(400, 'Rejection reason is required');

    await conn.beginTransaction();
    const [[demo]] = await conn.query('SELECT * FROM demo_requests WHERE id = ? FOR UPDATE', [req.params.id]);
    if (!demo) throw new HttpError(404, 'Demo request not found');
    // if (!(await m.canApprove(conn, req.user))) throw new HttpError(403, 'You do not have approval access');
        if (!(await m.canApproveDemo(conn, req.user, demo))) throw new HttpError(403, 'You do not have approval access');
    if (demo.status !== 'PENDING_APPROVAL') throw new HttpError(400, `Demo is already ${demo.status}`);

    if (action === 'APPROVED') {
      await conn.query(
        "UPDATE demo_requests SET status = 'APPROVED', approved_by = ?, approved_at = NOW(), rejection_reason = NULL WHERE id = ?",
        [req.user.id, demo.id]
      );
    } else {
      await conn.query(
        "UPDATE demo_requests SET status = 'REJECTED', approved_by = ?, approved_at = NOW(), rejection_reason = ? WHERE id = ?",
        [req.user.id, remarks, demo.id]
      );
    }
    await m.log(conn, demo.id, req.user.id, action, remarks || null);
    await conn.commit();
        m.clearSubmittedNotifications(demo.id).catch((e) => console.error('[demo notify clear]', e));

     m.notifyUsers([demo.created_by, demo.field_officer_id].filter((id) => id !== req.user.id), {
      demoId: demo.id,
      type: action === 'APPROVED' ? 'DEMO_APPROVED' : 'DEMO_REJECTED',
      title: action === 'APPROVED' ? 'Demo request approved' : 'Demo request rejected',
      message: action === 'APPROVED'
        ? `${demo.demo_no} is approved. You can now issue stock and add results.`
        : `${demo.demo_no} was rejected: ${remarks}`,
    }).catch((e) => console.error('[demo notify]', e));

    res.json({ success: true, message: `Demo ${action.toLowerCase()}` });
  });
}
exports.approveDemo = (req, res) => decide(req, res, 'APPROVED');
exports.rejectDemo = (req, res) => decide(req, res, 'REJECTED');

// -------------------------------------------------------------- ADD RESULT
// Up to 3 results per demo, any date the employee chooses. Auto-closes after #3.
// -------------------------------------------------------------- ADD RESULT
// Up to 3 results per demo, up to 3 photos per result. Auto-closes after #3.
exports.addResult = async (req, res) => {
  const conn = await db.getConnection();
  await run(res, conn, async () => {
    const b = req.body || {};
    const files = req.files || [];

    // cheap validation first, before touching the DB or MinIO
    if (!OUTCOMES.includes(b.outcome)) throw new HttpError(400, `outcome must be one of ${OUTCOMES.join(', ')}`);
    if (files.length > MAX_RESULT_PHOTOS) {
      throw new HttpError(400, `Maximum ${MAX_RESULT_PHOTOS} photos allowed per result`);
    }
    if (files.some((f) => !(f.mimetype || '').startsWith('image/'))) {
      throw new HttpError(400, 'Only image files are allowed as result photos');
    }
    const resultDate = optionalDate(b.result_date); // null -> CURDATE() in SQL
    const germination = optionalNumber(b.germination_pct, 'germination_pct', { min: 0, max: 100 });
    const yieldValue = optionalNumber(b.yield_value, 'yield_value', { min: 0 });
    const yieldUnit = (b.yield_unit || '').trim() || null;
    const remarks = (b.remarks || '').trim() || null;

    await conn.beginTransaction();
    // row lock: two simultaneous submissions cannot both take the same slot
    const [[demo]] = await conn.query('SELECT * FROM demo_requests WHERE id = ? FOR UPDATE', [req.params.id]);
    if (!demo) throw new HttpError(404, 'Demo request not found');

    // const approver = await m.canApprove(conn, req.user);
     const approver = await m.canApproveDemo(conn, req.user, demo);
    const involved = demo.created_by === req.user.id || demo.field_officer_id === req.user.id;
    if (!approver && !involved) throw new HttpError(403, 'Not allowed to add a result to this demo');
    if (!RESULT_ELIGIBLE_STATUSES.includes(demo.status)) {
      throw new HttpError(400, `Results can be added only after approval (current status: ${demo.status})`);
    }
    if (demo.results_count >= MAX_RESULTS) {
      throw new HttpError(400, `Maximum ${MAX_RESULTS} results already submitted`);
    }

    const resultNo = demo.results_count + 1;
    const photos = await m.uploadResultPhotos(files); // array of MinIO object paths

    await conn.query(
      `INSERT INTO demo_results
        (demo_id, result_no, result_date, outcome, germination_pct, yield_value, yield_unit, remarks, photos, created_by)
       VALUES (?,?,COALESCE(?, CURDATE()),?,?,?,?,?,?,?)`,
      [
        demo.id, resultNo, resultDate, b.outcome,
        germination, yieldValue, yieldUnit,
        remarks, JSON.stringify(photos), req.user.id,
      ]
    );

    const newStatus = resultNo >= MAX_RESULTS ? 'COMPLETED' : 'IN_PROGRESS';
    await conn.query('UPDATE demo_requests SET results_count = ?, status = ? WHERE id = ?', [resultNo, newStatus, demo.id]);
    await m.log(conn, demo.id, req.user.id, 'RESULT_ADDED', `Result ${resultNo} of ${MAX_RESULTS} (${b.outcome})`);
    const approverIds = await m.getApproverIds(conn, req.user.id);
    await conn.commit();

    const notifyIds = [...approverIds, demo.created_by, demo.field_officer_id]
      .filter((id) => id && id !== req.user.id); // don't notify the person who just submitted
    m.notifyUsers(notifyIds, {
      demoId: demo.id,
      type: 'DEMO_RESULT',
      title: `Demo result ${resultNo} of ${MAX_RESULTS}`,
      message: `${demo.demo_no}: ${b.outcome}${newStatus === 'COMPLETED' ? ' (demo closed)' : ''}`,
    }).catch((e) => console.error('[demo notify]', e));

    res.status(201).json({
      success: true,
      message: newStatus === 'COMPLETED' ? `Result ${MAX_RESULTS} saved. Demo closed.` : `Result ${resultNo} saved`,
      data: {
        result_no: resultNo,
        status: newStatus,
        remaining: MAX_RESULTS - resultNo,
        photo_count: photos.length,
      },
    });
  });
};

// --------------------------------------------------- "FROM VISIT FOLLOW-UP"
// Approved demos that still have result slots left, for the toggle in the app.
exports.followupEligible = async (req, res) => {
  await run(res, null, async () => {
    const approver = await m.canApprove(db, req.user);
    const where = ["d.status IN ('APPROVED','IN_PROGRESS')", 'd.results_count < ?'];
    const vals = [MAX_RESULTS];
    if (!approver) { where.push('(d.created_by = ? OR d.field_officer_id = ?)'); vals.push(req.user.id, req.user.id); }
    if (req.query.party_id) { where.push('d.party_id = ?'); vals.push(req.query.party_id); }

    const [rows] = await db.query(
      `SELECT d.id, d.demo_no, d.party_id, p.${PARTY_NAME_COL} AS party_name, d.demo_type,
              d.results_count, d.results_count + 1 AS next_result_no, d.followup_reminder_date, d.approved_at
         FROM demo_requests d
         LEFT JOIN ${PARTY_TABLE} p ON p.id = d.party_id
        WHERE ${where.join(' AND ')}
        ORDER BY d.approved_at DESC`,
      vals
    );
    res.json({ success: true, data: rows });
  });
};

// Lets the apps show/hide Approve & Edit buttons
// exports.myAccess = async (req, res) => {
//   await run(res, null, async () => {
//     res.json({ success: true, can_approve: await m.canApprove(db, req.user) });
//   });
// };

exports.myAccess = async (req, res) => {
  await run(res, null, async () => {
    const globalApprover = await m.canApprove(db, req.user);
    const manager = await m.hasDirectReports(db, req.user.id);
    res.json({
      success: true,
      can_approve: globalApprover || manager,   // existing app code keeps working
      is_global_approver: globalApprover,
      is_reporting_manager: manager,
    });
  });
};

// ----------------------------------------------------------- NOTIFICATIONS
exports.myNotifications = async (req, res) => {
  await run(res, null, async () => {
    const data = await m.listNotifications(req.user.id, {
      unreadOnly: req.query.unread === '1',
      page: req.query.page,
      limit: req.query.limit,
    });
    const unread = await m.unreadCount(req.user.id);
    res.json({ success: true, data, unread_count: unread });
  });
};

exports.unreadCount = async (req, res) => {
  await run(res, null, async () => {
    res.json({ success: true, unread_count: await m.unreadCount(req.user.id) });
  });
};

exports.markNotificationRead = async (req, res) => {
  await run(res, null, async () => {
    const n = await m.markRead(req.user.id, req.params.nid);
    if (!n) throw new HttpError(404, 'Notification not found');
    res.json({ success: true });
  });
};

exports.markAllNotificationsRead = async (req, res) => {
  await run(res, null, async () => {
    await m.markAllRead(req.user.id);
    res.json({ success: true });
  });
};

exports.fieldOfficers = async (req, res) => {
  await run(res, null, async () => {
    const rows = await m.getFieldOfficers(db);
    res.json({ success: true, data: rows });
  });
};
exports.partyDropdown = async (req, res) => {
  await run(res, null, async () => {
    const rows = await m.getPartyDropdown(db);
    res.json({ success: true, data: rows });
  });
};

// ------------------------------------------- EMPLOYEE: MY APPROVED DEMOS
// "From Visit Follow-up" list: approved demos of the logged-in employee that
// still need a result. Admins/approvers may pass ?employee_id= to see another user's.
exports.myApprovedDemos = async (req, res) => {
  await run(res, null, async () => {
    let targetId = req.user.id;
    const requested = Number(req.query.employee_id);
    if (requested && requested !== req.user.id) {
      if (!(await m.canApprove(db, req.user))) {
        throw new HttpError(403, 'You can only view your own approved demos');
      }
      targetId = requested;
    }

    const rows = await m.getMyApprovedDemos(db, targetId, {
      partyId: req.query.party_id,
      search: (req.query.search || '').trim(),
      page: req.query.page,
      limit: req.query.limit,
    });
    res.json({ success: true, data: rows, max_results: MAX_RESULTS, max_result_photos: MAX_RESULT_PHOTOS });
  });
};

// ----------------------------------------------- RESULTS OF ONE DEMO
// Employee involved in the demo, or any approver.
exports.getDemoResults = async (req, res) => {
  await run(res, null, async () => {
    const [[demo]] = await db.query(
      'SELECT id, demo_no, status, results_count, created_by, field_officer_id FROM demo_requests WHERE id = ?',
      [req.params.id]
    );
    if (!demo) throw new HttpError(404, 'Demo request not found');

    // const approver = await m.canApprove(db, req.user);
    const approver = await m.canApproveDemo(db, req.user, demo); 
    const involved = demo.created_by === req.user.id || demo.field_officer_id === req.user.id;
    if (!approver && !involved) throw new HttpError(403, 'Not allowed to view results of this demo');

    const results = await m.getResultsForDemo(db, demo.id);
    res.json({
      success: true,
      data: {
        demo_id: demo.id,
        demo_no: demo.demo_no,
        status: demo.status,
        results_count: demo.results_count,
        max_results: MAX_RESULTS,
        results,
      },
    });
  });
};

// ------------------------------------------------- ADMIN: ALL RESULTS
// Approvers only. Filters: outcome, party_id, employee_id, demo_id, from, to, search, page, limit
exports.listAllResults = async (req, res) => {
  await run(res, null, async () => {
    if (!(await m.canApprove(db, req.user))) {
      throw new HttpError(403, 'You do not have access to view all demo results');
    }
    const q = req.query;
    if (q.outcome && !OUTCOMES.includes(q.outcome)) {
      throw new HttpError(400, `outcome must be one of ${OUTCOMES.join(', ')}`);
    }
    optionalDate(q.from);
    optionalDate(q.to);

    const out = await m.listAllResults(
      db,
      {
        demoId: q.demo_id,
        partyId: q.party_id,
        employeeId: q.employee_id,
        outcome: q.outcome,
        from: q.from,
        to: q.to,
        search: (q.search || '').trim(),
      },
      { page: q.page, limit: q.limit }
    );
    res.json({ success: true, data: out.rows, summary: out.summary, page: out.page, limit: out.limit });
  });
};

exports.pendingApprovalCount = async (req, res) => {
  await run(res, null, async () => {
    res.json({ success: true, pending_count: await m.pendingApprovalCount(db, req.user) });
  });
};

// GET /api/demo-requests/eligible-customers?type=DISTRIBUTOR&ledger_id=..
// GET /api/demo-requests/eligible-customers?type=RETAILER&party_id=..
// GET /api/demo-requests/eligible-customers?type=FARMER&party_id=..
exports.eligibleCustomers = async (req, res) => {
  await run(res, null, async () => {
    const { type } = req.query;
    const isAdminRole = ['ADMIN', 'SUPER_ADMIN'].includes(req.user.role);

    if (type === 'DISTRIBUTOR') {
      const ledgerId = Number(req.query.ledger_id);
      if (!ledgerId) throw new HttpError(400, 'ledger_id is required');
      return res.json({ success: true, data: await dc.getEligibleUnderDistributor(ledgerId, req.user.id, isAdminRole) });
    }
    if (type === 'RETAILER') {
      const partyId = Number(req.query.party_id);
      if (!partyId) throw new HttpError(400, 'party_id is required');
      return res.json({ success: true, data: await dc.getEligibleUnderRetailer(partyId, req.user.id, isAdminRole) });
    }
    if (type === 'FARMER') {
      const partyId = Number(req.query.party_id);
      if (!partyId) throw new HttpError(400, 'party_id is required');
      return res.json({ success: true, data: await dc.getEligibleForFarmer(partyId, req.user.id, isAdminRole) });
    }
    throw new HttpError(400, 'type must be DISTRIBUTOR, RETAILER or FARMER');
  });
};

// GET /api/demo-requests/:id/customers
exports.getDemoCustomers = async (req, res) => {
  await run(res, null, async () => {
    const demoId = req.params.id;
    const [[demo]] = await db.query('SELECT * FROM demo_requests WHERE id = ?', [demoId]);
    if (!demo) throw new HttpError(404, 'Demo request not found');

    const approver = await m.canApproveDemo(db, req.user, demo);
    const involved = demo.created_by === req.user.id || demo.field_officer_id === req.user.id;
    if (!approver && !involved) throw new HttpError(403, 'Not allowed to view this demo');

    const includeRemoved = req.query.include_removed === '1' && approver;
    const rows = await dc.getDemoCustomers(demoId, { includeRemoved });
    const productQty = await m.getSingleItemQty(demoId);
    const allocation = dc.validateAllocationTotal
      ? (() => { try { return dc.validateAllocationTotal(rows.filter((r) => !r.is_removed), productQty); } catch { return null; } })()
      : null;

    res.json({ success: true, data: rows, allocation });
  });
};

// ---------------------------------------------------------------- GET ONE
// exports.getDemo = async (req, res) => {
//   await run(res, null, async () => {
//     const demo = await m.getDemoFull(db, req.params.id);
//     if (!demo) throw new HttpError(404, 'Demo request not found');
//     const approver = await m.canApprove(db, req.user);
//     const involved = demo.created_by === req.user.id || demo.field_officer_id === req.user.id;
//     if (!approver && !involved) throw new HttpError(403, 'Not allowed to view this demo');
//     res.json({ success: true, data: demo, can_approve: approver });
//   });
// };

// exports.addResult = async (req, res) => {
//   const conn = await db.getConnection();
//   await run(res, conn, async () => {
//     const b = req.body;
//     if (!OUTCOMES.includes(b.outcome)) throw new HttpError(400, `outcome must be one of ${OUTCOMES.join(', ')}`);
//     const resultDate = b.result_date || new Date().toISOString().slice(0, 10);

//     await conn.beginTransaction();
//     // row lock: two simultaneous submissions cannot both take the same slot
//     const [[demo]] = await conn.query('SELECT * FROM demo_requests WHERE id = ? FOR UPDATE', [req.params.id]);
//     if (!demo) throw new HttpError(404, 'Demo request not found');

//     const approver = await m.canApprove(conn, req.user);
//     const involved = demo.created_by === req.user.id || demo.field_officer_id === req.user.id;
//     if (!approver && !involved) throw new HttpError(403, 'Not allowed to add a result to this demo');
//     if (!['APPROVED', 'IN_PROGRESS'].includes(demo.status)) {
//       throw new HttpError(400, `Results can be added only after approval (current status: ${demo.status})`);
//     }
//     if (demo.results_count >= MAX_RESULTS) throw new HttpError(400, `Maximum ${MAX_RESULTS} results already submitted`);

//     const resultNo = demo.results_count + 1;
//     const photos = await m.uploadResultPhotos(req.files); // array of MinIO object paths

//     await conn.query(
//       `INSERT INTO demo_results
//         (demo_id, result_no, result_date, outcome, germination_pct, yield_value, yield_unit, remarks, photos, created_by)
//        VALUES (?,?,?,?,?,?,?,?,?,?)`,
//       [
//         demo.id, resultNo, resultDate, b.outcome,
//         b.germination_pct || null, b.yield_value || null, b.yield_unit || null,
//         b.remarks || null, JSON.stringify(photos), req.user.id,
//       ]
//     );

//     const newStatus = resultNo >= MAX_RESULTS ? 'COMPLETED' : 'IN_PROGRESS';
//     await conn.query('UPDATE demo_requests SET results_count = ?, status = ? WHERE id = ?', [resultNo, newStatus, demo.id]);
//     await m.log(conn, demo.id, req.user.id, 'RESULT_ADDED', `Result ${resultNo} of ${MAX_RESULTS} (${b.outcome})`);
//     const approverIds = await m.getApproverIds(conn, req.user.id);
//     await conn.commit();

//     m.notifyUsers([...approverIds, demo.created_by], {
//       demoId: demo.id,
//       type: 'DEMO_RESULT',
//       title: `Demo result ${resultNo} of ${MAX_RESULTS}`,
//       message: `${demo.demo_no}: ${b.outcome}${newStatus === 'COMPLETED' ? ' (demo closed)' : ''}`,
//     }).catch((e) => console.error('[demo notify]', e));

//     res.status(201).json({
//       success: true,
//       message: newStatus === 'COMPLETED' ? 'Result 3 saved. Demo closed.' : `Result ${resultNo} saved`,
//       data: { result_no: resultNo, status: newStatus, remaining: MAX_RESULTS - resultNo },
//     });
//   });
// };