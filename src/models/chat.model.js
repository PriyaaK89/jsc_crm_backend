const db = require("../config/db");
// ADJUST the path: this is the MinIO helper file you pasted (exports getPresignedUrl)
const { getPresignedUrl } = require("../utils/fileUpload");

const ISO = (col) => `DATE_FORMAT(${col}, '%Y-%m-%dT%H:%i:%sZ')`;
const inList = (arr) => arr.map(() => "?").join(",");

const sign = async (path) => {
  if (!path) return null;
  try {
    return await getPresignedUrl(path);
  } catch (e) {
    return null;
  }
};

const previewOf = (type, body, fileName, isDeleted) => {
  if (isDeleted) return "This message was deleted";
  switch (type) {
    case "IMAGE": return body ? `📷 ${body}` : "📷 Photo";
    case "DOCUMENT": return `📄 ${fileName || "Document"}`;
    case "KYC": return "🪪 KYC / License";
    default: return body || "";
  }
};

// ---------------------------------------------------------------------------
// Membership cache (used for typing events, which are frequent)
// ---------------------------------------------------------------------------
const memberCache = new Map();
const MEMBER_TTL = 30 * 1000;

const getActiveMemberIds = async (conversationId) => {
  const hit = memberCache.get(conversationId);
  if (hit && hit.exp > Date.now()) return hit.ids;
  const [rows] = await db.query(
    "SELECT user_id FROM chat_members WHERE conversation_id = ? AND is_active = 1",
    [conversationId]
  );
  const ids = rows.map((r) => r.user_id);
  memberCache.set(conversationId, { ids, exp: Date.now() + MEMBER_TTL });
  return ids;
};
const invalidateMembers = (conversationId) => memberCache.delete(Number(conversationId));

// ---------------------------------------------------------------------------
// Basic lookups
// ---------------------------------------------------------------------------
const getConversationBasic = async (conversationId) => {
  const [rows] = await db.query(
    `SELECT id, type, name, description, icon_path, created_by, last_message_id
     FROM chat_conversations WHERE id = ?`,
    [conversationId]
  );
  return rows[0];
};

const getMembership = async (conversationId, userId) => {
  const [rows] = await db.query(
    "SELECT * FROM chat_members WHERE conversation_id = ? AND user_id = ?",
    [conversationId, userId]
  );
  return rows[0];
};

const getActiveMembers = async (conversationId) => {
  const [rows] = await db.query(
    "SELECT user_id, role, is_muted FROM chat_members WHERE conversation_id = ? AND is_active = 1",
    [conversationId]
  );
  return rows;
};

const getUserNames = async (ids) => {
  if (!ids.length) return [];
  const [rows] = await db.query(`SELECT id, name FROM users WHERE id IN (${inList(ids)})`, ids);
  const byId = new Map(rows.map((r) => [r.id, r.name]));
  return ids.map((id) => byId.get(id)).filter(Boolean);
};

const getPeerIds = async (userId) => {
  const [rows] = await db.query(
    `SELECT DISTINCT cm2.user_id
     FROM chat_members cm
     JOIN chat_members cm2 ON cm2.conversation_id = cm.conversation_id
          AND cm2.is_active = 1 AND cm2.user_id <> cm.user_id
     WHERE cm.user_id = ? AND cm.is_active = 1`,
    [userId]
  );
  return rows.map((r) => r.user_id);
};

// ---------------------------------------------------------------------------
// Conversations
// ---------------------------------------------------------------------------
const createDirectConversation = async (creatorId, otherId) => {
  const a = Math.min(creatorId, otherId);
  const b = Math.max(creatorId, otherId);
  const key = `${a}_${b}`;

  const [existing] = await db.query("SELECT id FROM chat_conversations WHERE direct_key = ?", [key]);
  if (existing.length) return { id: existing[0].id, created: false };

  const conn = await db.getConnection();
  try {
    await conn.beginTransaction();
    let convId;
    try {
      const [r] = await conn.query(
        "INSERT INTO chat_conversations (type, direct_key, created_by, created_at) VALUES ('DIRECT', ?, ?, UTC_TIMESTAMP())",
        [key, creatorId]
      );
      convId = r.insertId;
    } catch (e) {
      if (e.code === "ER_DUP_ENTRY") {
        await conn.rollback();
        const [again] = await db.query("SELECT id FROM chat_conversations WHERE direct_key = ?", [key]);
        return { id: again[0].id, created: false };
      }
      throw e;
    }
    await conn.query(
      "INSERT INTO chat_members (conversation_id, user_id) VALUES (?, ?), (?, ?)",
      [convId, a, convId, b]
    );
    await conn.commit();
    return { id: convId, created: true };
  } catch (e) {
    await conn.rollback();
    throw e;
  } finally {
    conn.release();
  }
};

