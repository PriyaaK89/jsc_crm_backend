const model = require("../models/chat.model");
const access = require("../chat/chat.access");
const realtime = require("../chat/chat.realtime");
const fcm = require("../chat/chat.fcm");
const cfg = require("../chat/chat.config");

const { httpError } = access;
const FILE_TYPES = ["DOCUMENT", "IMAGE", "KYC"];
const uniqueIds = (arr) =>
  [...new Set((Array.isArray(arr) ? arr : []).map(Number).filter((n) => Number.isInteger(n) && n > 0))];

const safePush = (args) =>
  fcm.sendChatPush(args).catch((e) => console.error("[chat] push failed:", e.message));

// ---------------------------------------------------------------------------
// Guards
// ---------------------------------------------------------------------------
const requireMember = async (conversationId, userId) => {
  const m = await model.getMembership(conversationId, userId);
  if (!m || !m.is_active) throw httpError(403, "You are not a member of this conversation");
  return m;
};

const requireGroup = async (conversationId) => {
  const conv = await model.getConversationBasic(conversationId);
  if (!conv) throw httpError(404, "Conversation not found");
  if (conv.type !== "GROUP") throw httpError(400, "This action is only for groups");
  return conv;
};

const requireGroupAdmin = async (conversationId, userId) => {
  const m = await requireMember(conversationId, userId);
  if (m.role !== "ADMIN") throw httpError(403, "Only group admins can do this");
  return m;
};

// ---------------------------------------------------------------------------
// Realtime helpers
// ---------------------------------------------------------------------------
// Tell every member (except `exceptUserId`) the new delivered/read pointers for THEIR sent messages.
const emitReceipts = async (conversationId, exceptUserId) => {
  const map = await model.getReceiptMap(conversationId);
  for (const [uid, r] of map) {
    if (uid === exceptUserId) continue;
    realtime.emitToUser(uid, "message:receipt", { conversation_id: conversationId, ...r });
  }
};

const broadcastPresence = async (userId, isOnline) => {
  const peers = await model.getPeerIds(userId);
  const payload = {
    user_id: userId,
    is_online: isOnline,
    last_seen: isOnline ? null : new Date().toISOString(),
  };
  realtime.emitToUsers(peers, "presence", payload);
};

const onSocketConnected = async (userId, isFirstConnection) => {
  const pending = await model.markAllDeliveredOnConnect(userId);
  for (const p of pending) await emitReceipts(p.conversation_id, userId);
  if (isFirstConnection) await broadcastPresence(userId, true);
};

const onSocketDisconnected = async (userId) => {
  await model.setLastSeen(userId);
  await broadcastPresence(userId, false);
};

const typing = async (userId, conversationId, isTyping) => {
  const ids = await model.getActiveMemberIds(conversationId);
  if (!ids.includes(userId)) return;
  realtime.emitToUsers(
    ids.filter((id) => id !== userId),
    "typing",
    { conversation_id: conversationId, user_id: userId, is_typing: !!isTyping }
  );
};

