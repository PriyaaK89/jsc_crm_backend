const service = require("../chat/chat.service");   // ADJUST paths to your folder layout
const model = require("../chat/chat.model");
const cfg = require("../chat/chat.config");
const { httpError } = require("../chat/chat.access");
const { uploadFileToMinio } = require("../utils/minioUpload");

const fail = (res, e) => {
  if (!e.status) console.error("[chat]", e);
  return res.status(e.status || 500).json({
    message: e.status ? e.message : "Something went wrong",
    error: e.status ? undefined : e.message,
  });
};
const ok = (res, data, message = "Success", status = 200) => res.status(status).json({ message, data });

// ---- upload kinds from the attachment sheet ----
const IMG = /^image\/(jpeg|png|webp|heic|heif)$/i;
const DOC = /^(application\/(pdf|msword|vnd\.openxmlformats-officedocument\..+|vnd\.ms-(excel|powerpoint)|zip)|text\/(plain|csv))$/i;
const UPLOAD_KINDS = {
  document: { type: "DOCUMENT", folder: "chat_documents", allow: (m) => DOC.test(m) || IMG.test(m) },
  photo:    { type: "IMAGE",    folder: "chat_images",    allow: (m) => IMG.test(m) },
  camera:   { type: "IMAGE",    folder: "chat_images",    allow: (m) => IMG.test(m) },
  kyc:      { type: "KYC",      folder: "chat_kyc",       allow: (m) => IMG.test(m) || /^application\/pdf$/i.test(m) },
};

exports.getContacts = async (req, res) => {
  try {
    const { scope, search, page, limit } = req.query;
    return ok(res, await service.getContacts(req.user.id, { scope, search, page, limit }));
  } catch (e) { return fail(res, e); }
};

exports.getConversations = async (req, res) => {
  try {
    const { filter, search } = req.query;
    return ok(res, await service.getConversationList(req.user.id, { filter, search }));
  } catch (e) { return fail(res, e); }
};

exports.startDirect = async (req, res) => {
  try {
    return ok(res, await service.startDirect(req.user.id, req.body.user_id));
  } catch (e) { return fail(res, e); }
};

exports.getConversationDetail = async (req, res) => {
  try {
    return ok(res, await service.getConversationDetail(req.user.id, Number(req.params.id)));
  } catch (e) { return fail(res, e); }
};

exports.getMessages = async (req, res) => {
  try {
    const { before_id, limit } = req.query;
    const r = await service.getMessages(req.user.id, Number(req.params.id), { beforeId: before_id, limit });
    return ok(res, { messages: r.messages, has_more: r.hasMore });
  } catch (e) { return fail(res, e); }
};

// REST fallback for sending (the app normally sends through the socket)
exports.sendMessage = async (req, res) => {
  try {
    const msg = await service.sendMessage(req.user.id, { ...req.body, conversation_id: Number(req.params.id) });
    return ok(res, msg, "Sent", 201);
  } catch (e) { return fail(res, e); }
};

exports.markRead = async (req, res) => {
  try {
    return ok(res, await service.markRead(req.user.id, Number(req.params.id), req.body.up_to_id));
  } catch (e) { return fail(res, e); }
};

exports.setMute = async (req, res) => {
  try {
    const id = Number(req.params.id);
    const m = await model.getMembership(id, req.user.id);
    if (!m || !m.is_active) throw httpError(403, "You are not a member of this conversation");
    await model.setMuted(id, req.user.id, !!req.body.muted);
    return ok(res, { muted: !!req.body.muted });
  } catch (e) { return fail(res, e); }
};

exports.deleteMessage = async (req, res) => {
  try {
    return ok(res, await service.deleteMessage(req.user.id, Number(req.params.id)));
  } catch (e) { return fail(res, e); }
};

exports.getPresence = async (req, res) => {
  try {
    return ok(res, await service.getPresence(Number(req.params.userId)));
  } catch (e) { return fail(res, e); }
};

// multipart: field "file" + text field "kind" = document | photo | camera | kyc
exports.uploadFile = async (req, res) => {
  try {
    const kind = UPLOAD_KINDS[String(req.body.kind || "").toLowerCase()];
    if (!kind) throw httpError(400, "kind must be document, photo, camera or kyc");
    if (!req.file) throw httpError(400, "File is required");
    if (!kind.allow(req.file.mimetype)) throw httpError(400, `File type ${req.file.mimetype} is not allowed for ${req.body.kind}`);
    if (req.file.size > cfg.MAX_FILE_SIZE) throw httpError(400, "File is too large");

    const { object_path } = await uploadFileToMinio(req.file, kind.folder);
    return ok(res, {
      type: kind.type,
      file_path: object_path,
      file_name: req.file.originalname,
      file_mime: req.file.mimetype,
      file_size: req.file.size,
      file_url: await model.sign(object_path),
    }, "Uploaded", 201);
  } catch (e) { return fail(res, e); }
};

// ---- groups ----
exports.createGroup = async (req, res) => {
  try {
    return ok(res, await service.createGroup(req.user.id, req.body), "Group created", 201);
  } catch (e) { return fail(res, e); }
};

exports.updateGroup = async (req, res) => {
  try {
    await service.updateGroup(req.user.id, Number(req.params.id), req.body);
    return ok(res, null, "Group updated");
  } catch (e) { return fail(res, e); }
};

exports.setGroupIcon = async (req, res) => {
  try {
    if (!req.file) throw httpError(400, "File is required");
    if (!IMG.test(req.file.mimetype)) throw httpError(400, "Icon must be an image");
    const { object_path } = await uploadFileToMinio(req.file, "chat_groups");
    return ok(res, await service.setGroupIcon(req.user.id, Number(req.params.id), object_path), "Icon updated");
  } catch (e) { return fail(res, e); }
};

exports.addMembers = async (req, res) => {
  try {
    return ok(res, await service.addGroupMembers(req.user.id, Number(req.params.id), req.body.user_ids), "Members added");
  } catch (e) { return fail(res, e); }
};

exports.removeMember = async (req, res) => {
  try {
    await service.removeGroupMember(req.user.id, Number(req.params.id), Number(req.params.userId));
    return ok(res, null, "Member removed");
  } catch (e) { return fail(res, e); }
};

exports.setMemberRole = async (req, res) => {
  try {
    await service.setMemberRole(req.user.id, Number(req.params.id), Number(req.params.userId), req.body.role);
    return ok(res, null, "Role updated");
  } catch (e) { return fail(res, e); }
};

exports.leaveGroup = async (req, res) => {
  try {
    await service.leaveGroup(req.user.id, Number(req.params.id));
    return ok(res, null, "You left the group");
  } catch (e) { return fail(res, e); }
};

// ---- push tokens ----
exports.saveDeviceToken = async (req, res) => {
  try {
    const { fcm_token, platform } = req.body;
    if (!fcm_token) throw httpError(400, "fcm_token is required");
    await model.upsertDeviceToken(req.user.id, String(fcm_token), platform);
    return ok(res, null, "Token saved");
  } catch (e) { return fail(res, e); }
};

exports.deleteDeviceToken = async (req, res) => {
  try {
    if (!req.body.fcm_token) throw httpError(400, "fcm_token is required");
    await model.deleteDeviceToken(req.user.id, String(req.body.fcm_token));
    return ok(res, null, "Token removed");
  } catch (e) { return fail(res, e); }
};