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
      phone: document.contact_no ? document.contact_no.replace(/\D/g, "").slice(-10) : undefined
    },
     {
      name: "Authorized Signatory"
    }
  ],
    };

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