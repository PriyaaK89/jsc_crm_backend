const minioClient = require("../config/minio");
const { PDFDocument } = require("pdf-lib");

const BUCKET = "jsc-crm"; //  define bucket

// 🔹 Auth Header
const getDigioAuthHeader = () => {
  const clientId = process.env.DIGIO_CLIENT_ID;
  const clientSecret = process.env.DIGIO_CLIENT_SECRET;

  if (!clientId || !clientSecret) {
    throw new Error("DIGIO_CLIENT_ID or DIGIO_CLIENT_SECRET missing in env");
  }

  return "Basic " + Buffer.from(`${clientId}:${clientSecret}`).toString("base64");
};

// 🔹 Normalize Phone
const normalizePhone = (phone) => {
  if (!phone) return null;

  const digits = String(phone).replace(/\D/g, "");
  if (!digits) return null;

  return digits.length > 10 ? digits.slice(-10) : digits;
};

// 🔹 Get File Buffer from MinIO
const getFileBufferFromMinio = async (objectKey) => {
  const stream = await minioClient.getObject(BUCKET, objectKey);
  const chunks = [];

  for await (const chunk of stream) {
    chunks.push(chunk);
  }

  return Buffer.concat(chunks);
};

// 🔹 Get PDF Page Count
const getPdfPageCount = async (buffer) => {
  const pdfDoc = await PDFDocument.load(buffer, {
    ignoreEncryption: true,
  });

  return pdfDoc.getPageCount();
};

// 🔹 Build Sign Coordinates
const buildSignCoordinates = (totalPages) => {
  const companyCoordinates = [];
  const employeeCoordinates = [];

  for (let i = 1; i <= totalPages; i++) {
    // LEFT SIDE - company
    companyCoordinates.push({
      page_num: i,
      x: 100,
      y: 690,
      width: 150,
      height: 50,
    });

    // RIGHT SIDE - user/distributor
    employeeCoordinates.push({
      page_num: i,
      x: 450,
      y: 690,
      width: 150,
      height: 50,
    });
  }

  return { companyCoordinates, employeeCoordinates };
};

// EXPORT (IMPORTANT)
module.exports = {
  getDigioAuthHeader,
  normalizePhone,
  getFileBufferFromMinio,
  getPdfPageCount,
  buildSignCoordinates,
};