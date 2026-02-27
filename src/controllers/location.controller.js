const Location = require("../models/location.model");

exports.saveLocation = async (req, res) => {
  try {
    const employee_id = req.user.id;
    const { attendance_id, latitude, longitude, accuracy, speed } = req.body;

    if (!latitude || !longitude) {
      return res
        .status(400)
        .json({ success: false, message: "Invalid coordinates" });
    }

    await Location.saveLocation({
      employee_id,
      attendance_id,
      latitude,
      longitude,
      accuracy,
      speed,
    });

    return res.status(200).json({ success: true, message: "Location saved" });
  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  }
};

exports.getEmployeeRoute = async (req, res) => {
  try {
    const { employeeId, date } = req.query;

     if (!date) {
      return res.status(400).json({
        success: false,
        message: "Date is required",
      });
    }

    const start = `${date} 00:00:00`;
    const end = `${date} 23:59:59`;

    const locations = await Location.getLocationsByDate(employeeId, start, end);

    return res.status(200).json({ success: true, data: locations });
  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  }
};
