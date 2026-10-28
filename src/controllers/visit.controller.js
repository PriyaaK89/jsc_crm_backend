const { uploadFileToMinio, getPresignedUrl } = require("../utils/fileUpload");
const visitModel = require("../models/visit.model");
const customerModel = require("../models/customer.model");
const db = require("../config/db");
const User = require("../models/user.model");
const { getSubordinates, getHierarchyIds } = require("../controllers/rollingUser.controller");
const { getUsersByLevelAndHierarchy } = require("../models/rollingUser.model");
const whatsappService = require("../services/whatsapp.service");
const attendanceModel = require("../models/empAttendance.model");

const validPurposes = [
  "new_dist_planning", "sales_order", "sales_return", "collection", "others",
  "product_discussion", "stock_check", "scheme_discussion", "complaint",
  "demand_generation", "farmer_meeting", "recovery_followup",
  "product_demonstration", "competitor_information"
];

const validOutcomes = [
  "successful", "follow_up_required", "order_received", "payment_received",
  "no_requirement", "customer_not_available", "call_again", "escalation_required"
];

const visitPurposeLabels = {
  new_dist_planning: "New Distributor Planning",
  sales_order: "Sales Order",
  sales_return: "Sales Return",
  collection: "Collection",
  others: "Others",
  product_discussion: "Product Discussion",
  stock_check: "Stock Check",
  scheme_discussion: "Scheme Discussion",
  complaint: "Complaint",
  demand_generation: "Demand Generation",
  farmer_meeting: "Farmer Meeting",
  recovery_followup: "Recovery Follow-up",
  product_demonstration: "Product Demonstration",
  competitor_information: "Competitor Information"
};

const visitOutcomeLabels = {
  successful: "Successful",
  follow_up_required: "Follow-up Required",
  order_received: "Order Received",
  payment_received: "Payment Received",
  no_requirement: "No Requirement",
  customer_not_available: "Customer Not Available",
  call_again: "Call Again",
  escalation_required: "Escalation Required"
};

const visitTypeLabels = {
  farmer: "Farmer",
  retailer: "Retailer",
  distributor: "Distributor"
};


// Add near the top of the controller, alongside validPurposes/labels
const isPastVisitCutoff = () => {
  const CUTOFF_HOUR = 19; // 7 PM
  const CUTOFF_MINUTE = 0;

  // Resolve "now" in IST regardless of server's own timezone
  const nowIST = new Date(
    new Date().toLocaleString("en-US", { timeZone: "Asia/Kolkata" })
  );

  const cutoff = new Date(nowIST);
  cutoff.setHours(CUTOFF_HOUR, CUTOFF_MINUTE, 0, 0);

  return nowIST > cutoff;
};

