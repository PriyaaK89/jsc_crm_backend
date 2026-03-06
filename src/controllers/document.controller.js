const minioClient = require("../config/minio");
const { v4: uuidv4 } = require("uuid");
const db = require("../config/db");

const BUCKET = "jsc-crm";

// exports.uploadEmployeeLetter = async (req, res) => {
//   try {
//     const file = req.file;
//     const { employee_id, document_type } = req.body;
//     if (!file) {
//       return res.status(400).json({
//         message: "PDF file is required"
//       });
//     }
//     const fileName = `employee/letter/${uuidv4()}.pdf`;

//     await minioClient.putObject(  BUCKET, fileName, file.buffer, file.size,
//       { "Content-Type": "application/pdf" }
//     );

//     const file_url = `http://103.110.127.211:9000/${BUCKET}/${fileName}`;

//     await db.query(
//       `INSERT INTO employee_documents 
//        (employee_id, document_type, file_url)
//        VALUES (?, ?, ?)`,
//       [employee_id, document_type, file_url]
//     );

//     res.json({
//       message: "Offer letter uploaded successfully",
//       file_url
//     }); }
//      catch (error) {
//     res.status(500).json({
//       error: error.message
//     });
//   }
// };


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