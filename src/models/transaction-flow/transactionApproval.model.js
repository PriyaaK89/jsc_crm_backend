const db = require("../../config/db");

exports.createApprovalRequest = async (connection, data) => {
  const [result] = await connection.query(
    ` INSERT INTO transaction_approvals
      (
        transaction_type,
        created_by,
        junior_accountant_id,
        dispatcher_id,
        senior_accountant_id,

        current_approver_id,
        approval_level,
        payload_json,
        current_status_message
      )
      VALUES
      ( ?,?, ?,?,?, ?, ?, ?, ? ) `,
    [
      data.transaction_type,
      data.created_by,

      data.junior_accountant_id,
      data.dispatcher_id,
      data.senior_accountant_id,
      data.current_approver_id,
      data.approval_level,
      JSON.stringify(data.payload_json),
      data.current_status_message,
    ],
  );

  return result.insertId;
};

exports.createNotification = async (connection, data) => {
  const [result] = await connection.query(
    `
    INSERT INTO order_notifications
    (
      user_id,
      approval_id,
      module_type,
      notification_category,
      title,
      message,  generated_by_id, generated_by_name
    )
    VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    `,
    [
      data.user_id,
      data.approval_id,
      data.module_type,
      data.notification_category,
      data.title,
      data.message,  data.generated_by_id ?? null,
      data.generated_by_name ?? null,
    ],
  );

  return result.insertId;
};

exports.createHistory = async (connection, data) => {
  await connection.query(
    `
    INSERT INTO approval_history
    (
      approval_id,
      action,
      action_by,
      action_level,
      remarks,
      attachment
    )
    VALUES (?, ?, ?, ?, ?, ?)
    `,
    [
      data.approval_id,
      data.action,
      data.action_by,
      data.action_level,
      data.remarks,
      data.attachment || null,
    ],
  );
};

exports.createPayloadHistory = async (connection, data) => {
  await connection.query(
    `
    INSERT INTO approval_payload_history
    (
      approval_id,
      modified_by,
      modified_level,
      old_payload,
      new_payload
    )
    VALUES (?, ?, ?, ?, ?)
    `,
    [
      data.approval_id,
      data.modified_by,
      data.modified_level,
      JSON.stringify(data.old_payload),
      JSON.stringify(data.new_payload),
    ],
  );
};

// exports.getPendingApprovals = async (userId) => {
//   const [rows] = await db.query(
//     ` SELECT ta.*, u.name FROM transaction_approvals ta
//       INNER JOIN users u ON u.id = ta.created_by
//       WHERE ta.current_approver_id = ?
//       AND ta.status = 'PENDING'
//       ORDER BY ta.created_at DESC `, [userId],
//   );
//   return rows;
// };

exports.getPendingApprovals = async (userId) => {
  const [rows] = await db.query(
    `SELECT
        ta.*,
        creator.name AS created_by_name,
        junior.name  AS junior_name,
        disp.name    AS dispatcher_name,
        senior.name  AS senior_name,
        cu.name      AS current_approver_name

      FROM transaction_approvals ta
      LEFT JOIN users creator ON creator.id = ta.created_by
      LEFT JOIN users junior  ON junior.id  = ta.junior_accountant_id
      LEFT JOIN users disp    ON disp.id    = ta.dispatcher_id
      LEFT JOIN users senior  ON senior.id  = ta.senior_accountant_id
      LEFT JOIN users cu      ON cu.id      = ta.current_approver_id

      WHERE ta.current_approver_id = ?
      AND ta.status = 'PENDING'
      ORDER BY ta.created_at DESC`,
    [userId],
  );
  return rows;
};

exports.updateApproval = async (connection, approvalId, data) => {
  const [result] = await connection.query(
    `
    UPDATE transaction_approvals
    SET

      payload_json = ?,

      is_bill_modified = ?,
      modified_by = ?,
      modified_at = ?,

      current_approver_id = ?,
      approval_level = ?,
      status = ?,
      remarks = ?,
      current_status_message = ?,

      approved_at = ?,
      rejected_at = ?,
      returned_at = ?,
      final_transaction_id = ?,
      returned_to_user_id = ?,
      returned_from_level = ?,  

      updated_at = CURRENT_TIMESTAMP

    WHERE id = ?
    `,
    [
      JSON.stringify(data.payload_json),

      data.is_bill_modified || 0,
      data.modified_by || null,
      data.modified_at || null,

      data.current_approver_id,
      data.approval_level,
      data.status,
      data.remarks,
      data.current_status_message,

      data.approved_at || null,
      data.rejected_at || null,
      data.returned_at || null,
      data.final_transaction_id || null,
       data.returned_to_user_id || null,
      data.returned_from_level || null,

      approvalId,
    ],
  );

  return result;
};
exports.getNotifications = async (userId, moduleType = null, notificationCategory = null) => {
  let sql = `
    SELECT
      t.*
    FROM (
      SELECT
        n.*,
        ta.status,
        ta.transaction_type,
        ta.approval_level,
        ta.created_at        AS approval_created_at,
        creator.name         AS created_by_name,
        junior.name          AS junior_name,
        disp.name            AS dispatcher_name,
        senior.name          AS senior_name,
        cu.name              AS current_approver_name,
        @seq := @seq + 1     AS display_seq
      FROM order_notifications n
      LEFT JOIN transaction_approvals ta
        ON ta.id = n.approval_id
      LEFT JOIN users creator ON creator.id = ta.created_by
      LEFT JOIN users junior  ON junior.id  = ta.junior_accountant_id
      LEFT JOIN users disp    ON disp.id    = ta.dispatcher_id
      LEFT JOIN users senior  ON senior.id  = ta.senior_accountant_id
      LEFT JOIN users cu      ON cu.id      = ta.current_approver_id
      JOIN (SELECT @seq := 0) AS init
      WHERE n.user_id = ?
      AND n.is_read = 0
      ${moduleType           ? "AND n.module_type = ?"            : ""}
      ${notificationCategory ? "AND n.notification_category = ?" : ""}
      ORDER BY n.created_at ASC
    ) AS t
    ORDER BY t.created_at DESC
  `;

  const params = [userId];
  if (moduleType)           params.push(moduleType);
  if (notificationCategory) params.push(notificationCategory);

  const [rows] = await db.query(sql, params);
  return rows;
};
// exports.getNotifications = async ( userId, moduleType = null, notificationCategory = null, ) => {
//   let sql = `
//     SELECT
//       n.*,
//       ta.status,
//       ta.transaction_type,
//       ta.created_at AS approval_created_at

