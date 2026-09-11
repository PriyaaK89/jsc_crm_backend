const db = require("../config/db");

// Get all holidays for a given month/year
exports.getHolidaysByMonth = async (month, year) => {
  const [rows] = await db.query(
    `SELECT id, holiday_date, holiday_name, created_by, created_at, updated_at
     FROM company_holidays
     WHERE MONTH(holiday_date) = ? AND YEAR(holiday_date) = ?
     ORDER BY holiday_date ASC`,
    [month, year],
  );
  return rows;
};

// Get a single holiday by id (used before update/delete to confirm it exists)
exports.getHolidayById = async (id) => {
  const [rows] = await db.query(
    `SELECT id, holiday_date, holiday_name FROM company_holidays WHERE id = ?`,
    [id],
  );
  return rows[0];
};

// Bulk insert — HR selects multiple dates on the calendar, saves at once.
// INSERT IGNORE so re-saving a date that's already a holiday doesn't error out.
exports.bulkCreateHolidays = async (holidays, createdBy) => {
  // holidays = [{ date: '2026-10-02', name: 'Gandhi Jayanti' }, ...]
  const values = holidays.map((h) => [h.date, h.name, createdBy]);

  const [result] = await db.query(
    `INSERT IGNORE INTO company_holidays (holiday_date, holiday_name, created_by)
     VALUES ?`,
    [values],
  );
  return result.affectedRows; // number actually inserted (duplicates skipped)
};

exports.updateHoliday = async (id, { date, name }) => {
  return db.query(
    `UPDATE company_holidays SET holiday_date = ?, holiday_name = ? WHERE id = ?`,
    [date, name, id],
  );
};

exports.deleteHoliday = async (id) => {
  return db.query(`DELETE FROM company_holidays WHERE id = ?`, [id]);
};

// Used by getWorkingDaysInfo() in the attendance controller —
// excludes holidays that fall on Sunday so they're not double-subtracted
exports.countHolidaysExcludingSunday = async (month, year) => {
  const [rows] = await db.query(
    `SELECT COUNT(*) as cnt FROM company_holidays
     WHERE MONTH(holiday_date) = ? AND YEAR(holiday_date) = ?
       AND DAYOFWEEK(holiday_date) != 1`,
    [month, year],
  );
  return rows[0].cnt || 0;
};

exports.getHolidaysByYear = async (year) => {
  const [rows] = await db.query(
    `SELECT id, holiday_date, holiday_name, created_by, created_at, updated_at
     FROM company_holidays
     WHERE YEAR(holiday_date) = ?
     ORDER BY holiday_date ASC`,
    [year],
  );
  return rows;
};