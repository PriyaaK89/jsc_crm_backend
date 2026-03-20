const axios = require("axios");
const db = require("../config/db");
const minioClient = require("../config/minio");
const { PDFDocument } = require("pdf-lib");

const BUCKET = "jsc-crm";

function pretty(data) {
  try {
    return JSON.stringify(data, null, 2);
  } catch (e) {
    return String(data);
  }
}

function normalizePhone(phone) {
  if (!phone) return null;
  const digits = String(phone).replace(/\D/g, "");
  if (!digits) return null;
  return digits.length > 10 ? digits.slice(-10) : digits;
}

function getDigioAuthHeader() {
  const clientId = process.env.DIGIO_CLIENT_ID;
  const clientSecret = process.env.DIGIO_CLIENT_SECRET;

  if (!clientId || !clientSecret) {
    throw new Error("DIGIO_CLIENT_ID or DIGIO_CLIENT_SECRET missing in env");
  }

  return "Basic " + Buffer.from(`${clientId}:${clientSecret}`).toString("base64");
}

async function getDocumentRow(documentId) {
  const [rows] = await db.query(
    `SELECT ed.*, u.name, u.email, u.contact_no
     FROM employee_documents ed
     JOIN users u ON ed.employee_id = u.id
     WHERE ed.id = ?
     LIMIT 1`,
    [documentId]
  );

  return rows[0] || null;
}

async function getFileBufferFromMinio(objectKey) {
  const stream = await minioClient.getObject(BUCKET, objectKey);
  const chunks = [];

  for await (const chunk of stream) {
    chunks.push(chunk);
  }

  return Buffer.concat(chunks);
}

async function getPdfPageCount(buffer) {
  // ignoreEncryption helps in some PDFs that otherwise fail to parse
  const pdfDoc = await PDFDocument.load(buffer, { ignoreEncryption: true });
  return pdfDoc.getPageCount();
}

function buildSignCoordinates(totalPages) {
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

    // RIGHT SIDE - employee
    employeeCoordinates.push({
      page_num: i,
      x: 450,
      y: 690,
      width: 150,
      height: 50,
    });
  }

  return { companyCoordinates, employeeCoordinates };
}

