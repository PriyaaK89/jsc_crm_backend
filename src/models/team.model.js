const db = require('../config/db');

const createTeam = async (name, target_amount, created_by) => {
  const [result] = await db.query(
    `INSERT INTO teams (name, target_amount, pending_target_amount, created_by)
     VALUES (?, ?, ?, ?)`,
    [name, target_amount || 0, target_amount || 0, created_by]
  );

  return result.insertId;
};
const getAllTeams = async () => {
  const [rows] = await db.query(
    `SELECT id, name, target_amount, pending_target_amount 
     FROM teams 
     ORDER BY name ASC`
  );
  return rows;
};

const getTeamById = async (id) => {
  const [rows] = await db.query(
    `SELECT id, name, target_amount, pending_target_amount 
     FROM teams 
     WHERE id = ?`,
    [id]
  );
  return rows[0];
};

const createSubTeam = async ({
  name,
  parent_team_id,
  category_ids,
  sub_team_target_amount,
  created_by
}) => {

  const connection = await db.getConnection();

  try {
    await connection.beginTransaction();

    // 1. Check parent team
    const [teamRows] = await connection.query(
      `SELECT pending_target_amount FROM teams WHERE id = ?`,
      [parent_team_id]
    );

    const team = teamRows[0];

    if (!team) throw new Error('Parent team not found');

    if (sub_team_target_amount > team.pending_target_amount) {
      throw new Error('Not enough pending target available');
    }

    // 2. Insert subteam
    const [result] = await connection.query(
      `INSERT INTO sub_teams 
      (name, parent_team_id, sub_team_target_amount, pending_target_amount, created_by)
      VALUES (?, ?, ?, ?, ?)`,
      [
        name,
        parent_team_id,
        sub_team_target_amount,
        sub_team_target_amount,
        created_by
      ]
    );

    const subTeamId = result.insertId;

    // 3. Validate categories
    const [validCats] = await connection.query(
      `SELECT id FROM stock_categories 
       WHERE id IN (?) AND is_deleted = 0`,
      [category_ids]
    );

    if (validCats.length !== category_ids.length) {
      throw new Error('Invalid category ids');
    }

    // 4. Insert mapping
    for (const catId of category_ids) {
      await connection.query(
        `INSERT INTO sub_team_categories (sub_team_id, category_id)
         VALUES (?, ?)`,
        [subTeamId, catId]
      );
    }

    // 5. Update parent team
    await connection.query(
      `UPDATE teams 
       SET pending_target_amount = pending_target_amount - ?
       WHERE id = ?`,
      [sub_team_target_amount, parent_team_id]
    );

    await connection.commit();

    return subTeamId;

  } catch (error) {
    await connection.rollback();
    throw error;
  } finally {
    connection.release();
  }
};

// const createSubTeam = async ({ name, parent_team_id, product_category, sub_team_target_amount, created_by}) => {

//   // 1. Get parent team
//   const [teamRows] = await db.query(
//     `SELECT target_amount, pending_target_amount FROM teams WHERE id = ?`,
//     [parent_team_id]
//   );

//   const team = teamRows[0];
//   if (!team) {
//     throw new Error('Parent team not found');
//   }
//   // 2. Validate remaining target
//   if (sub_team_target_amount > team.pending_target_amount) {
//     throw new Error('Not enough pending target available');
//   }
//   // 3. Insert subteam
//   const [result] = await db.query(
//     `INSERT INTO sub_teams 
//     (name, parent_team_id, product_category, sub_team_target_amount, pending_target_amount, created_by)
//     VALUES (?, ?, ?, ?, ?, ?)`,
//     [
//       name, parent_team_id, product_category, sub_team_target_amount, sub_team_target_amount,  created_by
//     ]
//   );

//   await db.query(
//     `UPDATE teams  SET pending_target_amount = pending_target_amount - ? WHERE id = ?`,
//     [sub_team_target_amount, parent_team_id]
//   );

//   return result.insertId;
// };

// const getSubTeamsByTeam = async (teamId) => {
//   const [rows] = await db.query(
//     `SELECT id, name, sub_team_target_amount, pending_target_amount 
//      FROM sub_teams 
//      WHERE parent_team_id = ?
//      ORDER BY name ASC`,
//     [teamId]
//   );
//   return rows;
// };

const getSubTeamsByTeam = async (teamId) => {
  const [rows] = await db.query(
    `SELECT 
        st.id,
        st.name,
        st.sub_team_target_amount,
        st.pending_target_amount,
        GROUP_CONCAT(sc.name) as categories
     FROM sub_teams st
     LEFT JOIN sub_team_categories stc ON st.id = stc.sub_team_id
     LEFT JOIN stock_categories sc ON sc.id = stc.category_id
     WHERE st.parent_team_id = ?
     GROUP BY st.id
     ORDER BY st.name ASC`,
    [teamId]
  );

  //  Transform categories string → array
  return rows.map(row => ({
    ...row,
    categories: row.categories ? row.categories.split(',') : []
  }));
};

const getAssignedTargets = async ({
  page = 1,
  limit = 10,
  role,
  search
}) => {
  const offset = (page - 1) * limit;

  let where = `WHERE 1=1`;
  const params = [];

  if (role) {
    where += ` AND ta.role = ?`;
    params.push(role);
  }

  //  Search by user name
  if (search) {
    where += ` AND u.name LIKE ?`;
    params.push(`%${search}%`);
  }

  //  Main data query
  const [rows] = await db.query(
    `SELECT 
        ta.id,
        ta.user_id,
        u.name,
        ta.role,
        ta.parent_id,
        ta.parent_type,
        ta.total_target,
        ta.pending_target,
        ta.created_at
     FROM target_assignments ta
     JOIN users u ON u.id = ta.user_id
     ${where}
     ORDER BY ta.created_at DESC
     LIMIT ? OFFSET ?`,
    [...params, Number(limit), Number(offset)]
  );

  //  Count query (IMPORTANT: same WHERE)
  const [countRows] = await db.query(
    `SELECT COUNT(*) as total 
     FROM target_assignments ta
     JOIN users u ON u.id = ta.user_id
     ${where}`,
    params
  );

  return {
    data: rows,
    total: countRows[0].total,
    page,
    limit
  };
};

module.exports = {
  createTeam,createSubTeam, getAllTeams, getTeamById, getSubTeamsByTeam, getAssignedTargets
};