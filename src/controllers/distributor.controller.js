const db = require("../config/db");
const {
  createDistributor,
  insertPartners,
  insertCompanies,
  insertDocuments,
  getDistributors,
  getDistributorById,
  getPartners,
  getCompanies,
  getDocuments,
  updateDistributor,
  deletePartners,
  deleteCompanies,
  getRelatedData, deleteDistributor
} = require("../models/distributor.model");
const { uploadFileToMinio, getPresignedUrl } = require("../utils/fileUpload");


exports.createDistributor = async (req, res) => {
  const conn = await db.getConnection();
  await conn.beginTransaction();

  try {
    const body = req.body;
    const files = req.files || {};
    const userId = req.user?.id;
    const userName = req.user?.name;

    const allowedFields = [
      "customer_name",
      "customer_dob",
      "firm_name",
      "gst_number",
      "gst_type",
      "firm_type",
      "business_address",
      "business_territory",
      "state",
      "district",
      "tehsil",
      "landmark",
      "firm_landmark",
      "pincode",
      "contact_number",
      "alt_contact_number",
      "responsible_person_name",
      "responsible_person_contact",
      "responsible_person_address",
      "responsible_person_alt_contact",
      "firm_email",
      "firm_pan",
      "firm_aadhar",
      "jurisdiction_area",
      "branch",
      "firm_since",
      "seed_license_no",
      "seed_license_expiry",
      "fertilizer_license_no",
      "pesticide_license_no",
      "transport_name_a",
      "transport_name_b",
      "source_of_funds",
      "own_funds_details",
      "bank_name",
      "bank_account_no",
      "ifsc_code",
      "bank_branch",
      "security_cheque_no",
      "security_cheque_no_2",
      "security_amount",
      "credit_duration",
      "credit_amount",
      "annual_turnover",
      "expected_sale",
      "approver_name",
      "approving_date",
    ];

    const distributorData = {};

    for (let key of allowedFields) {
      if (body[key] !== undefined && body[key] !== "") {
        distributorData[key] = body[key];
      }
    }
    const gstTypes = ["regular", "consumer", "unregistered", "composition"];
    const firmTypes = ["proprietorship", "partnership", "private_limited"];
    const fundTypes = ["own_funds", "loan", "investment"];
    distributorData.created_by = userId;
    distributorData.created_by_name = userName;

    if (
      distributorData.gst_type &&
      !gstTypes.includes(distributorData.gst_type.toLowerCase())
    ) {
      throw new Error("Invalid GST Type");
    }

    if (
      distributorData.firm_type &&
      !firmTypes.includes(distributorData.firm_type.toLowerCase())
    ) {
      throw new Error("Invalid Firm Type");
    }

    if (
      distributorData.source_of_funds &&
      !fundTypes.includes(distributorData.source_of_funds.toLowerCase())
    ) {
      throw new Error("Invalid Source of Funds");
    }

    // normalize enums
    if (distributorData.gst_type)
      distributorData.gst_type = distributorData.gst_type.toLowerCase();

    if (distributorData.firm_type)
      distributorData.firm_type = distributorData.firm_type.toLowerCase();

    if (distributorData.source_of_funds)
      distributorData.source_of_funds =
        distributorData.source_of_funds.toLowerCase();

    const formatDate = (date) => {
      if (!date) return null;
      const d = new Date(date);
      if (isNaN(d)) throw new Error(`Invalid date: ${date}`);
      return d.toISOString().split("T")[0];
    };

    distributorData.customer_dob = formatDate(distributorData.customer_dob);
    distributorData.firm_since = formatDate(distributorData.firm_since);
    distributorData.seed_license_expiry = formatDate(
      distributorData.seed_license_expiry,
    );
    distributorData.approving_date = formatDate(distributorData.approving_date);

    const toNumber = (val) => (val ? Number(val) : null);
    distributorData.security_amount = toNumber(distributorData.security_amount);
    distributorData.annual_turnover = toNumber(distributorData.annual_turnover);
    distributorData.expected_sale = toNumber(distributorData.expected_sale);
    distributorData.credit_duration = toNumber(distributorData.credit_duration);
    distributorData.credit_amount = toNumber(distributorData.credit_amount);

    const uploadedDocs = {};

    // MULTIPLE FILES (shop, cheque)
    const uploadIndexed = async (field, maxCount) => {
      if (files[field] && Array.isArray(files[field])) {
        for (let i = 0; i < Math.min(files[field].length, maxCount); i++) {
          const uploaded = await uploadFileToMinio(
            files[field][i],
            "distributor_documents",
          );
          uploadedDocs[`${field}_${i + 1}`] = uploaded.object_path;
        }
      }
    };

    await uploadIndexed("shop_image", 4);
    await uploadIndexed("cheque_photo", 2);

    // AADHAR FRONT/BACK
    if (files?.aadhar_front?.[0]) {
      const uploaded = await uploadFileToMinio(
        files.aadhar_front[0],
        "distributor_documents",
      );
      uploadedDocs.aadhar_front = uploaded.object_path;
    }

    if (files?.aadhar_back?.[0]) {
      const uploaded = await uploadFileToMinio(
        files.aadhar_back[0],
        "distributor_documents",
      );
      uploadedDocs.aadhar_back = uploaded.object_path;
    }

    // SINGLE FILES
    const singleDocs = [
      "pan_photo",
      "gst_file",
      "seed_license",
      "fertilizer_license",
      "pesticide_license",
      "bank_diary",
      "letter_head",
      "authority_letter",
      "partnership_deed",
    ];

    for (let field of singleDocs) {
      if (files[field]?.[0]) {
        const uploaded = await uploadFileToMinio(
          files[field][0],
          "distributor_documents",
        );
        uploadedDocs[field] = uploaded.object_path;
      }
    }

    // APPROVER IMAGE
    let approverImagePath = null;

    if (files?.approver_image?.[0]) {
      const uploaded = await uploadFileToMinio(
        files.approver_image[0],
        "distributor_documents",
      );
      approverImagePath = uploaded.object_path;
    }

    distributorData.approver_image = approverImagePath;
    const distributorId = await createDistributor(conn, distributorData);
    // HANDLE PROPRIETORSHIP (OWNER)
    if (distributorData.firm_type === "proprietorship") {
      const owner = {
        name: body.owner_name,
        father_name: body.owner_father_name,
        pan_no: body.owner_pan,
        aadhar_no: body.owner_aadhar,
        address: body.owner_address,
        state: body.owner_state,
        district: body.owner_district,
        tehsil: body.owner_tehsil,
        pincode: body.owner_pincode,
        mobile_no: body.owner_mobile,
        alt_mobile_no: body.owner_alt_mobile,
        role: "owner",
      };

      // Upload owner photo
      if (files?.owner_photo?.[0]) {
        const uploaded = await uploadFileToMinio(
          files.owner_photo[0],
          "distributor_documents",
        );
        owner.photo = uploaded.object_path;
      }

      await insertPartners(conn, distributorId, [owner]);
    }

    if (distributorData.firm_type === "partnership") {
      let partners = [];

      if (distributorData.firm_type === "partnership" && body.partners) {
        try {
          partners = JSON.parse(body.partners);
        } catch {
          throw new Error("Invalid partners JSON");
        }
      }

      //  IMPORTANT CHECK
      if (Array.isArray(partners) && partners.length > 0) {
        for (let i = 0; i < partners.length; i++) {
          const fileKey = `partner_photo_${i}`;

          if (files[fileKey]?.[0]) {
            const uploaded = await uploadFileToMinio(
              files[fileKey][0],
              "distributor_documents",
            );
            partners[i].photo = uploaded.object_path;
          }

          //  Ensure role is always partner
          partners[i].role = "partner";
        }
        await insertPartners(conn, distributorId, partners);
      }
    }

    if (body.other_companies) {
      let companies = [];

      try {
        companies = JSON.parse(body.other_companies);
      } catch {
        throw new Error("Invalid companies JSON");
      }

      await insertCompanies(conn, distributorId, companies);
    }

    await insertDocuments(conn, distributorId, uploadedDocs);

    await conn.commit();

    res.status(201).json({
      success: true,
      message: "Distributor created successfully",
      distributorId,
      created_by: userId,
      created_by_name: userName,
    });
  } catch (error) {
    await conn.rollback();
    res.status(400).json({
      success: false,
      message: error.message,
    });
  } finally {
    conn.release();
  }
};