// ---------------------------------------------------------------------------
// Messages
// ---------------------------------------------------------------------------
const sendMessage = async (userId, p) => {
  const conversationId = Number(p.conversation_id);
  if (!conversationId) throw httpError(400, "conversation_id is required");
  await requireMember(conversationId, userId);

  const type = String(p.type || "TEXT").toUpperCase();
  let body = p.body == null ? "" : String(p.body).trim();
  let file = null;

  if (type === "TEXT") {
    if (!body) throw httpError(400, "Message is empty");
  } else if (FILE_TYPES.includes(type)) {
    if (!p.file_path || !String(p.file_path).startsWith("chat/")) {
      throw httpError(400, "Upload the file first and send its file_path");
    }
    file = {
      path: String(p.file_path),
      name: p.file_name ? String(p.file_name).slice(0, 255) : null,
      mime: p.file_mime ? String(p.file_mime).slice(0, 120) : null,
      size: p.file_size ? Number(p.file_size) : null,
    };
  } else {
    throw httpError(400, "Invalid message type");
  }
  if (body.length > cfg.MAX_BODY_LENGTH) throw httpError(400, "Message is too long");

  // Retry-safe: same client_msg_id returns the original message
  const clientMsgId = p.client_msg_id ? String(p.client_msg_id).slice(0, 64) : null;
  if (clientMsgId) {
    const dup = await model.findByClientMsgId(userId, clientMsgId);
    if (dup) return model.getMessageById(dup.id, { delivered_up_to: 0, read_up_to: 0 });
  }

  let replyToId = null;
  if (p.reply_to_id) {
    const target = await model.getMessageMeta(Number(p.reply_to_id));
    if (!target || target.conversation_id !== conversationId) {
      throw httpError(400, "Reply target not found in this conversation");
    }
    replyToId = target.id;
  }

  // Sending a message means the sender has read everything before it -> update others' ticks
  const advanced = await model.markRead(conversationId, userId, Number.MAX_SAFE_INTEGER);
  if (advanced) await emitReceipts(conversationId, userId);

  let messageId;
  try {
    messageId = await model.insertMessage({
      conversationId, senderId: userId, type, body, file, replyToId, clientMsgId,
    });
  } catch (e) {
    if (e.code === "ER_DUP_ENTRY" && clientMsgId) {
      const dup = await model.findByClientMsgId(userId, clientMsgId);
      return model.getMessageById(dup.id, { delivered_up_to: 0, read_up_to: 0 });
    }
    throw e;
  }

  const message = await model.getMessageById(messageId, { delivered_up_to: 0, read_up_to: 0 });
  const members = await model.getActiveMembers(conversationId);
  const recipients = members.filter((m) => m.user_id !== userId);

  // 1) live delivery to everyone (including the sender's other devices)
  realtime.emitToUsers(members.map((m) => m.user_id), "message:new", message);

  // 2) recipients that are online right now -> delivered
  const onlineRecipients = recipients.filter((m) => realtime.isOnline(m.user_id));
  for (const m of onlineRecipients) await model.markDelivered(conversationId, m.user_id, messageId);
  if (onlineRecipients.length) await emitReceipts(conversationId, null);

  // 3) offline + not muted -> FCM push (fire and forget)
  const toPush = recipients.filter((m) => !realtime.isOnline(m.user_id) && !m.is_muted).map((m) => m.user_id);
  if (toPush.length) {
    const conv = await model.getConversationBasic(conversationId);
    const preview = model.previewOf(type, body, file && file.name, false);
    const isGroup = conv.type === "GROUP";
    safePush({
      userIds: toPush,
      title: isGroup ? conv.name : message.sender_name,
      body: isGroup ? `${message.sender_name}: ${preview}` : preview,
      data: { type: "CHAT_MESSAGE", conversation_id: conversationId, message_id: messageId },
    });
  }
  return message;
};

const postSystemMessage = async (conversationId, actorId, text) => {
  const id = await model.insertMessage({
    conversationId, senderId: actorId, type: "SYSTEM", body: text,
  });
  const message = await model.getMessageById(id, null);
  const members = await model.getActiveMembers(conversationId);
  realtime.emitToUsers(members.map((m) => m.user_id), "message:new", message);
  return message;
};

const getMessages = async (userId, conversationId, { beforeId, limit }) => {
  const member = await requireMember(conversationId, userId);
  const lim = Math.min(Math.max(Number(limit) || 30, 1), 100);
  return model.getMessages(conversationId, member, {
    beforeId: beforeId ? Number(beforeId) : null,
    limit: lim,
  });
};

const markRead = async (userId, conversationId, upToId) => {
  await requireMember(conversationId, userId);
  const eff = await model.markRead(conversationId, userId, upToId ? Number(upToId) : Number.MAX_SAFE_INTEGER);
  if (eff) {
    await emitReceipts(conversationId, userId);
    realtime.emitToUser(userId, "conversation:read", { conversation_id: conversationId, up_to_id: eff });
  }
  return { read_up_to: eff };
};

const deleteMessage = async (userId, messageId) => {
  const msg = await model.getMessageMeta(messageId);
  if (!msg) throw httpError(404, "Message not found");
  if (msg.sender_id !== userId) throw httpError(403, "You can only delete your own messages");
  if (msg.type === "SYSTEM") throw httpError(400, "System messages cannot be deleted");
  await requireMember(msg.conversation_id, userId);
  if (msg.is_deleted) return { already: true };

  const windowMin = cfg.DELETE_FOR_EVERYONE_WINDOW_MIN;
  if (windowMin > 0 && msg.age_min > windowMin) {
    throw httpError(400, `You can delete a message for everyone only within ${windowMin} minutes`);
  }
  await model.softDeleteMessage(messageId);
  const members = await model.getActiveMembers(msg.conversation_id);
  realtime.emitToUsers(
    members.map((m) => m.user_id),
    "message:deleted",
    { conversation_id: msg.conversation_id, message_id: messageId }
  );
  return { deleted: true };
};

