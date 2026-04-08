// digio.controller.js

const axios = require("axios");

const createDigilockerKYC = async (req, res) => {
  try {
    const { mobile } = req.body;
    if (!mobile) {
  return res.status(400).json({
    success: false,
    message: "Mobile number is required"
  });
}

    const response = await axios.post(
      `${process.env.DIGIO_BASE_URL}/client/kyc/v2/request/with_template`,
      {
        customer_identifier: mobile, // mobile or email
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

    const response = await axios.post(                          // ← POST
      `${process.env.DIGIO_BASE_URL}/client/kyc/v2/${requestId}/response`,
      {},                                                        // ← empty body
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

    const data = response.data;
    const actions = data.actions || [];
    const digilockerAction = actions.find(a => a.type === "digilocker") || actions[0] || {};
    const aadhaarDetails = digilockerAction?.details?.aadhaar || {};
    const addressDetails = aadhaarDetails?.current_address_details || 
                           aadhaarDetails?.permanent_address_details || {};

    // processing_done is the real completion flag from Digio
    // const isCompleted = digilockerAction?.processing_done === true;
    const isCompleted = digilockerAction?.processing_done === true || 
                    !!(aadhaarDetails?.name && aadhaarDetails?.dob);

    return res.status(200).json({
      success: true,
      data: {
        id: data.id,
        status: data.status,
        is_completed: isCompleted, 
                                     // ← send this to Flutter
        customer_identifier: data.customer_identifier,
        aadhaar: {
          name:         aadhaarDetails.name          || "",
          dob:          aadhaarDetails.dob           || "",
          gender:       aadhaarDetails.gender        || "",
          father_name:  aadhaarDetails.father_name   || "",
          id_number:    aadhaarDetails.id_number     || "",
          address:      aadhaarDetails.current_address || 
                        aadhaarDetails.permanent_address || "",
          pincode:      addressDetails.pincode        || "",
          state:        addressDetails.state          || "",
          district:     addressDetails.district_or_city || "",
          locality:     addressDetails.locality_or_post_office || "",
        }
      }
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