//     FROM order_notifications n

//     LEFT JOIN transaction_approvals ta
//       ON ta.id = n.approval_id

//     WHERE n.user_id = ?
//     AND n.is_read = 0
//   `;

//   const params = [userId];

//   if (moduleType) { sql += ` AND n.module_type = ?`; params.push(moduleType) }
//   if (notificationCategory) { sql += ` AND n.notification_category = ?`; params.push(notificationCategory) }
//   sql += ` ORDER BY n.created_at DESC`;

//   const [rows] = await db.query(sql, params);

//   return rows;
// };

exports.getNotificationCounts = async (userId) => {
  const [rows] = await db.query(
    ` SELECT
            module_type,
            notification_category,
            COUNT(*) AS total

        FROM order_notifications

        WHERE user_id = ?
        AND is_read = 0

        GROUP BY module_type, notification_category `,
    [userId],
  );
  return rows;
};

exports.getApprovalById = async (approvalId) => {
  const [rows] = await db.query(
    `
    SELECT
      ta.*,
      creator.name AS created_by_name,
      junior.name AS junior_name,
      dispatcher.name AS dispatcher_name,
      senior.name AS senior_name,
      cu.name AS current_approver_name

    FROM transaction_approvals ta
    LEFT JOIN users creator ON creator.id = ta.created_by
    LEFT JOIN users junior ON junior.id = ta.junior_accountant_id
    LEFT JOIN users dispatcher ON dispatcher.id = ta.dispatcher_id
    LEFT JOIN users senior ON senior.id = ta.senior_accountant_id
    LEFT JOIN users cu ON cu.id = ta.current_approver_id

    WHERE ta.id = ?
    `,
    [approvalId]
  );

  if (!rows.length) {
    return null;
  }

  const approval = rows[0];

  // try {
  //   approval.payload_json = JSON.parse(
  //     approval.payload_json || "{}"
  //   );
  // } 
  try {
  const outer = JSON.parse(approval.payload_json || "{}");

  // If the actual payload is nested as a string, parse it out
  if (typeof outer.payload_json === "string") {
    const inner = JSON.parse(outer.payload_json);
    approval.payload_json = {
      ...inner,                          // flat payload fields
      orderBillImage: outer.orderBillImage || "",
      orderBillImageUrl: outer.orderBillImageUrl || "",
      dispatchDocImageUrl: outer.dispatchDocImageUrl || "",
      billTImageUrl: outer.billTImageUrl || "",
    };
  } else {
    approval.payload_json = outer;
  }
}
  catch (err) {
    approval.payload_json = {};
  }

  return approval;
};

exports.updateFinalTransaction = async (connection, approvalId, saleId) => {
  await connection.query(
    `
    UPDATE transaction_approvals
    SET
      final_transaction_id = ?,
      approved_at = CURRENT_TIMESTAMP,
      status = 'APPROVED',
      current_status_message =
        'Sales Order Approved'

    WHERE id = ?
    `,
    [saleId, approvalId],
  );
};

exports.getPayloadHistory = async (approvalId) => {
  const [rows] = await db.query(
    ` SELECT
      h.*,
      u.name

    FROM approval_payload_history h
    LEFT JOIN users u ON u.id = h.modified_by

    WHERE h.approval_id = ?
    ORDER BY h.created_at DESC `,
    [approvalId],
  );

  return rows;
};

exports.updateStatusNotification = async ( connection, approvalId, message ) => {
  await connection.query(
    ` UPDATE order_notifications
      SET
        message = ?,
        is_read = 0,
        created_at = CURRENT_TIMESTAMP

      WHERE approval_id = ?
      AND notification_category = 'STATUS'
    `,
    [message, approvalId]
  );
};

exports.completeApprovalNotification = async ( connection, approvalId, userId ) => {
  await connection.query(
    ` UPDATE order_notifications
    SET is_read = 1
    WHERE approval_id = ?
    AND user_id = ?
    AND notification_category = 'APPROVAL'
    `,
    [approvalId, userId]
  );
};

exports.getNextOrderNumber = async (transactionType) => {
  const [rows] = await db.query(
    ` SELECT MAX(id) AS lastId FROM transaction_approvals WHERE transaction_type = ? `,
    [transactionType]
  );

  return (rows[0]?.lastId || 0) + 1;
};