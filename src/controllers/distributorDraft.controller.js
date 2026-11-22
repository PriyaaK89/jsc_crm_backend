const db = require("../config/db");
const { uploadFileToMinio, getPresignedUrl } = require("../utils/fileUpload");

// Fields that can hold multiple files (stored as arrays)
const MULTI_FILE_FIELDS = ["shop_image", "cheque_photo"];

// ---------- helpers ----------

const safeParse = (value, fallback) => {
  if (value === null || value === undefined) return fallback;
  if (typeof value === "object") return value;
  try {
    return JSON.parse(value);
  } catch {
    return fallback;
  }
};

const cut = (val, max = 255) => {
  if (val === null || val === undefined) return null;
  const s = String(val).trim();
  return s === "" ? null : s.slice(0, max);
};

// Columns used only for showing the draft in the list
const extractSummary = (formData) => {
  const c = formData?.controllers || {};
  return {
    customer_name: cut(c.customerName),
    firm_name: cut(c.firmName),
    gst_number: cut(c.gstController, 50),
    firm_type: cut(formData?.firmType, 50),
  };
};

// Upload every received file to MinIO and return { field: path | [paths] }
const uploadDraftFiles = async (files) => {
  const result = {};

  for (const field of Object.keys(files)) {
    const list = files[field];
    if (!Array.isArray(list) || list.length === 0) continue;

    if (MULTI_FILE_FIELDS.includes(field)) {
      result[field] = [];
      for (const f of list) {
        const uploaded = await uploadFileToMinio(f, "distributor_drafts");
        result[field].push(uploaded.object_path);
      }
    } else {
      const uploaded = await uploadFileToMinio(list[0], "distributor_drafts");
      result[field] = uploaded.object_path;
    }
  }

  return result;
};

const presign = async (path) => {
  try {
    return await getPresignedUrl(path);
  } catch (err) {
    console.error("Draft presign error:", err.message);
    return null;
  }
};

// ---------- CREATE DRAFT ----------
exports.createDraft = async (req, res) => {
  try {
    const userId = req.user?.id;

    const formData = safeParse(req.body.form_data, null);
    if (!formData || typeof formData !== "object") {
      return res
        .status(400)
        .json({ success: false, message: "form_data is required" });
    }

    const filesData = await uploadDraftFiles(req.files || {});
    const summary = extractSummary(formData);

    const [result] = await db.query(
      `INSERT INTO distributor_drafts
        (created_by, customer_name, firm_name, gst_number, firm_type, form_data, files_data)
       VALUES (?, ?, ?, ?, ?, ?, ?)`,
      [
        userId,
        summary.customer_name,
        summary.firm_name,
        summary.gst_number,
        summary.firm_type,
        JSON.stringify(formData),
        JSON.stringify(filesData),
      ],
    );

    res.status(201).json({
      success: true,
      message: "Draft saved successfully",
      draftId: result.insertId,
    });
  } catch (error) {
    console.error(error);
    res.status(500).json({ success: false, message: error.message });
  }
};

// ---------- UPDATE DRAFT ----------
// The app always sends the full set of files it currently holds,
// so files_data is replaced entirely (a removed file is simply not sent).
exports.updateDraft = async (req, res) => {
  try {
    const userId = req.user?.id;
    const { id } = req.params;

    const [[existing]] = await db.query(
      "SELECT id FROM distributor_drafts WHERE id = ? AND created_by = ?",
      [id, userId],
    );

    if (!existing) {
      return res
        .status(404)
        .json({ success: false, message: "Draft not found" });
    }

    const formData = safeParse(req.body.form_data, null);
    if (!formData || typeof formData !== "object") {
      return res
        .status(400)
        .json({ success: false, message: "form_data is required" });
    }

    const filesData = await uploadDraftFiles(req.files || {});
    const summary = extractSummary(formData);

    await db.query(
      `UPDATE distributor_drafts
          SET customer_name = ?, firm_name = ?, gst_number = ?, firm_type = ?,
              form_data = ?, files_data = ?
        WHERE id = ? AND created_by = ?`,
      [
        summary.customer_name,
        summary.firm_name,
        summary.gst_number,
        summary.firm_type,
        JSON.stringify(formData),
        JSON.stringify(filesData),
        id,
        userId,
      ],
    );

    res.json({
      success: true,
      message: "Draft updated successfully",
      draftId: Number(id),
    });
  } catch (error) {
    console.error(error);
    res.status(500).json({ success: false, message: error.message });
  }
};

// ---------- LIST DRAFTS (only the logged-in user's drafts) ----------
exports.getDrafts = async (req, res) => {
  try {
    const userId = req.user?.id;

    const page = Math.max(Number(req.query.page) || 1, 1);
    const limit = Math.min(Math.max(Number(req.query.limit) || 20, 1), 100);
    const offset = (page - 1) * limit;
    const search = (req.query.search || "").trim();

    let where = "WHERE created_by = ?";
    const params = [userId];

    if (search) {
      where += ` AND (customer_name LIKE ? OR firm_name LIKE ? OR gst_number LIKE ?)`;
      const s = `%${search}%`;
      params.push(s, s, s);
    }

    const [rows] = await db.query(
      `SELECT id, customer_name, firm_name, gst_number, firm_type, created_at, updated_at
         FROM distributor_drafts
         ${where}
        ORDER BY updated_at DESC
        LIMIT ? OFFSET ?`,
      [...params, limit, offset],
    );

    const [[{ total }]] = await db.query(
      `SELECT COUNT(*) AS total FROM distributor_drafts ${where}`,
      params,
    );

    res.json({
      success: true,
      total,
      page,
      limit,
      totalPages: Math.ceil(total / limit),
      data: rows,
    });
  } catch (error) {
    console.error(error);
    res.status(500).json({ success: false, message: error.message });
  }
};

// ---------- GET ONE DRAFT (form data + presigned file urls) ----------
exports.getDraft = async (req, res) => {
  try {
    const userId = req.user?.id;
    const { id } = req.params;

    const [[draft]] = await db.query(
      "SELECT * FROM distributor_drafts WHERE id = ? AND created_by = ?",
      [id, userId],
    );

    if (!draft) {
      return res
        .status(404)
        .json({ success: false, message: "Draft not found" });
    }

    const formData = safeParse(draft.form_data, {});
    const filesRaw = safeParse(draft.files_data, {});
    const files = {};

    for (const key of Object.keys(filesRaw)) {
      const v = filesRaw[key];
      if (Array.isArray(v)) {
        const urls = [];
        for (const p of v) {
          const url = await presign(p);
          if (url) urls.push(url);
        }
        files[key] = urls;
      } else if (typeof v === "string") {
        const url = await presign(v);
        if (url) files[key] = url;
      }
    }

    res.json({
      success: true,
      data: {
        id: draft.id,
        form_data: formData,
        files,
        created_at: draft.created_at,
        updated_at: draft.updated_at,
      },
    });
  } catch (error) {
    console.error(error);
    res.status(500).json({ success: false, message: error.message });
  }
};

// ---------- DELETE DRAFT ----------
exports.deleteDraft = async (req, res) => {
  try {
    const userId = req.user?.id;
    const { id } = req.params;

    const [result] = await db.query(
      "DELETE FROM distributor_drafts WHERE id = ? AND created_by = ?",
      [id, userId],
    );

    if (result.affectedRows === 0) {
      return res
        .status(404)
        .json({ success: false, message: "Draft not found" });
    }

    res.json({ success: true, message: "Draft deleted successfully" });
  } catch (error) {
    console.error(error);
    res.status(500).json({ success: false, message: error.message });
  }
};