const createGroupConversation = async ({ name, description, creatorId, memberIds }) => {
  const conn = await db.getConnection();
  try {
    await conn.beginTransaction();
    const [r] = await conn.query(
      `INSERT INTO chat_conversations (type, name, description, created_by, created_at)
       VALUES ('GROUP', ?, ?, ?, UTC_TIMESTAMP())`,
      [name, description || null, creatorId]
    );
    const convId = r.insertId;
    const rows = [[convId, creatorId, "ADMIN"], ...memberIds.map((id) => [convId, id, "MEMBER"])];
    await conn.query("INSERT INTO chat_members (conversation_id, user_id, role) VALUES ?", [rows]);
    await conn.commit();
    return convId;
  } catch (e) {
    await conn.rollback();
    throw e;
  } finally {
    conn.release();
  }
};

const listConversations = async (userId, { search } = {}) => {
  const params = [userId, userId];
  let searchSql = "";
  if (search) {
    searchSql = " AND (c.name LIKE ? OR ou.name LIKE ?)";
    params.push(`%${search}%`, `%${search}%`);
  }
  const [rows] = await db.query(
    `SELECT c.id, c.type, c.name, c.icon_path, ${ISO("c.last_message_at")} AS last_message_at,
            cm.is_muted, cm.role AS my_role, cm.visible_from_message_id,
            lm.id AS lm_id, lm.type AS lm_type, lm.body AS lm_body, lm.file_name AS lm_file_name,
            lm.is_deleted AS lm_deleted, lm.sender_id AS lm_sender_id,
            ${ISO("lm.created_at")} AS lm_created_at, lmu.name AS lm_sender_name,
            (SELECT COUNT(*) FROM chat_messages m
              WHERE m.conversation_id = c.id
                AND m.id > GREATEST(cm.last_read_message_id, cm.visible_from_message_id)
                AND m.sender_id <> ? AND m.is_deleted = 0 AND m.type <> 'SYSTEM') AS unread_count,
            (SELECT COUNT(*) FROM chat_members x WHERE x.conversation_id = c.id AND x.is_active = 1) AS member_count,
            ou.id AS peer_id, ou.name AS peer_name, ou.profile_image AS peer_image, ojr.name AS peer_job_role
     FROM chat_members cm
     JOIN chat_conversations c ON c.id = cm.conversation_id
     LEFT JOIN chat_messages lm ON lm.id = c.last_message_id
     LEFT JOIN users lmu ON lmu.id = lm.sender_id
     LEFT JOIN chat_members ocm ON ocm.conversation_id = c.id AND c.type = 'DIRECT' AND ocm.user_id <> cm.user_id
     LEFT JOIN users ou ON ou.id = ocm.user_id
     LEFT JOIN job_roles ojr ON ojr.id = ou.job_role_id
     WHERE cm.user_id = ? AND cm.is_active = 1
       AND (c.type = 'GROUP' OR c.last_message_id IS NOT NULL)
       ${searchSql}
     ORDER BY (c.last_message_at IS NULL), c.last_message_at DESC, c.id DESC`,
    params
  );
  return rows;
};

const getConversationDetail = async (conversationId) => {
  const conv = await getConversationBasic(conversationId);
  if (!conv) return null;
  const [members] = await db.query(
    `SELECT cm.user_id, cm.role, u.name, u.profile_image, jr.name AS job_role
     FROM chat_members cm
     JOIN users u ON u.id = cm.user_id
     LEFT JOIN job_roles jr ON jr.id = u.job_role_id
     WHERE cm.conversation_id = ? AND cm.is_active = 1
     ORDER BY (cm.role = 'ADMIN') DESC, u.name`,
    [conversationId]
  );
  return { conv, members };
};

const setMuted = async (conversationId, userId, muted) => {
  await db.query(
    "UPDATE chat_members SET is_muted = ? WHERE conversation_id = ? AND user_id = ?",
    [muted ? 1 : 0, conversationId, userId]
  );
};

