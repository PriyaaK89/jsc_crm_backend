const minioClient = require("../config/minio");
const db = require("../config/db");

const BUCKET = "jsc-crm";

exports.uploadEmployeeLetter = async (req, res) => {
  try {
    const file = req.file;
    const { employee_id, document_type, employee_name } = req.body;

    if (!file) {
      return res.status(400).json({
        message: "PDF file is required",
      });
    }

    if (!document_type) {
      return res.status(400).json({
        message: "document_type is required",
      });
    }

    const cleanName = employee_name.replace(/\s+/g, "_").toLowerCase();

    const fileName = `employee/letter/${document_type}_${cleanName}_${employee_id}.pdf`;

    await minioClient.putObject(
      BUCKET,
      fileName,
      file.buffer,
      file.size,
      { "Content-Type": "application/pdf" }
    );

    await db.query(
      `INSERT INTO employee_documents
      (employee_id, document_type, file_url)
      VALUES (?, ?, ?)
      ON DUPLICATE KEY UPDATE file_url = VALUES(file_url)`,
      [employee_id, document_type, fileName] 
    );

    res.json({
      message: "Letter uploaded successfully",
      file_path: fileName
    });

  } catch (error) {
    res.status(500).json({
      error: error.message,
    });
  }
};

exports.getEmployeeDocumentsByEmployee = async (req, res) => {
  try {

    const { employee_id } = req.params;

    const [rows] = await db.query(
      `SELECT 
        ed.id,
        ed.employee_id,
        u.name AS employee_name,
        ed.document_type,
        ed.file_url,
        ed.signing_status,
        ed.leegality_document_id,
        ed.signed_file_url,
        ed.created_at
      FROM employee_documents ed
      LEFT JOIN users u ON u.id = ed.employee_id
      WHERE ed.employee_id = ?
      ORDER BY ed.created_at DESC`,
      [employee_id]
    );

    const data = await Promise.all(
      rows.map(async (doc) => {

        let filePreview = null;
        let signedPreview = null;

        if (doc.file_url) {
          filePreview = await minioClient.presignedGetObject(
            BUCKET,
            doc.file_url,
            60 * 5
          );
        }

        if (doc.signed_file_url) {
          signedPreview = await minioClient.presignedGetObject(
            BUCKET,
            doc.signed_file_url,
            60 * 5
          );
        }

        return {
          ...doc,
          file_url: filePreview,
          signed_file_url: signedPreview
        };

      })
    );

    res.json({ data });

  } catch (error) {

    res.status(500).json({
      message: error.message
    });

  }
};
