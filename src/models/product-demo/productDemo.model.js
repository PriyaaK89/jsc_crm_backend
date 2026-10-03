// models/demoModel.js
// STEP 2: data-access helpers for the Product Demo module
const db = require('../../config/db'); // mysql2/promise pool (same as the rest of your project)
// <-- path of the MinIO helper file you pasted (exports uploadFileToMinio, getPresignedUrl)
const { uploadFileToMinio, getPresignedUrl } = require('../../utils/fileUpload');
const { HttpError } = require('./httpError');
const customerModel = require('../customer.model');

// ---- CONFIG -----------------------------------------------------------
const APPROVER_ROLES = ['ADMIN', 'SUPER_ADMIN']; // always approve, no permission needed
const APPROVE_PERMISSION = 'demo_approve';        // anyone else, granted individually
const MAX_RESULTS = 3;
const PARTY_TABLE = 'customers';
const PARTY_NAME_COL = 'name';
const MAX_RESULT_PHOTOS = 3;
const RESULT_ELIGIBLE_STATUSES = ['APPROVED', 'IN_PROGRESS'];
const LEDGER_TABLE = 'ledgers';
const LEDGER_NAME_COL = 'ledger_name';
const LEDGER_ASSIGNED_COL = 'employee_under'; // same condition your get-my-assigned-ledgers uses
const LEDGER_CONTACT_COL = null;    
const PARTY_TYPES = ['DISTRIBUTOR', 'RETAILER', 'FARMER'];  
// -------------------------------------------------------------------------

const HAS_PERMISSION_SQL = `EXISTS (
  SELECT 1 FROM user_permissions up
    JOIN permissions p ON p.id = up.permission_id
   WHERE up.user_id = u.id AND up.is_allowed = 1 AND p.code = ?
)`;


// class HttpError extends Error {
//   constructor(status, message) {
//     super(message);
//     this.status = status;
//   }
// }

const nz = (v) => (v === undefined || v === null || v === '' ? null : v);
const toBool = (v) => (v === true || v === 1 || v === '1' || v === 'true' ? 1 : 0);