// ---------------------------------------------------------------------------
// Messages
// ---------------------------------------------------------------------------
const MESSAGE_SELECT = `
  m.id, m.conversation_id, m.sender_id, m.type, m.body, m.file_path, m.file_name, m.file_mime,
  m.file_size, m.reply_to_id, m.client_msg_id, m.is_deleted, ${ISO("m.created_at")} AS created_at,
  su.name AS sender_name,
  rm.type AS rm_type, rm.body AS rm_body, rm.file_name AS rm_file_name, rm.is_deleted AS rm_deleted,
  rm.sender_id AS rm_sender_id, ru.name AS rm_sender_name
  FROM chat_messages m
  JOIN users su ON su.id = m.sender_id
  LEFT JOIN chat_messages rm ON rm.id = m.reply_to_id
  LEFT JOIN users ru ON ru.id = rm.sender_id`;

// receipt = { delivered_up_to, read_up_to } for the SENDER of this message (omit for others' messages)
const mapMessage = async (row, receipt) => {
  const deleted = !!row.is_deleted;
  const msg = {
    id: row.id,
    conversation_id: row.conversation_id,
    client_msg_id: row.client_msg_id,
    sender_id: row.sender_id,
    sender_name: row.sender_name,
    type: row.type,
    body: deleted ? null : row.body,
    file: null,
    reply_to: null,
    is_deleted: deleted,
    created_at: row.created_at,
  };
  if (!deleted && row.file_path) {
    msg.file = {
      url: await sign(row.file_path),
      name: row.file_name,
      mime: row.file_mime,
      size: row.file_size,
    };
  }
  if (row.reply_to_id) {
    msg.reply_to = {
      id: row.reply_to_id,
      sender_id: row.rm_sender_id,
      sender_name: row.rm_sender_name,
      type: row.rm_type,
      preview: previewOf(row.rm_type, row.rm_body, row.rm_file_name, !!row.rm_deleted),
    };
  }
  if (receipt && row.type !== "SYSTEM") {
    msg.status =
      row.id <= receipt.read_up_to ? "read" : row.id <= receipt.delivered_up_to ? "delivered" : "sent";
  }
  return msg;
};

// For every member S: the delivered/read pointer across all OTHER members.
// This is what S sees as ticks on messages S sent.
const getReceiptMap = async (conversationId) => {
  const [rows] = await db.query(
    `SELECT user_id, last_delivered_message_id AS d, last_read_message_id AS r
     FROM chat_members WHERE conversation_id = ? AND is_active = 1`,
    [conversationId]
  );
  const map = new Map();
  for (const s of rows) {
    let minD = Infinity;
    let minR = Infinity;
    for (const o of rows) {
      if (o.user_id === s.user_id) continue;
      minD = Math.min(minD, o.d);
      minR = Math.min(minR, o.r);
    }
    map.set(s.user_id, {
      delivered_up_to: Number.isFinite(minD) ? minD : 0,
      read_up_to: Number.isFinite(minR) ? minR : 0,
    });
  }
  return map;
};

const getMessages = async (conversationId, member, { beforeId, limit }) => {
  const params = [conversationId, member.visible_from_message_id];
  let cond = "";
  if (beforeId) {
    cond = " AND m.id < ?";
    params.push(beforeId);
  }
  params.push(limit + 1);
  const [rows] = await db.query(
    `SELECT ${MESSAGE_SELECT}
     WHERE m.conversation_id = ? AND m.id > ? ${cond}
     ORDER BY m.id DESC LIMIT ?`,
    params
  );
  const hasMore = rows.length > limit;
  const page = rows.slice(0, limit).reverse(); // oldest -> newest
  const receipts = await getReceiptMap(conversationId);
  const mine = receipts.get(member.user_id) || { delivered_up_to: 0, read_up_to: 0 };
  const messages = [];
  for (const row of page) {
    messages.push(await mapMessage(row, row.sender_id === member.user_id ? mine : null));
  }
  return { messages, hasMore };
};

const getMessageById = async (id, receipt) => {
  const [rows] = await db.query(`SELECT ${MESSAGE_SELECT} WHERE m.id = ?`, [id]);
  return rows[0] ? mapMessage(rows[0], receipt) : null;
};

const findByClientMsgId = async (senderId, clientMsgId) => {
  const [rows] = await db.query(
    "SELECT id FROM chat_messages WHERE sender_id = ? AND client_msg_id = ?",
    [senderId, clientMsgId]
  );
  return rows[0];
};

