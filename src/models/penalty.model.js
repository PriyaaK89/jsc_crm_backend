const db = require("../config/db"); // adjust to your actual db module

exports.createPenalty = async ({ employee_id, reason, amount, imposed_by }) => {
  const connection = await db.getConnection();
  try {
    const [result] = await connection.query(
      `INSERT INTO emp_penalty (employee_id, reason, amount, imposed_by)
       VALUES (?, ?, ?, ?)`,
      [employee_id, reason, amount, imposed_by]
    );
    return result.insertId;
  } finally {
    connection.release();
  }
};

exports.markPenaltyNotified = async (penaltyId) => {
  const connection = await db.getConnection();
  try {
    await connection.query(
      `UPDATE emp_penalty SET whatsapp_sent = 1 WHERE id = ?`,
      [penaltyId]
    );
  } finally {
    connection.release();
  }
};