const Pincode = require("../models/pincode.model")

exports.getByPincode = async (req, res) => {
  try {
    const { pincode } = req.params;

    const data = await Pincode.searchPincode(pincode);

    if (data.length === 0) {
      return res.status(404).json({ message: "Pincode not found" });
    }

    const record = data[0];

    return res.status(200).json({
      success: true,
      data: {
        city: record.district,
        district: record.district,
        state: record.statename,
        pincode: record.pincode
      }
    });

  } catch (error) {
    return res.status(500).json({ message: "Server error" });
  }
};

// Search by district
exports.getByDistrict = async (req, res) => {
  try {
    const { district } = req.query;

    if (!district) return res.status(400).json({ message: "District is required" });

    const data = await Pincode.searchByDistrict(district);

    return res.status(200).json({ success: true, data });
  } catch (error) {
    console.log(error);
    return res.status(500).json({ message: "Server error" });
  }
};

exports.getAreasByPincode = async (req, res) => {
  try {
    const { pincode } = req.query;

    if (!pincode) {
      return res.status(400).json({
        message: "Pincode is required"
      });
    }

    const data = await Pincode.getAreasByPincode(pincode);

    return res.status(200).json({
      success: true,
      data
    });

  } catch (error) {
    console.error("getAreasByPincode error:", error);
    return res.status(500).json({
      message: "Server error",
      error: error.message
    });
  }
};
