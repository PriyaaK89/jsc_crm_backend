// models/demoModel.js
// STEP 2: data-access helpers for the Product Demo module
const db = require('../../config/db'); // mysql2/promise pool (same as the rest of your project)
// <-- path of the MinIO helper file you pasted (exports uploadFileToMinio, getPresignedUrl)
const { uploadFileToMinio, getPresignedUrl } = require('../../utils/fileUpload');

// ---- CONFIG -----------------------------------------------------------
const APPROVER_ROLES = ['ADMIN', 'SUPER_ADMIN']; // always approve, no permission needed
const APPROVE_PERMISSION = 'demo_approve';        // anyone else, granted individually
const MAX_RESULTS = 3;
const PARTY_TABLE = 'customers';
const PARTY_NAME_COL = 'name';
// -------------------------------------------------------------------------

const HAS_PERMISSION_SQL = `EXISTS (
  SELECT 1 FROM user_permissions up
    JOIN permissions p ON p.id = up.permission_id
   WHERE up.user_id = u.id AND up.is_allowed = 1 AND p.code = ?
)`;


class HttpError extends Error {
  constructor(status, message) {
    super(message);
    this.status = status;
  }
}

const nz = (v) => (v === undefined || v === null || v === '' ? null : v);
const toBool = (v) => (v === true || v === 1 || v === '1' || v === 'true' ? 1 : 0);

const EDITABLE_FIELDS = [
  'party_id', 'demo_type', 'is_distributor_sponsored', 'village', 'district',
  'land_area', 'land_unit', 'soil_type', 'irrigation_type', 'sowing_date',
  'expected_result_date', 'followup_reminder_date', 'field_officer_id', 'narration',
];


// async function getApproverIds(conn, excludeUserId = null) {
//   const [rows] = await conn.query(
//     `SELECT u.id
//        FROM users u
//       WHERE u.is_active = 1
//         AND (u.role IN (?) OR ${HAS_PERMISSION_SQL})`,
//     [APPROVER_ROLES, APPROVE_PERMISSION]
//   );
//   return rows.map((r) => r.id).filter((id) => id !== excludeUserId);
// }


async function getApproverIds(conn, excludeUserId = null) {
  const [rows] = await conn.query(
    `SELECT u.id
       FROM users u
       JOIN roles r ON r.id = u.role_id
      WHERE u.is_active = 1
        AND (r.name IN (?) OR ${HAS_PERMISSION_SQL})`,
    [APPROVER_ROLES, APPROVE_PERMISSION]
  );
  return rows.map((r) => r.id).filter((id) => id !== excludeUserId);
}

async function canApprove(conn, user) {
  const [rows] = await conn.query(
    `SELECT 1
       FROM users u
       JOIN roles r ON r.id = u.role_id
      WHERE u.id = ?
        AND (r.name IN (?) OR ${HAS_PERMISSION_SQL})
      LIMIT 1`,
    [user.id, APPROVER_ROLES, APPROVE_PERMISSION]
  );
  return rows.length > 0;
}

// ------------------------------------------------------------ notifications
// Stored in demo_notifications (separate from the location notifications table).
// Call AFTER commit, fire-and-forget (same pattern as your WhatsApp calls).
async function notifyUsers(userIds, { title, message, demoId, type = 'DEMO_UPDATE' }) {
  const ids = [...new Set(userIds.filter(Boolean))];
  if (!ids.length) return;
  const values = ids.map((id) => [id, demoId, type, title, message]);
  await db.query(
    'INSERT INTO demo_notifications (user_id, demo_id, type, title, message) VALUES ?',
    [values]
  );
  // TODO: also send an FCM push here if you already have a push helper
}

async function listNotifications(userId, { unreadOnly = false, page = 1, limit = 20 } = {}) {
  const lim = Math.min(Number(limit) || 20, 100);
  const off = (Math.max(Number(page), 1) - 1) * lim;
  const [rows] = await db.query(
    `SELECT n.*, d.demo_no, d.status AS demo_status
       FROM demo_notifications n
       LEFT JOIN demo_requests d ON d.id = n.demo_id
      WHERE n.user_id = ? ${unreadOnly ? 'AND n.is_read = 0' : ''}
      ORDER BY n.id DESC
      LIMIT ? OFFSET ?`,
    [userId, lim, off]
  );
  return rows;
}

async function unreadCount(userId) {
  const [[row]] = await db.query(
    'SELECT COUNT(*) AS cnt FROM demo_notifications WHERE user_id = ? AND is_read = 0',
    [userId]
  );
  return row.cnt;
}