const generateDocumentUrls = async (documents) => {
  if (!documents) return null;

  const result = { ...documents };

  for (let key in result) {
    if (result[key] && typeof result[key] === "string") {
      try {
        result[key] = await getPresignedUrl(result[key]);
      } catch (err) {
        console.error(`Error generating URL for ${key}`, err.message);
        result[key] = null;
      }
    }
  }

  return result;
};

exports.getDistributor = async (req, res) => {
  const conn = await db.getConnection();

  try {
    const { id } = req.params;

    const distributor = await getDistributorById(conn, id);
    if (!distributor) {
      return res.status(404).json({
        success: false,
        message: "Distributor not found",
      });
    }

    const partners = await getPartners(conn, id);
    const companies = await getCompanies(conn, id);
    // const documents = await getDocuments(conn, id);
    const documentsRaw = await getDocuments(conn, id);
    const documents = await generateDocumentUrls(documentsRaw);

    res.status(200).json({
      success: true,
      data: {
        distributor,
        partners,
        companies,
        documents,
      },
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      message: error.message,
    });
  } finally {
    conn.release();
  }
};

exports.updateDistributor = async (req, res) => {
  const conn = await db.getConnection();
  await conn.beginTransaction();

  try {
    const { id } = req.params;
    const body = req.body;
    const files = req.files || {};

    //  Check if exists
    const [existing] = await conn.query(
      "SELECT id FROM distributors WHERE id = ?",
      [id]
    );

    if (!existing.length) {
      throw new Error("Distributor not found");
    }

    //  STEP 1: Prepare distributor data
    const distributorData = {};

    const allowedFields = [
      "customer_name",
      "firm_name",
      "gst_number",
      "contact_number",
      "state",
      "district",
      "firm_type"
    ];

    for (let key of allowedFields) {
      if (body[key] !== undefined) {
        distributorData[key] = body[key];
      }
    }

    //  STEP 2: Update distributor
    if (Object.keys(distributorData).length > 0) {
      await updateDistributor(conn, id, distributorData);
    }

    //  STEP 3: Partners (DELETE + INSERT)
    await deletePartners(conn, id);

    if (body.partners) {

      let partners;

      try {
        partners = JSON.parse(body.partners);
      } catch {
        throw new Error("Invalid partners JSON");
      }

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

      await insertPartners(conn, id, partners);
    }

    //  STEP 4: Companies
    await deleteCompanies(conn, id);

    if (body.other_companies) {
      let companies;

      try {
        companies = JSON.parse(body.other_companies);
      } catch {
        throw new Error("Invalid companies JSON");
      }

      await insertCompanies(conn, id, companies);
    }

    //  STEP 5: Documents
    const updatedDocs = {};

    const docFields = [
      "pan_photo",
      "gst_file",
      "seed_license",
      "fertilizer_license",
      "pesticide_license",
      "bank_diary",
      "letter_head",
      "authority_letter",
      "partnership_deed",
      "aadhar_front",
      "aadhar_back"
    ];

    for (let field of docFields) {
      if (files[field]?.[0]) {
        const uploaded = await uploadFileToMinio(
          files[field][0],
          "distributor_documents"
        );
        updatedDocs[field] = uploaded.object_path;
      }
    }

    //  Multiple images handling
    if (files.shop_image) {
      files.shop_image.forEach(async (file, index) => {
        const uploaded = await uploadFileToMinio(file, "distributor_documents");
        updatedDocs[`shop_image_${index + 1}`] = uploaded.object_path;
      });
    }

    if (files.cheque_photo) {
      files.cheque_photo.forEach(async (file, index) => {
        const uploaded = await uploadFileToMinio(file, "distributor_documents");
        updatedDocs[`cheque_photo_${index + 1}`] = uploaded.object_path;
      });
    }

    if (Object.keys(updatedDocs).length > 0) {
      await conn.query(
        "UPDATE distributor_documents SET ? WHERE distributor_id = ?",
        [updatedDocs, id]
      );
    }

    await conn.commit();

    res.json({
      success: true,
      message: "Distributor updated successfully",
    });

  } catch (error) {
    await conn.rollback();

    res.status(400).json({
      success: false,
      message: error.message,
    });
  } finally {
    conn.release();
  }
};

