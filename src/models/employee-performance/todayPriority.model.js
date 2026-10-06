const db = require("../../config/db");

// ⚠ confirm with: SELECT DISTINCT transaction_type, status FROM transaction_approvals;
const SALES_TXN_TYPE = "SALES";
const RETURNED_STATUS = "RETURNED";
const REJECTED_STATUS = "REJECTED";
exports.RETURNED_STATUS = RETURNED_STATUS;
exports.REJECTED_STATUS = REJECTED_STATUS;

// keep in sync with demoModel.js
const DEMO_RESULT_ELIGIBLE_STATUSES = ["APPROVED", "IN_PROGRESS"];
const DEMO_MAX_RESULTS = 3;
exports.DEMO_MAX_RESULTS = DEMO_MAX_RESULTS;

// 1) Overdue bills, one row per party
exports.getOverdueParties = async (employeeId, today) => {
  const [rows] = await db.query(
    `SELECT
       o.ledger_id,
       l.ledger_name,
       COALESCE(NULLIF(lod.firm_name, ''), l.ledger_name) AS party_name,
       lod.contact AS contact_number,
       COALESCE(NULLIF(l.location, ''), NULLIF(lod.landmark, ''), lod.district) AS area,
       o.overdue_bills,
       o.overdue_amount,
       DATE_FORMAT(o.oldest_due_date, '%Y-%m-%d') AS oldest_due_date,
       DATEDIFF(?, o.oldest_due_date) AS overdue_days
     FROM (
       SELECT
         sbr.ledger_id,
         COUNT(*) AS overdue_bills,
         SUM(sbr.pending_amount) AS overdue_amount,
         MIN(sbr.due_date) AS oldest_due_date
       FROM sales_bill_references sbr
       INNER JOIN ledgers lx
         ON lx.id = sbr.ledger_id AND lx.employee_under = ?
       WHERE sbr.pending_amount > 0
         AND sbr.due_date IS NOT NULL
         AND sbr.due_date < ?
         AND sbr.status IN ('PENDING', 'PARTIAL')
       GROUP BY sbr.ledger_id
     ) o
     INNER JOIN ledgers l ON l.id = o.ledger_id
     LEFT JOIN ledger_other_details lod ON lod.ledger_id = l.id
     ORDER BY o.overdue_amount DESC, overdue_days DESC`,
    [today, employeeId, today]
  );
  return rows;
};

// 2) Visit reminders: today's + missed ones from the last N days
exports.getFollowUps = async (employeeId, today, lookbackDays = 7) => {
  const [rows] = await db.query(
    `SELECT
       v.id AS visit_id,
       v.customer_id,
       v.visit_type,
       v.visit_purpose,
       v.reminder_reason,
       v.priority,
       DATE_FORMAT(v.reminder_date, '%Y-%m-%d') AS reminder_date,
       TIME_FORMAT(v.reminder_time, '%H:%i') AS reminder_time,
       v.latitude,
       v.longitude,
       COALESCE(NULLIF(c.firm_name, ''), c.name) AS party_name,
       c.name AS contact_person,
       c.contact_number,
       c.area,
       c.district,
       c.address
     FROM visits v
     INNER JOIN customers c ON c.id = v.customer_id
     WHERE v.user_id = ?
       AND v.reminder_date IS NOT NULL
       AND v.reminder_status = 'PENDING'
       AND v.reminder_date <= ?
       AND v.reminder_date >= DATE_SUB(?, INTERVAL ? DAY)
       AND NOT EXISTS (
         SELECT 1 FROM visits v2
         WHERE v2.user_id = v.user_id
           AND v2.customer_id = v.customer_id
           AND v2.id > v.id
           AND DATE(v2.created_at) >= v.reminder_date
       )
     ORDER BY
       (v.reminder_date = ?) DESC,
       FIELD(COALESCE(v.priority, 'low'), 'high', 'medium', 'low'),
       v.reminder_time IS NULL,
       v.reminder_time,
       v.reminder_date`,
    [employeeId, today, today, lookbackDays, today]
  );
  return rows;
};

