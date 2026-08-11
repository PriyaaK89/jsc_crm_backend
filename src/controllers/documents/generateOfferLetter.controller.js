const db = require("../../config/db");

const {
    getFinancialYear,
    getCurrentMonth,
} = require("../../utils/helper");



exports.getNextOfferReference = async (req, res) => {
  try {
    const { employee_id } = req.query;

    // ----------------------------------------------------
    // If employee already has an offer letter,
    // always return the same reference number.
    // ----------------------------------------------------
    const [existing] = await db.query(
      `
      SELECT reference_no
      FROM employee_documents
      WHERE employee_id = ?
        AND document_type = 'offer_letter'
      LIMIT 1
      `,
      [employee_id]
    );

    if (
      existing.length > 0 &&
      existing[0].reference_no &&
      existing[0].reference_no.trim() !== ""
    ) {
      return res.json({
        success: true,
        existing: true,
        referenceNo: existing[0].reference_no,
      });
    }

    // ----------------------------------------------------
    // Generate next reference
    // ----------------------------------------------------
    const financialYear = getFinancialYear();
    const month = getCurrentMonth();

    const prefix = `HR/OFFER/${financialYear}/${month}/`;

    const [rows] = await db.query(
      `
      SELECT reference_no
      FROM employee_documents
      WHERE reference_no IS NOT NULL
        AND reference_no <> ''
        AND reference_no LIKE ?
      `,
      [`${prefix}%`]
    );

    let maxNumber = 0;

    for (const row of rows) {
      const parts = row.reference_no.split("/");
      const number = parseInt(parts[parts.length - 1], 10);

      if (!isNaN(number) && number > maxNumber) {
        maxNumber = number;
      }
    }

    const nextNumber = maxNumber + 1;

    const referenceNo =
      prefix + String(nextNumber).padStart(3, "0");

    return res.json({
      success: true,
      existing: false,
      referenceNo,
    });
  } catch (err) {
    console.error(err);

    return res.status(500).json({
      success: false,
      message: err.message,
    });
  }
};
