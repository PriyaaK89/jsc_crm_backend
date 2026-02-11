const bcrypt = require("bcryptjs");
const jwt = require("jsonwebtoken");
const User = require("../models/user.model");
const Role = require("../models/role.model");
const UserDocument = require("../models/userDocument.model")
const UserIp = require("../models/UserIp.model");
const { sendUserRegisteredMail } = require("../utils/mail.util");


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
      approver_name,
      login_time,
      logout_time,
      pf,
      esi
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
      name,
      email,
      role_id: roleId,
      gender,
      contact_no,
      date_of_birth,
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
      approver_name,
      login_time,
      logout_time,
      pf,
      esi
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


// exports.createUserByRole = async (req, res) => {
//   try {
//     const {
//       name,
//       gender,
//       contact_no,
//       date_of_birth,
//       email,
//       password,

//       address_line1,
//       address_line2,
//       country,
//       state,
//       city,
//       district,
//       pincode,

//       father_name,
//       pan_number,
//       aadhar_no,
//       blood_group,

//       department_id,
//       job_role_id,
//       date_of_joining,
//       salary,

//       attendance_selfie,
//       travelling_allowance_per_km,
//       avg_travel_km_per_day,
//       city_allowance_per_km,
//       daily_allowance_with_doc,
//       daily_allowance_without_doc,
//       hotel_allowance,
//       attendance_time,
//       total_leaves,
//       authentication_amount,
//       headquarter,
//       approver_name,
//       login_time,
//       logout_time,
//       pf,
//       esi
//     } = req.body;

//     const roleName = req.body.roleName;

//     if (!roleName) {
//       return res.status(400).json({ message: "Role not assigned by system" });
//     }

//     const hashedPassword = await bcrypt.hash(password, 10);
//     const roleId = await Role.getRoleIdByName(roleName);
//     if (!roleId) { return res.status(400).json({ message: "Role not found in DB" });}

//     const createdUser = await User.createUser({
//       name, gender, contact_no, date_of_birth, email, password: hashedPassword, role_id: roleId, address_line1, address_line2,
//       country, state, city, district, pincode, father_name, pan_number, aadhar_no, blood_group, department_id, job_role_id, date_of_joining, salary,
//       attendance_selfie, travelling_allowance_per_km, avg_travel_km_per_day, city_allowance_per_km, daily_allowance_with_doc, daily_allowance_without_doc, hotel_allowance, attendance_time, total_leaves, authentication_amount, headquarter, approver_name, login_time, logout_time, pf, esi
//     });

//     await UserDocument.createEmptyRow(createdUser.id, name);

//     res.status(201).json({
//       message: `${roleName} created successfully`,
//       id: createdUser.id
//     });

//   } catch (err) {
//     res.status(500).json({ error: err.message });
//   }
// };

// exports.createUserByRole = async (req, res) => {
//   try {
//     const {
//       name, gender, contact_no, date_of_birth, email,
//       address_line1, address_line2, country, state, city, district, pincode,
//       father_name, pan_number, aadhar_no, blood_group,
//       department_id, job_role_id, date_of_joining, salary,
//       attendance_selfie, travelling_allowance_per_km, avg_travel_km_per_day,
//       city_allowance_per_km, daily_allowance_with_doc,
//       daily_allowance_without_doc, hotel_allowance,
//       total_leaves, authentication_amount, headquarter,
//       approver_name, login_time, logout_time, pf, esi
//     } = req.body;

//     const roleName = req.body.roleName;
//     if (!roleName) {
//       return res.status(400).json({ message: "Role not assigned" });
//     }

//     const roleId = await Role.getRoleIdByName(roleName);
//     if (!roleId) {
//       return res.status(400).json({ message: "Role not found" });
//     }

//     //  Generate & hash password
//     const tempPassword = generateTempPassword();
//     const hashedPassword = await bcrypt.hash(tempPassword, 10);

//     const createdUser = await User.createUser({
//       name,
//       email,
//       password: hashedPassword,
//       role_id: roleId,
//       must_change_password: 1,
//       gender,
//       contact_no,
//       date_of_birth,
//       address_line1,
//       address_line2,
//       country,
//       state,
//       city,
//       district,
//       pincode,
//       father_name,
//       pan_number,
//       aadhar_no,
//       blood_group,
//       department_id,
//       job_role_id,
//       date_of_joining,
//       salary,
//       attendance_selfie,
//       travelling_allowance_per_km,
//       avg_travel_km_per_day,
//       city_allowance_per_km,
//       daily_allowance_with_doc,
//       daily_allowance_without_doc,
//       hotel_allowance,
//       total_leaves,
//       authentication_amount,
//       headquarter,
//       approver_name,
//       login_time,
//       logout_time,
//       pf,
//       esi
//     });

//     await UserDocument.createEmptyRow(createdUser.id, name);

//     //  Send email
//     await sendCredentialsMail(email, tempPassword);

//     res.status(201).json({
//       message: `${roleName} created and credentials sent`,
//       id: createdUser.id
//     });

//   } catch (err) {
//     res.status(500).json({ error: err.message });
//   }
// };

// exports.createUserByRole = async (req, res) => {
//   try {
//     const {
//       name, gender, contact_no, date_of_birth, email, password,
//       address_line1, address_line2, country, state, city, district, pincode,
//       father_name, pan_number, aadhar_no, blood_group,
//       department_id, job_role_id, date_of_joining, salary, travelling_allowance,
//       attendance_timing, approver_name
//     } = req.body;

//     // roleName MUST come from middleware
//     const roleName = req.body.roleName;
//     if (!roleName) {
//       return res.status(400).json({ message: "Role not assigned by system" });
//     }

//     const hashedPassword = await bcrypt.hash(password, 10);

//     const roleId = await Role.getRoleIdByName(roleName);
//     if (!roleId) {
//       return res.status(400).json({ message: "Role not found in DB" });
//     }

//     const createdUser = await User.createUser({
//       name,
//       gender,
//       contact_no,
//       date_of_birth,
//       email,
//       password: hashedPassword,
//       role_id: roleId,
//       address_line1,
//       address_line2,
//       country,
//       state,
//       city,
//       district,
//       pincode,
//       father_name,
//       pan_number,
//       aadhar_no,
//       blood_group,
//       department_id,
//       job_role_id,
//       date_of_joining,
//       salary,
//       travelling_allowance,
//       attendance_timing,
//       approver_name
//     });

//     await UserDocument.createEmptyRow(
//       createdUser.id,
//       name
//     );

//     res.status(201).json({
//       message: `${roleName} created successfully`,
//       id: createdUser.id
//     });

//   } catch (err) {
//     res.status(500).json({ error: err.message });
//   }
// };


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

    await UserIp.approveIp(ipId, adminId);

    res.json({
      message: "IP approved successfully"
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

  } catch (err) {
    console.error(err);
    res.status(500).json({ error: err.message });
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


