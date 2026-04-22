const db = require("../config/db");

const createUser = async (user) => {
  const [result] = await db.query(
    ` INSERT INTO users (
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
      area,
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
      two_wheeler_allowance_per_km,
      four_wheeler_allowance_per_km,
      avg_travel_km_per_day,
      city_allowance_per_km,
      daily_allowance_with_doc,
      daily_allowance_without_doc,
      hotel_allowance,
      total_leaves,
      authentication_amount,
      headquarter,
      approver_id,
      login_time,
      logout_time,
      pf,
      esi, profile_image, reporting_under
    )
    VALUES (
      ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?,
      ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ? )`,
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
      user.area || null,
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
      // user.travelling_allowance_per_km || null,
      user.two_wheeler_allowance_per_km || 0,
user.four_wheeler_allowance_per_km || 0,
      user.avg_travel_km_per_day || null,
      user.city_allowance_per_km || null,
      user.daily_allowance_with_doc || null,
      user.daily_allowance_without_doc || null,
      user.hotel_allowance || null,

      user.total_leaves ?? 0,
      user.authentication_amount || null,
      user.headquarter || null,
      user.approver_id || null,

      user.login_time || null,
      user.logout_time || null,
      user.pf || null,
      user.esi || null,
      user.profile_image || null,
user.reporting_under || null
    ]
  );

  return { id: result.insertId };
};

const findUserByEmail = async (email) => {
  const [rows] = await db.query(
    ` SELECT 
      u.*, 
      r.name AS role,
      jr.name AS job_role_name,
      jr.level AS job_role_level,
      d.name AS department_name
    FROM users u
    LEFT JOIN job_roles jr ON u.job_role_id = jr.id
    LEFT JOIN roles r ON r.id = u.role_id
    LEFT JOIN department d ON d.id = u.department_id
    WHERE u.email = ? `,
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
  whereClause = `
    WHERE 
      u.name LIKE ? 
      OR u.email LIKE ? 
      OR u.contact_no LIKE ?
  `;
  params.push(`%${search}%`, `%${search}%`, `%${search}%`);
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
      u.area,
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
      u.two_wheeler_allowance_per_km,
u.four_wheeler_allowance_per_km,
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
      u.is_active,

      u.approver_id,
approver.name AS approver_name,
      r.name AS role,
       u.profile_image,
    u.reporting_under,
    manager.name AS reporting_officer_name,

  u.internet_status,
  u.location_status,
  u.last_seen,

  TIMESTAMPDIFF(MINUTE, u.last_seen, NOW()) AS minutes_offline
    FROM users u
     JOIN roles r ON r.id = u.role_id
    LEFT JOIN department d ON d.id = u.department_id AND d.is_active = 1
    LEFT JOIN job_roles jr ON jr.id = u.job_role_id AND jr.is_active = 1
    LEFT JOIN users approver ON approver.id = u.approver_id

     LEFT JOIN users manager ON manager.id = u.reporting_under
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

const getUserById = async (id) => {
  const [rows] = await db.query(
    `
    SELECT 
      u.id,
      u.name,
      u.email,
      u.gender,
      u.contact_no,
      u.date_of_birth,

      u.address_line1,
      u.address_line2,
      u.country,
      u.state,
      u.city,
      u.district,
      u.area,
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
      u.two_wheeler_allowance_per_km,
      u.four_wheeler_allowance_per_km,
      u.avg_travel_km_per_day,
      u.city_allowance_per_km,
      u.daily_allowance_with_doc,
      u.daily_allowance_without_doc,
      u.hotel_allowance,

      u.total_leaves,
      u.authentication_amount,
      u.headquarter,
      u.approver_id,
      approver.name AS approver_name,

      u.login_time,
      u.logout_time,
      u.pf,
      u.esi,

      u.role_id,
      r.name AS role,
       u.profile_image,
    u.reporting_under,
    manager.name AS reporting_officer_name,
      u.internet_status,
  u.location_status,
  u.last_seen,

  TIMESTAMPDIFF(MINUTE, u.last_seen, NOW()) AS minutes_offline
    FROM users u
    JOIN roles r ON r.id = u.role_id
    LEFT JOIN department d ON d.id = u.department_id AND d.is_active = 1
    LEFT JOIN job_roles jr ON jr.id = u.job_role_id AND jr.is_active = 1
    LEFT JOIN users manager ON manager.id = u.reporting_under
    LEFT JOIN users approver ON approver.id = u.approver_id
    WHERE u.id = ?
    `,
    [id]
  );

  return rows[0];
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


const updateUserStatus = async (userId, is_active) => {
  const [result] = await db.query(
    `UPDATE users SET is_active = ? WHERE id = ?`,
    [is_active, userId]
  );

  return result.affectedRows > 0;
};

const softDeleteUser = async (userId) => {
  const conn = await db.getConnection();

  try {
    await conn.beginTransaction();

    // 1. Copy to deleted_users
    const [rows] = await conn.query(
      `INSERT INTO deleted_users SELECT *, NOW() FROM users WHERE id = ?`,
      [userId]
    );

    if (rows.affectedRows === 0) {
      await conn.rollback();
      return false;
    }

    // 2. Delete from users
    await conn.query(`DELETE FROM users WHERE id = ?`, [userId]);

    await conn.commit();
    return true;

  } catch (err) {
    await conn.rollback();
    throw err;
  } finally {
    conn.release();
  }
};

const getDeletedUsers = async () => {
  const [rows] = await db.query(
    `SELECT * FROM deleted_users ORDER BY deleted_at DESC`
  );
  return rows;
};

const getUserDropdown = async () => {
  const [rows] = await db.query(
    `SELECT id, name 
     FROM users
     WHERE is_active = 1
     ORDER BY name ASC`
  );

  return rows;
};

const updateProfileImage = async (userId, imagePath) => {
  await db.query(
    `UPDATE users SET profile_image = ? WHERE id = ?`,
    [imagePath, userId]
  );
};

const getUsersUnderManager = async (managerId) => {
  const [rows] = await db.query(
    `WITH RECURSIVE team AS (
      SELECT id, name, reporting_under
      FROM users
      WHERE reporting_under = ?

      UNION ALL

      SELECT u.id, u.name, u.reporting_under
      FROM users u
      INNER JOIN team t ON u.reporting_under = t.id
    )
    SELECT * FROM team`,
    [managerId]
  );

  return rows;
};

const getSubordinateIds = async (userId) => {
  const query = `
    WITH RECURSIVE subordinates AS (
      SELECT id, reporting_under
      FROM users
      WHERE id = ?

      UNION ALL

      SELECT u.id, u.reporting_under
      FROM users u
      INNER JOIN subordinates s ON u.reporting_under = s.id
    )
    SELECT id FROM subordinates
  `;

  const [rows] = await db.query(query, [userId]);

  return rows.map(row => row.id);
};

module.exports = {
  createUser, findUserByEmail, getAllUsers, getUserById, updateUserById, updatePasswordByAdmin, updateUserStatus, softDeleteUser, getDeletedUsers, getUserDropdown, updateProfileImage, getSubordinateIds, getUsersUnderManager
};
