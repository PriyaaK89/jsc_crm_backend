const  axios  = require("axios");
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
  distributor_agreement: 'distributor/dist-letters',
  company: 'company/images',
  txn_payments: "txn-master/payment",
  txn_receipt: "txn-master/receipt",
  txn_sales: "txn-master/sales",
  txn_purchase: "txn-master/purchase",
  txn_debitNote: "txn-master/debitNote",
  txn_creditNote: "txn-master/creditNote",
  approval_returns: "approval/returns",
  salary_slips: "employee/salary-slip"
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

 async function fetchMinioObjectAsBuffer(objectPath) {
  if (!objectPath) return null;

  const url = await getPresignedUrl(objectPath);
  const response = await axios.get(url, { responseType: "arraybuffer" });

  return {
    buffer: Buffer.from(response.data),
    mimeType: response.headers["content-type"] || "image/jpeg",
  };
}

module.exports = { uploadFileToMinio, getPresignedUrl , fetchMinioObjectAsBuffer};