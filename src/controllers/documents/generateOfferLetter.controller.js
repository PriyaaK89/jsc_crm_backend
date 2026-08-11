const db = require("../../config/db");

const {
    getFinancialYear,
    getCurrentMonth,
} = require("../../utils/helper");

exports.getNextOfferReference = async (req, res) => {
  try {
    const { employee_id } = req.query;

    // Check whether this employee already has an offer letter
    const [existing] = await db.query(
      `SELECT reference_no
       FROM employee_documents
       WHERE employee_id = ?
         AND document_type = 'offer_letter'
       LIMIT 1`,
      [employee_id]
    );

    if (existing.length > 0 && existing[0].reference_no) {
      return res.json({
        success: true,
        referenceNo: existing[0].reference_no,
        existing: true,
      });
    }

    // Otherwise generate the next reference
    const financialYear = getFinancialYear();
    const month = getCurrentMonth();

    const prefix = `HR/OFFER/${financialYear}/${month}/`;

    const [rows] = await db.query(
      `SELECT reference_no
       FROM employee_documents
       WHERE reference_no LIKE ?
       ORDER BY id DESC
       LIMIT 1`,
      [`${prefix}%`]
    );

    let next = 1;

    if (rows.length) {
      next =
        parseInt(rows[0].reference_no.split("/").pop(), 10) + 1;
    }

    const referenceNo =
      prefix + String(next).padStart(3, "0");

    res.json({
      success: true,
      referenceNo,
      existing: false,
    });

  } catch (err) {
    console.log(err);

    res.status(500).json({
      success: false,
      message: err.message,
    });
  }
};