// ---------------------------------------------------------------------------
// Conversations & contacts
// ---------------------------------------------------------------------------
const startDirect = async (userId, targetId) => {
  targetId = Number(targetId);
  if (!targetId || targetId === userId) throw httpError(400, "Invalid user");
  const caps = await access.getChatCapabilities(userId);
  await access.assertCanMessage(caps, userId, targetId);
  return model.createDirectConversation(userId, targetId);
};

const getConversationList = async (userId, { filter, search }) => {
  const rows = await model.listConversations(userId, { search });
  const { team, managers } = await access.getRelationSets(userId);
  const peerIds = rows.filter((r) => r.peer_id).map((r) => r.peer_id);
  const lastSeen = await model.getLastSeenMap(peerIds);

  const items = [];
  for (const r of rows) {
    const isGroup = r.type === "GROUP";
    let relation = "Group";
    if (!isGroup) relation = team.has(r.peer_id) ? "My Team" : managers.has(r.peer_id) ? "Reporting Line" : "Other";

    const lastVisible = r.lm_id && r.lm_id > r.visible_from_message_id;
    items.push({
      conversation_id: r.id,
      type: r.type,
      title: isGroup ? r.name : r.peer_name,
      avatar_url: await model.sign(isGroup ? r.icon_path : r.peer_image),
      relation,
      peer: isGroup ? null : {
        user_id: r.peer_id,
        name: r.peer_name,
        job_role: r.peer_job_role,
        is_online: realtime.isOnline(r.peer_id),
        last_seen: lastSeen.get(r.peer_id) || null,
      },
      member_count: isGroup ? r.member_count : null,
      my_role: r.my_role,
      is_muted: !!r.is_muted,
      unread_count: r.unread_count,
      last_message_at: r.last_message_at,
      last_message: lastVisible ? {
        id: r.lm_id,
        type: r.lm_type,
        preview: model.previewOf(r.lm_type, r.lm_body, r.lm_file_name, !!r.lm_deleted),
        sender_id: r.lm_sender_id,
        sender_name: r.lm_sender_name,
        is_mine: r.lm_sender_id === userId,
        created_at: r.lm_created_at,
      } : null,
    });
  }

  const f = String(filter || "all").toLowerCase();
  return items.filter((i) => {
    if (f === "unread") return i.unread_count > 0;
    if (f === "team") return i.relation === "My Team";
    if (f === "reporting") return i.relation === "Reporting Line";
    return true;
  });
};

const getConversationDetail = async (userId, conversationId) => {
  await requireMember(conversationId, userId);
  const d = await model.getConversationDetail(conversationId);
  const isGroup = d.conv.type === "GROUP";
  const members = [];
  for (const m of d.members) {
    members.push({
      user_id: m.user_id,
      name: m.name,
      job_role: m.job_role,
      role: m.role,
      avatar_url: await model.sign(m.profile_image),
      is_online: realtime.isOnline(m.user_id),
    });
  }
  return {
    conversation_id: d.conv.id,
    type: d.conv.type,
    name: isGroup ? d.conv.name : null,
    description: d.conv.description,
    icon_url: await model.sign(d.conv.icon_path),
    created_by: d.conv.created_by,
    members,
  };
};

const getContacts = async (userId, { scope, search, page, limit }) => {
  const caps = await access.getChatCapabilities(userId);
  const { team, managers } = await access.getRelationSets(userId);
  const lim = Math.min(Math.max(Number(limit) || 30, 1), 100);
  const pg = Math.max(Number(page) || 1, 1);
  const s = String(scope || "all").toLowerCase();

  let ids; // undefined = every active user (admins / permitted)
  if (s === "team") ids = [...team];
  else if (s === "reporting") ids = [...managers];
  else if (!caps.canMessageAnyone) ids = [...new Set([...team, ...managers])];

  const rows = await model.searchUsers({ excludeId: userId, ids, search, page: pg, limit: lim });
  const lastSeen = await model.getLastSeenMap(rows.map((r) => r.id));
  const out = [];
  for (const r of rows) {
    out.push({
      user_id: r.id,
      name: r.name,
      job_role: r.job_role,
      avatar_url: await model.sign(r.profile_image),
      relation: team.has(r.id) ? "My Team" : managers.has(r.id) ? "Reporting Line" : "Other",
      is_online: realtime.isOnline(r.id),
      last_seen: lastSeen.get(r.id) || null,
    });
  }
  return out;
};

const getPresence = async (userId) => {
  const map = await model.getLastSeenMap([userId]);
  return { user_id: userId, is_online: realtime.isOnline(userId), last_seen: map.get(userId) || null };
};

