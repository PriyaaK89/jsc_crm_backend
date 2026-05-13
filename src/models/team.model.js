const db = require('../config/db');

const createTeam = async (name, target_amount, created_by) => {
  const [result] = await db.query(
    `INSERT INTO teams (name, target_amount, pending_target_amount, created_by)
     VALUES (?, ?, ?, ?)`,
    [name, target_amount || 0, target_amount || 0, created_by]
  );

  return result.insertId;
};

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
    `SELECT id, name, target_amount, pending_target_amount
     FROM teams ${where}
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
      [ name, parent_team_id, sub_team_target_amount, sub_team_target_amount, created_by ]
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

// teamModel.js

const getAssignedTargets = async ({ page, limit, search }) => {

  const offset = (page - 1) * limit;

  let where = `WHERE 1=1`;

  let params = [];

  // SEARCH FILTER

  if (search) {

    where += `
      AND (
        u.name LIKE ?
        OR u.email LIKE ?
        OR ta.role LIKE ?
        OR t.name LIKE ?
        OR st.name LIKE ?
        OR ta.parent_type LIKE ?
      )
    `;

    params.push(
      `%${search}%`,
      `%${search}%`,
      `%${search}%`,
      `%${search}%`,
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

        t.name AS team_name,

        st.name AS sub_team_name

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

    `SELECT COUNT(*) AS total

     FROM target_assignments ta

     LEFT JOIN users u
       ON u.id = ta.user_id

     LEFT JOIN teams t
       ON t.id = ta.team_id

     LEFT JOIN sub_teams st
       ON st.id = ta.sub_team_id

     ${where}`,

    params
  );

  return {
    data: rows,
    total: countRows[0].total
  };
};

const getAssignmentById = async (id, connection = db) => {

  const [rows] = await connection.query(
    `SELECT *
     FROM target_assignments
     WHERE id = ?`,
    [id]
  );

  return rows[0];
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

// const deleteTeam = async (id) => {
//   await db.query( `DELETE FROM teams WHERE id = ?`, [id]);
// };

const deleteTeam = async (teamId) => {

  const connection = await db.getConnection();

  try {

    await connection.beginTransaction();

    const [subTeams] = await connection.query(

      `SELECT id
       FROM sub_teams
       WHERE parent_team_id = ?`,

      [teamId]
    );

    const subTeamIds =
      subTeams.map(item => item.id);

    if (subTeamIds.length > 0) {

      await connection.query(

        `DELETE FROM sub_team_categories
         WHERE sub_team_id IN (?)`,

        [subTeamIds]
      );

      await connection.query(

        `DELETE FROM target_assignments
         WHERE sub_team_id IN (?)`,

        [subTeamIds]
      );

      await connection.query(

        `DELETE FROM sub_teams
         WHERE id IN (?)`,

        [subTeamIds]
      );
    }

    await connection.query(

      `DELETE FROM teams
       WHERE id = ?`,

      [teamId]
    );

    await connection.commit();

    return true;

  } catch (error) {

    await connection.rollback();

    throw error;

  } finally {

    connection.release();
  }
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

  const connection =
    await db.getConnection();

  try {

    await connection.beginTransaction();

    // ================= CHECK SUBTEAM EXISTS =================

    const [subTeamRows] =
      await connection.query(

        `SELECT
            id,
            parent_team_id,
            pending_target_amount

         FROM sub_teams
         WHERE id = ?`,

        [id]
      );

    const subTeam =
      subTeamRows[0];

    if (!subTeam) {

      throw new Error(
        "Sub team not found"
      );
    }

    // ================= CHECK ASSIGNMENTS =================

    const [assignments] =
      await connection.query(
        `SELECT id
         FROM target_assignments
         WHERE sub_team_id = ?
         LIMIT 1`,
        [id]
      );
    if ( assignments.length > 0 ) {
      throw new Error(
        "Cannot delete sub team because targets are assigned to employees."
      );
    }
    // ================= RESTORE PENDING TARGET =================

    await connection.query(
      `UPDATE teams
       SET pending_target_amount =
           pending_target_amount + ?
       WHERE id = ?`,
      [
        subTeam.pending_target_amount,
        subTeam.parent_team_id
      ]
    );

    // ================= DELETE CATEGORY MAPPINGS =================

    await connection.query(
      `DELETE FROM sub_team_categories  WHERE sub_team_id = ?`, [id]
    );

    // ================= DELETE SUBTEAM =================

    await connection.query( `DELETE FROM sub_teams WHERE id = ?`, [id] );
    await connection.commit();
    return true;
  } catch (error) {
    await connection.rollback();
    throw error;
  } finally {
    connection.release();
  }
};

module.exports = { createTeam,createSubTeam, getAllTeams, getTeamById, getSubTeamsByTeam, getAssignedTargets, updateTeam, deleteTeam, updateSubTeam, deleteSubTeam, getAssignmentById};