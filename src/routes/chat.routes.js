const router = require("express").Router();
const multer = require("multer");
const auth = require("../middleware/auth.middleware"); // ADJUST path: your JWT middleware (sets req.user.id)
const c = require("../controllers/chat.controller");
const cfg = require("../chat/chat.config");

const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: cfg.MAX_FILE_SIZE } });

router.use(auth);

// contacts + conversations
router.get("/capabilities", c.getCapabilities);
router.get("/contacts", c.getContacts);
router.get("/conversations", c.getConversations);
router.post("/conversations/direct", c.startDirect);
router.get("/conversations/:id", c.getConversationDetail);
router.get("/conversations/:id/messages", c.getMessages);
router.post("/conversations/:id/messages", c.sendMessage);   // REST fallback
router.post("/conversations/:id/read", c.markRead);
router.post("/conversations/:id/mute", c.setMute);

// messages / files / presence
router.delete("/messages/:id", c.deleteMessage);
router.post("/upload", upload.single("file"), c.uploadFile);
router.get("/presence/:userId", c.getPresence);

// groups
router.post("/groups", c.createGroup);
router.put("/groups/:id", c.updateGroup);
router.post("/groups/:id/icon", upload.single("file"), c.setGroupIcon);
router.post("/groups/:id/members", c.addMembers);
router.delete("/groups/:id/members/:userId", c.removeMember);
router.put("/groups/:id/members/:userId/role", c.setMemberRole);
router.post("/groups/:id/leave", c.leaveGroup);

// React dashboard (read-only)
router.get("/admin/conversations", c.adminListConversations);
router.get("/admin/conversations/:id", c.adminGetConversation);
router.get("/admin/conversations/:id/messages", c.adminGetMessages);

// push tokens
router.post("/device-token", c.saveDeviceToken);
router.delete("/device-token", c.deleteDeviceToken);

module.exports = router;