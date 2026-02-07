const db = require("../config/db");


// const createUser = async (user) => {
//   const [result] = await db.query(
//     `
//     INSERT INTO users (
//       name, email, password, role_id,must_change_password,
//       gender, contact_no, date_of_birth,
//       address_line1, address_line2, country, state, city, district, pincode,
//       father_name, pan_number, aadhar_no, blood_group,
//       department_id, job_role_id, date_of_joining,
//       salary, attendance_selfie, travelling_allowance_per_km, avg_travel_km_per_day,
//       city_allowance_per_km, daily_allowance_with_doc, daily_allowance_without_doc, hotel_allowance,
//       total_leaves, login_time, logout_time, authentication_amount, headquarter, approver_name, pf, esi)
//     VALUES (
//       ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?,
//        ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
//     [
//       user.name, user.email, user.password, user.role_id, user.must_change_password ?? 1,
//       user.gender, user.contact_no, user.date_of_birth,
//       user.address_line1, user.address_line2, user.country, user.state, user.city, user.district, user.pincode,
//       user.father_name, user.pan_number, user.aadhar_no, user.blood_group,
//       user.department_id, user.job_role_id, user.date_of_joining, user.salary, user.attendance_selfie, user.travelling_allowance_per_km, user.avg_travel_km_per_day,
//       user.city_allowance_per_km, user.daily_allowance_with_doc, user.daily_allowance_without_doc, user.hotel_allowance,
//      user.total_leaves, user.login_time, user.logout_time, user.authentication_amount, user.headquarter, user.approver_name, user.pf, user.esi
//     ]
//   );

//   return { id: result.insertId };
// };


// const createUser = async (user) => {
//   const [rows] = await db.query(` SELECT user_id FROM users WHERE user_id IS NOT NULL ORDER BY id DESC LIMIT 1 `);
//   let nextUserId = 'EMP-1001';
//   if (rows.length > 0 && rows[0].user_id) {
//     const lastNumber = parseInt(rows[0].user_id.split('-')[1], 10);
//     nextUserId = `EMP-${lastNumber + 1}`; }

//   const [result] = await db.query(
//     ` INSERT INTO users ( user_id, name, email, password, role_id, gender, contact_no, date_of_birth, address_line1, address_line2, country, state, city, district, pincode, father_name, pan_number, aadhar_no, blood_group, department_id, job_role_id, date_of_joining, salary, travelling_allowance, attendance_timing, approver_name )
//     VALUES ( ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ? ) `,
//     [ nextUserId, user.name, user.email, user.password, user.role_id,
//       user.gender, user.contact_no, user.date_of_birth, user.address_line1, user.address_line2, user.country, user.state, user.city, user.district,
//       user.pincode, user.father_name, user.pan_number, user.aadhar_no, user.blood_group, user.department_id, user.job_role_id, user.date_of_joining, user.salary, user.travelling_allowance, user.attendance_timing, user.approver_name ]
//   );
//   return {
//     id: result.insertId,
//     user_id: nextUserId
//   };
// };

// FIND USER BY EMAIL

const createUser = async (user) => {
  const [result] = await db.query(
    `
    INSERT INTO users (
      name,
      email,
      password,
      role_id,
      must_change_password,

      gender,
      contact_no,
      date_of_birth,

      address_line1,
      address_line2,
      country,
      state,
      city,
      district,
      pincode,

      father_name,
      pan_number,
      aadhar_no,
      blood_group,

      department_id,
      job_role_id,
      date_of_joining,
      salary,

      week_off,
      attendance_selfie,
      travelling_allowance_per_km,
      avg_travel_km_per_day,
      city_allowance_per_km,
      daily_allowance_with_doc,
      daily_allowance_without_doc,
      hotel_allowance,

      total_leaves,
      authentication_amount,
      headquarter,
      approver_name,

      login_time,
      logout_time,
      pf,
      esi
    )
    VALUES (
      ?, ?, ?, ?, ?,
      ?, ?, ?,
      ?, ?, ?, ?, ?, ?, ?,
      ?, ?, ?, ?,
      ?, ?, ?, ?,
      ?, ?, ?, ?, ?, ?, ?,
      ?, ?, ?, ?,
      ?, ?, ?, ?, ?
    )
    `,
    [
      user.name || null,
      user.email || null,
      null, // password ALWAYS null at creation
      user.role_id || null,
      1, // must_change_password = true

      user.gender || null,
      user.contact_no || null,
      user.date_of_birth || null,

      user.address_line1 || null,
      user.address_line2 || null,
      user.country || null,
      user.state || null,
      user.city || null,
      user.district || null,
      user.pincode || null,

      user.father_name || null,
      user.pan_number || null,
      user.aadhar_no || null,
      user.blood_group || null,

      user.department_id || null,
      user.job_role_id || null,
      user.date_of_joining || null,
      user.salary || null,

      user.week_off || null,
      user.attendance_selfie || null,
      user.travelling_allowance_per_km || null,
      user.avg_travel_km_per_day || null,
      user.city_allowance_per_km || null,
      user.daily_allowance_with_doc || null,
      user.daily_allowance_without_doc || null,
      user.hotel_allowance || null,

      user.total_leaves ?? 0,
      user.authentication_amount || null,
      user.headquarter || null,
      user.approver_name || null,

      user.login_time || null,
      user.logout_time || null,
      user.pf || null,
      user.esi || null
    ]
  );

  return { id: result.insertId };
};


