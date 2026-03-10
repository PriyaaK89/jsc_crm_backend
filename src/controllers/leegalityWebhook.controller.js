const crypto = require("crypto");
const db = require("../config/db");

exports.leegalityWebhook = async (req, res) => {
  try {

    const payload = req.body;

    console.log("Leegality Webhook:", payload);

    const documentId = payload.documentId;
    const documentStatus = payload.documentStatus;
    const action = payload?.request?.action;

    if (!documentId) {
      return res.status(400).json({ message: "Invalid payload" });
    }

    // Verify MAC
    const expectedMac = crypto
      .createHmac("sha1", process.env.LEEGALITY_PRIVATE_SALT)
      .update(documentId)
      .digest("hex");

    if (payload.mac !== expectedMac) {
      return res.status(401).json({
        message: "Invalid webhook MAC"
      });
    }

    let signingStatus = "pending";

    if (action === "Signed") signingStatus = "signed";
    if (action === "Rejected") signingStatus = "rejected";

    if (documentStatus === "Completed") signingStatus = "signed";

    await db.query(
      `UPDATE employee_documents
       SET signing_status = ?,
           webhook_status = ?,
           signed_at = IF(?='signed', NOW(), signed_at)
       WHERE leegality_document_id = ?`,
      [signingStatus, documentStatus, signingStatus, documentId]
    );

    console.log("Document updated:", documentId);

    res.status(200).json({
      status: 1,
      message: "Webhook processed"
    });

  } catch (error) {

    console.error("Webhook error:", error);

    res.status(500).json({
      status: 0,
      message: "Webhook failed"
    });

  }
};