exports.getAllDistributors = async (req, res) => {
  const conn = await db.getConnection();

  try {
    const filters = req.query;

    // STEP 1: Get distributors
    const { rows, total } = await getDistributors(conn, filters);

    const distributorIds = rows.map((d) => d.id);

    // STEP 2: Get related data
    const { partners, companies, documents } = await getRelatedData(
      conn,
      distributorIds,
    );

    const result = await Promise.all(
      rows.map(async (d) => {
        const doc = documents.find((doc) => doc.distributor_id === d.id);
        return {
          ...d,
          partners: partners.filter((p) => p.distributor_id === d.id),
          companies: companies.filter((c) => c.distributor_id === d.id),
          documents: await generateDocumentUrls(doc),
        };
      }),
    );

    // STEP 4: Pagination response
    res.status(200).json({
      success: true,
      total,
      page: Number(filters.page) || 1,
      limit: Number(filters.limit) || 10,
      totalPages: Math.ceil(total / (filters.limit || 10)),
      data: result,
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      message: error.message,
    });
  } finally {
    conn.release();
  }
};

exports.deleteDistributor = async (req, res) => {
  const conn = await db.getConnection();

  try {
    const { id } = req.params;

    await conn.beginTransaction();

    // 1. Delete child tables first
    await deletePartners(conn, id);
    await deleteCompanies(conn, id);

    // delete documents
    await conn.query(
      "DELETE FROM distributor_documents WHERE distributor_id = ?",
      [id]
    );

    // 2. Delete main distributor
    await deleteDistributor(conn, id);

    await conn.commit();

    res.status(200).json({
      success: true,
      message: "Distributor deleted successfully",
    });
  } catch (error) {
    await conn.rollback();

    res.status(500).json({
      success: false,
      message: "Delete failed",
      error: error.message,
    });
  } finally {
    conn.release();
  }
};

