const crypto = require("crypto");
const db = require("../config/db");

exports.leegalityWebhook = async (req, res) => {
  try {

    console.log("Webhook headers:", req.headers);
    console.log("Webhook body:", req.body);

    const payload = req.body;

    const documentId = payload.documentId;
    const documentStatus = payload.documentStatus;
    const action = payload?.request?.action;

    console.log("documentId:", documentId);
    console.log("documentStatus:", documentStatus);
    console.log("action:", action);

    if (!documentId) {
      return res.status(400).json({ message: "Invalid payload" });
    }

    const expectedMac = crypto
      .createHmac("sha1", process.env.LEEGALITY_PRIVATE_SALT)
      .update(documentId)
      .digest("hex");

    console.log("MAC from payload:", payload.mac);
    console.log("Expected MAC:", expectedMac);

    // if (payload.mac !== expectedMac) {
    //   return res.status(401).json({
    //     message: "Invalid webhook MAC"
    //   });
    // }

    let signingStatus = "pending";

    if (documentStatus === "Completed") {
      signingStatus = "signed";
    } else if (action === "Rejected") {
      signingStatus = "rejected";
    } else if (payload?.request?.expired) {
      signingStatus = "expired";
    }

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