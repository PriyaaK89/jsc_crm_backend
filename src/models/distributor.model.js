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
      role: p.role || "partner",
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

    shop_image_1: docs.shop_image_1 || null,
    shop_image_2: docs.shop_image_2 || null,
    shop_image_3: docs.shop_image_3 || null,
    shop_image_4: docs.shop_image_4 || null,

    cheque_photo_1: docs.cheque_photo_1 || null,
    cheque_photo_2: docs.cheque_photo_2 || null,

    aadhar_front: docs.aadhar_front || null,
    aadhar_back: docs.aadhar_back || null,

    pan_photo: docs.pan_photo || null,
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

// Get Distributor
const getDistributorById = async (conn, id) => {
  const [rows] = await conn.query(
    "SELECT * FROM distributors WHERE id = ?",
    [id]
  );
  return rows[0];
};

// Get Partners
const getPartners = async (conn, distributorId) => {
  const [rows] = await conn.query(
    "SELECT * FROM distributor_partner_details WHERE distributor_id = ?",
    [distributorId]
  );
  return rows;
};

// Get Companies
const getCompanies = async (conn, distributorId) => {
  const [rows] = await conn.query(
    "SELECT * FROM distributor_other_companies WHERE distributor_id = ?",
    [distributorId]
  );
  return rows;
};

// Get Documents
const getDocuments = async (conn, distributorId) => {
  const [rows] = await conn.query(
    "SELECT * FROM distributor_documents WHERE distributor_id = ?",
    [distributorId]
  );
  return rows[0];
};

// Update Distributor
const updateDistributor = async (conn, id, data) => {
  await conn.query("UPDATE distributors SET ? WHERE id = ?", [data, id]);
};

// Delete old partners
const deletePartners = async (conn, distributorId) => {
  await conn.query(
    "DELETE FROM distributor_partner_details WHERE distributor_id = ?",
    [distributorId]
  );
};

// Delete companies
const deleteCompanies = async (conn, distributorId) => {
  await conn.query(
    "DELETE FROM distributor_other_companies WHERE distributor_id = ?",
    [distributorId]
  );
};

const getDistributors = async (conn, filters) => {
  let query = `SELECT * FROM distributors WHERE 1=1`;
  let countQuery = `SELECT COUNT(*) as total FROM distributors WHERE 1=1`;

  const params = [];

  //  SEARCH
  if (filters.search) {
    query += ` AND (
      customer_name LIKE ? OR
      firm_name LIKE ? OR
      gst_number LIKE ? OR
      contact_number LIKE ?
    )`;
    countQuery += ` AND (
      customer_name LIKE ? OR
      firm_name LIKE ? OR
      gst_number LIKE ? OR
      contact_number LIKE ?
    )`;

    const searchValue = `%${filters.search}%`;
    params.push(searchValue, searchValue, searchValue, searchValue);
  }

  //  FILTERS
  if (filters.state) {
    query += ` AND state = ?`;
    countQuery += ` AND state = ?`;
    params.push(filters.state);
  }

  if (filters.district) {
    query += ` AND district = ?`;
    countQuery += ` AND district = ?`;
    params.push(filters.district);
  }

  if (filters.firm_type) {
    query += ` AND firm_type = ?`;
    countQuery += ` AND firm_type = ?`;
    params.push(filters.firm_type);
  }

  //  DATE FILTER
  if (filters.from_date && filters.to_date) {
    query += ` AND DATE(created_at) BETWEEN ? AND ?`;
    countQuery += ` AND DATE(created_at) BETWEEN ? AND ?`;
    params.push(filters.from_date, filters.to_date);
  }

  //  PAGINATION
  const limit = Number(filters.limit) || 10;
  const page = Number(filters.page) || 1;
  const offset = (page - 1) * limit;

  query += ` ORDER BY id DESC LIMIT ? OFFSET ?`;

  const dataParams = [...params, limit, offset];

  const [rows] = await conn.query(query, dataParams);
  const [[{ total }]] = await conn.query(countQuery, params);

  return { rows, total };
};


//  Fetch related data
const getRelatedData = async (conn, ids) => {
  if (!ids.length) return {};

  const [partners] = await conn.query(
    `SELECT * FROM distributor_partner_details WHERE distributor_id IN (?)`,
    [ids]
  );

  const [companies] = await conn.query(
    `SELECT * FROM distributor_other_companies WHERE distributor_id IN (?)`,
    [ids]
  );

  const [documents] = await conn.query(
    `SELECT * FROM distributor_documents WHERE distributor_id IN (?)`,
    [ids]
  );

  return { partners, companies, documents };
};

const deleteDistributor = async (conn, distributorId) => {
  await conn.query("DELETE FROM distributors WHERE id = ?", [distributorId]);
};
module.exports = {
  createDistributor,
  insertPartners,
  insertCompanies,
  insertDocuments, getDistributorById, getCompanies, getDocuments, getPartners, updateDistributor, deletePartners, deleteCompanies, getDistributors, getRelatedData, deleteDistributor
};