const getMessageMeta = async (id) => {
  const [rows] = await db.query(
    `SELECT id, conversation_id, sender_id, type, is_deleted,
            TIMESTAMPDIFF(MINUTE, created_at, UTC_TIMESTAMP()) AS age_min
     FROM chat_messages WHERE id = ?`,
    [id]
  );
  return rows[0];
};

const insertMessage = async ({ conversationId, senderId, type, body, file, replyToId, clientMsgId }) => {
  const conn = await db.getConnection();
  try {
    await conn.beginTransaction();
    const [r] = await conn.query(
      `INSERT INTO chat_messages
        (conversation_id, sender_id, type, body, file_path, file_name, file_mime, file_size,
         reply_to_id, client_msg_id, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, UTC_TIMESTAMP())`,
      [
        conversationId, senderId, type, body || null,
        file ? file.path : null, file ? file.name : null,
        file ? file.mime : null, file ? file.size : null,
        replyToId || null, clientMsgId || null,
      ]
    );
    const id = r.insertId;
    await conn.query(
      "UPDATE chat_conversations SET last_message_id = ?, last_message_at = UTC_TIMESTAMP() WHERE id = ?",
      [id, conversationId]
    );
    await conn.query(
      `UPDATE chat_members SET last_read_message_id = ?, last_delivered_message_id = ?
       WHERE conversation_id = ? AND user_id = ?`,
      [id, id, conversationId, senderId]
    );
    await conn.commit();
    return id;
  } catch (e) {
    await conn.rollback();
    throw e;
  } finally {
    conn.release();
  }
};

const softDeleteMessage = async (id) => {
  await db.query(
    `UPDATE chat_messages
     SET is_deleted = 1, deleted_at = UTC_TIMESTAMP(), body = NULL,
         file_path = NULL, file_name = NULL, file_mime = NULL, file_size = NULL
     WHERE id = ?`,
    [id]
  );
};

// ---------------------------------------------------------------------------
// Receipts (delivered / read pointers)
// ---------------------------------------------------------------------------
// Returns the effective id the pointer moved to, or null if nothing changed.
const markRead = async (conversationId, userId, upToId) => {
  const [[c]] = await db.query("SELECT last_message_id FROM chat_conversations WHERE id = ?", [conversationId]);
  if (!c || !c.last_message_id) return null;
  const eff = Math.min(Number(upToId), Number(c.last_message_id));
  const [r] = await db.query(
    `UPDATE chat_members
     SET last_read_message_id = ?, last_delivered_message_id = GREATEST(last_delivered_message_id, ?)
     WHERE conversation_id = ? AND user_id = ? AND is_active = 1 AND last_read_message_id < ?`,
    [eff, eff, conversationId, userId, eff]
  );
  return r.affectedRows > 0 ? eff : null;
};

const markDelivered = async (conversationId, userId, upToId) => {
  const [r] = await db.query(
    `UPDATE chat_members SET last_delivered_message_id = ?
     WHERE conversation_id = ? AND user_id = ? AND is_active = 1 AND last_delivered_message_id < ?`,
    [upToId, conversationId, userId, upToId]
  );
  return r.affectedRows > 0;
};

// When a user's app connects: everything sent while offline becomes "delivered".
const markAllDeliveredOnConnect = async (userId) => {
  const [pending] = await db.query(
    `SELECT cm.conversation_id, c.last_message_id AS up_to_id
     FROM chat_members cm
     JOIN chat_conversations c ON c.id = cm.conversation_id
     WHERE cm.user_id = ? AND cm.is_active = 1
       AND c.last_message_id IS NOT NULL AND cm.last_delivered_message_id < c.last_message_id`,
    [userId]
  );
  if (!pending.length) return [];
  await db.query(
    `UPDATE chat_members cm
     JOIN chat_conversations c ON c.id = cm.conversation_id
     SET cm.last_delivered_message_id = c.last_message_id
     WHERE cm.user_id = ? AND cm.is_active = 1
       AND c.last_message_id IS NOT NULL AND cm.last_delivered_message_id < c.last_message_id`,
    [userId]
  );
  return pending;
};