exports.createVisit = async (req, res) => {
  try {
    const {
      user_id, visit_type, customer_type, customer_id,
      name, firm_name, firm_address, contact_number, alt_contact_number, gst_number,
      address, area, town, state, district, pincode,
      visit_purpose, visit_outcome, comment,
      reminder_date, reminder_time, reminder_reason, priority,
      latitude, longitude,
      distributor_ledger_id,                          // used directly for visit_type = distributor,
                                                        // and as the distributor picked for a new retailer
      retailer_id,                                     // existing retailer picked for a new farmer
      new_retailer_name, new_retailer_firm_name,
      new_retailer_contact_number, new_retailer_area,
      new_retailer_district, new_retailer_pincode,
      new_retailer_distributor_ledger_id, visit_start_time, visit_duration_seconds
    } = req.body;
 
    console.log("createVisit called | user_id:", user_id, "| body keys:", Object.keys(req.body));
 
    if (!validPurposes.includes(visit_purpose)) {
      return res.status(400).json({ message: "Invalid visit purpose" });
    }
 
    if (visit_outcome && !validOutcomes.includes(visit_outcome)) {
      return res.status(400).json({ message: "Invalid visit outcome" });
    }
 
    const attendance = await attendanceModel.getTodayAttendance(user_id);
    if (!attendance) {
      return res.status(400).json({
        success: false,
        message: "Please mark attendance before submitting a visit"
      });
    }
 
    if (attendance.status === "day_over") {
      return res.status(400).json({
        success: false,
        message: "Attendance already marked as day over. Cannot submit visit."
      });
    }
 
    let finalCustomerId = customer_id;
 
    // ============================================================
    // DISTRIBUTOR VISIT — always resolves to the one customers row
    // that represents this employee's assigned ledger. Never goes
    // through the new/existing customer_type flow at all.
    // ============================================================
    if (visit_type === "distributor") {
      if (!distributor_ledger_id) {
        return res.status(400).json({ message: "Please select a distributor" });
      }
      finalCustomerId = await customerModel.findOrCreateDistributorCustomer(
        distributor_ledger_id,
        user_id
      );
    }
 
    // ============================================================
    // NEW CUSTOMER FLOW — retailer or farmer
    // ============================================================
    if (customer_type === "new" && (visit_type === "retailer" || visit_type === "farmer")) {
      if (!name) {
        return res.status(400).json({ message: "Customer name required" });
      }
      const existing = await customerModel.findCustomer(contact_number, visit_type);
      if (existing) {
        return res.status(400).json({ message: "Customer already exists with this mobile number" });
      }

      let resolvedRetailerId = clean(retailer_id);
      let resolvedDistributorLedgerId = clean(distributor_ledger_id);

      if (visit_type === "retailer" && !resolvedDistributorLedgerId) {
        return res.status(400).json({ message: "Please assign a distributor for this retailer" });
      }

      // Farmer visit, creating a brand-new retailer inline
      if (visit_type === "farmer" && !resolvedRetailerId && new_retailer_name) {
        if (!new_retailer_distributor_ledger_id) {
          return res.status(400).json({ message: "Please assign a distributor for the new retailer" });
        }

        resolvedRetailerId = await customerModel.createCustomer([
          "retailer", new_retailer_name, clean(new_retailer_firm_name), null,
          new_retailer_contact_number, null, null,
          clean(new_retailer_area) || "", clean(new_retailer_area) || "",
          null, null,
          clean(new_retailer_district) || "", clean(new_retailer_pincode) || "",
          null, new_retailer_distributor_ledger_id, user_id
        ]);
        resolvedDistributorLedgerId = new_retailer_distributor_ledger_id;
      }

      if (visit_type === "farmer") {
        if (!resolvedRetailerId) {
          return res.status(400).json({ message: "Please assign a retailer for this farmer" });
        }
        if (!resolvedDistributorLedgerId) {
          return res.status(400).json({ message: "Please assign a distributor for this farmer" });
        }
        const retailer = await customerModel.getCustomerById(resolvedRetailerId);
        if (!retailer || retailer.type !== "retailer") {
          return res.status(400).json({ message: "Selected retailer is invalid" });
        }
      }

      finalCustomerId = await customerModel.createCustomer([
        visit_type, name, firm_name, firm_address, contact_number,
        clean(alt_contact_number), clean(gst_number),
        address, area, clean(town), clean(state), district, pincode,
        visit_type === "farmer" ? resolvedRetailerId : null,
        resolvedDistributorLedgerId,
        user_id
      ]);

      // ---- many-to-many links (idempotent) ----
      if (visit_type === "retailer") {
        await customerModel.linkRetailerToDistributor(finalCustomerId, resolvedDistributorLedgerId, user_id);
      }
      if (visit_type === "farmer") {
        // Retailer picked (or created) under this distributor -> make sure the
        // retailer<->distributor link exists. This is the "forgotten retailer" case.
        await customerModel.linkRetailerToDistributor(resolvedRetailerId, resolvedDistributorLedgerId, user_id);
        await customerModel.linkFarmerToRetailer(finalCustomerId, resolvedRetailerId, user_id);
      }
    }
 
    // EXISTING CUSTOMER FLOW (retailer / farmer / distributor all share this)
    if (customer_type === "existing") {
      if (!customer_id) {
        return res.status(400).json({
          message: "Customer ID is required for existing customer"
        });
      }
    }
 
    const files = req.files || {};
    if (!files.image || !files.image[0]) {
      return res.status(400).json({
        success: false,
        message: "Image is mandatory. Please upload an image."
      });
    }
 
    const cleanedReminderDate = clean(reminder_date);
    const cleanedReminderTime = clean(reminder_time);
 
    const mainUpload = await uploadFileToMinio(files.image[0], "visits");
    const imagePath = mainUpload.object_path;
 
  let shopImagePath = null;
if (files.shop_image && files.shop_image[0]) {
  const shopUpload = await uploadFileToMinio(files.shop_image[0], "visits_shop");
  shopImagePath = shopUpload.object_path;
}

let documentImagePath = null;
if (files.document_image && files.document_image[0]) {
  const docUpload = await uploadFileToMinio(files.document_image[0], "visits_documents");
  documentImagePath = docUpload.object_path;
}

let startEpoch = Number(clean(visit_start_epoch));
let durationSeconds = null;
const nowSec = Math.floor(Date.now() / 1000);
if (Number.isFinite(startEpoch) && startEpoch > 0 && startEpoch <= nowSec + 60 && nowSec - startEpoch < 86400) {
  durationSeconds = Math.max(0, nowSec - startEpoch);
} else {
  startEpoch = null;
}



    const visitId = await visitModel.createVisit([
  user_id, finalCustomerId, visit_type,
  customer_type === "existing" ? "old" : customer_type,
  visit_purpose, clean(visit_outcome), comment,
  cleanedReminderDate, cleanedReminderTime, clean(reminder_reason),
  clean(priority) ? String(clean(priority)).toLowerCase() : null,
  imagePath, shopImagePath, documentImagePath,
  clean(latitude), clean(longitude),
  startEpoch, durationSeconds
]);
 
    const resolvedVisitType = visitTypeLabels[visit_type] || visit_type;
    const resolvedVisitPurpose = visitPurposeLabels[visit_purpose] || visit_purpose;
    const resolvedVisitOutcome = visit_outcome
      ? (visitOutcomeLabels[visit_outcome] || visit_outcome)
      : null;
 
    try {
      const visit = await visitModel.getVisitWhatsappData(visitId);
 
      if (visit && visit.contact_number && visit.customer_name && visit.employee_name) {
        let mobile = visit.contact_number.replace(/\D/g, "");
        if (!mobile.startsWith("91")) {
          mobile = "91" + mobile;
        }
 
        await whatsappService.sendTemplateMessage(
          mobile,
          "visit_submitted",
          "en_US",
          [
            {
              type: "body",
              parameters: [
                { type: "text", text: visit.customer_name },
                { type: "text", text: visit.employee_name },
                { type: "text", text: visitTypeLabels[visit.visit_type] || visit.visit_type },
                { type: "text", text: visitPurposeLabels[visit.visit_purpose] || visit.visit_purpose },
                { type: "text", text: visit.visit_date }
              ]
            }
          ]
        );
      }
    } catch (err) {
      console.error("WhatsApp Error:", err.response?.data || err.message);
    }
 
    return res.status(201).json({
      success: true,
      message: "Visit created successfully",
      data: {
        visitId,
        visit_type: visit_type,
        visit_type_label: resolvedVisitType,
        visit_purpose: visit_purpose,
        visit_purpose_label: resolvedVisitPurpose,
        visit_outcome: visit_outcome || null,
        visit_outcome_label: resolvedVisitOutcome
      }
    });
 
  } catch (err) {
    console.error(" ERROR:", err);
    return res.status(500).json({
      message: err.message,
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

    const result = await visitModel.getVisits({ ...filters, user_ids: userIds });

    const data = await Promise.all(
      result.data.map(async (item) => ({
        ...item, image_url: item.image_path ? await getPresignedUrl(item.image_path) : null }))
    );

    res.status(200).json({
      success: true, total: result.total, page: result.page,
      limit: result.limit, totalPages: result.totalPages,
      data
    });

  } catch (err) {
    res.status(500).json({ error: err.message });
  }
};

exports.getMyVisits = async (req, res) => {
  try {
    const userId = req.user.id;
    const period = clean(req.query.period); // today | week | month | all

    let from_date = clean(req.query.from_date);
    let to_date = clean(req.query.to_date);

    if (period && period !== "all") {
      const nowIST = new Date(new Date().toLocaleString("en-US", { timeZone: "Asia/Kolkata" }));
      const pad = (n) => String(n).padStart(2, "0");
      const toISO = (d) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;

      if (period === "today") {
        from_date = to_date = toISO(nowIST);
      } else if (period === "week") {
        const day = nowIST.getDay();
        const diffToMonday = day === 0 ? 6 : day - 1;
        const monday = new Date(nowIST);
        monday.setDate(nowIST.getDate() - diffToMonday);
        from_date = toISO(monday);
        to_date = toISO(nowIST);
      } else if (period === "month") {
        const first = new Date(nowIST.getFullYear(), nowIST.getMonth(), 1);
        from_date = toISO(first);
        to_date = toISO(nowIST);
      }
    }

    const filters = {
      user_ids: [userId],
      visit_type: clean(req.query.visit_type),
      district: clean(req.query.district),
      from_date,
      to_date,
      search: clean(req.query.search),
      page: req.query.page || 1,
      limit: req.query.limit || 10
    };

    const result = await visitModel.getVisits(filters);
    const data = await Promise.all(
      result.data.map(async (item) => ({
        ...item,
        image_url: item.image_path ? await getPresignedUrl(item.image_path) : null
      }))
    );

    return res.status(200).json({
      success: true, total: result.total, page: result.page,
      limit: result.limit, totalPages: result.totalPages, data
    });
  } catch (err) {
    return res.status(500).json({ error: err.message });
  }
};

// without date filters
// exports.getMyVisits = async (req, res) => {
//   try {
//     const userId = req.user.id;

//     const filters = {
//       user_ids: [userId], // FIXED
//       visit_type: clean(req.query.visit_type),
//       district: clean(req.query.district),
//       from_date: clean(req.query.from_date),
//       to_date: clean(req.query.to_date),
//       search: clean(req.query.search),
//       page: req.query.page || 1,
//       limit: req.query.limit || 10
//     };

//     const result = await visitModel.getVisits(filters);

//     const data = await Promise.all(
//       result.data.map(async (item) => ({
//         ...item,
//         image_url: item.image_path
//           ? await getPresignedUrl(item.image_path)
//           : null
//       }))
//     );

//     return res.status(200).json({
//       success: true,
//       total: result.total,
//       page: result.page,
//       limit: result.limit,
//       totalPages: result.totalPages,
//       data
//     });

//   } catch (err) {
//     return res.status(500).json({ error: err.message });
//   }
// };

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
      from_date: req.query.start_date,
      to_date: req.query.end_date,
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
    const { start_date, end_date } = req.query;

    const visits = await visitModel.getUserVisitDetails(userId, start_date, end_date);
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

exports.getMyVisitSummary = async (req, res) => {
  try {
    const userId = req.user.id;
    const nowIST = new Date(new Date().toLocaleString("en-US", { timeZone: "Asia/Kolkata" }));
    const year = Number(clean(req.query.year)) || nowIST.getFullYear();
    const month = Number(clean(req.query.month)) || (nowIST.getMonth() + 1);

    const summary = await visitModel.getMonthlySummary(userId, year, month);

    const isCurrentMonth = year === nowIST.getFullYear() && month === nowIST.getMonth() + 1;
    const daysElapsed = isCurrentMonth ? nowIST.getDate() : new Date(year, month, 0).getDate();
    const totalVisits = Number(summary.total_visits) || 0;

    return res.status(200).json({
      success: true,
      year, month,
      data: {
        total_visits: totalVisits,
        successful: Number(summary.successful) || 0,
        follow_ups: Number(summary.follow_ups) || 0,
        orders_from_visits: Number(summary.orders_from_visits) || 0,
        new_customers: Number(summary.new_customers) || 0,
        avg_visits_per_day: daysElapsed ? Number((totalVisits / daysElapsed).toFixed(1)) : 0
      }
    });
  } catch (err) {
    return res.status(500).json({ success: false, message: err.message });
  }
};

exports.getMyVisitDetailsById = async (req, res) => {
  try {
    const visitId = req.params.id;
    const isAdmin = ["ADMIN", "SUPER_ADMIN"].includes(req.user.role);

    const visit = isAdmin
      ? await visitModel.getVisitByIdAdmin(visitId)
      : await visitModel.getVisitByIdForUser(visitId, req.user.id);

    if (!visit) {
      return res.status(404).json({ success: false, message: "Visit not found" });
    }

    const data = {
      ...visit,
      image_url: visit.image_path ? await getPresignedUrl(visit.image_path) : null,
      shop_image_url: visit.shop_image_path ? await getPresignedUrl(visit.shop_image_path) : null,
      document_image_url: visit.document_image_path ? await getPresignedUrl(visit.document_image_path) : null
    };

    return res.status(200).json({ success: true, data });
  } catch (err) {
    return res.status(500).json({ success: false, message: err.message });
  }
};

// exports.getHierarchyVisits = async (req, res) => {
//   try {
//     const loginUserId = req.user.id;

//     const hierarchyIds = await getHierarchyIds(loginUserId);

//     const data = await visitModel.getHierarchyVisitSummary({
//       user_ids: hierarchyIds,
//       date: req.query.date,
//       level: req.query.level,
//       user_id: req.query.user_id
//     });

//     return res.status(200).json({
//       success: true,
//       data
//     });

//   } catch (error) {
//     return res.status(500).json({
//       success: false,
//       message: error.message
//     });
//   }
// };

// exports.getUserVisitDetails = async (req, res) => {
//   try {
//     const userId = req.params.userId;
//     const date = req.query.date;

//     const visits = await visitModel.getUserVisitDetails(userId, date);
//     const data = await Promise.all(
//       visits.map(async (visit) => ({
//         ...visit,
//         image_url: visit.image_path
//           ? await getPresignedUrl(visit.image_path)
//           : null
//       }))
//     );
//     return res.status(200).json({
//       success: true,
//       total_visits: visits.length,
//       data
//     });

//   } catch (error) {
//     return res.status(500).json({
//       success: false,
//       message: error.message
//     });
//   }
// };