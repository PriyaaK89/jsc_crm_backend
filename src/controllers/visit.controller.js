const { uploadFileToMinio, getPresignedUrl } = require("../utils/fileUpload");
const visitModel = require("../models/visit.model");
const customerModel = require("../models/customer.model");
const db = require("../config/db");
const User = require("../models/user.model");
const { getSubordinates, getHierarchyIds } = require("../controllers/rollingUser.controller");
const { getUsersByLevelAndHierarchy } = require("../models/rollingUser.model");
const whatsappService = require("../services/whatsapp.service");

const validPurposes = ["new_dist_planning", "sales_order", "sales_return", "collection", "others"];

const visitPurposeLabels = {
  new_dist_planning: "New Distributor Planning",
  sales_order: "Sales Order",
  sales_return: "Sales Return",
  collection: "Collection",
  others: "Others"
};

const visitTypeLabels = {
  farmer: "Farmer",
  retailer: "Retailer",
  distributor: "Distributor"
};

const IST_OFFSET_MS = (5 * 60 + 30) * 60 * 1000;

const isVisitTimeAllowed = (visitUptoTimeStr) => {
  if (!visitUptoTimeStr) return true;

  const now = new Date();

  const istTime = new Intl.DateTimeFormat("en-IN", {
    timeZone: "Asia/Kolkata",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hour12: false,
  }).formatToParts(now);

  const hour = Number(istTime.find(p => p.type === "hour").value);
  const minute = Number(istTime.find(p => p.type === "minute").value);
  const second = Number(istTime.find(p => p.type === "second").value);

  const nowSeconds =
    hour * 3600 +
    minute * 60 +
    second;

  const [h, m, s = 0] = visitUptoTimeStr.split(":").map(Number);

  const uptoSeconds =
    h * 3600 +
    m * 60 +
    s;

  console.log("Server UTC time:", now.toISOString());
  console.log(
    "Current IST time:",
    `${String(hour).padStart(2, "0")}:${String(minute).padStart(2, "0")}:${String(second).padStart(2, "0")}`
  );
  console.log(
    "Visit allowed till:",
    visitUptoTimeStr
  );
  console.log(
    "nowSeconds:",
    nowSeconds,
    "| uptoSeconds:",
    uptoSeconds,
    "| allowed:",
    nowSeconds <= uptoSeconds
  );

  return nowSeconds <= uptoSeconds;
};

const formatTimeForDisplay = (timeStr) => {
  const [h, m] = timeStr.split(":").map(Number);
  const period = h >= 12 ? "PM" : "AM";
  const hour12 = h % 12 === 0 ? 12 : h % 12;
  return `${hour12}:${String(m).padStart(2, "0")} ${period}`;
};

