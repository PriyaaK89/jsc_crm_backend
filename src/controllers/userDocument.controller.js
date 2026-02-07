const uploadToS3 = require("../utils/S3Upload");
const UserDoc = require("../models/userDocument.model");

exports.uploadUserDocument = async (req, res) => {
  try {
    const { user_id, document_type } = req.body;
    const file = req.file;

    if (!file) {
      return res.status(400).json({ message: "File is required" });
    }

    const url = await uploadToS3(file, user_id);
    await UserDoc.updateDocument(user_id, document_type, url);

    res.json({
      message: "Document uploaded successfully",
      document_type,
      url
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
};
exports.getUserDocuments = async (req, res) => {
  try {
    const { user_id } = req.params;
    const documents = await UserDoc.getUserDocuments(user_id);

    if (!documents) {
      return res.status(404).json({ message: "User documents not found" });
    }

    res.json({ documents });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
};

exports.updateDocument = async (req, res) => {
  try {
    const { user_id, document_type, url } = req.body;

    if (!url) {
      return res.status(400).json({ message: "Document URL is required" });
    }

    await UserDoc.updateDocument(user_id, document_type, url);

    res.json({
      message: "Document updated successfully",
      document_type,
      url
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
};