exports.uploadAgreement = async (req, res) => {
  try {
    const { distributor_id } = req.body;

    if (!req.file) {
      return res.status(400).json({ message: "PDF file required" });
    }

    // Upload to MinIO
    const uploadRes = await uploadFileToMinio(
      req.file,
      "distributor_agreement",
      {
        distributor_id, // optional (if you want structured path)
      }
    );

    // Save in DB
    await db.query(
      `
      INSERT INTO distributor_documents_master 
      (distributor_id, document_type, file_path, file_url)
      VALUES (?, ?, ?, ?)
      ON DUPLICATE KEY UPDATE 
      file_path = VALUES(file_path),
      file_url = VALUES(file_url)
      `,
      [
        distributor_id,
        "agreement",
        uploadRes.object_path,
        uploadRes.file_url,
      ]
    );

    return res.json({
      success: true,
      message: "Agreement uploaded successfully",
      data: uploadRes,
    });
  } catch (err) {
    console.error(err);
    res.status(500).json({ message: "Upload failed" });
  }
};

exports.getDistributorDocument = async (req, res) => {
  try {
    const { distributor_id } = req.params;

    if (!distributor_id) {
      return res.status(400).json({ message: "Distributor ID is required" });
    }

    // Fetch document from DB
    const [[doc]] = await db.query(
      `SELECT * FROM distributor_documents_master 
       WHERE distributor_id = ? AND document_type = 'agreement'`,
      [distributor_id]
    );

    if (!doc) {
      return res.status(404).json({ message: "Document not found" });
    }

    // Generate presigned URL
    let presignedUrl = null;
    if (doc.file_path) {
      presignedUrl = await getPresignedUrl(doc.file_path);
    }

    return res.json({
      success: true,
      data: {
        id: doc.id,
        distributor_id: doc.distributor_id,
        document_type: doc.document_type,

        file_path: doc.file_path,
        file_url: doc.file_url, // optional
        presigned_url: presignedUrl, //  THIS YOU SEND TO DIGIO

        signing_status: doc.signing_status,
        sign_url: doc.sign_url,

        digio_document_id: doc.digio_document_id,
        digio_invitee_id: doc.digio_invitee_id,

        signed_file_url: doc.signed_file_url,

        sent_for_sign_at: doc.sent_for_sign_at,
        signed_at: doc.signed_at,
      },
    });

  } catch (err) {
    console.error(err);
    res.status(500).json({ message: "Failed to fetch document" });
  }
};

