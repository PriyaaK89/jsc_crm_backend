const db = require("../config/db");
const {
  createDistributor,
  insertPartners,
  insertCompanies,
  insertDocuments,
} = require("../models/distributor.model");

const { uploadFileToMinio } = require("../utils/fileUpload");

exports.createDistributor = async (req, res) => {
  const conn = await db.getConnection();
  await conn.beginTransaction();

  try {
    const body = req.body;
    const files = req.files || {};

    // 🔹 1. Upload Documents to MinIO
    const uploadedDocs = {};

    const uploadSingle = async (field) => {
      if (files[field]?.[0]) {
        const result = await uploadFileToMinio(
          files[field][0],
          "distributor_documents"
        );
        uploadedDocs[field] = result.object_path;
      }
    };

    let approverImagePath = null;

if (req.files?.approver_image?.[0]) {
  const uploaded = await uploadFileToMinio(
    req.files.approver_image[0],
    "distributor_documents"
  );
  approverImagePath = uploaded.object_path;
}

    const docFields = [
      "shop_image",
      "cheque_photo",
      "pan_photo",
      "aadhar_photo",
      "gst_file",
      "seed_license",
      "fertilizer_license",
      "pesticide_license",
      "bank_diary",
      "letter_head",
      "authority_letter",  
  "partnership_deed",
    ];

    for (let field of docFields) {
      await uploadSingle(field);
    }

    // 🔹 2. Insert Distributor
    const distributorId = await createDistributor(conn, {
      customer_name: body.customer_name,
      customer_dob: body.customer_dob,
      firm_name: body.firm_name,
      gst_number: body.gst_number,
      gst_type: body.gst_type,
      firm_type: body.firm_type,
      business_address: body.business_address,
      state: body.state,
      district: body.district,
      tehsil: body.tehsil,
      pincode: body.pincode,
      contact_number: body.contact_number,
      alt_contact_number: body.alt_contact_number,
      source_of_funds: body.source_of_funds,
      own_funds_details: body.own_funds_details,
      bank_name: body.bank_name,
      bank_account_no: body.bank_account_no,
      ifsc_code: body.ifsc_code,
      approver_name: body.approver_name,
      approving_date: body.approving_date,
      approver_image: approverImagePath,
    });

    // 🔹 3. Partners
    if (body.firm_type === "partnership" && body.partners) {
      const partners = JSON.parse(body.partners);

      // upload partner photos if present
      for (let i = 0; i < partners.length; i++) {
        const fileKey = `partner_photo_${i}`;
        if (files[fileKey]?.[0]) {
          const uploaded = await uploadFileToMinio(
            files[fileKey][0],
            "distributor_documents"
          );
          partners[i].photo = uploaded.object_path;
        }
      }

      await insertPartners(conn, distributorId, partners);
    }

    // 🔹 4. Other Companies
    if (body.other_companies) {
      const companies = JSON.parse(body.other_companies);
      await insertCompanies(conn, distributorId, companies);
    }

    // 🔹 5. Documents
    await insertDocuments(conn, distributorId, uploadedDocs);

    await conn.commit();

    res.status(201).json({
      success: true,
      message: "Distributor created successfully",
      distributorId,
    });

  } catch (error) {
    await conn.rollback();
    res.status(500).json({
      success: false,
      error: error.message,
    });
  } finally {
    conn.release();
  }
};