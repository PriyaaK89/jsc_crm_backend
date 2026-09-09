const transactionDocumentsModel = require("../../models/reports/transactionDocuments.model");

exports.getTransactionDocuments = async (req, res) => {
  try {
    const { transaction_type, from_date, to_date, page = 1, limit = 10, search = "", } = req.query;

    if (!transaction_type || !from_date || !to_date) {
      return res.status(400).json({
        success: false,
        message: "transaction_type, from_date, and to_date are required",
      });
    }

    const validTypes = transactionDocumentsModel.getAvailableTransactionTypes();
    if (!validTypes.includes(transaction_type)) {
      return res.status(400).json({
        success: false,
        message: `Invalid transaction_type. Must be one of: ${validTypes.join(", ")}`,
      });
    }

    const data = await transactionDocumentsModel.getTransactionDocuments(
      transaction_type,
      from_date,
      to_date,
      Number(page),
      Number(limit),
      search,
    );

    return res.json({ success: true, data });
  } catch (err) {
    console.error("getTransactionDocuments error:", err);
    return res.status(500).json({
      success: false,
      message: "Failed to fetch transaction documents",
    });
  }
};