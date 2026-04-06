const axios = require("axios");
const { v4: uuidv4 } = require("uuid");

exports.verifyPAN = async (req, res) => {
  try {
    const { pan_number } = req.body;

    if (!pan_number) {
      return res.status(400).json({ message: "PAN is required" });
    }

    const unique_request_id = uuidv4();

    const response = await axios.post(
      `${process.env.DIGIO_BASE_URL}/v3/client/kyc/fetch_id_data/PAN`,
      {
        id_no: pan_number,
        unique_request_id,
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

    const isVerified =
      data.status === "VALID" &&
      data.name_as_per_pan_match === "true";

    return res.json({
      success: true,
      verified: isVerified,
      data,
    });
  } catch (error) {
    return res.status(500).json({
      success: false,
      message: "PAN verification failed",
      error: error.response?.data || error.message,
    });
  }
};