const EDITABLE_FIELDS = [
 'crop_id', 'party_id', 'demo_type', 'is_distributor_sponsored', "distributor_ledger_id",
  'distributor_name', 'distributor_contact', 'sponsorship_share_pct',
  'village', 'district', 'land_area', 'land_unit',
  'soil_type', 'irrigation_type', 'sowing_date',
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

// Turns the sponsorship inputs into the final 4 columns.
// - switch OFF          -> everything NULL
// - ledger id given     -> name (and contact, if not typed) come from the ledger
// - no ledger id        -> manual name/contact as typed
async function resolveDistributor(conn, b, user, isApprover) {
  if (!toBool(b.is_distributor_sponsored)) {
    return {
      distributor_ledger_id: null, distributor_name: null,
      distributor_contact: null, sponsorship_share_pct: null,
    };
  }

  const share = nz(b.sponsorship_share_pct);
  const ledgerId = nz(b.distributor_ledger_id);

  if (!ledgerId) {
    return {
      distributor_ledger_id: null,
      distributor_name: nz(b.distributor_name),
      distributor_contact: nz(b.distributor_contact),
      sponsorship_share_pct: share,
    };
  }


  const [rows] = await conn.query(
    `SELECT l.id, l.${LEDGER_NAME_COL} AS name,
            l.${LEDGER_ASSIGNED_COL} AS assigned,
            (SELECT lod.contact FROM ledger_other_details lod
              WHERE lod.ledger_id = l.id LIMIT 1) AS contact
       FROM ${LEDGER_TABLE} l
      WHERE l.id = ?`,
    [ledgerId]
  );
  if (!rows.length) throw new HttpError(400, 'Selected distributor was not found');
  const l = rows[0];
  if (!isApprover && Number(l.assigned) !== Number(user.id)) {
    throw new HttpError(403, 'This distributor is not assigned to you');
  }

  return {
    distributor_ledger_id: l.id,
    distributor_name: l.name,                                 // ledger is the source of truth
    distributor_contact: nz(b.distributor_contact) ?? l.contact, // typed value wins if sent
    sponsorship_share_pct: share,
  };
}

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
// Is userId the reporting manager of the demo's creator or assigned field officer?
// A manager cannot approve a demo they raised themselves.
async function isReportingManagerOf(conn, userId, demo) {
  if (demo.created_by === userId) return false;
  const ids = [demo.created_by, demo.field_officer_id].filter(Boolean);
  if (!ids.length) return false;
  const [rows] = await conn.query(
    'SELECT 1 FROM users WHERE id IN (?) AND reporting_under = ? LIMIT 1',
    [ids, userId]
  );
  return rows.length > 0;
}

// Global approvers (role / permission) OR the reporting manager of this demo
async function canApproveDemo(conn, user, demo) {
  if (await canApprove(conn, user)) return true;
  return isReportingManagerOf(conn, user.id, demo);
}

async function hasDirectReports(conn, userId) {
  const [rows] = await conn.query(
    'SELECT 1 FROM users WHERE reporting_under = ? AND is_active = 1 LIMIT 1',
    [userId]
  );
  return rows.length > 0;
}

// Active managers of the given users (for notifications)
async function getManagerIds(conn, userIds) {
  const ids = [...new Set(userIds.filter(Boolean))];
  if (!ids.length) return [];
  const [rows] = await conn.query(
    `SELECT DISTINCT m.id
       FROM users u JOIN users m ON m.id = u.reporting_under
      WHERE u.id IN (?) AND m.is_active = 1`,
    [ids]
  );
  return rows.map((r) => r.id);
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

// "DEMO_SUBMITTED,DEMO_EDITED" -> ['DEMO_SUBMITTED','DEMO_EDITED'] (only A-Z and _ allowed)
function parseTypes(raw) {
  if (!raw) return [];
  return String(raw)
    .split(',')
    .map((s) => s.trim().toUpperCase())
    .filter((s) => /^[A-Z_]+$/.test(s));
}

async function listNotifications(userId, { unreadOnly = false, types = [], pendingOnly = false, page = 1, limit = 20 } = {}) {
  const lim = Math.min(Number(limit) || 20, 100);
  const off = (Math.max(Number(page), 1) - 1) * lim;

  const where = ['n.user_id = ?'];
  const vals = [userId];
  if (unreadOnly) where.push('n.is_read = 0');
  if (types.length) { where.push('n.type IN (?)'); vals.push(types); }
  if (pendingOnly) where.push("d.status = 'PENDING_APPROVAL'");

  const [rows] = await db.query(
    `SELECT n.*, d.demo_no, d.status AS demo_status,
            d.created_by, cu.name AS created_by_name
       FROM demo_notifications n
       LEFT JOIN demo_requests d ON d.id = n.demo_id
       LEFT JOIN users cu ON cu.id = d.created_by
      WHERE ${where.join(' AND ')}
      ORDER BY n.id DESC
      LIMIT ? OFFSET ?`,
    [...vals, lim, off]
  );
  return rows;
}

async function unreadCount(userId, { types = [], pendingOnly = false } = {}) {
  const where = ['n.user_id = ?', 'n.is_read = 0'];
  const vals = [userId];
  if (types.length) { where.push('n.type IN (?)'); vals.push(types); }
  if (pendingOnly) where.push("d.status = 'PENDING_APPROVAL'");

  const [[row]] = await db.query(
    `SELECT COUNT(*) AS cnt
       FROM demo_notifications n
       LEFT JOIN demo_requests d ON d.id = n.demo_id
      WHERE ${where.join(' AND ')}`,
    vals
  );
  return row.cnt;
}

async function markAllRead(userId, { types = [] } = {}) {
  const vals = [userId];
  let typeSql = '';
  if (types.length) { typeSql = 'AND type IN (?)'; vals.push(types); }
  await db.query(
    `UPDATE demo_notifications SET is_read = 1, read_at = NOW()
      WHERE user_id = ? AND is_read = 0 ${typeSql}`,
    vals
  );
}

async function markRead(userId, notificationId) {
  const [r] = await db.query(
    'UPDATE demo_notifications SET is_read = 1, read_at = NOW() WHERE id = ? AND user_id = ?',
    [notificationId, userId]
  );
  return r.affectedRows;
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
function calcSingleItem(product) {
  if (!product || !product.stock_item_id) {
    throw new HttpError(400, 'A product is required');
  }
  const qty = Number(product.qty);
  const rate = Number(product.rate || 0);
  if (!(qty > 0) || rate < 0) {
    throw new HttpError(400, 'Invalid product (stock_item_id, qty > 0 required)');
  }
  const isFree = product.is_free_sample === undefined ? 1 : toBool(product.is_free_sample);
  const amount = isFree ? 0 : +(qty * rate).toFixed(2);
  return {
    clean: {
      stock_item_id: product.stock_item_id,
      item_name: nz(product.item_name),
      qty,
      unit: nz(product.unit),
      rate,
      is_free_sample: isFree,
      amount,
    },
    total: amount,
  };
}

// One product per demo. Customer allocation lives in demo_request_customers
// (see demoCustomer.model.js) — party_id/party_type are no longer stored
// directly on demo_requests.
async function insertDemo(conn, b, userId) {
  const { clean, total } = calcSingleItem(b.product);

  const [[stock]] = await conn.query(
    'SELECT crop_id FROM stock_items WHERE id = ?',
    [clean.stock_item_id]
  );
  if (!stock) throw new HttpError(404, 'Selected stock item was not found');

  const [r] = await conn.query(
    `INSERT INTO demo_requests
      (demo_type, is_distributor_sponsored,
       distributor_ledger_id, distributor_name, distributor_contact, sponsorship_share_pct,
       village, district, land_area, land_unit, soil_type, irrigation_type, sowing_date,
       expected_result_date, followup_reminder_date, field_officer_id, narration,
       crop_id, total_value, status, created_by)
     VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?, 'PENDING_APPROVAL', ?)`,
    [
      b.demo_type, toBool(b.is_distributor_sponsored),
      nz(b.distributor_ledger_id), nz(b.distributor_name),
      nz(b.distributor_contact), nz(b.sponsorship_share_pct),
      nz(b.village), nz(b.district), nz(b.land_area), nz(b.land_unit),
      nz(b.soil_type), nz(b.irrigation_type), nz(b.sowing_date),
      nz(b.expected_result_date), nz(b.followup_reminder_date),
      nz(b.field_officer_id), nz(b.narration),
      stock.crop_id || null, total, userId,
    ]
  );
  const demoId = r.insertId;
  const demoNo = `DEMO-${new Date().getFullYear()}-${String(demoId).padStart(2, '0')}`;
  await conn.query('UPDATE demo_requests SET demo_no = ? WHERE id = ?', [demoNo, demoId]);
  await insertItems(conn, demoId, [clean]);
  return { demoId, demoNo, total, productQty: clean.qty };
}

// One demo = one product row. Used by updateDemo when admin/owner changes
// the product itself.
async function replaceSingleItem(conn, demoId, product) {
  const { clean, total } = calcSingleItem(product);

  const [[stock]] = await conn.query(
    'SELECT crop_id FROM stock_items WHERE id = ?', [clean.stock_item_id]
  );
  if (!stock) throw new HttpError(404, 'Selected stock item was not found');

  const [[demo]] = await conn.query('SELECT crop_id FROM demo_requests WHERE id = ?', [demoId]);
  const [[{ cnt }]] = await conn.query(
    'SELECT COUNT(*) AS cnt FROM demo_results WHERE demo_id = ?', [demoId]
  );
  const newCrop = stock.crop_id || null;
  if (cnt > 0 && demo.crop_id && newCrop !== demo.crop_id) {
    throw new HttpError(400, 'Results are already recorded for another crop, so the product cannot be changed to a different crop');
  }

  await conn.query('DELETE FROM demo_request_items WHERE demo_id = ?', [demoId]);
  await insertItems(conn, demoId, [clean]);
  await conn.query(
    'UPDATE demo_requests SET total_value = ?, crop_id = COALESCE(?, crop_id) WHERE id = ?',
    [total, newCrop, demoId]
  );
  return { total, qty: clean.qty };
}

async function getSingleItemQty(demoId) {
  const [[row]] = await db.query(
    'SELECT qty FROM demo_request_items WHERE demo_id = ? ORDER BY id LIMIT 1',
    [demoId]
  );
  return row ? Number(row.qty) : 0;
}

// --------------------------------------------------------------------- edit
async function updateFields(conn, demoId, body) {
  const sets = [];
  const vals = [];
  for (const f of EDITABLE_FIELDS) {
    if (body[f] !== undefined) {
      sets.push(`${f} = ?`);
      vals.push(f === 'is_distributor_sponsored' ? toBool(body[f]) : nz(body[f]));
    }
  }
  // switch turned OFF -> wipe the sponsor details
  if (body.is_distributor_sponsored !== undefined && !toBool(body.is_distributor_sponsored)) {
    for (const f of ['distributor_name', 'distributor_contact', 'sponsorship_share_pct']) {
      if (!sets.some((s) => s.startsWith(`${f} =`))) { sets.push(`${f} = NULL`); }
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
            cr.crop_name AS crop_name,
            cu.name AS created_by_name, fo.name AS field_officer_name,
            fm.name AS field_officer_manager_name,
            au.name AS approved_by_name
       FROM demo_requests d
       LEFT JOIN ${PARTY_TABLE} p ON p.id = d.party_id
       LEFT JOIN crops cr ON cr.id = d.crop_id
       LEFT JOIN users cu ON cu.id = d.created_by
       LEFT JOIN users fo ON fo.id = d.field_officer_id
       LEFT JOIN users fm ON fm.id = fo.reporting_under
       LEFT JOIN users au ON au.id = d.approved_by
      WHERE d.id = ?`,
    [id]
  );
  if (!rows.length) return null;
  const demo = rows[0];

  // items now carry the crop of their stock item
  const [items] = await conn.query(
    `SELECT i.*, c.crop_name
       FROM demo_request_items i
       LEFT JOIN stock_items s ON s.id = i.stock_item_id
       LEFT JOIN crops c ON c.id = s.crop_id
      WHERE i.demo_id = ?
      ORDER BY i.id`,
    [id]
  );

  // mapped customers (active ones for the allocation table, removed ones only to name old results)
  const allCustomers = await getDemoCustomers(id, { includeRemoved: true });
  const nameById = new Map(allCustomers.map((c) => [c.id, c.party_name]));
  const customers = allCustomers
    .filter((c) => !c.is_removed)
    .map((c) => ({ ...c, parent_name: c.parent_customer_id ? nameById.get(c.parent_customer_id) || null : null }));

  const [proofRows] = await conn.query('SELECT * FROM demo_proofs WHERE demo_id = ?', [id]);

  const [resultRows] = await conn.query(
    `SELECT r.*, u.name AS submitted_by_name
       FROM demo_results r
       LEFT JOIN users u ON u.id = r.created_by
      WHERE r.demo_id = ?
      ORDER BY r.demo_request_customer_id, r.result_no`,
    [id]
  );

  // dynamic crop-growth values (result 2 and 3)
  const growthByResult = {};
  if (resultRows.length) {
    const [gv] = await conn.query(
      `SELECT v.demo_result_id, v.field_value, f.field_name, f.input_type,
              COALESCE(fm.unit_override, f.default_unit) AS unit
         FROM demo_result_growth_values v
         JOIN crop_growth_field_mapping fm ON fm.id = v.crop_growth_field_mapping_id
         JOIN crop_growth_fields f ON f.id = fm.field_id
        WHERE v.demo_result_id IN (?)
        ORDER BY fm.display_order ASC, fm.id ASC`,
      [resultRows.map((r) => r.id)]
    );
    for (const g of gv) {
      if (!growthByResult[g.demo_result_id]) growthByResult[g.demo_result_id] = [];
      growthByResult[g.demo_result_id].push(g);
    }
  }

  const proofs = await Promise.all(
    proofRows.map(async (pr) => ({ ...pr, file_url: await signPath(pr.file_path) }))
  );
  const results = await Promise.all(
    resultRows.map(async (r) => {
      const photos = parsePhotos(r.photos);
      return {
        ...r,
        photos,
        photo_urls: await Promise.all(photos.map(signPath)),
        customer_name: nameById.get(r.demo_request_customer_id) || null,
        growth_values: growthByResult[r.id] || [],
      };
    })
  );
  const [activity] = await conn.query(
    `SELECT l.*, u.name AS acted_by_name
       FROM demo_activity_log l LEFT JOIN users u ON u.id = l.acted_by
      WHERE l.demo_id = ? ORDER BY l.id`,
    [id]
  );
  return { ...demo, items, customers, proofs, results, activity, max_results: MAX_RESULTS };
}

// async function getDemoFull(conn, id) {
//   const [rows] = await conn.query(
//   `SELECT d.*, p.${PARTY_NAME_COL} AS party_name,
//             cu.name AS created_by_name, fo.name AS field_officer_name,
//             fm.name AS field_officer_manager_name,
//             au.name AS approved_by_name
//        FROM demo_requests d
//        LEFT JOIN ${PARTY_TABLE} p ON p.id = d.party_id
//        LEFT JOIN users cu ON cu.id = d.created_by
//        LEFT JOIN users fo ON fo.id = d.field_officer_id
//        LEFT JOIN users fm ON fm.id = fo.reporting_under
//        LEFT JOIN users au ON au.id = d.approved_by
//       WHERE d.id = ?`,
//     [id]
//   );
//   if (!rows.length) return null;
//   const demo = rows[0];
//   const [items] = await conn.query('SELECT * FROM demo_request_items WHERE demo_id = ?', [id]);
//   const [proofRows] = await conn.query('SELECT * FROM demo_proofs WHERE demo_id = ?', [id]);

//    const [resultRows] = await conn.query(
//     `SELECT r.*, u.name AS submitted_by_name
//        FROM demo_results r
//        LEFT JOIN users u ON u.id = r.created_by
//       WHERE r.demo_id = ?
//       ORDER BY r.result_no`,
//     [id]
//   );
//   const proofs = await Promise.all(
//     proofRows.map(async (pr) => ({ ...pr, file_url: await signPath(pr.file_path) }))
//   );
//   const results = await Promise.all(
//     resultRows.map(async (r) => {
//       const photos = parsePhotos(r.photos);
//       return { ...r, photos, photo_urls: await Promise.all(photos.map(signPath)) };
//     })
//   );
//   const [activity] = await conn.query(
//     `SELECT l.*, u.name AS acted_by_name
//        FROM demo_activity_log l LEFT JOIN users u ON u.id = l.acted_by
//       WHERE l.demo_id = ? ORDER BY l.id`,
//     [id]
//   );
//   return { ...demo, items, proofs, results, activity, max_results: MAX_RESULTS };
// }

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

// ---------------------------------------------------------- result helpers
async function attachPhotoUrls(row) {
  const photos = parsePhotos(row.photos);
  return { ...row, photos, photo_urls: await Promise.all(photos.map(signPath)) };
}

// Employee side: approved demos that still have result slots left,
// limited to demos the employee created or is assigned to.
async function getMyApprovedDemos(conn, userId, { partyId = null, search = '', page = 1, limit = 50 } = {}) {
  const where = [
    'd.status IN (?)',
    'd.results_count < ?',
    '(d.created_by = ? OR d.field_officer_id = ?)',
  ];
  const vals = [RESULT_ELIGIBLE_STATUSES, MAX_RESULTS, userId, userId];

  if (partyId) { where.push('d.party_id = ?'); vals.push(partyId); }
  if (search) {
    where.push(`(d.demo_no LIKE ? OR p.${PARTY_NAME_COL} LIKE ?)`);
    vals.push(`%${search}%`, `%${search}%`);
  }

  const lim = Math.min(Number(limit) || 50, 100);
  const off = (Math.max(Number(page), 1) - 1) * lim;

  const [rows] = await conn.query(
    `SELECT d.id, d.demo_no, d.party_id, p.${PARTY_NAME_COL} AS party_name, d.demo_type,
            d.village, d.district, d.total_value, d.status,
            d.results_count, d.results_count + 1 AS next_result_no,
            d.sowing_date, d.expected_result_date, d.followup_reminder_date, d.approved_at,
            fo.name AS field_officer_name, ap.name AS approved_by_name,
            (SELECT COUNT(*) FROM demo_request_items i WHERE i.demo_id = d.id) AS item_count,
            (SELECT MAX(r.result_date) FROM demo_results r WHERE r.demo_id = d.id) AS last_result_date
       FROM demo_requests d
       LEFT JOIN ${PARTY_TABLE} p ON p.id = d.party_id
       LEFT JOIN users fo ON fo.id = d.field_officer_id
       LEFT JOIN users ap ON ap.id = d.approved_by
      WHERE ${where.join(' AND ')}
      ORDER BY (d.followup_reminder_date IS NULL), d.followup_reminder_date ASC, d.approved_at DESC
      LIMIT ? OFFSET ?`,
    [...vals, lim, off]
  );
  return rows;
}

// All results of one demo (with signed photo URLs)
async function getResultsForDemo(conn, demoId) {
  const [rows] = await conn.query(
    `SELECT r.*, u.name AS submitted_by_name
       FROM demo_results r
       LEFT JOIN users u ON u.id = r.created_by
      WHERE r.demo_id = ?
      ORDER BY r.result_no`,
    [demoId]
  );
  return Promise.all(rows.map(attachPhotoUrls));
}

// Admin side: results across all demos with filters + outcome summary
function buildResultFilters({ demoId, partyId, employeeId, outcome, from, to, search }) {
  const where = [];
  const vals = [];
  if (demoId)     { where.push('r.demo_id = ?');      vals.push(demoId); }
  if (partyId)    { where.push('COALESCE(dc.party_id, d.party_id) = ?'); vals.push(partyId); }
  if (employeeId) { where.push('r.created_by = ?');   vals.push(employeeId); }
  if (outcome)    { where.push('r.outcome = ?');      vals.push(outcome); }
  if (from)       { where.push('r.result_date >= ?'); vals.push(from); }
  if (to)         { where.push('r.result_date <= ?'); vals.push(to); }
  if (search) {
    where.push(`(d.demo_no LIKE ? OR p.${PARTY_NAME_COL} LIKE ?)`);
    vals.push(`%${search}%`, `%${search}%`);
  }
  return { w: where.length ? `WHERE ${where.join(' AND ')}` : '', vals };
}

async function listAllResults(conn, filters, { page = 1, limit = 20 } = {}) {
  const { w, vals } = buildResultFilters(filters);
  const lim = Math.min(Number(limit) || 20, 100);
  const pg = Math.max(Number(page) || 1, 1);
  const off = (pg - 1) * lim;

  const fromJoin = `
      FROM demo_results r
      JOIN demo_requests d ON d.id = r.demo_id
      LEFT JOIN demo_request_customers dc ON dc.id = r.demo_request_customer_id
      LEFT JOIN ${PARTY_TABLE} p ON p.id = COALESCE(dc.party_id, d.party_id)`;

  const [rows] = await conn.query(
    `SELECT r.*, d.demo_no, d.demo_type, d.status AS demo_status, d.results_count,
            COALESCE(dc.party_id, d.party_id) AS party_id, dc.party_type,
            p.${PARTY_NAME_COL} AS party_name,
            d.crop_id, cr.crop_name,
            d.field_officer_id, fo.name AS field_officer_name,
            u.name AS submitted_by_name
       ${fromJoin}
       LEFT JOIN crops cr ON cr.id = d.crop_id
       LEFT JOIN users u  ON u.id  = r.created_by
       LEFT JOIN users fo ON fo.id = d.field_officer_id
       ${w}
      ORDER BY r.result_date DESC, r.id DESC
      LIMIT ? OFFSET ?`,
    [...vals, lim, off]
  );

  const [[s]] = await conn.query(
    `SELECT COUNT(*) AS total,
            SUM(r.outcome = 'POSITIVE') AS positive,
            SUM(r.outcome = 'NEUTRAL')  AS neutral,
            SUM(r.outcome = 'NEGATIVE') AS negative
       ${fromJoin}
       ${w}`,
    vals
  );

  return {
    rows: await Promise.all(rows.map(attachPhotoUrls)),
    summary: {
      total: Number(s.total) || 0,
      positive: Number(s.positive) || 0,
      neutral: Number(s.neutral) || 0,
      negative: Number(s.negative) || 0,
    },
    page: pg,
    limit: lim,
  };
}

// Demos waiting for THIS user's approval
async function pendingApprovalCount(conn, user) {
  if (await canApprove(conn, user)) {
    const [[r]] = await conn.query(
      "SELECT COUNT(*) AS cnt FROM demo_requests WHERE status = 'PENDING_APPROVAL'"
    );
    return r.cnt;
  }
  // reporting manager: only their team's demos, never their own
  const [[r]] = await conn.query(
    `SELECT COUNT(*) AS cnt
       FROM demo_requests d
      WHERE d.status = 'PENDING_APPROVAL'
        AND d.created_by <> ?
        AND (d.created_by IN (SELECT id FROM users WHERE reporting_under = ?)
          OR d.field_officer_id IN (SELECT id FROM users WHERE reporting_under = ?))`,
    [user.id, user.id, user.id]
  );
  return r.cnt;
}

// Once a demo is approved/rejected, its "new request" alerts are no longer actionable
async function clearSubmittedNotifications(demoId) {
  await db.query(
    `UPDATE demo_notifications
        SET is_read = 1, read_at = NOW()
      WHERE demo_id = ? AND type = 'DEMO_SUBMITTED' AND is_read = 0`,
    [demoId]
  );
}

async function getEligibleUnderDistributor(ledgerId, employeeId, isAdmin) {
  const ledger = await customerModel.getLedgerForEmployee(ledgerId, employeeId, isAdmin);
  if (!ledger) throw new HttpError(403, 'This distributor is not assigned to you');

  const [[row]] = await db.query('SELECT id, ledger_name FROM ledgers WHERE id = ?', [ledgerId]);
  if (!row) throw new HttpError(404, 'Distributor not found');

  const links = await customerModel.getDistributorLinks(ledgerId);

  const farmerMap = new Map();
  for (const f of links.farmers) farmerMap.set(f.id, f);
  for (const f of links.farmers_via_retailers) {
    if (!farmerMap.has(f.id)) farmerMap.set(f.id, f);
  }

  return {
    parent: { id: row.id, type: 'DISTRIBUTOR', name: row.ledger_name },
    retailers: links.retailers.map((r) => ({ id: r.id, name: r.name, firm_name: r.firm_name })),
    farmers: [...farmerMap.values()].map((f) => ({ id: f.id, name: f.name, firm_name: f.firm_name })),
  };
}

async function getEligibleUnderRetailer(retailerId, employeeId, isAdmin) {
  const retailer = await customerModel.getCustomerById(retailerId);
  if (!retailer || retailer.type !== 'retailer') throw new HttpError(400, 'Not a retailer');
  if (!(await customerModel.canManageCustomer(retailerId, employeeId, isAdmin))) {
    throw new HttpError(403, 'You cannot use this retailer');
  }

  const farmers = await customerModel.getLinkedFarmersForRetailer(retailerId);
  return {
    parent: { id: retailer.id, type: 'RETAILER', name: retailer.name },
    farmers: farmers.map((f) => ({ id: f.id, name: f.name, firm_name: f.firm_name })),
  };
}

// Last stage — no sub-customers, just confirms access.
async function getEligibleForFarmer(farmerId, employeeId, isAdmin) {
  const farmer = await customerModel.getCustomerById(farmerId);
  if (!farmer || farmer.type !== 'farmer') throw new HttpError(400, 'Not a farmer');
  if (!(await customerModel.canManageCustomer(farmerId, employeeId, isAdmin))) {
    throw new HttpError(403, 'You cannot use this farmer');
  }
  return { parent: { id: farmer.id, type: 'FARMER', name: farmer.name } };
}

// ============================================================
// SELECTION VALIDATION + INSERT (Parts 3-8, 13-17)
// ============================================================

function toQty(v) {
  if (v === undefined || v === null || v === '') return null;
  const n = Number(v);
  if (!Number.isFinite(n) || n < 0) throw new HttpError(400, 'Invalid allocated quantity');
  return n;
}

/**
 * selections: [
 *   { party_type: 'DISTRIBUTOR', ledger_id, allocated_qty?,
 *     sub_customers?: [{ party_type: 'RETAILER'|'FARMER', party_id, allocated_qty? }] },
 *   { party_type: 'RETAILER', party_id, allocated_qty?,
 *     sub_customers?: [{ party_type: 'FARMER', party_id, allocated_qty? }] },
 *   { party_type: 'FARMER', party_id, allocated_qty? },   // no sub_customers ever
 *   ... (multiple distributors / retailers / farmers all allowed)
 * ]
 *
 * Returns a flat array of rows ready for insertDemoCustomers, every one of
 * them already checked against the real mapping tables and the employee's
 * own access rights — nothing here trusts the client's party_type/party_id.
 */
async function resolveSelections(selections, employeeId, isAdmin) {
  if (!Array.isArray(selections) || selections.length === 0) {
    throw new HttpError(400, 'Select at least one distributor, retailer or farmer');
  }

  const rows = [];
  const seen = new Set();

  const addRow = (partyType, partyId, isPrimary, allocatedQty, parentIndex) => {
    const key = `${partyType}:${partyId}`;
    if (seen.has(key)) {
      throw new HttpError(400, `${partyType.toLowerCase()} ${partyId} is selected more than once`);
    }
    seen.add(key);
    rows.push({ party_type: partyType, party_id: partyId, is_primary: isPrimary ? 1 : 0, allocated_qty: allocatedQty, parent_index: parentIndex });
    return rows.length - 1;
  };

  for (const sel of selections) {
    if (!sel || !PARTY_TYPES.includes(sel.party_type)) {
      throw new HttpError(400, `Invalid party_type: ${sel && sel.party_type}`);
    }

    if (sel.party_type === 'DISTRIBUTOR') {
      const ledgerId = Number(sel.ledger_id);
      if (!ledgerId) throw new HttpError(400, 'ledger_id is required for a distributor selection');

      // materialize (or reuse) the customers row for this ledger — same
      // function the visit-mapping flow already uses.
      const partyId = await customerModel.findOrCreateDistributorCustomer(ledgerId, employeeId);
      const primaryIndex = addRow('DISTRIBUTOR', partyId, true, toQty(sel.allocated_qty), null);

      if (Array.isArray(sel.sub_customers) && sel.sub_customers.length > 0) {
        const eligible = await getEligibleUnderDistributor(ledgerId, employeeId, isAdmin);
        const eligibleRetailerIds = new Set(eligible.retailers.map((r) => r.id));
        const eligibleFarmerIds = new Set(eligible.farmers.map((f) => f.id));

        for (const sub of sel.sub_customers) {
          const subId = Number(sub.party_id);
          if (sub.party_type === 'RETAILER') {
            if (!eligibleRetailerIds.has(subId)) throw new HttpError(400, `Retailer ${subId} is not mapped under this distributor`);
          } else if (sub.party_type === 'FARMER') {
            if (!eligibleFarmerIds.has(subId)) throw new HttpError(400, `Farmer ${subId} is not mapped under this distributor`);
          } else {
            throw new HttpError(400, "A distributor's sub-customer must be RETAILER or FARMER");
          }
          addRow(sub.party_type, subId, false, toQty(sub.allocated_qty), primaryIndex);
        }
      }

    } else if (sel.party_type === 'RETAILER') {
      const retailerId = Number(sel.party_id);
      if (!retailerId) throw new HttpError(400, 'party_id is required for a retailer selection');

      const eligible = await getEligibleUnderRetailer(retailerId, employeeId, isAdmin);
      const primaryIndex = addRow('RETAILER', retailerId, true, toQty(sel.allocated_qty), null);

      if (Array.isArray(sel.sub_customers) && sel.sub_customers.length > 0) {
        const eligibleFarmerIds = new Set((eligible.farmers || []).map((f) => f.id));
        for (const sub of sel.sub_customers) {
          if (sub.party_type !== 'FARMER') throw new HttpError(400, "A retailer's sub-customer must be FARMER");
          const subId = Number(sub.party_id);
          if (!eligibleFarmerIds.has(subId)) throw new HttpError(400, `Farmer ${subId} is not mapped under this retailer`);
          addRow('FARMER', subId, false, toQty(sub.allocated_qty), primaryIndex);
        }
      }

    } else { // FARMER — always a primary, never has sub_customers
      const farmerId = Number(sel.party_id);
      if (!farmerId) throw new HttpError(400, 'party_id is required for a farmer selection');
      await getEligibleForFarmer(farmerId, employeeId, isAdmin);
      addRow('FARMER', farmerId, true, toQty(sel.allocated_qty), null);
    }
  }

  return rows;
}

// Part 7-8: sum <= requested qty; partial/zero allocation is valid.
function validateAllocationTotal(rows, productQty) {
  const total = rows.reduce((s, r) => s + (r.allocated_qty || 0), 0);
  if (total > productQty + 1e-9) {
    throw new HttpError(400, `Total allocated quantity (${total}) exceeds the requested quantity (${productQty})`);
  }
  return {
    requested_qty: productQty,
    allocated_qty: +total.toFixed(2),
    remaining_qty: +(productQty - total).toFixed(2),
  };
}

// Two-phase insert: primaries first (so we know their ids), then sub-rows
// with parent_customer_id resolved.
async function insertDemoCustomers(conn, demoId, rows, employeeId) {
  const insertedIds = new Array(rows.length).fill(null);

  for (let i = 0; i < rows.length; i++) {
    const r = rows[i];
    if (r.parent_index !== null) continue;
    const [res] = await conn.query(
      `INSERT INTO demo_request_customers
        (demo_id, party_type, party_id, is_primary, parent_customer_id, allocated_qty, created_by)
       VALUES (?,?,?,?,NULL,?,?)`,
      [demoId, r.party_type, r.party_id, r.is_primary, r.allocated_qty, employeeId]
    );
    insertedIds[i] = res.insertId;
  }

  for (let i = 0; i < rows.length; i++) {
    const r = rows[i];
    if (r.parent_index === null) continue;
    const parentId = insertedIds[r.parent_index];
    const [res] = await conn.query(
      `INSERT INTO demo_request_customers
        (demo_id, party_type, party_id, is_primary, parent_customer_id, allocated_qty, created_by)
       VALUES (?,?,?,?,?,?,?)`,
      [demoId, r.party_type, r.party_id, r.is_primary, parentId, r.allocated_qty, employeeId]
    );
    insertedIds[i] = res.insertId;
  }

  return insertedIds;
}

// ============================================================
// ADMIN EDIT-MERGE (safe add/remove without destroying results)
// ============================================================

// All rows for a demo, active by default.
async function getDemoCustomers(demoId, { includeRemoved = false } = {}) {
  const [rows] = await db.query(
    `SELECT dc.*, c.name AS party_name, c.firm_name AS party_firm_name, c.contact_number AS party_contact
       FROM demo_request_customers dc
       JOIN customers c ON c.id = dc.party_id
      WHERE dc.demo_id = ? ${includeRemoved ? '' : 'AND dc.is_removed = 0'}
      ORDER BY dc.is_primary DESC, dc.parent_customer_id IS NULL DESC, dc.id ASC`,
    [demoId]
  );
  return rows;
}

// Merge newly-resolved selections into the demo's existing customer rows.
// Never deletes a row — only flips is_removed — so any demo_results tied to
// a row survive untouched.
async function mergeDemoCustomers(conn, demoId, resolvedRows, employeeId) {
  const [existing] = await conn.query(
    'SELECT * FROM demo_request_customers WHERE demo_id = ? FOR UPDATE',
    [demoId]
  );
  const byKey = new Map(existing.map((r) => [`${r.party_type}:${r.party_id}`, r]));
  const keptKeys = new Set();
  const insertedIds = new Array(resolvedRows.length).fill(null);

  let added = 0, reactivated = 0, updated = 0;

  // pass 1: primaries
  for (let i = 0; i < resolvedRows.length; i++) {
    const r = resolvedRows[i];
    if (r.parent_index !== null) continue;
    const key = `${r.party_type}:${r.party_id}`;
    keptKeys.add(key);
    const existingRow = byKey.get(key);

    if (existingRow) {
      await conn.query(
        `UPDATE demo_request_customers
            SET is_primary = 1, parent_customer_id = NULL, allocated_qty = ?, is_removed = 0
          WHERE id = ?`,
        [r.allocated_qty, existingRow.id]
      );
      insertedIds[i] = existingRow.id;
      if (existingRow.is_removed) reactivated++; else updated++;
    } else {
      const [res] = await conn.query(
        `INSERT INTO demo_request_customers
          (demo_id, party_type, party_id, is_primary, parent_customer_id, allocated_qty, created_by)
         VALUES (?,?,?,1,NULL,?,?)`,
        [demoId, r.party_type, r.party_id, r.allocated_qty, employeeId]
      );
      insertedIds[i] = res.insertId;
      added++;
    }
  }

  // pass 2: sub-customers
  for (let i = 0; i < resolvedRows.length; i++) {
    const r = resolvedRows[i];
    if (r.parent_index === null) continue;
    const key = `${r.party_type}:${r.party_id}`;
    keptKeys.add(key);
    const parentId = insertedIds[r.parent_index];
    const existingRow = byKey.get(key);

    if (existingRow) {
      await conn.query(
        `UPDATE demo_request_customers
            SET is_primary = 0, parent_customer_id = ?, allocated_qty = ?, is_removed = 0
          WHERE id = ?`,
        [parentId, r.allocated_qty, existingRow.id]
      );
      insertedIds[i] = existingRow.id;
      if (existingRow.is_removed) reactivated++; else updated++;
    } else {
      const [res] = await conn.query(
        `INSERT INTO demo_request_customers
          (demo_id, party_type, party_id, is_primary, parent_customer_id, allocated_qty, created_by)
         VALUES (?,?,?,0,?,?,?)`,
        [demoId, r.party_type, r.party_id, parentId, r.allocated_qty, employeeId]
      );
      insertedIds[i] = res.insertId;
      added++;
    }
  }

  // pass 3: soft-remove anything active that wasn't in the new set
  let removed = 0;
  for (const row of existing) {
    const key = `${row.party_type}:${row.party_id}`;
    if (!row.is_removed && !keptKeys.has(key)) {
      await conn.query('UPDATE demo_request_customers SET is_removed = 1 WHERE id = ?', [row.id]);
      removed++;
    }
  }

  const [finalRows] = await conn.query(
    'SELECT * FROM demo_request_customers WHERE demo_id = ? AND is_removed = 0',
    [demoId]
  );

  return { added, reactivated, updated, removed, rows: finalRows };
}

// Quantity edits for customers already on the demo. Runs inside the caller's transaction.
async function applyAllocationEdits(conn, demoId, allocations, productQty) {
  if (!Array.isArray(allocations)) throw new HttpError(400, 'allocations must be an array');

  const [rows] = await conn.query(
    'SELECT id, allocated_qty FROM demo_request_customers WHERE demo_id = ? AND is_removed = 0 FOR UPDATE',
    [demoId]
  );
  const next = new Map(rows.map((r) => [Number(r.id), r.allocated_qty == null ? null : Number(r.allocated_qty)]));
  const changed = [];

  for (const a of allocations) {
    const cid = Number(a.id);
    if (!next.has(cid)) throw new HttpError(400, `Customer row ${a.id} is not part of this demo`);
    const q = toQty(a.allocated_qty); // '' / null -> null, invalid -> 400
    if ((next.get(cid) ?? null) !== q) changed.push([q, cid]);
    next.set(cid, q);
  }

  const total = [...next.values()].reduce((s, v) => s + (v || 0), 0);
  if (total > productQty + 1e-9) {
    throw new HttpError(400, `Total allocated quantity (${+total.toFixed(2)}) exceeds the requested quantity (${productQty})`);
  }

  for (const [q, cid] of changed) {
    await conn.query('UPDATE demo_request_customers SET allocated_qty = ? WHERE id = ? AND demo_id = ?', [q, cid, demoId]);
  }

  return {
    requested_qty: productQty,
    allocated_qty: +total.toFixed(2),
    remaining_qty: +(productQty - total).toFixed(2),
    changed_count: changed.length,
  };
}

module.exports = {
  db, HttpError, MAX_RESULTS, MAX_RESULT_PHOTOS, RESULT_ELIGIBLE_STATUSES, PARTY_TABLE, PARTY_NAME_COL,
  getApproverIds, canApprove, canApproveDemo, hasDirectReports, getManagerIds, notifyUsers,
  listNotifications, unreadCount, markRead, markAllRead,
  insertDemo, updateFields, replaceItems, saveProofs, uploadProofs, uploadResultPhotos, log, getDemoFull,
  getFieldOfficers, getPartyDropdown,
  getMyApprovedDemos, getResultsForDemo, listAllResults,
  pendingApprovalCount, clearSubmittedNotifications,
  replaceSingleItem, getSingleItemQty,
  signPathSafe: signPath,

  // customer-mapping bridge
  getEligibleUnderDistributor,
  getEligibleUnderRetailer,
  getEligibleForFarmer,
  resolveSelections,
  validateAllocationTotal,
  insertDemoCustomers,
  getDemoCustomers,
  mergeDemoCustomers, applyAllocationEdits, parseTypes
};