// ---------------------------------------------------------------------------
// Group management
// ---------------------------------------------------------------------------
const addMembers = async (conversationId, userIds) => {
  const conv = await getConversationBasic(conversationId);
  const lastId = (conv && conv.last_message_id) || 0;
  const rows = userIds.map((id) => [conversationId, id, "MEMBER", lastId, lastId, lastId]);
  await db.query(
    `INSERT INTO chat_members
       (conversation_id, user_id, role, visible_from_message_id, last_read_message_id, last_delivered_message_id)
     VALUES ?
     ON DUPLICATE KEY UPDATE
       is_active = 1, left_at = NULL, role = 'MEMBER', joined_at = CURRENT_TIMESTAMP,
       visible_from_message_id = VALUES(visible_from_message_id),
       last_read_message_id = VALUES(last_read_message_id),
       last_delivered_message_id = VALUES(last_delivered_message_id)`,
    [rows]
  );
  invalidateMembers(conversationId);
};

const removeMember = async (conversationId, userId) => {
  await db.query(
    `UPDATE chat_members SET is_active = 0, role = 'MEMBER', left_at = CURRENT_TIMESTAMP
     WHERE conversation_id = ? AND user_id = ?`,
    [conversationId, userId]
  );
  invalidateMembers(conversationId);
};

// If a group has members but no admin left, promote the longest-standing member.
const ensureAdmin = async (conversationId) => {
  const [[a]] = await db.query(
    "SELECT COUNT(*) AS n FROM chat_members WHERE conversation_id = ? AND is_active = 1 AND role = 'ADMIN'",
    [conversationId]
  );
  if (a.n > 0) return;
  await db.query(
    `UPDATE chat_members SET role = 'ADMIN'
     WHERE conversation_id = ? AND is_active = 1 ORDER BY joined_at ASC, id ASC LIMIT 1`,
    [conversationId]
  );
};

const countAdmins = async (conversationId) => {
  const [[a]] = await db.query(
    "SELECT COUNT(*) AS n FROM chat_members WHERE conversation_id = ? AND is_active = 1 AND role = 'ADMIN'",
    [conversationId]
  );
  return a.n;
};

const setMemberRole = async (conversationId, userId, role) => {
  await db.query(
    "UPDATE chat_members SET role = ? WHERE conversation_id = ? AND user_id = ? AND is_active = 1",
    [role, conversationId, userId]
  );
};

const updateGroup = async (conversationId, { name, description, icon_path }) => {
  const sets = [];
  const params = [];
  if (name !== undefined) { sets.push("name = ?"); params.push(name); }
  if (description !== undefined) { sets.push("description = ?"); params.push(description); }
  if (icon_path !== undefined) { sets.push("icon_path = ?"); params.push(icon_path); }
  if (!sets.length) return;
  params.push(conversationId);
  await db.query(`UPDATE chat_conversations SET ${sets.join(", ")} WHERE id = ?`, params);
};

// ---------------------------------------------------------------------------
// Contacts
// ---------------------------------------------------------------------------
const searchUsers = async ({ excludeId, ids, search, page, limit }) => {
  const params = [excludeId];
  let where = "u.is_active = 1 AND u.id <> ?";
  if (ids) {
    if (!ids.length) return [];
    where += ` AND u.id IN (${inList(ids)})`;
    params.push(...ids);
  }
  if (search) {
    where += " AND (u.name LIKE ? OR u.contact_no LIKE ?)";
    params.push(`%${search}%`, `%${search}%`);
  }
  params.push(Number(limit), (Number(page) - 1) * Number(limit));
  const [rows] = await db.query(
    `SELECT u.id, u.name, u.profile_image, jr.name AS job_role
     FROM users u
     LEFT JOIN job_roles jr ON jr.id = u.job_role_id
     WHERE ${where}
     ORDER BY u.name
     LIMIT ? OFFSET ?`,
    params
  );
  return rows;
};