exports.createVisit = async (req, res) => {
  try {
    const { user_id, visit_type, customer_type, customer_id, name, firm_name, firm_address, contact_number, address, area, district, pincode, visit_purpose, comment, reminder_date } = req.body;
    console.log("createVisit called | user_id:", user_id, "| body keys:", Object.keys(req.body));

    // Validate purpose
    if (!validPurposes.includes(visit_purpose)) {
      return res.status(400).json({ message: "Invalid visit purpose" });
    }

    let finalCustomerId = customer_id;

    //  NEW CUSTOMER FLOW
    if (customer_type === "new") {
      if (!name) { return res.status(400).json({ message: "Customer name required" }); }
      const existing = await customerModel.findCustomer(contact_number, visit_type);

      if (existing) {
        return res.status(400).json({ message: "Customer already exists with this mobile number" });
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

    try {
      console.log("========================================");
      console.log("VISIT WHATSAPP START");
      console.log("Visit ID:", visitId);
      const visit = await visitModel.getVisitWhatsappData(visitId);
      console.log("Visit WhatsApp Data:", visit);
      if (
        visit &&
        visit.contact_number &&
        visit.customer_name &&
        visit.employee_name
      ) {
        // console.log("All required visit data found");

        let mobile = visit.contact_number.replace(/\D/g, "");
        console.log("Mobile before country code:", mobile);

        if (!mobile.startsWith("91")) {
          mobile = "91" + mobile;
        }
        // console.log("Final WhatsApp mobile:", mobile)
        // Resolve human-readable labels for THIS visit only
        const resolvedVisitType =
          visitTypeLabels[visit.visit_type] || visit.visit_type;

        const resolvedVisitPurpose =
          visitPurposeLabels[visit.visit_purpose] || visit.visit_purpose;
        // console.log(
        //   "WhatsApp Template Name:",
        //   "visit_submitted"
        // );

        // console.log(
        //   "WhatsApp Template Language:",
        //   "en_GB"
        // );



        // console.log("Calling sendTemplateMessage...");

        const response = await whatsappService.sendTemplateMessage(
          mobile,
          "visit_submitted",
          "en_GB",
          [
            {
              type: "body",
              parameters: [
                {
                  type: "text",
                  text: visit.customer_name
                },
                {
                  type: "text",
                  text: visit.employee_name
                },
                {
                  type: "text",
                  text: resolvedVisitType
                },
                {
                  type: "text",
                  text: resolvedVisitPurpose
                },
                {
                  type: "text",
                  text: visit.visit_date
                }
              ]
            }
          ]
        );

        console.log(
          "Visit WhatsApp sent:",
          response.messages?.[0]?.id
        );
        console.log("WhatsApp API SUCCESS");
        console.log(
          "WhatsApp Response:",
          JSON.stringify(response, null, 2)
        );

        console.log(
          "WhatsApp Message ID:",
          response.messages?.[0]?.id
        );
      } else {

        console.log("WhatsApp NOT sent because required data is missing");

        // console.log("Has visit:", !!visit);
        // console.log("Contact number:", visit?.contact_number);
        // console.log("Customer name:", visit?.customer_name);
        // console.log("Employee name:", visit?.employee_name);
      }


    } catch (err) {
      console.error(
        "Error message:",
        err.message
      );

      console.error(
        "Meta/API error:",
        JSON.stringify(
          err.response?.data || {},
          null,
          2
        )
      );

      console.error(
        "HTTP status:",
        err.response?.status
      );
      console.error("WhatsApp Error:", err.response?.data || err.message);
    }

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
      user_id: clean(req.query.user_id),
      visit_type: clean(req.query.visit_type),
      district: clean(req.query.district),
      from_date: clean(req.query.from_date),
      to_date: clean(req.query.to_date),
      search: clean(req.query.search),
      page: req.query.page || 1,
      limit: req.query.limit || 10,

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

exports.getTodayVisit = async (req, res) => {
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

exports.getVisitReport = async (req, res) => {
  try {
    const filters = {
      user_id: clean(req.query.user_id),
      from_date: clean(req.query.from_date),
      to_date: clean(req.query.to_date),
      visit_type: clean(req.query.visit_type),

      // NEW
      search: clean(req.query.search),
      page: clean(req.query.page),
      limit: clean(req.query.limit),
    };

    const result = await visitModel.getVisitReportSummary(filters);

    res.status(200).json({
      success: true,
      total: result.total,
      page: result.page,
      limit: result.limit,
      totalPages: result.totalPages,
      count: result.data.length,
      data: result.data,
    });

  } catch (err) {
    console.log("getVisitReport Error:", err);
    res.status(500).json({
      success: false,
      error: err.message,
    });
  }
};

exports.getUsersBySelectedLevel = async (req, res) => {
  try {
    const loginUserId = req.user.id;
    const selectedLevel = Number(req.query.level);

    if (!selectedLevel) {
      return res.status(400).json({
        success: false,
        message: "level is required"
      });
    }

    const hierarchyUsers = await getSubordinates(loginUserId);
    const users = hierarchyUsers.filter(user => Number(user.level) === selectedLevel);
    return res.status(200).json({ success: true, data: users });

  } catch (error) {
    return res.status(500).json({
      success: false,
      message: error.message
    });
  }
};

exports.getHierarchyVisits = async (req, res) => {
  try {
    const loginUserId = req.user.id;

    const hierarchyIds = await getHierarchyIds(loginUserId);

    const data = await visitModel.getHierarchyVisitSummary({
      user_ids: hierarchyIds,
      date: req.query.date,
      level: req.query.level,
      user_id: req.query.user_id
    });

    return res.status(200).json({
      success: true,
      data
    });

  } catch (error) {
    return res.status(500).json({
      success: false,
      message: error.message
    });
  }
};

exports.getUserVisitDetails = async (req, res) => {
  try {
    const userId = req.params.userId;
    const date = req.query.date;

    const visits = await visitModel.getUserVisitDetails(userId, date);
    const data = await Promise.all(
      visits.map(async (visit) => ({
        ...visit,
        image_url: visit.image_path
          ? await getPresignedUrl(visit.image_path)
          : null
      }))
    );
    return res.status(200).json({
      success: true,
      total_visits: visits.length,
      data
    });

  } catch (error) {
    return res.status(500).json({
      success: false,
      message: error.message
    });
  }
};