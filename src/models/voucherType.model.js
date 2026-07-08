const connection = require("../config/db")

const createVoucherTypeModel = async (connection, data) => {

  const query = `
    INSERT INTO voucher_types
    (
      voucher_name,
      voucher_type,
      numbering_method,
      use_advance_numbering,
      decimal_digit,
      starting_number,
      prefix,
      suffix,
      use_effective_date,
      voucher_start_date,
      voucher_end_date,
      allow_narration
    )
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `;

  const values = [
    data.voucher_name,
    data.voucher_type,
    data.numbering_method,
    data.use_advance_numbering,
    data.decimal_digit,
    data.starting_number,
    data.prefix,
    data.suffix,
    data.use_effective_date,
    data.voucher_start_date,
    data.voucher_end_date,
    data.allow_narration
  ];

  const [result] = await connection.execute(query, values);

  return result;
};

const getAllVoucherTypesModel = async (
  connection,
  page,
  limit,
  search
) => {

  const offset = (page - 1) * limit;

  let query = `
    SELECT *
    FROM voucher_types
  `;

  let countQuery = `
    SELECT COUNT(*) as total
    FROM voucher_types
  `;

  const values = [];
  const countValues = [];

  // SEARCH FILTER
  if (search) {

    query += `
      WHERE
        voucher_name LIKE ?
        OR voucher_type LIKE ?
    `;

    countQuery += `
      WHERE
        voucher_name LIKE ?
        OR voucher_type LIKE ?
    `;

    const searchValue = `%${search}%`;

    values.push(searchValue, searchValue);
    countValues.push(searchValue, searchValue);
  }

  // PAGINATION
  query += `
    ORDER BY id DESC
    LIMIT ${parseInt(limit, 10)}
    OFFSET ${parseInt(offset, 10)}
  `;

  // GET DATA
  const [rows] = await connection.execute(query, values);

  // GET TOTAL COUNT
  const [countResult] = await connection.execute(
    countQuery,
    countValues
  );

  return {
    rows,
    total: countResult[0].total
  };
};

// const getAllVoucherTypesModel = async (
//   connection,
//   page,
//   limit,
//   search
// ) => {

//   const offset = (page - 1) * limit;

//   let query = `
//     SELECT *
//     FROM voucher_types
//   `;

//   let countQuery = `
//     SELECT COUNT(*) as total
//     FROM voucher_types
//   `;

//   const values = [];
//   const countValues = [];

//   // SEARCH FILTER
//   if (search) {

//     query += `
//       WHERE
//         voucher_name LIKE ?
//         OR voucher_type LIKE ?
//     `;

//     countQuery += `
//       WHERE
//         voucher_name LIKE ?
//         OR voucher_type LIKE ?
//     `;

//     const searchValue = `%${search}%`;

//     values.push(searchValue, searchValue);
//     countValues.push(searchValue, searchValue);
//   }

//   // PAGINATION
//   query += `
//     ORDER BY id DESC
//     LIMIT ?
//     OFFSET ?
//   `;

//   values.push(Number(limit), Number(offset));

//   // GET DATA
//   const [rows] = await connection.execute(query, values);

//   // GET TOTAL COUNT
//   const [countResult] = await connection.execute(
//     countQuery,
//     countValues
//   );

//   return {
//     rows,
//     total: countResult[0].total
//   };
// };



// GET BY ID
const getVoucherTypeByIdModel = async (connection, id) => {

  const query = `
    SELECT *
    FROM voucher_types
    WHERE id = ?
  `;

  const [rows] = await connection.execute(query, [id]);

  return rows[0];
};



// UPDATE
const updateVoucherTypeModel = async (connection, id, data) => {

  const query = `
    UPDATE voucher_types
    SET
      voucher_name = ?,
      voucher_type = ?,
      numbering_method = ?,
      use_advance_numbering = ?,
      decimal_digit = ?,
      starting_number = ?,
      prefix = ?,
      suffix = ?,
      use_effective_date = ?,
      voucher_start_date = ?,
      voucher_end_date = ?,
      allow_narration = ?
    WHERE id = ?
  `;

  const values = [
    data.voucher_name,
    data.voucher_type,
    data.numbering_method,
    data.use_advance_numbering,
    data.decimal_digit,
    data.starting_number,
    data.prefix,
    data.suffix,
    data.use_effective_date,
    data.voucher_start_date,
    data.voucher_end_date,
    data.allow_narration,
    id
  ];

  const [result] = await connection.execute(query, values);

  return result;
};


// DELETE
const deleteVoucherTypeModel = async (connection, id) => {

  const query = `
    DELETE FROM voucher_types
    WHERE id = ?
  `;

  const [result] = await connection.execute(query, [id]);

  return result;
};

module.exports = {
  createVoucherTypeModel,
  getAllVoucherTypesModel,
  getVoucherTypeByIdModel,
  updateVoucherTypeModel,
  deleteVoucherTypeModel
};