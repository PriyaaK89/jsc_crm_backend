const axios = require("axios");
const db = require("../config/db");
const { getPdfPageCount, getFileBufferFromMinio, normalizePhone, getDigioAuthHeader, buildSignCoordinates } = require("../utils/digio.helper");
const minioClient = require("../config/minio"); 
const { getPresignedUrl } = require("../utils/fileUpload");

exports.sendDistributorForESign = async (req, res) => {
  try {
    const { distributor_id } = req.body;

    if (!distributor_id) {
      return res.status(400).json({ message: "distributor_id required" });
    }

    // 1. Get distributor + document
    const [[doc]] = await db.query(`
      SELECT dd.*, d.customer_name, d.contact_number
      FROM distributor_documents_master dd
      JOIN distributors d ON dd.distributor_id = d.id
      WHERE dd.distributor_id = ? AND dd.document_type = 'agreement'
    `, [distributor_id]);

    if (!doc) {
      return res.status(404).json({ message: "Document not found" });
    }

    // 2. Get mobile
    const mobile = normalizePhone(doc.contact_number);
    const companyEmail = process.env.COMPANY_SIGNER_EMAIL;

    if (!mobile) {
      return res.status(400).json({ message: "Distributor mobile missing" });
    }

    // 3. Get file from MinIO
    const fileBuffer = await getFileBufferFromMinio(doc.file_path);

    // 4. Get pages
    const totalPages = await getPdfPageCount(fileBuffer);

    const { companyCoordinates, employeeCoordinates } =
      buildSignCoordinates(totalPages);

    // 5. Prepare payload
    const payload = {
      file_name: `distributor_${doc.distributor_id}.pdf`,
      expire_in_days: 10,
      notify_signers: true,
      send_sign_link: true,
      sequential: true,
      reference_id: `dist_${doc.distributor_id}_${Date.now()}`,
      file_data: fileBuffer.toString("base64"),
      signers: [
        {
          identifier: mobile,
          name: doc.customer_name,
          sign_type: "aadhaar",
          reason: "Distributor Signing",
          index: 1,
          sign_coordinates: employeeCoordinates,
        },
        {
          identifier: companyEmail,
          name: "Company",
          sign_type: "electronic",
          signature_mode: "otp",
          index: 2,
          sign_coordinates: companyCoordinates,
        },
      ],
    };

    // 6. Send to Digio
    const response = await axios.post(
      `${process.env.DIGIO_BASE_URL}/v2/client/document/uploadpdf`,
      payload,
      {
        headers: {
          Authorization: getDigioAuthHeader(),
          "Content-Type": "application/json",
        },
      }
    );

    const resp = response.data;

    // 7. Save in DB
    await db.query(`
      UPDATE distributor_documents_master
      SET digio_document_id = ?,
          digio_invitee_id = ?,
          signing_status = 'pending',
          sent_for_sign_at = NOW()
      WHERE id = ?
    `, [
      resp.id,
      resp.signing_parties?.[0]?.identifier || null,
      doc.id
    ]);

    return res.json({
      success: true,
      message: "Distributor sent for eSign",
      data: resp,
    });

  } catch (err) {
    console.error(err);
    res.status(500).json({ message: "Error sending for sign" });
  }
};

exports.checkDistributorStatus = async (req, res) => {
  try {
    const { distributor_id } = req.params;

    const [[doc]] = await db.query(
      `SELECT * FROM distributor_documents_master 
       WHERE distributor_id = ?`,
      [distributor_id]
    );

    if (!doc || !doc.digio_document_id) {
      return res.status(404).json({ message: "No Digio document found" });
    }

    const response = await axios.get(
      `${process.env.DIGIO_BASE_URL}/v2/client/document/${doc.digio_document_id}`,
      {
        headers: {
          Authorization: getDigioAuthHeader(),
        },
      }
    );

    const status = response.data.agreement_status;

    await db.query(
      `UPDATE distributor_documents_master 
       SET signing_status = ?
       WHERE id = ?`,
      [status, doc.id]
    );

    res.json({
      success: true,
      status,
      data: response.data,
    });

  } catch (err) {
    console.error(err);
    res.status(500).json({ message: "Error checking status" });
  }
};

exports.downloadDistributorSignedPdf = async (req, res) => {
  try {
    const { distributor_id } = req.params;

    const [[doc]] = await db.query(
      `SELECT * FROM distributor_documents_master 
       WHERE distributor_id = ?`,
      [distributor_id]
    );

    if (!doc || !doc.digio_document_id) {
      return res.status(404).json({ message: "Document not found" });
    }

    // 1. Download from Digio
    const response = await axios.get(
      `${process.env.DIGIO_BASE_URL}/v2/client/document/download`,
      {
        params: { document_id: doc.digio_document_id },
        responseType: "arraybuffer",
        headers: {
          Authorization: getDigioAuthHeader(),
        },
      }
    );

    const buffer = Buffer.from(response.data);

    // 2. Upload to MinIO
    const fileName = `distributor/signed_${doc.distributor_id}.pdf`;

    await minioClient.putObject(
      "jsc-crm",
      fileName,
      buffer,
      buffer.length
    );

    // 3. Update DB
    await db.query(
      `UPDATE distributor_documents_master
       SET signed_file_url = ?, signing_status = 'completed', signed_at = NOW()
       WHERE id = ?`,
      [fileName, doc.id]
    );

const signedUrl = await getPresignedUrl(fileName);

res.json({
  success: true,
  signed_file_url: fileName,
  download_url: signedUrl, // usable link
});

  } catch (err) {
    console.error(err);
    res.status(500).json({ message: "Download failed" });
  }
};