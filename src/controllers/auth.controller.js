const db = require("../config/db");
const bcrypt = require("bcryptjs");
const jwt = require("jsonwebtoken");
const User = require("../models/user.model");
const Role = require("../models/role.model");
const UserDocument = require("../models/userDocument.model")
const UserIp = require("../models/UserIp.model");
const { sendUserRegisteredMail, sendIpApprovedMail  } = require("../utils/mail.util");

exports.registerAdmin = async (req, res) => {
  try {
    const { name, email, password } = req.body;
    const hashedPassword = await bcrypt.hash(password, 10);
    const roleId = await Role.getRoleIdByName("ADMIN");

    if (!roleId) {
      return res.status(400).json({ message: "Role not found" });
    }

    await User.createUser({
      name,
      email,
      password: hashedPassword,
      role_id: roleId
    });

    res.json({ message: "Admin created successfully" });

  } catch (err) {
    res.status(500).json({ error: err.message });
  }
};


exports.createUserByRole = async (req, res) => {
  try {
    const {
      name, gender, contact_no, date_of_birth, email,
      address_line1, address_line2, country, state, city, district, area,
      pincode, father_name, pan_number, aadhar_no, blood_group,
      department_id, job_role_id, date_of_joining, salary,
      attendance_selfie, travelling_allowance_per_km, avg_travel_km_per_day, 
      city_allowance_per_km, daily_allowance_with_doc, daily_allowance_without_doc,
      hotel_allowance, total_leaves, authentication_amount, headquarter,
      approver_name, login_time, logout_time, pf, esi
    } = req.body;

    const roleName = req.body.roleName;
    if (!roleName) {
      return res.status(400).json({ message: "Role not assigned" });
    }

    const roleId = await Role.getRoleIdByName(roleName);
    if (!roleId) {
      return res.status(400).json({ message: "Role not found" });
    }

    const createdUser = await User.createUser({
      name, email, role_id: roleId, gender, contact_no, date_of_birth,
      address_line1, address_line2, country, state, city, district,
      area, pincode, father_name, pan_number, aadhar_no, blood_group, department_id, job_role_id, 
      date_of_joining, salary, attendance_selfie, travelling_allowance_per_km, avg_travel_km_per_day, city_allowance_per_km, daily_allowance_with_doc,
      daily_allowance_without_doc, hotel_allowance, total_leaves, authentication_amount, headquarter, approver_name, login_time, logout_time, pf, esi
    });

    await UserDocument.createEmptyRow(createdUser.id, name);

    await sendUserRegisteredMail(email, name);

    res.status(201).json({
      message: `${roleName} created. Password must be set by admin.`,
      id: createdUser.id,
      email: email,
       must_change_password: 1
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
};

exports.getUserById = async (req, res) => {
  try {
    const { id } = req.params;

    const user = await User.getUserById(id);

    if (!user) {
      return res.status(404).json({ message: "User not found" });
    }

    res.status(200).json({
      success: true,
      data: user
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
};


const getClientIp = (req) => {
  return (
    req.headers['x-forwarded-for']?.split(',')[0] ||
    req.connection.remoteAddress ||
    req.socket.remoteAddress ||
    req.ip
  );
};

exports.login = async (req, res) => {
  const { email, password } = req.body;
  const user = await User.findUserByEmail(email);
  if (!user) return res.status(401).json({ message: "Invalid credentials" });
  if (user.is_active === 0) {
  return res.status(403).json({
    message: "Your account is deactivated. Please contact admin."
  });
}

  const isMatch = await bcrypt.compare(password, user.password);
  if (!isMatch) return res.status(401).json({ message: "Invalid credentials" });

  const ipAddress = getClientIp(req);

  if (user.role === "ADMIN" || user.role === "SUPER_ADMIN") {
  const token = jwt.sign(
    { id: user.id, role: user.role, ip: ipAddress },
    process.env.JWT_SECRET,
    { expiresIn: "1d" }
  );

  return res.json({
    token,
    user: { id: user.id, name: user.name, role: user.role, ip: ipAddress }
  });
}

  let ipRecord = await UserIp.getByUserIdAndIp(user.id, ipAddress);

  if (!ipRecord) {
    const anyIpExists = await UserIp.getAnyIpForUser(user.id);

    if (!anyIpExists) {
      await UserIp.createIp(user.id, ipAddress, 1); // auto allow first login
    } else {
      await UserIp.createIp(user.id, ipAddress, 0); // request approval
      return res.status(403).json({
        message: "This IP is not allowed. Request sent to admin for approval."
      });
    }
  } else if (ipRecord.is_allowed === 0) {
    return res.status(403).json({
      message: "This IP is pending admin approval."
    });
  }

  const token = jwt.sign(
    { id: user.id, role: user.role, ip: ipAddress },
    process.env.JWT_SECRET,
    { expiresIn: "1d" }
  );

  res.json({
    token,
    user: { id: user.id, name: user.name, role: user.role, ip: ipAddress }
  });
};

exports.getPendingIpRequests = async (req, res) => {
  try {
    const requests = await UserIp.getPendingRequests();
    res.json(requests);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
};
exports.approveIpRequest = async (req, res) => {
  try {
    const { ipId } = req.params;

    const adminId = req.user.id;

    const approvedIpData = await UserIp.approveIp(ipId, adminId);

    if (!approvedIpData) {
      return res.status(404).json({ error: "IP request not found" });
    }

    const user = await UserIp.findById(approvedIpData.user_id);

    if (!user) {
      return res.status(404).json({ error: "User not found" });
    }

    await sendIpApprovedMail(
      user.email,
      user.name,
      approvedIpData.ip_address
    );

    res.json({
      message: "IP approved successfully and notification email sent"
    });

  } catch (err) {
    res.status(500).json({ error: err.message });
  }
};

exports.getUsersList = async (req, res) => {
  try {
    const {
      search = "",
      page = 1,
      limit = 10
    } = req.query;

    const result = await User.getAllUsers({
      search,
      page: Number(page),
      limit: Number(limit)
    });

    res.status(200).json({
      success: true,
      data: result.users,
      pagination: {
        total: result.total,
        page: Number(page),
        limit: Number(limit),
        totalPages: Math.ceil(result.total / limit)
      }
    });

  } catch (err) {
    res.status(500).json({ error: err.message });
  }
};

exports.updateUserById = async (req, res) => {
  try {
    const userId = req.params.id;

    const {
      name,
      gender,
      contact_no,
      date_of_birth,
      email,
      address_line1,
      address_line2,
      country,
      state,
      city,
      district,
      area,
      pincode,

      father_name,
      pan_number,
      aadhar_no,
      blood_group,

      department_id,
      job_role_id,
      date_of_joining,
      salary,
      
      week_off,
      attendance_selfie,
      travelling_allowance_per_km,
      avg_travel_km_per_day,
      city_allowance_per_km,
      daily_allowance_with_doc,
      daily_allowance_without_doc,
      hotel_allowance,
      total_leaves,
      authentication_amount,
      headquarter,
      login_time,
      logout_time,
      pf,
      esi,

      approver_name,
      role_id
    } = req.body;
    
 if (job_role_id !== undefined && job_role_id !== null) {
      const [jobRole] = await db.query(
        "SELECT id FROM job_roles WHERE id = ?",
        [job_role_id]
      );

      if (jobRole.length === 0) {
        return res.status(400).json({
          success: false,
          message: "Invalid job_role_id. Job role does not exist."
        });
      }
    }
    const updated = await User.updateUserById(userId, {
      name,
      gender,
      contact_no,
      date_of_birth,
      email,
      address_line1,
      address_line2,
      country,
      state,
      city,
      district,
      area,
      pincode,

      father_name,
      pan_number,
      aadhar_no,
      blood_group,

      department_id,
      job_role_id,
      date_of_joining,
      salary,

      week_off,
      attendance_selfie,
      travelling_allowance_per_km,
      avg_travel_km_per_day,
      city_allowance_per_km,
      daily_allowance_with_doc,
      daily_allowance_without_doc,
      hotel_allowance,
      total_leaves,
      authentication_amount,
      headquarter,
      login_time,
      logout_time,
      pf,
      esi,

      approver_name,
      role_id
    });

    if (!updated) {
      return res.status(404).json({
        message: "User not found or no data to update"
      });
    }

    res.status(200).json({
      success: true,
      message: "User updated successfully"
    });

  }catch (err) {
  if (err.code === "ER_NO_REFERENCED_ROW_2") {
    return res.status(400).json({
      success: false,
      message: "Invalid reference ID provided."
    });
  }

  res.status(500).json({
    error: err.message
  });
}
};

exports.setUserPassword = async (req, res) => {
  const { password } = req.body;
  const userId = req.params.userId;

  const hashedPassword = await bcrypt.hash(password, 10);

  await User.updatePasswordByAdmin(userId, hashedPassword);

  res.json({ message: "Password set successfully" });
};

exports.updateUserStatusByAction = async (req, res) => {
  try {
    const { action } = req.params;
    const { userId } = req.body;

    if (!userId) {
      return res.status(400).json({ message: "userId is required" });
    }

    let is_active;

    if (action === "activate") {
      is_active = 1;
    } else if (action === "deactivate") {
      is_active = 0;
    } else {
      return res.status(400).json({
        message: "Invalid action. Use activate or deactivate"
      });
    }

    const updated = await User.updateUserStatus(userId, is_active);

    if (!updated) {
      return res.status(404).json({ message: "User not found" });
    }

    res.json({
      success: true,
      message: `User ${action}d successfully`
    });

  } catch (err) {
    res.status(500).json({ error: err.message });
  }
};


exports.deleteUserById = async (req, res) => {
  try {
    const userId = req.params.id;

    const deleted = await User.softDeleteUser(userId);

    if (!deleted) {
      return res.status(404).json({ message: "User not found" });
    }

    res.json({
      success: true,
      message: "User deleted successfully"
    });

  } catch (err) {
    res.status(500).json({ error: err.message });
  }
};

exports.getDeletedUsers = async (req, res) => {
  try {
    const users = await User.getDeletedUsers();

    res.json({
      success: true,
      data: users
    });

  } catch (err) {
    res.status(500).json({ error: err.message });
  }
};


