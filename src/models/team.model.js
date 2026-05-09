const db = require('../config/db');

const createTeam = async (name, target_amount, created_by) => {
  const [result] = await db.query(
    `INSERT INTO teams (name, target_amount, pending_target_amount, created_by)
     VALUES (?, ?, ?, ?)`,
    [name, target_amount || 0, target_amount || 0, created_by]
  );

  return result.insertId;
};
// const getAllTeams = async () => {
//   const [rows] = await db.query(
//     `SELECT id, name, target_amount, pending_target_amount 
//      FROM teams 
//      ORDER BY name ASC`
//   );
//   return rows;
// };
const getAllTeams = async ({
  page,
  limit,
  search
}) => {

  const offset = (page - 1) * limit;

  let where = `WHERE 1=1`;

  let params = [];

  // SEARCH FILTER

  if (search) {

    where += ` AND name LIKE ?`;

    params.push(`%${search}%`);
  }

  // MAIN QUERY

  const [rows] = await db.query(

    `SELECT
        id,
        name,
        target_amount,
        pending_target_amount

     FROM teams

     ${where}

     ORDER BY id DESC

     LIMIT ? OFFSET ?`,

    [...params, limit, offset]
  );

  // COUNT QUERY

  const [countRows] = await db.query(

    `SELECT COUNT(*) as total
     FROM teams
     ${where}`,

    params
  );

  return {
    data: rows,
    total: countRows[0].total
  };
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

const getSubTeamsByTeam = async ({
  teamId,
  page,
  limit,
  search
}) => {

  const offset = (page - 1) * limit;

  let where = `WHERE st.parent_team_id = ?`;

  let params = [teamId];

  // SEARCH

  if (search) {

    where += ` AND st.name LIKE ?`;

    params.push(`%${search}%`);
  }

  // MAIN QUERY

  const [rows] = await db.query(

    `SELECT
        st.id,
        st.name,
        st.sub_team_target_amount,
        st.pending_target_amount,

        GROUP_CONCAT(sc.name) as categories

     FROM sub_teams st

     LEFT JOIN sub_team_categories stc
       ON st.id = stc.sub_team_id

     LEFT JOIN stock_categories sc
       ON sc.id = stc.category_id

     ${where}

     GROUP BY st.id

     ORDER BY st.id DESC

     LIMIT ? OFFSET ?`,

    [...params, limit, offset]
  );

  // COUNT

  const [countRows] = await db.query(

    `SELECT COUNT(*) as total

     FROM sub_teams st

     ${where}`,

    params
  );

  return {
    data: rows.map(row => ({
      ...row,
      categories: row.categories
        ? row.categories.split(',')
        : []
    })),

    total: countRows[0].total
  };
};
// const getSubTeamsByTeam = async (teamId) => {
//   const [rows] = await db.query(
//     `SELECT 
//         st.id,
//         st.name,
//         st.sub_team_target_amount,
//         st.pending_target_amount,
//         GROUP_CONCAT(sc.name) as categories
//      FROM sub_teams st
//      LEFT JOIN sub_team_categories stc ON st.id = stc.sub_team_id
//      LEFT JOIN stock_categories sc ON sc.id = stc.category_id
//      WHERE st.parent_team_id = ?
//      GROUP BY st.id
//      ORDER BY st.name ASC`,
//     [teamId]
//   );

//   //  Transform categories string → array
//   return rows.map(row => ({
//     ...row,
//     categories: row.categories ? row.categories.split(',') : []
//   }));
// };

// teamModel.js

const getAssignedTargets = async ({
  page,
  limit,
  role,
  search,
  team_id,
  sub_team_id
}) => {

  const offset = (page - 1) * limit;

  let where = `WHERE 1=1`;

  let params = [];

  // ROLE FILTER

  if (role) {

    where += ` AND ta.role = ?`;

    params.push(role);
  }

  // TEAM FILTER

  if (team_id) {

    where += ` AND ta.team_id = ?`;

    params.push(team_id);
  }

  // SUBTEAM FILTER

  if (sub_team_id) {

    where += ` AND ta.sub_team_id = ?`;

    params.push(sub_team_id);
  }

  // SEARCH FILTER

  if (search) {

    where += `
      AND (
        u.name LIKE ?
        OR u.email LIKE ?
      )
    `;

    params.push(
      `%${search}%`,
      `%${search}%`
    );
  }

  // MAIN QUERY

  const [rows] = await db.query(

    `SELECT
        ta.id,
        ta.team_id,
        ta.sub_team_id,
        ta.parent_assignment_id,
        ta.parent_id,
        ta.parent_type,
        ta.user_id,
        ta.role,
        ta.total_target,
        ta.pending_target,
        u.name,
        u.email,
        t.name as team_name,
        st.name as sub_team_name

     FROM target_assignments ta

     LEFT JOIN users u
       ON u.id = ta.user_id

     LEFT JOIN teams t
       ON t.id = ta.team_id

     LEFT JOIN sub_teams st
       ON st.id = ta.sub_team_id

     ${where}

     ORDER BY ta.id DESC

     LIMIT ? OFFSET ?`,

    [...params, limit, offset]
  );

  // COUNT QUERY

  const [countRows] = await db.query(

    `SELECT COUNT(*) as total

     FROM target_assignments ta

     LEFT JOIN users u
       ON u.id = ta.user_id

     ${where}`,

    params
  );

  return {
    data: rows,
    total: countRows[0].total
  };
};

const updateTeam = async ({
  id,
  name,
  target_amount
}) => {

  await db.query(

    `UPDATE teams
     SET
       name = ?,
       target_amount = ?
     WHERE id = ?`,

    [name, target_amount, id]
  );
};

const deleteTeam = async (id) => {

  await db.query(

    `DELETE FROM teams
     WHERE id = ?`,

    [id]
  );
};

const updateSubTeam = async ({
  id,
  name,
  sub_team_target_amount
}) => {

  await db.query(

    `UPDATE sub_teams
     SET
       name = ?,
       sub_team_target_amount = ?
     WHERE id = ?`,

    [name, sub_team_target_amount, id]
  );
};

const deleteSubTeam = async (id) => {

  await db.query(

    `DELETE FROM sub_teams
     WHERE id = ?`,

    [id]
  );
};


module.exports = { createTeam,createSubTeam, getAllTeams, getTeamById, getSubTeamsByTeam, getAssignedTargets, updateTeam, deleteTeam, updateSubTeam, deleteSubTeam};