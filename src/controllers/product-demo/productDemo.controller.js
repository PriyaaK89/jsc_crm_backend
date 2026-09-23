// controllers/demoController.js
// STEP 3: business logic for the Product Demo module
const m = require('../../models/product-demo/productDemo.model');
const { db, HttpError, MAX_RESULTS, PARTY_TABLE, PARTY_NAME_COL } = m;

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
    const b = { ...req.body, items: parseItems(req.body.items) };
    validateBody(b);

    const uploaded = await m.uploadProofs(req.files); // MinIO first, then DB

    await conn.beginTransaction();
    const { demoId, demoNo, total } = await m.insertDemo(conn, b, req.user.id);
    await m.saveProofs(conn, demoId, uploaded, req.user.id);
    await m.log(conn, demoId, req.user.id, 'CREATED');
    // every submit notifies admin, super_admin and employees with approve access
    const approverIds = await m.getApproverIds(conn, req.user.id);
    await conn.commit();

    m.notifyUsers(approverIds, {
      demoId,
      type: 'DEMO_SUBMITTED',
      title: 'New demo request',
      message: `${demoNo} (₹${total}) is waiting for your approval`,
    }).catch((e) => console.error('[demo notify]', e));

    res.status(201).json({ success: true, message: 'Demo request submitted', data: { id: demoId, demo_no: demoNo } });
  });
};

// -------------------------------------------------------------------- LIST
// Approvers see everything; others see demos they created or are assigned to.
exports.listDemos = async (req, res) => {
  await run(res, null, async () => {
    const { status, party_id, page = 1, limit = 20 } = req.query;
    const approver = await m.canApprove(db, req.user);

    const where = [];
    const vals = [];
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
    res.json({ success: true, data: rows, can_approve: approver });
  });
};

// ---------------------------------------------------------------- GET ONE
exports.getDemo = async (req, res) => {
  await run(res, null, async () => {
    const demo = await m.getDemoFull(db, req.params.id);
    if (!demo) throw new HttpError(404, 'Demo request not found');
    const approver = await m.canApprove(db, req.user);
    const involved = demo.created_by === req.user.id || demo.field_officer_id === req.user.id;
    if (!approver && !involved) throw new HttpError(403, 'Not allowed to view this demo');
    res.json({ success: true, data: demo, can_approve: approver });
  });
};

// ------------------------------------------------------------------- EDIT
// Approvers can edit until the demo is REJECTED/COMPLETED.
// The creator can edit only while it is still PENDING_APPROVAL.
exports.updateDemo = async (req, res) => {
  const conn = await db.getConnection();
  await run(res, conn, async () => {
    const b = { ...req.body, items: parseItems(req.body.items) };
    validateBody(b, { partial: true });

    await conn.beginTransaction();
    const [[demo]] = await conn.query('SELECT * FROM demo_requests WHERE id = ? FOR UPDATE', [req.params.id]);
    if (!demo) throw new HttpError(404, 'Demo request not found');

    const approver = await m.canApprove(conn, req.user);
    const ownerEdit = demo.created_by === req.user.id && demo.status === 'PENDING_APPROVAL';
    const approverEdit = approver && !['REJECTED', 'COMPLETED'].includes(demo.status);
    if (!ownerEdit && !approverEdit) throw new HttpError(403, 'You cannot edit this demo in its current status');

    await m.updateFields(conn, demo.id, b);
    if (b.items !== undefined) await m.replaceItems(conn, demo.id, b.items);
    const uploaded = await m.uploadProofs(req.files);
    await m.saveProofs(conn, demo.id, uploaded, req.user.id);
    await m.log(conn, demo.id, req.user.id, 'EDITED', b.edit_remarks || null);
    await conn.commit();

    if (demo.created_by !== req.user.id) {
      m.notifyUsers([demo.created_by, demo.field_officer_id], {
        demoId: demo.id,
        type: 'DEMO_EDITED',
        title: 'Demo request edited',
        message: `${demo.demo_no} was updated by an approver`,
      }).catch((e) => console.error('[demo notify]', e));
    }
    res.json({ success: true, message: 'Demo request updated' });
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
    if (!(await m.canApprove(conn, req.user))) throw new HttpError(403, 'You do not have approval access');
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

    m.notifyUsers([demo.created_by, demo.field_officer_id], {
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
exports.addResult = async (req, res) => {
  const conn = await db.getConnection();
  await run(res, conn, async () => {
    const b = req.body;
    if (!OUTCOMES.includes(b.outcome)) throw new HttpError(400, `outcome must be one of ${OUTCOMES.join(', ')}`);
    const resultDate = b.result_date || new Date().toISOString().slice(0, 10);

    await conn.beginTransaction();
    // row lock: two simultaneous submissions cannot both take the same slot
    const [[demo]] = await conn.query('SELECT * FROM demo_requests WHERE id = ? FOR UPDATE', [req.params.id]);
    if (!demo) throw new HttpError(404, 'Demo request not found');

    const approver = await m.canApprove(conn, req.user);
    const involved = demo.created_by === req.user.id || demo.field_officer_id === req.user.id;
    if (!approver && !involved) throw new HttpError(403, 'Not allowed to add a result to this demo');
    if (!['APPROVED', 'IN_PROGRESS'].includes(demo.status)) {
      throw new HttpError(400, `Results can be added only after approval (current status: ${demo.status})`);
    }
    if (demo.results_count >= MAX_RESULTS) throw new HttpError(400, `Maximum ${MAX_RESULTS} results already submitted`);

    const resultNo = demo.results_count + 1;
    const photos = await m.uploadResultPhotos(req.files); // array of MinIO object paths

    await conn.query(
      `INSERT INTO demo_results
        (demo_id, result_no, result_date, outcome, germination_pct, yield_value, yield_unit, remarks, photos, created_by)
       VALUES (?,?,?,?,?,?,?,?,?,?)`,
      [
        demo.id, resultNo, resultDate, b.outcome,
        b.germination_pct || null, b.yield_value || null, b.yield_unit || null,
        b.remarks || null, JSON.stringify(photos), req.user.id,
      ]
    );

    const newStatus = resultNo >= MAX_RESULTS ? 'COMPLETED' : 'IN_PROGRESS';
    await conn.query('UPDATE demo_requests SET results_count = ?, status = ? WHERE id = ?', [resultNo, newStatus, demo.id]);
    await m.log(conn, demo.id, req.user.id, 'RESULT_ADDED', `Result ${resultNo} of ${MAX_RESULTS} (${b.outcome})`);
    const approverIds = await m.getApproverIds(conn, req.user.id);
    await conn.commit();

    m.notifyUsers([...approverIds, demo.created_by], {
      demoId: demo.id,
      type: 'DEMO_RESULT',
      title: `Demo result ${resultNo} of ${MAX_RESULTS}`,
      message: `${demo.demo_no}: ${b.outcome}${newStatus === 'COMPLETED' ? ' (demo closed)' : ''}`,
    }).catch((e) => console.error('[demo notify]', e));

    res.status(201).json({
      success: true,
      message: newStatus === 'COMPLETED' ? 'Result 3 saved. Demo closed.' : `Result ${resultNo} saved`,
      data: { result_no: resultNo, status: newStatus, remaining: MAX_RESULTS - resultNo },
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
exports.myAccess = async (req, res) => {
  await run(res, null, async () => {
    res.json({ success: true, can_approve: await m.canApprove(db, req.user) });
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