const axios = require("axios");
const { v4: uuidv4 } = require("uuid");

exports.verifyGST = async (req, res) => {
  try {
    const { gst_number, name } = req.body;

    if (!gst_number) {
      return res.status(400).json({ message: "GST number is required" });
    }

    // GST format validation
    const gstRegex = /^[0-9]{2}[A-Z]{5}[0-9]{4}[A-Z]{1}[1-9A-Z]{1}Z[0-9A-Z]{1}$/;
    if (!gstRegex.test(gst_number)) {
      return res.status(400).json({
        success: false,
        message: "Invalid GST format"
      });
    }

    const unique_request_id = uuidv4();

    const response = await axios.post(
      `${process.env.DIGIO_BASE_URL}/v3/client/kyc/fetch_id_data/GST`,
      {
        id_no: gst_number,
        // name: name || "",
        // unique_request_id,
      },
      {
        auth: {
          username: process.env.DIGIO_CLIENT_ID,
          password: process.env.DIGIO_CLIENT_SECRET,
        },
        headers: {
          "Content-Type": "application/json",
        },
      }
    );

    const data = response.data;

    if (!data.details) {
      return res.status(400).json({
        success: false,
        message: "Invalid GST or no data found",
      });
    }

    const gstDetails = data.details;

    return res.status(200).json({
      success: true,
      isVerified: gstDetails.sts?.toLowerCase() === "active",

      gst_number: gstDetails.gstin,
      business_name: gstDetails.trade_nam,
      legal_name: gstDetails.lgnm,

      status: gstDetails.sts,

      address: {
        building: gstDetails.pradr?.addr?.bno,
        street: gstDetails.pradr?.addr?.st,
        location: gstDetails.pradr?.addr?.loc,
        district: gstDetails.pradr?.addr?.dst,
        state: gstDetails.pradr?.addr?.stcd,
        pincode: gstDetails.pradr?.addr?.pncd,
      },

      business_type: gstDetails.ctb,
      reg_date: gstDetails.rgdt,
      activities: gstDetails.nba,
      last_updated: gstDetails.lstupdt,
    });

  } catch (error) {
    console.error("GST Verification Error:", error.response?.data || error.message);

    return res.status(500).json({
      success: false,
      message: "GST verification failed",
      error: error.response?.data || error.message,
    });
  }
};