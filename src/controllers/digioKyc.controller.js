// digio.controller.js

const axios = require("axios");

const createDigilockerKYC = async (req, res) => {
  try {
    const { mobile, name } = req.body;

    const response = await axios.post(
      `${process.env.DIGIO_BASE_URL}/client/kyc/v2/request/with_template`,
      {
        customer_identifier: mobile, // mobile or email
        customer_name: name,
        template_name: "DIGILOCKER_AADHAAR_PAN",
        notify_customer: true,
        generate_access_token: true,
        reference_id: `REF_${Date.now()}`,
        transaction_id: `TXN_${Date.now()}`,
        expire_in_days: 10
      },
      {
        auth: {
          username: process.env.DIGIO_CLIENT_ID,
          password: process.env.DIGIO_CLIENT_SECRET
        },
        headers: {
          "Content-Type": "application/json"
        }
      }
    );

    return res.status(200).json({
      success: true,
      message: "KYC request created",
      data: response.data
    });

  } catch (error) {
    console.error("Digio Error:", error.response?.data || error.message);

    return res.status(500).json({
      success: false,
      message: "Failed to create KYC request",
      error: error.response?.data || error.message
    });
  }
};

const getKycStatus = async (req, res) => {
  try {
    const { requestId } = req.params;

    const response = await axios.get(
      `${process.env.DIGIO_BASE_URL}/client/kyc/v2/${requestId}`,
      {
        auth: {
          username: process.env.DIGIO_CLIENT_ID,
          password: process.env.DIGIO_CLIENT_SECRET
        }
      }
    );

    return res.status(200).json({
      success: true,
      data: response.data
    });

  } catch (error) {
    console.error("Error:", error.response?.data || error.message);

    return res.status(500).json({
      success: false,
      error: error.response?.data || error.message
    });
  }
};


module.exports = { createDigilockerKYC, getKycStatus };