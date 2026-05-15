const db = require("../config/db");

const createAccountGroup = async (data) => {
  const {
    group_name,
    parent_group_id,
    behaves_like_subledger,
    nett_debit_credit,
    used_for_calculation,
    method_to_allocate,
    created_by,
  } = data;

  const [result] = await db.query(
    `
    INSERT INTO account_groups
    (
      group_name,
      parent_group_id,
      behaves_like_subledger,
      nett_debit_credit,
      used_for_calculation,
      method_to_allocate,
      created_by
    )
    VALUES (?, ?, ?, ?, ?, ?, ? )
    `,
    [
      group_name,
      parent_group_id,
      behaves_like_subledger,
      nett_debit_credit,
      used_for_calculation,
      method_to_allocate,
      created_by,
    ],
  );

  return result;
};

// CHECK GROUP EXISTS
const findGroupByName = async (group_name) => {
  const [rows] = await db.query(
    `
    SELECT *
    FROM account_groups
    WHERE LOWER(TRIM(group_name)) = LOWER(TRIM(?))
    `,
    [group_name],
  );

  return rows[0];
};

// GET ALL GROUPS WITH PAGINATION + SEARCH
const getAllGroups = async ({
  page = 1,
  limit = 10,
  search = "",
}) => {

  const offset = (page - 1) * limit;

  // =========================
  // SEARCH CONDITION
  // =========================

  let searchQuery = "";

  let queryParams = [];

  if (search) {

    searchQuery = `
      WHERE
        ag.group_name LIKE ?
        OR pg.group_name LIKE ?
    `;

    queryParams.push(`%${search}%`);
    queryParams.push(`%${search}%`);
  }


  const [rows] = await db.query(
    `
    SELECT
      ag.id,
      ag.group_name,
      ag.parent_group_id,
      pg.group_name AS parent_group_name,
      ag.behaves_like_subledger,
      ag.nett_debit_credit,
      ag.used_for_calculation,
      ag.method_to_allocate,
      ag.is_primary,
      ag.status,
      ag.created_by,
      ag.created_at,
      ag.updated_at

    FROM account_groups ag

    LEFT JOIN account_groups pg
      ON ag.parent_group_id = pg.id

    ${searchQuery}

    ORDER BY ag.id DESC

    LIMIT ?
    OFFSET ?
    `,
    [
      ...queryParams,
      Number(limit),
      Number(offset),
    ]
  );

  const [countResult] = await db.query(
    `
    SELECT COUNT(*) AS total

    FROM account_groups ag

    LEFT JOIN account_groups pg
      ON ag.parent_group_id = pg.id

    ${searchQuery}
    `,
    queryParams
  );

  return {
    rows,
    total: countResult[0]?.total || 0,
  };
};

// GET GROUP BY ID
const getGroupById = async (id) => {
  const [rows] = await db.query(
    `
    SELECT *
    FROM account_groups
    WHERE id = ?
    `,
    [id],
  );

  return rows[0];
};

// UPDATE GROUP
const updateAccountGroup = async (id, data) => {
  const {
    group_name,
    parent_group_id,
    behaves_like_subledger,
    nett_debit_credit,
    used_for_calculation,
    method_to_allocate,
  } = data;

  const [result] = await db.query(
    `
    UPDATE account_groups
    SET
      group_name = ?,
      parent_group_id = ?,
      behaves_like_subledger = ?,
      nett_debit_credit = ?,
      used_for_calculation = ?,
      method_to_allocate = ?
    WHERE id = ?
    `,
    [
      group_name,
      parent_group_id,
      behaves_like_subledger,
      nett_debit_credit,
      used_for_calculation,
      method_to_allocate,
      id,
    ],
  );

  return result;
};

// DELETE GROUP
const deleteAccountGroup = async (id) => {
  const [result] = await db.query(
    `
    DELETE FROM account_groups
    WHERE id = ?
    `,
    [id],
  );

  return result;
};

module.exports = {
  createAccountGroup,
  findGroupByName,
  getAllGroups,
  getGroupById,
  updateAccountGroup,
  deleteAccountGroup,
};
