const minioClient = require("../config/minio");
const db = require("../config/db");

const BUCKET = "jsc-crm";


exports.uploadEmployeeLetter = async (req, res) => {
  try {
    const file = req.file;
    const { employee_id, document_type, employee_name } = req.body;

    if (!file) {
      return res.status(400).json({
        message: "PDF file is required"
      });
    }

    if (!document_type) {
      return res.status(400).json({
        message: "document_type is required"
      });
    }

    // clean employee name
    const cleanName = employee_name.replace(/\s+/g, "_").toLowerCase();

    // dynamic filename
    const fileName = `employee/letter/${document_type}_${cleanName}_${employee_id}.pdf`;

    // upload to minio
    await minioClient.putObject(
      BUCKET,
      fileName,
      file.buffer,
      file.size,
      { "Content-Type": "application/pdf" }
    );

    // store path in DB
    await db.query(
      `INSERT INTO employee_documents
       (employee_id, document_type, file_url)
       VALUES (?, ?, ?)`,
      [employee_id, document_type, fileName]
    );

    res.json({
      message: "Letter uploaded successfully",
      file_path: fileName
    });

  } catch (error) {
    res.status(500).json({
      error: error.message
    });
  }
};