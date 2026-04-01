const db = require("../config/db");

// Create Distributor
const createDistributor = async (conn, data) => {
  const [result] = await conn.query("INSERT INTO distributors SET ?", data);
  return result.insertId;
};

// Insert Partners
const insertPartners = async (conn, distributorId, partners) => {
  for (let p of partners) {
    await conn.query("INSERT INTO distributor_partner_details SET ?", {
      distributor_id: distributorId,
      name: p.name,
      father_name: p.father_name,
      pan_no: p.pan_no,
      aadhar_no: p.aadhar_no,
      address: p.address,
      state: p.state,
      district: p.district,
      tehsil: p.tehsil,
      pincode: p.pincode,
      mobile_no: p.mobile_no,
      alt_mobile_no: p.alt_mobile_no,
      photo: p.photo || null,
    });
  }
};

// Insert Other Companies
const insertCompanies = async (conn, distributorId, companies) => {
  for (let c of companies) {
    await conn.query("INSERT INTO distributor_other_companies SET ?", {
      distributor_id: distributorId,
      company_name: c.company_name,
      turnover: c.turnover,
    });
  }
};

// Insert Documents
const insertDocuments = async (conn, distributorId, docs) => {
  await conn.query("INSERT INTO distributor_documents SET ?", {
    distributor_id: distributorId,
    shop_image: docs.shop_image || null,
    cheque_photo: docs.cheque_photo || null,
    pan_photo: docs.pan_photo || null,
    aadhar_photo: docs.aadhar_photo || null,
    gst_file: docs.gst_file || null,
    seed_license: docs.seed_license || null,
    fertilizer_license: docs.fertilizer_license || null,
    pesticide_license: docs.pesticide_license || null,
    bank_diary: docs.bank_diary || null,
    letter_head: docs.letter_head || null,
     authority_letter: docs.authority_letter || null,    
  partnership_deed: docs.partnership_deed || null,    
  });
};

module.exports = {
  createDistributor,
  insertPartners,
  insertCompanies,
  insertDocuments,
};