// ---------------------------------------------------------------------------
// React dashboard (read-only monitoring)
// ---------------------------------------------------------------------------
const adminListConversations = async ({ search, type, userId, page, limit }) => {
  const params = [];
  let where = "(c.type = 'GROUP' OR c.last_message_id IS NOT NULL)";
  if (type === "DIRECT" || type === "GROUP") { where += " AND c.type = ?"; params.push(type); }
  if (userId) {
    where += " AND EXISTS (SELECT 1 FROM chat_members x WHERE x.conversation_id = c.id AND x.user_id = ?)";
    params.push(userId);
  }
  if (search) {
    where += ` AND (c.name LIKE ? OR EXISTS (
      SELECT 1 FROM chat_members x JOIN users u ON u.id = x.user_id
      WHERE x.conversation_id = c.id AND u.name LIKE ?))`;
    params.push(`%${search}%`, `%${search}%`);
  }
  params.push(Number(limit) + 1, (Number(page) - 1) * Number(limit));
  const [rows] = await db.query(
    `SELECT c.id, c.type, c.name, c.icon_path, ${ISO("c.last_message_at")} AS last_message_at,
            (SELECT GROUP_CONCAT(u.name ORDER BY u.name SEPARATOR ', ')
               FROM chat_members x JOIN users u ON u.id = x.user_id
              WHERE x.conversation_id = c.id AND x.is_active = 1) AS member_names,
            (SELECT COUNT(*) FROM chat_members x WHERE x.conversation_id = c.id AND x.is_active = 1) AS member_count,
            (SELECT COUNT(*) FROM chat_messages m WHERE m.conversation_id = c.id AND m.type <> 'SYSTEM') AS message_count,
            lm.type AS lm_type, lm.body AS lm_body, lm.file_name AS lm_file_name, lm.is_deleted AS lm_deleted,
            lmu.name AS lm_sender_name
     FROM chat_conversations c
     LEFT JOIN chat_messages lm ON lm.id = c.last_message_id
     LEFT JOIN users lmu ON lmu.id = lm.sender_id
     WHERE ${where}
     ORDER BY (c.last_message_at IS NULL), c.last_message_at DESC, c.id DESC
     LIMIT ? OFFSET ?`,
    params
  );
  return { rows: rows.slice(0, Number(limit)), hasMore: rows.length > Number(limit) };
};

// ---------------------------------------------------------------------------
// Device tokens + presence
// ---------------------------------------------------------------------------
const upsertDeviceToken = async (userId, token, platform) => {
  await db.query(
    `INSERT INTO chat_device_tokens (user_id, fcm_token, platform) VALUES (?, ?, ?)
     ON DUPLICATE KEY UPDATE user_id = VALUES(user_id), platform = VALUES(platform), updated_at = CURRENT_TIMESTAMP`,
    [userId, token, platform || null]
  );
};

const deleteDeviceToken = async (userId, token) => {
  await db.query("DELETE FROM chat_device_tokens WHERE user_id = ? AND fcm_token = ?", [userId, token]);
};

const getTokensForUsers = async (userIds) => {
  if (!userIds.length) return [];
  const [rows] = await db.query(
    `SELECT fcm_token FROM chat_device_tokens WHERE user_id IN (${inList(userIds)})`,
    userIds
  );
  return rows.map((r) => r.fcm_token);
};

const deleteTokens = async (tokens) => {
  if (!tokens.length) return;
  await db.query(`DELETE FROM chat_device_tokens WHERE fcm_token IN (${inList(tokens)})`, tokens);
};

const setLastSeen = async (userId) => {
  await db.query(
    `INSERT INTO chat_user_presence (user_id, last_seen_at) VALUES (?, UTC_TIMESTAMP())
     ON DUPLICATE KEY UPDATE last_seen_at = UTC_TIMESTAMP()`,
    [userId]
  );
};

const getLastSeenMap = async (ids) => {
  const map = new Map();
  if (!ids.length) return map;
  const [rows] = await db.query(
    `SELECT user_id, ${ISO("last_seen_at")} AS last_seen_at FROM chat_user_presence
     WHERE user_id IN (${inList(ids)})`,
    ids
  );
  rows.forEach((r) => map.set(r.user_id, r.last_seen_at));
  return map;
};

module.exports = {
  sign, previewOf,
  getActiveMemberIds, invalidateMembers,
  getConversationBasic, getMembership, getActiveMembers, getUserNames, getPeerIds,
  createDirectConversation, createGroupConversation, listConversations, getConversationDetail, setMuted,
  getMessages, getMessageById, findByClientMsgId, getMessageMeta, insertMessage, softDeleteMessage,
  getReceiptMap, markRead, markDelivered, markAllDeliveredOnConnect,
  addMembers, removeMember, ensureAdmin, countAdmins, setMemberRole, updateGroup,
  searchUsers, adminListConversations,
  upsertDeviceToken, deleteDeviceToken, getTokensForUsers, deleteTokens, setLastSeen, getLastSeenMap,
};