// ---------------------------------------------------------------------------
// React dashboard (read-only; never touches read/delivered pointers)
// ---------------------------------------------------------------------------
const adminListConversations = async (userId, { search, type, user_id, page, limit }) => {
  await access.assertCanViewAll(userId);
  const lim = Math.min(Math.max(Number(limit) || 20, 1), 100);
  const pg = Math.max(Number(page) || 1, 1);
  const { rows, hasMore } = await model.adminListConversations({
    search, type: String(type || "").toUpperCase(), userId: Number(user_id) || null, page: pg, limit: lim,
  });
  const items = [];
  for (const r of rows) {
    items.push({
      conversation_id: r.id,
      type: r.type,
      title: r.type === "GROUP" ? r.name : r.member_names,
      icon_url: await model.sign(r.icon_path),
      member_names: r.member_names,
      member_count: r.member_count,
      message_count: r.message_count,
      last_message_at: r.last_message_at,
      last_message: r.lm_type ? {
        preview: model.previewOf(r.lm_type, r.lm_body, r.lm_file_name, !!r.lm_deleted),
        sender_name: r.lm_sender_name,
      } : null,
    });
  }
  return { items, has_more: hasMore };
};

const adminGetConversation = async (userId, conversationId) => {
  await access.assertCanViewAll(userId);
  const d = await model.getConversationDetail(conversationId);
  if (!d) throw httpError(404, "Conversation not found");
  const members = [];
  for (const m of d.members) {
    members.push({
      user_id: m.user_id, name: m.name, job_role: m.job_role, role: m.role,
      avatar_url: await model.sign(m.profile_image),
    });
  }
  return {
    conversation_id: d.conv.id, type: d.conv.type, name: d.conv.name,
    description: d.conv.description, icon_url: await model.sign(d.conv.icon_path),
    created_by: d.conv.created_by, members,
  };
};

const adminGetMessages = async (userId, conversationId, { beforeId, limit }) => {
  await access.assertCanViewAll(userId);
  const lim = Math.min(Math.max(Number(limit) || 50, 1), 200);
  return model.getMessages(conversationId, { user_id: 0, visible_from_message_id: 0 }, {
    beforeId: beforeId ? Number(beforeId) : null, limit: lim,
  });
};

// ---------------------------------------------------------------------------
// Groups
// ---------------------------------------------------------------------------
const createGroup = async (userId, { name, description, member_ids }) => {
  const caps = await access.getChatCapabilities(userId);
  if (!caps.canCreateGroup) throw httpError(403, "You are not allowed to create groups");

  const groupName = String(name || "").trim();
  if (!groupName) throw httpError(400, "Group name is required");
  if (groupName.length > 150) throw httpError(400, "Group name is too long");

  const memberIds = uniqueIds(member_ids).filter((id) => id !== userId);
  if (!memberIds.length) throw httpError(400, "Select at least one member");
  if (memberIds.length + 1 > cfg.MAX_GROUP_MEMBERS) throw httpError(400, "Too many members");
  await access.assertCanAddUsers(caps, userId, memberIds);

  const conversationId = await model.createGroupConversation({
    name: groupName,
    description: description ? String(description).slice(0, 500) : null,
    creatorId: userId,
    memberIds,
  });
  await postSystemMessage(conversationId, userId, `${caps.user.name} created group "${groupName}"`);
  realtime.emitToUsers([userId, ...memberIds], "conversation:updated", { conversation_id: conversationId, reason: "created" });
  safePush({
    userIds: memberIds,
    title: groupName,
    body: `${caps.user.name} added you to this group`,
    data: { type: "CHAT_GROUP", conversation_id: conversationId },
  });
  return { conversation_id: conversationId };
};

const updateGroup = async (userId, conversationId, { name, description }) => {
  await requireGroup(conversationId);
  await requireGroupAdmin(conversationId, userId);
  const patch = {};
  if (name !== undefined) {
    const n = String(name).trim();
    if (!n || n.length > 150) throw httpError(400, "Invalid group name");
    patch.name = n;
  }
  if (description !== undefined) patch.description = String(description).slice(0, 500);
  await model.updateGroup(conversationId, patch);

  const actor = await access.getChatUser(userId);
  if (patch.name) await postSystemMessage(conversationId, userId, `${actor.name} changed the group name to "${patch.name}"`);
  const ids = await model.getActiveMemberIds(conversationId);
  realtime.emitToUsers(ids, "conversation:updated", { conversation_id: conversationId, reason: "updated" });
};