// exports.createDistributor = async (req, res) => {
//   const conn = await db.getConnection();
//   await conn.beginTransaction();

//   try {
//     const body = req.body;
//     const files = req.files || {};

//     const uploadedDocs = {};

//     const uploadSingle = async (field) => {
//       if (files[field]?.[0]) {
//         const result = await uploadFileToMinio(
//           files[field][0],
//           "distributor_documents"
//         );
//         uploadedDocs[field] = result.object_path;
//       }
//     };

//     let approverImagePath = null;

// if (req.files?.approver_image?.[0]) {
//   const uploaded = await uploadFileToMinio(
//     req.files.approver_image[0],
//     "distributor_documents"
//   );
//   approverImagePath = uploaded.object_path;
// }

//     const docFields = [
//       "shop_image",
//       "cheque_photo",
//       "pan_photo",
//       "aadhar_photo",
//       "gst_file",
//       "seed_license",
//       "fertilizer_license",
//       "pesticide_license",
//       "bank_diary",
//       "letter_head",
//       "authority_letter",
//   "partnership_deed",
//     ];

//     for (let field of docFields) {
//       await uploadSingle(field);
//     }
//     const distributorId = await createDistributor(conn, {
//       customer_name: body.customer_name,
//       customer_dob: body.customer_dob,
//       firm_name: body.firm_name,
//       gst_number: body.gst_number,
//       gst_type: body.gst_type,
//       firm_type: body.firm_type,
//       business_address: body.business_address,
//       state: body.state,
//       district: body.district,
//       tehsil: body.tehsil,
//       pincode: body.pincode,
//       contact_number: body.contact_number,
//       alt_contact_number: body.alt_contact_number,
//       source_of_funds: body.source_of_funds,
//       own_funds_details: body.own_funds_details,
//       bank_name: body.bank_name,
//       bank_account_no: body.bank_account_no,
//       ifsc_code: body.ifsc_code,
//       approver_name: body.approver_name,
//       approving_date: body.approving_date,
//       approver_image: approverImagePath,
//     });

//     //  3. Partners
//     if (body.firm_type === "partnership" && body.partners) {
//       const partners = JSON.parse(body.partners);

//       // upload partner photos if present
//       for (let i = 0; i < partners.length; i++) {
//         const fileKey = `partner_photo_${i}`;
//         if (files[fileKey]?.[0]) {
//           const uploaded = await uploadFileToMinio(
//             files[fileKey][0],
//             "distributor_documents"
//           );
//           partners[i].photo = uploaded.object_path;
//         }
//       }

//       await insertPartners(conn, distributorId, partners);
//     }

//     if (body.other_companies) {
//       const companies = JSON.parse(body.other_companies);
//       await insertCompanies(conn, distributorId, companies);
//     }

//     await insertDocuments(conn, distributorId, uploadedDocs);

//     await conn.commit();

//     res.status(201).json({
//       success: true,
//       message: "Distributor created successfully",
//       distributorId,
//     });

//   } catch (error) {
//     await conn.rollback();
//     res.status(500).json({
//       success: false,
//       error: error.message,
//     });
//   } finally {
//     conn.release();
//   }
// };