exports.sendForESign = async (req, res) => {
  try {
    console.log("\n=========== DIGIO JSON SEND REQUEST ===========");
    console.log("BODY:", pretty(req.body));

    const { document_id } = req.body;

    if (!document_id) {
      return res.status(400).json({
        success: false,
        message: "document_id is required",
      });
    }

    const document = await getDocumentRow(document_id);

    if (!document) {
      return res.status(404).json({
        success: false,
        message: "Document not found",
      });
    }

    console.log("Fetched document row:", pretty(document));

    if (!document.file_url) {
      return res.status(400).json({
        success: false,
        message: "Document file_url missing",
      });
    }

    // Aadhaar signer ke liye mobile use karna better hai
    const employeeMobile = normalizePhone(document.contact_no);
    const companyIdentifier = process.env.COMPANY_SIGNER_EMAIL?.trim()?.toLowerCase();

    if (!employeeMobile) {
      return res.status(400).json({
        success: false,
        message: "Employee mobile number not available for Aadhaar eSign",
      });
    }

    if (!companyIdentifier) {
      return res.status(400).json({
        success: false,
        message: "COMPANY_SIGNER_EMAIL missing in env",
      });
    }

    const fileBuffer = await getFileBufferFromMinio(document.file_url);

    if (!fileBuffer || !fileBuffer.length) {
      return res.status(400).json({
        success: false,
        message: "Failed to read PDF file from MinIO",
      });
    }

    console.log("MinIO file fetched successfully. Size:", fileBuffer.length);

    const totalPages = await getPdfPageCount(fileBuffer);
    console.log("Total PDF Pages:", totalPages);

    const { companyCoordinates, employeeCoordinates } = buildSignCoordinates(totalPages);

    const uniqueTs = Date.now();
    const fileName = `${document.document_type || "document"}_${document.id}_${uniqueTs}.pdf`;
    const referenceId = `emp_doc_${document.id}_${uniqueTs}`;
    const fileDataBase64 = fileBuffer.toString("base64");

    const payload = {
      file_name: fileName,
      expire_in_days: 10,
      notify_signers: true,
      send_sign_link: true,
      sequential: true,
      reference_id: referenceId,
      file_data: fileDataBase64,
      signers: [
        {
          identifier: employeeMobile,
          name: document.name || "Employee",
          reason: "Employee Signing",
          sign_type: "aadhaar",
          index: 1,
          sign_coordinates: employeeCoordinates,
        },
        {
          identifier: companyIdentifier,
          name: "Authorized Signatory",
          reason: "Company Approval",
          sign_type: "electronic",
          signature_mode: "otp",
          index: 2,
          sign_coordinates: companyCoordinates,
        },
      ],
    };

    console.log(
      "DIGIO JSON PAYLOAD META:",
      pretty({
        file_name: payload.file_name,
        expire_in_days: payload.expire_in_days,
        notify_signers: payload.notify_signers,
        send_sign_link: payload.send_sign_link,
        sequential: payload.sequential,
        reference_id: payload.reference_id,
        file_data_length: payload.file_data.length,
        signers: payload.signers,
      })
    );

    const url = `${process.env.DIGIO_BASE_URL}/v2/client/document/uploadpdf`;

    const response = await axios.post(url, payload, {
      headers: {
        Authorization: getDigioAuthHeader(),
        Accept: "application/json",
        "Content-Type": "application/json",
      },
      timeout: 120000,
      maxBodyLength: Infinity,
      maxContentLength: Infinity,
      validateStatus: () => true,
    });

    console.log("DIGIO URL:", url);
    console.log("DIGIO STATUS:", response.status);
    console.log("DIGIO RESPONSE:", pretty(response.data));

    if (response.status < 200 || response.status >= 300) {
      return res.status(502).json({
        success: false,
        message: "Digio returned non-success status",
        digio_status: response.status,
        digio_response: response.data,
        sent_payload_meta: {
          file_name: payload.file_name,
          reference_id: payload.reference_id,
          signers: payload.signers,
        },
      });
    }

    const respData = response.data;

    await db.query(
      `UPDATE employee_documents
       SET digio_document_id = ?,
           signing_status = 'pending',
           sent_for_sign_at = NOW(),
           digio_status = ?
       WHERE id = ?`,
      [respData.id, respData.agreement_status || "requested", document_id]
    );

    return res.status(200).json({
      success: true,
      message: "Sent for eSign via Digio",
      data: respData,
      meta: {
        document_id,
        reference_id: referenceId,
        total_pages: totalPages,
      },
    });
  } catch (error) {
    console.error("DIGIO SEND ERROR:", error.message);
    console.error("DIGIO SEND ERROR RESPONSE:", pretty(error.response?.data));
    console.error("DIGIO SEND ERROR STACK:", error.stack);

    return res.status(500).json({
      success: false,
      message: "Internal server error while sending eSign request",
      error: error.response?.data || error.message,
    });
  }
};

exports.checkDigioStatus = async (req, res) => {
  try {
    const { documentId } = req.params;

    if (!documentId) {
      return res.status(400).json({
        success: false,
        message: "documentId is required",
      });
    }

    const [rows] = await db.query(
      `SELECT * FROM employee_documents WHERE id = ? LIMIT 1`,
      [documentId]
    );

    if (!rows.length) {
      return res.status(404).json({
        success: false,
        message: "Document not found",
      });
    }

    const document = rows[0];

    if (!document.digio_document_id) {
      return res.status(400).json({
        success: false,
        message: "No Digio document id found for this document",
      });
    }

    const url = `${process.env.DIGIO_BASE_URL}/v2/client/document/${document.digio_document_id}`;

    const response = await axios.get(url, {
      headers: {
        Authorization: getDigioAuthHeader(),
        Accept: "application/json",
      },
      timeout: 30000,
      validateStatus: () => true,
    });

    console.log("DIGIO STATUS URL:", url);
    console.log("DIGIO STATUS RESPONSE:", pretty(response.data));

    if (response.status < 200 || response.status >= 300) {
      return res.status(502).json({
        success: false,
        message: "Digio returned non-success status while fetching status",
        digio_status: response.status,
        digio_response: response.data,
      });
    }

    const digioData = response.data;
    const signingStatus = digioData.agreement_status || "unknown";

    await db.query(
      `UPDATE employee_documents
       SET signing_status = ?,
           digio_status = ?
       WHERE id = ?`,
      [signingStatus, signingStatus, documentId]
    );

    return res.status(200).json({
      success: true,
      message: "Digio status fetched successfully",
      data: digioData,
    });
  } catch (error) {
    console.error("DIGIO STATUS ERROR:", error.message);
    console.error("DIGIO STATUS ERROR RESPONSE:", pretty(error.response?.data));
    console.error("DIGIO STATUS ERROR STACK:", error.stack);

    return res.status(500).json({
      success: false,
      message: "Internal server error while checking status",
      error: error.response?.data || error.message,
    });
  }
};