const setGroupIcon = async (userId, conversationId, iconPath) => {
  await requireGroup(conversationId);
  await requireGroupAdmin(conversationId, userId);
  await model.updateGroup(conversationId, { icon_path: iconPath });
  const ids = await model.getActiveMemberIds(conversationId);
  realtime.emitToUsers(ids, "conversation:updated", { conversation_id: conversationId, reason: "updated" });
  return { icon_url: await model.sign(iconPath) };
};

const addGroupMembers = async (userId, conversationId, userIds) => {
  const conv = await requireGroup(conversationId);
  await requireGroupAdmin(conversationId, userId);
  const caps = await access.getChatCapabilities(userId);

  const ids = uniqueIds(userIds).filter((id) => id !== userId);
  if (!ids.length) throw httpError(400, "Select at least one user");
  await access.assertCanAddUsers(caps, userId, ids);

  const current = (await model.getActiveMembers(conversationId)).map((m) => m.user_id);
  const fresh = ids.filter((id) => !current.includes(id));
  if (!fresh.length) throw httpError(400, "Selected users are already members");
  if (current.length + fresh.length > cfg.MAX_GROUP_MEMBERS) throw httpError(400, "Too many members");

  await model.addMembers(conversationId, fresh);
  const names = await model.getUserNames(fresh);
  await postSystemMessage(conversationId, userId, `${caps.user.name} added ${names.join(", ")}`);

  realtime.emitToUsers([...current, ...fresh], "conversation:updated", { conversation_id: conversationId, reason: "members_changed" });
  safePush({
    userIds: fresh,
    title: conv.name,
    body: `${caps.user.name} added you to this group`,
    data: { type: "CHAT_GROUP", conversation_id: conversationId },
  });
  return { added: fresh };
};

const removeGroupMember = async (userId, conversationId, targetId) => {
  await requireGroup(conversationId);
  await requireGroupAdmin(conversationId, userId);
  if (targetId === userId) throw httpError(400, "Use leave group to exit");
  const target = await model.getMembership(conversationId, targetId);
  if (!target || !target.is_active) throw httpError(404, "User is not a member of this group");

  await model.removeMember(conversationId, targetId);
  const [actor, names] = [await access.getChatUser(userId), await model.getUserNames([targetId])];
  await postSystemMessage(conversationId, userId, `${actor.name} removed ${names[0] || "a member"}`);

  realtime.emitToUser(targetId, "conversation:updated", { conversation_id: conversationId, reason: "removed" });
  const ids = await model.getActiveMemberIds(conversationId);
  realtime.emitToUsers(ids, "conversation:updated", { conversation_id: conversationId, reason: "members_changed" });
};

const setMemberRole = async (userId, conversationId, targetId, role) => {
  await requireGroup(conversationId);
  await requireGroupAdmin(conversationId, userId);
  const r = String(role || "").toUpperCase();
  if (!["ADMIN", "MEMBER"].includes(r)) throw httpError(400, "Invalid role");
  const target = await model.getMembership(conversationId, targetId);
  if (!target || !target.is_active) throw httpError(404, "User is not a member of this group");
  if (r === "MEMBER" && target.role === "ADMIN" && (await model.countAdmins(conversationId)) <= 1) {
    throw httpError(400, "A group must have at least one admin");
  }
  await model.setMemberRole(conversationId, targetId, r);
  const ids = await model.getActiveMemberIds(conversationId);
  realtime.emitToUsers(ids, "conversation:updated", { conversation_id: conversationId, reason: "members_changed" });
};

const leaveGroup = async (userId, conversationId) => {
  await requireGroup(conversationId);
  await requireMember(conversationId, userId);
  const actor = await access.getChatUser(userId);

  await model.removeMember(conversationId, userId);
  await model.ensureAdmin(conversationId);
  await postSystemMessage(conversationId, userId, `${actor.name} left`);

  realtime.emitToUser(userId, "conversation:updated", { conversation_id: conversationId, reason: "removed" });
  const ids = await model.getActiveMemberIds(conversationId);
  realtime.emitToUsers(ids, "conversation:updated", { conversation_id: conversationId, reason: "members_changed" });
};

module.exports = {
  emitReceipts, onSocketConnected, onSocketDisconnected, typing,
  sendMessage, getMessages, markRead, deleteMessage,
  adminListConversations, adminGetConversation, adminGetMessages,
  startDirect, getConversationList, getConversationDetail, getContacts, getPresence,
  createGroup, updateGroup, setGroupIcon, addGroupMembers, removeGroupMember, setMemberRole, leaveGroup,
};