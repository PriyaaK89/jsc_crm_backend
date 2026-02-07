const db = require("../config/db");

const createEmptyRow = async (userId, userName) => {
  await db.query(
    `INSERT INTO user_documents (user_id, user_name)
     VALUES (?, ?)`,
    [userId, userName]
  );
};

const updateDocument = async (userId, field, url) => {
  const allowedFields = [
    "old_salary_slip",
    "experience_certificate",
    "education_certificate",
    "pan_card",
    "aadhar_card",
    "voter_card",
    "driving_licence",
    "bank_passbook",
    "address_proof"
  ];

  if (!allowedFields.includes(field)) {
    throw new Error("Invalid document type");
  }

  await db.query(
    `UPDATE user_documents SET ${field} = ? WHERE user_id = ?`,
    [url, userId]
  );
};

const getUserDocuments = async (userId) => {
  const [rows] = await db.query(
    `SELECT * FROM user_documents WHERE user_id = ?`,
    [userId]
  );
  return rows[0]; 
};


module.exports = { createEmptyRow, updateDocument, getUserDocuments };