const findUserByEmail = async (email) => {
  const [rows] = await db.query(
    `
    SELECT u.*, r.name AS role
    FROM users u
    JOIN roles r ON r.id = u.role_id
    WHERE u.email = ?
    `,
    [email]
  );

  return rows[0];
};

const updatePasswordByAdmin = async (userId, hashedPassword) => {
  await db.query(
    `
    UPDATE users
    SET password = ?, must_change_password = 0
    WHERE id = ?
    `,
    [hashedPassword, userId]
  );
};

const getAllUsers = async ({ search = "", page = 1, limit = 10 }) => {
  const offset = (page - 1) * limit;

  let whereClause = "";
  let params = [];

  if (search) {
    whereClause = "WHERE u.name LIKE ?";
    params.push(`%${search}%`);
  }

  // Get paginated users
  const [rows] = await db.query(
    ` SELECT 
      u.id,
      u.name,
      u.email,
      u.gender,
      u.role_id,
      u.contact_no,
      u.date_of_birth,

      u.address_line1, 
      u.address_line2, 
      u.country, 
      u.state, 
      u.city, 
      u.district, 
      u.pincode,

      u.father_name, 
      u.pan_number, 
      u.aadhar_no, 
      u.blood_group,

      u.department_id,
      d.name AS department_name,
      u.job_role_id,
      jr.name AS job_role_name,
      u.date_of_joining,

      u.salary,

      u.week_off,
      u.attendance_selfie,
      u.travelling_allowance_per_km,
      u.avg_travel_km_per_day,
      u.city_allowance_per_km,
      u.daily_allowance_with_doc,
      u.daily_allowance_without_doc,
      u.hotel_allowance,
      u.total_leaves,
      u.authentication_amount,
      u.headquarter,
      u.login_time,
      u.logout_time,
      u.pf,
      u.esi,

      u.approver_name,
      r.name AS role
    FROM users u
     JOIN roles r ON r.id = u.role_id
    LEFT JOIN department d ON d.id = u.department_id AND d.is_active = 1
    LEFT JOIN job_roles jr ON jr.id = u.job_role_id AND jr.is_active = 1
    ${whereClause}
    ORDER BY u.id DESC
    LIMIT ? OFFSET ?
    `,
    [...params, Number(limit), Number(offset)]
  );

  // Get total count
  const [countResult] = await db.query(
    `
    SELECT COUNT(*) AS total
    FROM users u
    ${whereClause}
    `,
    params
  );

  return {
    users: rows,
    total: countResult[0].total
  };
};



const updateUserById = async (id, userData) => {
  const fields = [];
  const values = [];

  Object.entries(userData).forEach(([key, value]) => {
    if (value !== undefined) {
      fields.push(`${key} = ?`);
      values.push(value);
    }
  });

  if (fields.length === 0) {
    return false;
  }

  values.push(id);

  const [result] = await db.query(
    `
    UPDATE users
    SET ${fields.join(", ")}
    WHERE id = ?
    `,
    values
  );

  return result.affectedRows > 0;
};


module.exports = {
  createUser, findUserByEmail, getAllUsers, updateUserById, updatePasswordByAdmin
};
