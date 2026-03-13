const { default: axios } = require("axios");
const db = require("../config/db");
const minioClient = require("../config/minio");
const https = require("https");

const BUCKET = "jsc-crm";

exports.sendForESign = async (req, res) => {
  try {
    const { document_id } = req.body;

    // Fetch document + user info
    const [rows] = await db.query(
      `SELECT ed.*, u.name, u.email, u.contact_no
       FROM employee_documents ed
       JOIN users u ON ed.employee_id = u.id
       WHERE ed.id = ?`,
      [document_id]
    );

    if (!rows.length) {
      return res.status(404).json({
        status: 0,
        messages: [{ code: "NOT_FOUND", message: "Document not found" }],
        data: null,
      });
    }

    const document = rows[0];

    // Validate email and phone for notifications
    if (!document.email && !document.contact_no) {
      return res.status(400).json({
        status: 0,
        messages: [{ code: "INVALID_INVITEE", message: "Invitee email or phone is required" }],
        data: null,
      });
    }

    // Fetch file from MinIO
    const stream = await minioClient.getObject(BUCKET, document.file_url);
    const chunks = [];
    for await (const chunk of stream) chunks.push(chunk);
    const buffer = Buffer.concat(chunks);
    const pdfBase64 = buffer.toString("base64");

    // Prepare payload for Leegality API
    const payload = {
  profileId: process.env.LEEGALITY_PROFILE_ID,
  irn: `emp_doc_${document.id}_${Date.now()}`,
  file: {
    name: `${document.document_type}.pdf`,
    file: pdfBase64,
  },
  invitees: [
  {
    name: document.name,
    email: document.email,
    phone: document.contact_no
      ? document.contact_no.replace(/\D/g, "").slice(-10)
      : undefined,
    signOrder: 1
  },
  {
    name: "Authorized Signatory",
    email: "jamidaraseedscorporation@gmail.com",
    signOrder: 2
  }
],
    };
    console.log("Leegality Payload:", JSON.stringify(payload, null, 2));

    // Call Leegality
    const response = await axios.post(
      process.env.LEEGALITY_BASE_URL,
      payload,
      {
        headers: {
          "X-Auth-Token": process.env.LEEGALITY_AUTH_TOKEN,
          "Content-Type": "application/json",
        },
        httpsAgent: new https.Agent({
        minVersion: "TLSv1.2",
        }),
      }
    );

    const respData = response.data;

    // Check status returned by Leegality
    if (respData.status !== 1) {
      return res.status(400).json({
        status: 0,
        messages: respData.messages || [{ code: "API_ERROR", message: "Leegality API failed" }],
        data: respData.data || null,
      });
    }

    // Save Leegality document details in DB
    const documentId = respData.data.documentId;
    // const invitee = respData.data.invitees[0];
    const invitee1 = respData.data.invitees[0];
const invitee2 = respData.data.invitees[1];

    await db.query(
      `UPDATE employee_documents
       SET leegality_document_id = ?,
       leegality_invitee_id = ?,
           sign_url = ?,
           signing_status = 'pending',
           sent_for_sign_at = NOW()
       WHERE id = ?`,
      [documentId, invitee1.inviteeId, invitee1.signUrl, document_id]
    );

    // Respond with full Leegality response schema
    return res.json({
      status: 1,
      messages: [{ code: "SUCCESS", message: "Document sent for eSign successfully" }],
      data: respData.data,
    });
  } catch (error) {
    // console.error("Leegality error:", error.response?.data || error.message);
    console.error("Leegality error:", { message: error.message,
    response: error.response?.data,
    status: error.response?.status,
     });

    return res.status(500).json({
      status: 0,
      messages: [{ code: "SERVER_ERROR", message: error.message }],
      data: null,
    });
  }
};


exports.checkLeegalityStatus = async (req, res) => {
  try {

    const { documentId } = req.params;

    // Get existing record
    const [rows] = await db.query(
      `SELECT signing_status, signed_file_url
       FROM employee_documents
       WHERE leegality_document_id = ?`,
      [documentId]
    );

    if (!rows.length) {
      return res.status(404).json({
        status: 0,
        message: "Document not found"
      });
    }

    const existingDoc = rows[0];

    // If already signed and stored → return immediately
    if (existingDoc.signing_status === "signed" && existingDoc.signed_file_url) {

      const previewUrl = await minioClient.presignedGetObject(
        BUCKET,
        existingDoc.signed_file_url,
        60 * 5
      );

      return res.json({
        status: 1,
        signing_status: "signed",
        signed_file_url: previewUrl
      });
    }

    // Call Leegality API
    const response = await axios.get(
      process.env.LEEGALITY_DETAILS_URL,
      {
        headers: {
          "X-Auth-Token": process.env.LEEGALITY_AUTH_TOKEN
        },
        params: {
          documentId: documentId
        }
      }
    );

    const data = response.data.data;

    const employeeSigned = data.requests[0]?.signed;
    const companySigned = data.requests[1]?.signed;

    let signingStatus = "pending";

    if (employeeSigned && companySigned) {
      signingStatus = "signed";
    }

    let previewUrl = null;

    if (signingStatus === "signed" && data.files?.length) {

      const objectName = `employee/signed_letters/${documentId}.pdf`;

      // Download signed file from Leegality
      const leegalityFileUrl = data.files[0];

      const fileResponse = await axios.get(leegalityFileUrl, {
        responseType: "arraybuffer"
      });

      const buffer = Buffer.from(fileResponse.data);

      // Upload to MinIO
      await minioClient.putObject(
        BUCKET,
        objectName,
        buffer,
        buffer.length,
        { "Content-Type": "application/pdf" }
      );

      // Save only object path in DB
      await db.query(
        `UPDATE employee_documents
         SET signing_status = ?, 
             signed_file_url = ?, 
             signed_at = NOW()
         WHERE leegality_document_id = ?`,
        ["signed", objectName, documentId]
      );

      // Generate preview URL
      previewUrl = await minioClient.presignedGetObject(
        BUCKET,
        objectName,
        60 * 5
      );
    }

    res.json({
      status: 1,
      signing_status: signingStatus,
      signed_file_url: previewUrl
    });

  } catch (error) {

    console.error("Leegality status error:", error);

    res.status(500).json({
      status: 0,
      message: error.message
    });

  }
};