async function markRead(userId, notificationId) {
  const [r] = await db.query(
    'UPDATE demo_notifications SET is_read = 1, read_at = NOW() WHERE id = ? AND user_id = ?',
    [notificationId, userId]
  );
  return r.affectedRows;
}

async function markAllRead(userId) {
  await db.query(
    'UPDATE demo_notifications SET is_read = 1, read_at = NOW() WHERE user_id = ? AND is_read = 0',
    [userId]
  );
}

// -------------------------------------------------------------------- items
function calcItems(items) {
  if (!Array.isArray(items) || items.length === 0) {
    throw new HttpError(400, 'At least one demo item is required');
  }
  let total = 0;
  const clean = items.map((i) => {
    const qty = Number(i.qty);
    const rate = Number(i.rate || 0);
    if (!i.stock_item_id || !(qty > 0) || rate < 0) {
      throw new HttpError(400, 'Invalid demo item (stock_item_id, qty > 0 required)');
    }
    const amount = +(qty * rate).toFixed(2);
    total += amount;
    return {
      stock_item_id: i.stock_item_id,
      item_name: nz(i.item_name),
      qty,
      unit: nz(i.unit),
      rate,
      is_free_sample: i.is_free_sample === undefined ? 1 : toBool(i.is_free_sample),
      amount,
    };
  });
  return { clean, total: +total.toFixed(2) };
}

async function insertItems(conn, demoId, cleanItems) {
  const values = cleanItems.map((i) => [
    demoId, i.stock_item_id, i.item_name, i.qty, i.unit, i.rate, i.is_free_sample, i.amount,
  ]);
  await conn.query(
    `INSERT INTO demo_request_items
      (demo_id, stock_item_id, item_name, qty, unit, rate, is_free_sample, amount)
     VALUES ?`,
    [values]
  );
}

// ------------------------------------------------------------------- create
async function insertDemo(conn, b, userId) {
  const { clean, total } = calcItems(b.items);

  const [r] = await conn.query(
    `INSERT INTO demo_requests
      (party_id, demo_type, is_distributor_sponsored, village, district, land_area, land_unit,
       soil_type, irrigation_type, sowing_date, expected_result_date, followup_reminder_date,
       field_officer_id, narration, total_value, status, created_by)
     VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?, 'PENDING_APPROVAL', ?)`,
    [
      b.party_id, b.demo_type, toBool(b.is_distributor_sponsored), nz(b.village), nz(b.district),
      nz(b.land_area), nz(b.land_unit), nz(b.soil_type), nz(b.irrigation_type),
      nz(b.sowing_date), nz(b.expected_result_date), nz(b.followup_reminder_date),
      nz(b.field_officer_id), nz(b.narration), total, userId,
    ]
  );
  const demoId = r.insertId;
  const demoNo = `DEMO-${new Date().getFullYear()}-${String(demoId).padStart(2, '0')}`;
  await conn.query('UPDATE demo_requests SET demo_no = ? WHERE id = ?', [demoNo, demoId]);
  await insertItems(conn, demoId, clean);
  return { demoId, demoNo, total };
}

// --------------------------------------------------------------------- edit
async function updateFields(conn, demoId, body) {
  const sets = [];
  const vals = [];
  for (const f of EDITABLE_FIELDS) {
    if (body[f] !== undefined) {
      sets.push(`${f} = ?`); // f comes from the whitelist above, so it is safe
      vals.push(f === 'is_distributor_sponsored' ? toBool(body[f]) : nz(body[f]));
    }
  }
  if (sets.length) {
    await conn.query(`UPDATE demo_requests SET ${sets.join(', ')} WHERE id = ?`, [...vals, demoId]);
  }
}

async function replaceItems(conn, demoId, items) {
  const { clean, total } = calcItems(items);
  await conn.query('DELETE FROM demo_request_items WHERE demo_id = ?', [demoId]);
  await insertItems(conn, demoId, clean);
  await conn.query('UPDATE demo_requests SET total_value = ? WHERE id = ?', [total, demoId]);
}

// ------------------------------------------------------- files (MinIO)
// DB stores only the MinIO object_path. GET APIs turn it into a presigned URL.
const PROOF_FIELDS = { farm_image: 'FARM_IMAGE', consent_doc: 'CONSENT_DOC' };

