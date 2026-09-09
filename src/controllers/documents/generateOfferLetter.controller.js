const db = require("../../config/db");
const {
  getFinancialYear,
  getCurrentMonth,
} = require("../../utils/helper");

exports.getNextDocumentReference = async (req, res) => {
  try {
    const {
      employee_id,
      document_type,
    } = req.query;

    if (!employee_id) {
      return res.status(400).json({
        success: false,
        message: "employee_id is required",
      });
    }

    if (!document_type) {
      return res.status(400).json({
        success: false,
        message: "document_type is required",
      });
    }

    //--------------------------------------------------
    // Check if employee already has this document
    //--------------------------------------------------

    const [existing] = await db.query(
      `
      SELECT reference_no
      FROM employee_documents
      WHERE employee_id=?
      AND document_type=?
      LIMIT 1
      `,
      [employee_id, document_type]
    );

    if (
      existing.length &&
      existing[0].reference_no &&
      existing[0].reference_no.trim() !== ""
    ) {
      return res.json({
        success: true,
        existing: true,
        referenceNo: existing[0].reference_no,
      });
    }

    //--------------------------------------------------
    // Prefix
    //--------------------------------------------------

    const prefixes = {
      offer_letter: "HR/OFFER",
      joining_letter: "HR/JOIN",
      appointment_letter: "HR/APPOINT",
      experience_letter: "HR/EXP",
      relieving_letter: "HR/REL",
    };

    const documentPrefix = prefixes[document_type];

    if (!documentPrefix) {
      return res.status(400).json({
        success: false,
        message: "Invalid document_type",
      });
    }

    const financialYear = getFinancialYear();
    const month = getCurrentMonth();

    const prefix =
      `${documentPrefix}/${financialYear}/${month}/`;

    //--------------------------------------------------
    // Find highest reference
    //--------------------------------------------------

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

    rows.forEach((row) => {
      const parts = row.reference_no.split("/");
      const last = parseInt(parts[parts.length - 1], 10);

      if (!isNaN(last) && last > maxNumber) {
        maxNumber = last;
      }
    });

    const nextNumber = maxNumber + 1;

    const referenceNo =
      prefix +
      String(nextNumber).padStart(3, "0");

    return res.json({
      success: true,
      existing: false,
      referenceNo,
    });

  } catch (err) {
    console.log(err);

    return res.status(500).json({
      success: false,
      message: err.message,
    });
  }
};