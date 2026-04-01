const minioClient = require("../config/minio");
const { v4: uuidv4 } = require("uuid");

const BUCKET = "jsc-crm";

const folderMap = {
  user_document: "users/documents",
  profile_image: "users/profile",
  attendance_photo: "attendance/photos",
  product_image: "products/images",
  employee_letters: "employee/letter",
  bills: "employee/expenses/bills",
  visits: "employee/visits",
  distributor_documents: "employee/dist-documents",
};

const uploadFileToMinio = async (file, type, options = {}) => {
  if (!file) {
    throw new Error("File is required");
  }

  if (!type || !folderMap[type]) {
    throw new Error("Invalid upload type");
  }

  const folder = folderMap[type];
  const fileExtension = file.originalname.split(".").pop();

  let fileName;

  //  SPECIAL CASE: user documents (overwrite logic)
  if (type === "user_document" && options.user_id && options.document_type) {
    fileName = `${folder}/${options.user_id}/${options.document_type}.${fileExtension}`;
  } else {
    //  DEFAULT (random file for others)
    fileName = `${folder}/${uuidv4()}.${fileExtension}`;
  }

  await minioClient.putObject(
    BUCKET,
    fileName,
    file.buffer,
    file.size,
    { "Content-Type": file.mimetype }
  );

  return {
  object_path: fileName,   // store this in DB
  file_url: `${process.env.MINIO_PUBLIC_URL}/${BUCKET}/${fileName}` // optional (not used)
};
};

const getPresignedUrl = async (objectPath, expiry = 60 * 60) => {
  try {
    const url = await minioClient.presignedGetObject(
      BUCKET,
      objectPath,
      expiry // seconds (1 hour default)
    );

    return url;
  } catch (err) {
    throw err;
  }
};

module.exports = { uploadFileToMinio, getPresignedUrl };