// Uploads happen first; the DB insert (saveProofs) follows inside the transaction.
async function uploadProofs(files) {
  const uploaded = [];
  if (!files) return uploaded;
  for (const [field, type] of Object.entries(PROOF_FIELDS)) {
    const f = files[field] && files[field][0];
    if (!f) continue;
    const { object_path } = await uploadFileToMinio(f, 'demo_proofs');
    uploaded.push({ type, object_path });
  }
  return uploaded;
}

async function uploadResultPhotos(files) {
  const paths = [];
  for (const f of files || []) {
    const { object_path } = await uploadFileToMinio(f, 'demo_results');
    paths.push(object_path);
  }
  return paths;
}

async function saveProofs(conn, demoId, uploaded, userId) {
  for (const { type, object_path } of uploaded || []) {
    // a newly uploaded file replaces the previous proof of the same type
    await conn.query('DELETE FROM demo_proofs WHERE demo_id = ? AND proof_type = ?', [demoId, type]);
    await conn.query(
      'INSERT INTO demo_proofs (demo_id, proof_type, file_path, uploaded_by) VALUES (?,?,?,?)',
      [demoId, type, object_path, userId]
    );
  }
}

async function signPath(objectPath) {
  if (!objectPath) return null;
  try {
    return await getPresignedUrl(objectPath); // default 1 hour
  } catch (e) {
    console.error('[demo presign]', objectPath, e.message);
    return null;
  }
}

// JSON column comes back parsed on MySQL, as a string on MariaDB
const parsePhotos = (v) => {
  if (!v) return [];
  if (typeof v === 'string') { try { return JSON.parse(v); } catch { return []; } }
  return v;
};

// --------------------------------------------------------------------- misc
async function log(conn, demoId, userId, action, remarks = null) {
  await conn.query(
    'INSERT INTO demo_activity_log (demo_id, action, acted_by, remarks) VALUES (?,?,?,?)',
    [demoId, action, userId, remarks]
  );
}

async function getDemoFull(conn, id) {
  const [rows] = await conn.query(
    `SELECT d.*, p.${PARTY_NAME_COL} AS party_name,
            cu.name AS created_by_name, fo.name AS field_officer_name, au.name AS approved_by_name
       FROM demo_requests d
       LEFT JOIN ${PARTY_TABLE} p ON p.id = d.party_id
       LEFT JOIN users cu ON cu.id = d.created_by
       LEFT JOIN users fo ON fo.id = d.field_officer_id
       LEFT JOIN users au ON au.id = d.approved_by
      WHERE d.id = ?`,
    [id]
  );
  if (!rows.length) return null;
  const demo = rows[0];
  const [items] = await conn.query('SELECT * FROM demo_request_items WHERE demo_id = ?', [id]);
  const [proofRows] = await conn.query('SELECT * FROM demo_proofs WHERE demo_id = ?', [id]);
  const [resultRows] = await conn.query(
    'SELECT * FROM demo_results WHERE demo_id = ? ORDER BY result_no', [id]
  );
  const proofs = await Promise.all(
    proofRows.map(async (pr) => ({ ...pr, file_url: await signPath(pr.file_path) }))
  );
  const results = await Promise.all(
    resultRows.map(async (r) => {
      const photos = parsePhotos(r.photos);
      return { ...r, photos, photo_urls: await Promise.all(photos.map(signPath)) };
    })
  );
  const [activity] = await conn.query(
    `SELECT l.*, u.name AS acted_by_name
       FROM demo_activity_log l LEFT JOIN users u ON u.id = l.acted_by
      WHERE l.demo_id = ? ORDER BY l.id`,
    [id]
  );
  return { ...demo, items, proofs, results, activity, max_results: MAX_RESULTS };
}

async function getFieldOfficers(conn) {
  const [rows] = await conn.query(
    `SELECT u.id, u.name, m.name AS manager_name
       FROM users u
       LEFT JOIN users m ON m.id = u.reporting_under
      WHERE u.is_active = 1
      ORDER BY u.name`
  );
  return rows;
}

async function getPartyDropdown(conn) {
  const [rows] = await conn.query(
    `SELECT id, ${PARTY_NAME_COL} AS name FROM ${PARTY_TABLE} ORDER BY ${PARTY_NAME_COL}`
  );
  return rows;
}

module.exports = {
  db, HttpError, MAX_RESULTS, PARTY_TABLE, PARTY_NAME_COL,
  getApproverIds, canApprove, notifyUsers,
  listNotifications, unreadCount, markRead, markAllRead,
  insertDemo, updateFields, replaceItems, saveProofs, uploadProofs, uploadResultPhotos, log, getDemoFull,
  getFieldOfficers, getPartyDropdown
};