exports.downloadSignedPdf = async (req, res) => {
  try {
    const { documentId } = req.params;

    if (!documentId) {
      return res.status(400).json({
        success: false,
        message: "documentId is required",
      });
    }

    const [rows] = await db.query(
      `SELECT * FROM employee_documents WHERE id = ? LIMIT 1`,
      [documentId]
    );

    if (!rows.length) {
      return res.status(404).json({
        success: false,
        message: "Document not found",
      });
    }

    const document = rows[0];

    if (!document.digio_document_id) {
      return res.status(400).json({
        success: false,
        message: "No Digio document id found for this document",
      });
    }

    const statusUrl = `${process.env.DIGIO_BASE_URL}/v2/client/document/${document.digio_document_id}`;

    const statusResponse = await axios.get(statusUrl, {
      headers: {
        Authorization: getDigioAuthHeader(),
        Accept: "application/json",
      },
      timeout: 30000,
      validateStatus: () => true,
    });

    console.log("DIGIO STATUS URL:", statusUrl);
    console.log("DIGIO STATUS RESPONSE:", pretty(statusResponse.data));

    if (statusResponse.status < 200 || statusResponse.status >= 300) {
      return res.status(502).json({
        success: false,
        message: "Failed to fetch Digio status",
        digio_status: statusResponse.status,
        digio_response: statusResponse.data,
      });
    }

    const digioData = statusResponse.data;
    const agreementStatus = digioData.agreement_status || "unknown";

    await db.query(
      `UPDATE employee_documents
       SET signing_status = ?,
           digio_status = ?
       WHERE id = ?`,
      [agreementStatus, agreementStatus, documentId]
    );

    if (agreementStatus !== "completed") {
      return res.status(400).json({
        success: false,
        message: `Document is not completed yet. Current status: ${agreementStatus}`,
        data: digioData,
      });
    }

    if (document.signed_file_url) {
      return res.status(200).json({
        success: true,
        message: "Signed PDF already downloaded",
        data: {
          signed_file_url: document.signed_file_url,
          digio_document_id: document.digio_document_id,
          agreement_status: agreementStatus,
        },
      });
    }

    const downloadUrl = `${process.env.DIGIO_BASE_URL}/v2/client/document/download`;

    const fileResponse = await axios.get(downloadUrl, {
      params: {
        document_id: document.digio_document_id,
      },
      responseType: "arraybuffer",
      headers: {
        Authorization: getDigioAuthHeader(),
        Accept: "*/*",
      },
      timeout: 60000,
      validateStatus: () => true,
    });

    console.log("DIGIO DOWNLOAD URL:", downloadUrl);
    console.log("DIGIO DOWNLOAD STATUS:", fileResponse.status);
    console.log("DIGIO DOWNLOAD HEADERS:", fileResponse.headers);

    if (fileResponse.status < 200 || fileResponse.status >= 300) {
      let errorText = "";
      try {
        errorText = Buffer.from(fileResponse.data).toString("utf8");
      } catch (e) {
        errorText = "Unable to decode error body";
      }

      console.error("DIGIO DOWNLOAD FAILED BODY:", errorText);

      return res.status(502).json({
        success: false,
        message: "Signed PDF download failed",
        digio_download_status: fileResponse.status,
        digio_download_error: errorText,
      });
    }

    const fileBuffer = Buffer.from(fileResponse.data);
    const safeDocumentType = document.document_type || "document";
    const fileName = `signed/${safeDocumentType}_${document.employee_id}_${document.id}.pdf`;

    await minioClient.putObject(
      BUCKET,
      fileName,
      fileBuffer,
      fileBuffer.length,
      { "Content-Type": "application/pdf" }
    );

    await db.query(
      `UPDATE employee_documents
       SET signed_file_url = ?,
           signing_status = 'completed',
           digio_status = 'completed',
           signed_at = NOW()
       WHERE id = ?`,
      [fileName, document.id]
    );

    return res.status(200).json({
      success: true,
      message: "Signed PDF downloaded and saved successfully",
      data: {
        signed_file_url: fileName,
        digio_document_id: document.digio_document_id,
        agreement_status: agreementStatus,
      },
    });
  } catch (error) {
    console.error("DOWNLOAD SIGNED PDF ERROR:", error.message);
    console.error("DOWNLOAD SIGNED PDF STACK:", error.stack);
    console.error("DOWNLOAD SIGNED PDF RESPONSE:", pretty(error.response?.data));

    return res.status(500).json({
      success: false,
      message: "Internal server error while downloading signed PDF",
      error: error.response?.data || error.message,
    });
  }
};