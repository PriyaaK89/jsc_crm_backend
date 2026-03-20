const db = require("../config/db");
const minioClient = require("../config/minio");
const axios = require("axios");
const crypto = require("crypto");

const BUCKET = "jsc-crm";

function pretty(data) {
  try {
    return JSON.stringify(data, null, 2);
  } catch (e) {
    return String(data);
  }
}

function getDigioAuthHeader() {
  const clientId = process.env.DIGIO_CLIENT_ID;
  const clientSecret = process.env.DIGIO_CLIENT_SECRET;

  if (!clientId || !clientSecret) {
    throw new Error("DIGIO_CLIENT_ID or DIGIO_CLIENT_SECRET missing");
  }

  return "Basic " + Buffer.from(`${clientId}:${clientSecret}`).toString("base64");
}

const verifyWebhook = (rawBody, signature) => {
  if (process.env.DIGIO_WEBHOOK_BYPASS_SIGNATURE === "true") {
    return true;
  }

  const secret = process.env.DIGIO_WEBHOOK_SECRET;

  if (!secret || !signature) return false;

  const expected = crypto
    .createHmac("sha256", secret)
    .update(rawBody)
    .digest("hex");

  return signature === expected;
};

exports.digioWebhook = async (req, res) => {
  try {
    console.log("\n=========== DIGIO WEBHOOK RECEIVED ===========");

    const rawBody = req.body;
    const signature =
      req.headers["x-digio-signature"] ||
      req.headers["X-Digio-Signature"];

    if (!Buffer.isBuffer(rawBody)) {
      console.error("Webhook body is not raw Buffer");
      return res.status(400).json({
        success: false,
        message: "Invalid raw body"
      });
    }

    const isValid = verifyWebhook(rawBody, signature);

    if (!isValid) {
      console.log("Invalid webhook signature");
      return res.status(401).json({
        success: false,
        message: "Invalid signature"
      });
    }

    console.log("Webhook signature verified");

    let data;
    try {
      data = JSON.parse(rawBody.toString("utf8"));
    } catch (parseErr) {
      console.error("Webhook JSON parse failed:", parseErr.message);
      return res.status(400).json({
        success: false,
        message: "Invalid JSON payload"
      });
    }

    console.log("DIGIO WEBHOOK BODY:", pretty(data));

    const digioDocumentId = data.id;
    const agreementStatus = data.agreement_status;

    if (!digioDocumentId) {
      return res.status(400).json({
        success: false,
        message: "Webhook payload missing document id",
      });
    }

    const [rows] = await db.query(
      `SELECT * FROM employee_documents WHERE digio_document_id = ? LIMIT 1`,
      [digioDocumentId]
    );

    if (!rows.length) {
      console.log("No matching employee_documents row for digio_document_id:", digioDocumentId);
      return res.status(200).json({
        success: true,
        message: "No matching local document found",
      });
    }

    const document = rows[0];

    await db.query(
      `UPDATE employee_documents
       SET digio_status = ?,
           webhook_status = ?,
           signing_status = ?
       WHERE id = ?`,
      [
        agreementStatus || null,
        "received",
        agreementStatus || document.signing_status,
        document.id,
      ]
    );

    if (agreementStatus === "completed") {
      const downloadUrl = `${process.env.DIGIO_BASE_URL}/v2/client/document/download`;

      const fileResponse = await axios.get(downloadUrl, {
        params: {
          document_id: digioDocumentId,
        },
        responseType: "arraybuffer",
        headers: {
          Authorization: getDigioAuthHeader(),
          Accept: "*/*",
        },
        timeout: 60000,
        validateStatus: () => true,
      });

      console.log("DIGIO DOWNLOAD STATUS:", fileResponse.status);
      console.log("DIGIO DOWNLOAD HEADERS:", fileResponse.headers);

      if (fileResponse.status < 200 || fileResponse.status >= 300) {
        let errorText = "";
        try {
          errorText = Buffer.from(fileResponse.data).toString("utf8");
        } catch (e) {
          errorText = "Unable to decode error body";
        }

        console.error("DIGIO DOWNLOAD FAILED BODY:", errorText);

        await db.query(
          `UPDATE employee_documents
           SET webhook_status = ?
           WHERE id = ?`,
          ["download_failed", document.id]
        );

        return res.status(200).json({
          success: true,
          message: "Webhook processed, but signed PDF download failed",
          digio_download_status: fileResponse.status,
          digio_download_error: errorText,
        });
      }

      const fileBuffer = Buffer.from(fileResponse.data);
      const fileName = `signed/${document.document_type}_${document.employee_id}_${document.id}.pdf`;

      await minioClient.putObject(
        BUCKET,
        fileName,
        fileBuffer,
        fileBuffer.length,
        { "Content-Type": "application/pdf" }
      );

      await db.query(
        `UPDATE employee_documents
         SET signed_file_url = ?,
             signing_status = 'completed',
             signed_at = NOW(),
             webhook_status = ?
         WHERE id = ?`,
        [fileName, "processed", document.id]
      );
    }

    if (agreementStatus === "expired" || agreementStatus === "failed") {
      await db.query(
        `UPDATE employee_documents
         SET webhook_status = ?
         WHERE id = ?`,
        ["processed", document.id]
      );
    }

    return res.status(200).json({
      success: true,
      message: "Webhook processed successfully",
    });
  } catch (error) {
    console.error("DIGIO WEBHOOK ERROR:", error.message);
    console.error("DIGIO WEBHOOK STACK:", error.stack);

    return res.status(500).json({
      success: false,
      message: "Webhook processing failed",
      error: error.message,
    });
  }
};