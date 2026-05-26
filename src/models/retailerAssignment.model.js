const db = require("../config/db");

/* =====================================================
    GET ALL RETAILERS WITH ASSIGNED EMPLOYEE
===================================================== */

exports.getRetailersWithEmployee = async () => {

  const [rows] = await db.query(`

    SELECT

      c.id AS retailer_id,
      c.name AS retailer_name,
      c.firm_name,

      u.id AS employee_id,
      u.name AS employee_name

    FROM customers c

    LEFT JOIN retailer_assignments ra
      ON c.id = ra.retailer_id

    LEFT JOIN users u
      ON ra.employee_id = u.id

    WHERE c.type = 'retailer'

    ORDER BY c.name ASC

  `);

  return rows;
};

/* =====================================================
    ASSIGN OR UPDATE RETAILER
===================================================== */

exports.assignOrUpdateRetailer = async (
  retailer_id,
  employee_id,
  assigned_by
) => {

  // Check retailer already assigned or not

  const [existing] = await db.query(`

    SELECT id

    FROM retailer_assignments

    WHERE retailer_id = ?

  `, [retailer_id]);

  // =====================================================
  // UPDATE EXISTING ASSIGNMENT
  // =====================================================

  if (existing.length > 0) {

    await db.query(`

      UPDATE retailer_assignments

      SET
        employee_id = ?,
        assigned_by = ?

      WHERE retailer_id = ?

    `, [
      employee_id,
      assigned_by,
      retailer_id
    ]);

    return "updated";

  }

  // =====================================================
  // NEW ASSIGNMENT
  // =====================================================

  else {

    await db.query(`

      INSERT INTO retailer_assignments
      (
        retailer_id,
        employee_id,
        assigned_by
      )

      VALUES (?, ?, ?)

    `, [
      retailer_id,
      employee_id,
      assigned_by
    ]);

    return "assigned";

  }

};