exports.markReminderDone = async (visitId, userId) => {
  const [result] = await db.query(
    `UPDATE visits
     SET reminder_status = 'DONE', reminder_done_at = NOW()
     WHERE id = ? AND user_id = ? AND reminder_date IS NOT NULL`,
    [visitId, userId]
  );
  return result.affectedRows;
};

// 3) Orders requested by this employee, pending approval
exports.getPendingApprovals = async (employeeId, { seniorStageOnly = true } = {}) => {
  const [rows] = await db.query(
    `SELECT
       ta.id,
       ta.order_no,
       ta.approval_level,
       ta.payload_json,
       ta.current_status_message,
       ta.created_at,
       cu.name AS current_approver_name
     FROM transaction_approvals ta
     LEFT JOIN users cu ON cu.id = ta.current_approver_id
     WHERE ta.created_by = ?
       AND ta.status = 'PENDING'
       AND ta.transaction_type = ?
       ${seniorStageOnly ? "AND ta.approval_level = 'SENIOR'" : ""}
     ORDER BY ta.created_at DESC`,
    [employeeId, SALES_TXN_TYPE]
  );
  return rows;
};

// 4) Orders returned to this employee + recently rejected (last 3 days)
exports.getReturnedOrders = async (employeeId, today) => {
  const [rows] = await db.query(
    `SELECT
       ta.id,
       ta.order_no,
       ta.status,
       ta.returned_from_level,
       ta.payload_json,
       ta.remarks,
       COALESCE(ta.returned_at, ta.rejected_at) AS action_at
     FROM transaction_approvals ta
     WHERE ta.transaction_type = ?
       AND (
         (ta.status = ? AND ta.returned_to_user_id = ?)
         OR (ta.status = ? AND ta.created_by = ?
             AND ta.rejected_at >= DATE_SUB(?, INTERVAL 3 DAY))
       )
     ORDER BY action_at DESC`,
    [SALES_TXN_TYPE, RETURNED_STATUS, employeeId, REJECTED_STATUS, employeeId, today]
  );
  return rows;
};

// 5) Demos whose result is due (follow-up date reached, results still open)
exports.getDemoFollowUps = async (employeeId, today, lookbackDays = 30) => {
  const DUE = "COALESCE(d.followup_reminder_date, d.expected_result_date)";

  const [rows] = await db.query(
    `SELECT
       d.id AS demo_id,
       d.demo_no,
       d.status,
       d.village,
       d.district,
       d.results_count,
       d.results_count + 1 AS next_result_no,
       DATE_FORMAT(${DUE}, '%Y-%m-%d') AS due_date,
       cr.crop_name,
       (SELECT COALESCE(NULLIF(c.firm_name, ''), c.name)
          FROM demo_request_customers dc
          JOIN customers c ON c.id = dc.party_id
         WHERE dc.demo_id = d.id AND dc.is_removed = 0 AND dc.is_primary = 1
         ORDER BY dc.id LIMIT 1) AS party_name,
       (SELECT COUNT(*) FROM demo_request_customers dc2
         WHERE dc2.demo_id = d.id AND dc2.is_removed = 0) AS customer_count
     FROM demo_requests d
     LEFT JOIN crops cr ON cr.id = d.crop_id
     WHERE d.status IN (?)
       AND d.results_count < ?
       AND d.created_by = ?
       AND ${DUE} <= ?
       AND ${DUE} >= DATE_SUB(?, INTERVAL ? DAY)
       AND NOT EXISTS (
         SELECT 1 FROM demo_results r
         WHERE r.demo_id = d.id AND r.result_date >= ${DUE}
       )
     ORDER BY (${DUE} = ?) DESC, ${DUE} ASC`,
    [DEMO_RESULT_ELIGIBLE_STATUSES, DEMO_MAX_RESULTS, employeeId, today, today, lookbackDays, today]
  );
  return rows;
};

exports.getLedgerNames = async (ids) => {
  if (!ids.length) return {};
  const [rows] = await db.query(
    `SELECT id, ledger_name FROM ledgers WHERE id IN (${ids.map(() => "?").join(",")})`,
    ids
  );
  return Object.fromEntries(rows.map((r) => [r.id, r.ledger_name]));
};