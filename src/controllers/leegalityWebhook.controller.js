const crypto = require("crypto");
const axios = require("axios");
const db = require("../config/db");
const minioClient = require("../config/minio");

const BUCKET = "jsc-crm";

exports.leegalityWebhook = async (req, res) => {
  try {
    console.log("Webhook headers:", req.headers);
    console.log("Webhook body:", req.body);
    console.log("LEEGALITY WEBHOOK HIT");

    const payload = req.body;

    const documentId = payload.documentId;
    const documentStatus = payload.documentStatus;
    const action = payload?.request?.action;

    if (!documentId) {
      return res.status(400).json({
        status: 0,
        message: "Invalid payload",
      });
    }

    console.log("documentId:", documentId);
    console.log("documentStatus:", documentStatus);
    console.log("action:", action);

    // ---------------- MAC VERIFICATION ----------------
    const expectedMac = crypto
      .createHmac("sha1", process.env.LEEGALITY_PRIVATE_SALT)
      .update(documentId)
      .digest("hex");

    console.log("MAC from payload:", payload.mac);
    console.log("Expected MAC:", expectedMac);

    // if (payload.mac !== expectedMac) {
    //   console.log("Invalid webhook MAC");
    //   return res.status(401).json({
    //     status: 0,
    //     message: "Invalid webhook MAC",
    //   });
    // }

    // ---------------- STATUS LOGIC ----------------
    let signingStatus = "pending";

    if (action === "Signed") {
      signingStatus = "signed";
    } else if (action === "Rejected") {
      signingStatus = "rejected";
    } else if (payload?.request?.expired) {
      signingStatus = "expired";
    }

    // ---------------- DOWNLOAD SIGNED PDF ----------------
    if (documentStatus === "Completed") {
      try {
        console.log("Downloading signed PDF from Leegality...");

        const response = await axios.get(
          process.env.LEEGALITY_DOWNLOAD_DOC_URL,
          {
            headers: {
              "X-Auth-Token": process.env.LEEGALITY_AUTH_TOKEN,
            },
            params: {
              documentId: documentId,
              documentDownloadType: "DOCUMENT",
            },
            responseType: "arraybuffer",
          }
        );

        const signedBuffer = Buffer.from(response.data);

        const objectName = `employee/signed_letters/${documentId}.pdf`;

        await minioClient.putObject(
          BUCKET,
          objectName,
          signedBuffer,
          signedBuffer.length,
          { "Content-Type": "application/pdf" }
        );

        console.log("Signed document uploaded to MinIO:", objectName);

        await db.query(
          `UPDATE employee_documents
           SET signed_file_url = ?
           WHERE leegality_document_id = ?`,
          [objectName, documentId]
        );

        signingStatus = "signed";
      } catch (downloadError) {
        console.error("Error downloading signed PDF:", downloadError.message);
      }
    }

    // ---------------- UPDATE DB STATUS ----------------
    await db.query(
      `UPDATE employee_documents
       SET signing_status = ?,
           webhook_status = ?,
           signed_at = IF(?='signed', NOW(), signed_at)
       WHERE leegality_document_id = ?`,
      [signingStatus, documentStatus, signingStatus, documentId]
    );

    console.log("Document updated in database:", documentId);

    return res.status(200).json({
      status: 1,
      message: "Webhook processed successfully",
    });

  } catch (error) {
    console.error("Webhook error:", error);

    return res.status(500).json({
      status: 0,
      message: "Webhook processing failed",
    });
  }
};