const db = require("../config/db");
const { createDistributor, insertPartners, insertCompanies, insertDocuments,} = require("../models/distributor.model");
const { uploadFileToMinio } = require("../utils/fileUpload");

exports.createDistributor = async (req, res) => {
  const conn = await db.getConnection();
  await conn.beginTransaction();

  try {
    const body = req.body;
    const files = req.files || {};

    const allowedFields = [
      "customer_name","customer_dob","firm_name","gst_number","gst_type","firm_type",
      "business_address","business_territory","state","district","tehsil","landmark",
      "firm_landmark","pincode","contact_number","alt_contact_number",
      "responsible_person_name","responsible_person_contact",
      "responsible_person_address","responsible_person_alt_contact",
      "firm_email","firm_pan","firm_aadhar","jurisdiction_area","branch",
      "firm_since","seed_license_no","seed_license_expiry",
      "fertilizer_license_no","pesticide_license_no",
      "transport_name_a","transport_name_b",
      "source_of_funds","own_funds_details",
      "bank_name","bank_account_no","ifsc_code","bank_branch",
      "security_cheque_no","security_cheque_no_2",
      "security_amount","credit_duration",
      "annual_turnover","expected_sale",
      "approver_name","approving_date"
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
      distributorData.seed_license_expiry
    );
    distributorData.approving_date = formatDate(
      distributorData.approving_date
    );


    const toNumber = (val) => (val ? Number(val) : null);

    distributorData.security_amount = toNumber(distributorData.security_amount);
    distributorData.annual_turnover = toNumber(distributorData.annual_turnover);
    distributorData.expected_sale = toNumber(distributorData.expected_sale);
    distributorData.credit_duration = toNumber(distributorData.credit_duration);


    const uploadedDocs = {};

    // MULTIPLE FILES (shop, cheque)
    const uploadIndexed = async (field, maxCount) => {
      if (files[field] && Array.isArray(files[field])) {
        for (let i = 0; i < Math.min(files[field].length, maxCount); i++) {
          const uploaded = await uploadFileToMinio(
            files[field][i],
            "distributor_documents"
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
        "distributor_documents"
      );
      uploadedDocs.aadhar_front = uploaded.object_path;
    }

    if (files?.aadhar_back?.[0]) {
      const uploaded = await uploadFileToMinio(
        files.aadhar_back[0],
        "distributor_documents"
      );
      uploadedDocs.aadhar_back = uploaded.object_path;
    }

    // SINGLE FILES
    const singleDocs = [
      "pan_photo","gst_file","seed_license",
      "fertilizer_license","pesticide_license",
      "bank_diary","letter_head","authority_letter","partnership_deed"
    ];

    for (let field of singleDocs) {
      if (files[field]?.[0]) {
        const uploaded = await uploadFileToMinio(
          files[field][0], "distributor_documents");
        uploadedDocs[field] = uploaded.object_path;
      }
    }

    // APPROVER IMAGE
    let approverImagePath = null;

    if (files?.approver_image?.[0]) {
      const uploaded = await uploadFileToMinio(
        files.approver_image[0],
        "distributor_documents"
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
    role: "owner"
  };

  // Upload owner photo
  if (files?.owner_photo?.[0]) {
    const uploaded = await uploadFileToMinio(
      files.owner_photo[0],
      "distributor_documents"
    );
    owner.photo = uploaded.object_path;
  }

  await insertPartners(conn, distributorId, [owner]);
}


    if (
      distributorData.firm_type === "partnership" &&
      body.partners
    ) {
      let partners = [];

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

      await insertPartners(conn, distributorId, partners);
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