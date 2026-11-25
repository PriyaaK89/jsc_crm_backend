// Dealer reminders (Dealer List -> Add Reminder / History).
// Table: dealer_reminders, see sql/2026_11_24_dealer_reminders.sql
//   status: PENDING -> DONE | CANCELLED
const db = require("../config/db");

const STATUSES = ["PENDING", "DONE", "CANCELLED"];
const MAX_LIMIT = 100;

const shape = (r) => ({
  id: r.id,
  ledger_id: r.ledger_id,
  user_id: r.user_id,
  employee_name: r.employee_name || "",
  remind_date: r.remind_date ? String(r.remind_date).slice(0, 10) : null,
  remind_time: r.remind_time ? String(r.remind_time).slice(0, 5) : null,
  note: r.note || "",
  status: r.status,
  done_at: r.done_at || null,
  created_at: r.created_at,
});

const SELECT_SQL = `
  SELECT dr.id, dr.ledger_id, dr.user_id, u.name AS employee_name, dr.remind_date, dr.remind_time,
         dr.note, dr.status, dr.done_at, dr.created_at
  FROM dealer_reminders dr
  LEFT JOIN users u ON u.id = dr.user_id`;

/** @returns the new reminder */
const createReminder = async ({ ledgerId, userId, remindDate, remindTime, note }) => {
  const [res] = await db.query(
    `INSERT INTO dealer_reminders (ledger_id, user_id, remind_date, remind_time, note, status)
     VALUES (?, ?, ?, ?, ?, 'PENDING')`,
    [ledgerId, userId, remindDate, remindTime || null, note],
  );
  return getReminderById(res.insertId);
};

const getReminderById = async (id) => {
  const [rows] = await db.query(`${SELECT_SQL} WHERE dr.id = ?`, [id]);
  return rows[0] ? shape(rows[0]) : null;
};

/**
 * Reminders of one dealer. Pending first (soonest date first), then the rest (newest first).
 * @param {{ ledgerId: number, userIds: number[]|null, status?: string, page?: number, limit?: number }} f
 *   userIds = whose reminders may be shown (null = everybody's)
 */
const listReminders = async ({ ledgerId, userIds, status, page = 1, limit = 50 }) => {
  const lim = Math.min(Math.max(Number(limit) || 50, 1), MAX_LIMIT);
  const pg = Math.max(Number(page) || 1, 1);
  if (userIds && !userIds.length) {
    return { items: [], pagination: { page: pg, limit: lim, total: 0, total_pages: 1, has_more: false } };
  }

  const where = ["dr.ledger_id = ?"];
  const params = [ledgerId];
  if (userIds) {
    where.push("dr.user_id IN (?)");
    params.push(userIds);
  }
  if (status) {
    where.push("dr.status = ?");
    params.push(status);
  }

  const [[cnt]] = await db.query(
    `SELECT COUNT(*) AS total FROM dealer_reminders dr WHERE ${where.join(" AND ")}`,
    params,
  );
  const [rows] = await db.query(
    `${SELECT_SQL}
     WHERE ${where.join(" AND ")}
     ORDER BY CASE WHEN dr.status = 'PENDING' THEN 0 ELSE 1 END,
              CASE WHEN dr.status = 'PENDING' THEN dr.remind_date END ASC,
              CASE WHEN dr.status = 'PENDING' THEN dr.remind_time END ASC,
              dr.id DESC
     LIMIT ? OFFSET ?`,
    [...params, lim, (pg - 1) * lim],
  );

  const total = Number((cnt && cnt.total) || 0);
  const totalPages = Math.max(Math.ceil(total / lim), 1);
  return {
    items: rows.map(shape),
    pagination: { page: pg, limit: lim, total, total_pages: totalPages, has_more: pg < totalPages },
  };
};

/** PENDING -> DONE / CANCELLED. Returns the updated reminder, or null when it was not PENDING. */
const setStatus = async (id, status) => {
  const [res] = await db.query(
    `UPDATE dealer_reminders
     SET status = ?, done_at = CASE WHEN ? = 'DONE' THEN NOW() ELSE NULL END
     WHERE id = ? AND status = 'PENDING'`,
    [status, status, id],
  );
  if (!res.affectedRows) return null;
  return getReminderById(id);
};

module.exports = { STATUSES, createReminder, getReminderById, listReminders, setStatus };
