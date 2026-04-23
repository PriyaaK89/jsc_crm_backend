const { uploadFileToMinio,getPresignedUrl } = require("../utils/fileUpload");
const visitModel = require("../models/visit.model");
const customerModel = require("../models/customer.model");
const db = require("../config/db");
const User = require("../models/user.model");

const validPurposes = [ "new_dist_planning", "sales_order", "sales_return", "collection", "others"];

exports.createVisit = async (req, res) => {
  try {
    const { user_id, visit_type,customer_type,  customer_id, name, firm_name, firm_address, contact_number, address, area, district, pincode, visit_purpose, comment, reminder_date
    } = req.body;

    // Validate purpose
    if (!validPurposes.includes(visit_purpose)) {
      return res.status(400).json({ message: "Invalid visit purpose" });
    }

    let finalCustomerId = customer_id;

    //  NEW CUSTOMER FLOW
    if (customer_type === "new") {
      if (!name) {
        return res.status(400).json({ message: "Customer name required" });
      }

      const existing = await customerModel.findCustomer(
        contact_number,
        // visit_type
      );

      if (existing) {
        return res.status(400).json({
          message: "Customer already exists with this mobile number"
        });
      }

      finalCustomerId = await customerModel.createCustomer([
         visit_type, name, firm_name, firm_address,
        contact_number, address, area, district, pincode, user_id
      ]);
    }

    //  EXISTING CUSTOMER FLOW
    if (customer_type === "existing") {
      if (!customer_id) {
        return res.status(400).json({
          message: "Customer ID is required for existing customer"
        });
      }
    }
    if (!req.file) {
  return res.status(400).json({
    success: false,
    message: "Image is mandatory. Please upload an image."
  });
}

const cleanedReminderDate = clean(reminder_date);
    // Upload Image
    let imagePath = null;
    if (req.file) {
      const upload = await uploadFileToMinio(req.file, "visits");
      imagePath = upload.object_path;
    }

    // Save Visit
    const visitId = await visitModel.createVisit([
      user_id,
      finalCustomerId,
      visit_type,
      customer_type,
      visit_purpose,
      comment,
      cleanedReminderDate,
      imagePath
    ]);

    return res.status(201).json({
      success: true,
      message: "Visit created successfully",
      data: {
        visitId
      }
    });
    

  } catch (err) {
  console.error(" ERROR:", err);

  return res.status(500).json({
    message: err.message,   //  SHOW REAL ERROR
    error: err
  });
}
};

const clean = (value) => {
  if (!value) return null;
  if (value === "null" || value === "undefined") return null;
  if (typeof value === "string" && value.trim() === "") return null;
  return value;
};

exports.getVisits = async (req, res) => {
  try {
    const loggedInUser = req.user;

    const filters = {
      visit_type: clean(req.query.visit_type),
      district: clean(req.query.district),
      from_date: clean(req.query.from_date),
      to_date: clean(req.query.to_date),
      search: clean(req.query.search),
      page: req.query.page || 1,
      limit: req.query.limit || 10
    };

    let userIds = null; //  default = no restriction

    //  Only apply hierarchy for NON-admin users
    if (!["ADMIN", "SUPER_ADMIN"].includes(loggedInUser.role)) {
      userIds = await User.getSubordinateIds(loggedInUser.id);
    }

    const result = await visitModel.getVisits({
      ...filters,
      user_ids: userIds
    });

    const data = await Promise.all(
      result.data.map(async (item) => ({
        ...item,
        image_url: item.image_path
          ? await getPresignedUrl(item.image_path)
          : null
      }))
    );

    res.status(200).json({
      success: true,
      total: result.total,
      page: result.page,
      limit: result.limit,
      totalPages: result.totalPages,
      data
    });

  } catch (err) {
    res.status(500).json({ error: err.message });
  }
};

exports.getMyVisits = async (req, res) => {
  try {
    const userId = req.user.id;

    const filters = {
      user_ids: [userId], // FIXED
      visit_type: clean(req.query.visit_type),
      district: clean(req.query.district),
      from_date: clean(req.query.from_date),
      to_date: clean(req.query.to_date),
      search: clean(req.query.search),
      page: req.query.page || 1,
      limit: req.query.limit || 10
    };

    const result = await visitModel.getVisits(filters);

    const data = await Promise.all(
      result.data.map(async (item) => ({
        ...item,
        image_url: item.image_path
          ? await getPresignedUrl(item.image_path)
          : null
      }))
    );

    return res.status(200).json({
      success: true,
      total: result.total,
      page: result.page,
      limit: result.limit,
      totalPages: result.totalPages,
      data
    });

  } catch (err) {
    return res.status(500).json({ error: err.message });
  }
};

exports.getTodayVisit =  async (req, res) => {
  try {
    const today = new Date().toISOString().split("T")[0];

    const result = await visitModel.getVisits({
       user_ids: [req.user.id], 
      from_date: today,
      to_date: today,
      page: 1,
      limit: 50
    });

    res.json({ success: true, data: result.data });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
};

exports.getTodayVisitCount = async (req, res) => {
  try {
    const userId = req.user.id;

    const [rows] = await db.query(
      `SELECT COUNT(*) as total 
       FROM visits 
       WHERE user_id = ? 
       AND DATE(created_at) = CURDATE()`,
      [userId]
    );

    return res.json({
      success: true,
      totalVisits: rows[0].total
    });
  } catch (error) {
    return res.status(500).json({ success: false, message: error.message });
  }
};