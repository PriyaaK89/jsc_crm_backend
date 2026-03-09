const { default: axios } = require("axios");
const db = require("../config/db");
const minioClient = require("../config/minio");

const BUCKET = "jsc-crm";
exports.sendForESign = async (req, res) => {
  try {
    const { document_id } = req.body;

    const [rows] = await db.query(
      `SELECT ed.*, u.name, u.email, u.contact_no
       FROM employee_documents ed
       JOIN users u ON ed.employee_id = u.id
       WHERE ed.id = ?`,
      [document_id]
    );

    if (!rows.length) {
      return res.status(404).json({
        message: "Document not found",
      });
    }

    const document = rows[0];

    // Get PDF from MinIO
    const stream = await minioClient.getObject(
      BUCKET,
      document.file_url
    );

    const chunks = [];

    for await (const chunk of stream) {
      chunks.push(chunk);
    }

    const buffer = Buffer.concat(chunks);

    const pdfBase64 = buffer.toString("base64");
    console.log("Calling:", `${process.env.LEEGALITY_BASE_URL}`);
    // Send to Leegality
const response = await axios.post(
  `${process.env.LEEGALITY_BASE_URL}`,
  {
    profileId: process.env.LEEGALITY_PROFILE_ID,
    file: {
      name: `${document.document_type}.pdf`,
      file: pdfBase64
    },
    invitees: [
      {
        name: document.name,
        email: document.email,
        phone: document.contact_no
      }
    ]
  },
  {
    headers: {
      "x-api-key": process.env.LEEGALITY_AUTH_TOKEN,
      "Content-Type": "application/json"
    }
    
  }
);

if (response.data.status !== 1) {
  throw new Error(response.data.messages?.[0]?.message || "Leegality API failed");
}

const documentId = response.data.data.documentId;

const invitee = response.data.data.invitees[0];

await db.query(
`UPDATE employee_documents
 SET leegality_document_id=?,
     leegality_invitee_id=?,
     sign_url=?,
     signing_status='pending',
     sent_for_sign_at=NOW()
 WHERE id=?`,
[
  documentId,
  invitee.inviteeId,
  invitee.signUrl,
  document_id
]
);
    res.json({
      message: "Document sent for eSign successfully",
    });

  } catch (error) {
    console.error(error);
    res.status(500).json({
      error: error.message
    });
  }
};