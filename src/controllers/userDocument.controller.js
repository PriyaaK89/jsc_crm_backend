const { uploadFileToMinio } = require("../utils/fileUpload"); //  ADD THIS
const UserDoc = require("../models/userDocument.model");
const minioClient = require("../config/minio");

const BUCKET = "jsc-crm";

exports.uploadUserDocument = async (req, res) => {
  try {
    const file = req.file;
    const { user_id, document_type } = req.body;


    if (!file) {
      return res.status(400).json({ message: "File is required" });
    }

    if (!user_id || !document_type) {
      return res.status(400).json({ message: "user_id & document_type required" });
    }

    //  Upload to MinIO (overwrite logic handled inside)
    const result = await uploadFileToMinio(file, "user_document", {
      user_id,
      document_type
    });

    //  Save in DB (no duplicate row)
    // await UserDoc.upsertDocument(user_id, document_type, result.file_url);
    await UserDoc.upsertDocument(user_id, document_type, result.object_path);

    res.status(200).json({
      message: "Document uploaded successfully",
      document_type,
      file_url: result.file_url
    });

  } catch (error) {
    res.status(500).json({ error: error.message });
  }
};

exports.getUserDocuments = async (req, res) => {
  try {
    const { user_id } = req.params;
    const documents = await UserDoc.getUserDocuments(user_id);

    if (!documents) {
      return res.status(404).json({ message: "User documents not found" });
    }

    //  generate presigned URLs
    const updatedDocs = { ...documents };

    for (const key in updatedDocs) {
      if (
        updatedDocs[key] &&
        typeof updatedDocs[key] === "string" &&
        updatedDocs[key].includes("users/documents")
      ) {
        const presignedUrl = await minioClient.presignedGetObject(
          BUCKET,
          updatedDocs[key],
          60 * 60 
        );

        updatedDocs[key] = presignedUrl;
      }
    }

    res.json({ documents: updatedDocs });

  } catch (err) {
    res.status(500).json({ error: err.message });
  }
};