const express = require("express");
const multer = require("multer");
const router = express.Router();
const authMiddleware = require("../../middleware/auth.middleware");
const c = require("../../controllers/employee-performance/task.controller");

const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 10 * 1024 * 1024, files: 5 },
  fileFilter: (req, file, cb) => {
    if (file.mimetype.startsWith("image/") || file.mimetype === "application/pdf") {
      return cb(null, true);
    }
    cb(new Error("Only images and PDF files are allowed"));
  },
});

// Assigner (CRM)
router.get("/get-assignable-roles", authMiddleware, c.getAssignableRoles);
router.get("/get-assignable-users", authMiddleware, c.getAssignableUsers);
router.post("/", authMiddleware, c.createTask);
router.get("/assigned-by-me", authMiddleware, c.getAssignedByMe);

// Assignee (Flutter)
router.get("/my", authMiddleware, c.getMyTasks);

// Single task + actions
router.get("/:id", authMiddleware, c.getTask);
router.patch("/:id/start", authMiddleware, c.startTask);
router.post("/:id/proof", authMiddleware, upload.array("files", 5), c.uploadProof);
router.patch("/:id/comment", authMiddleware, c.addComment);
router.patch("/:id/complete", authMiddleware, c.completeTask);

module.exports = router;