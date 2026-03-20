const axios = require("axios");

exports.checkPanStatus = async (pan, dob) => {

  const auth = Buffer.from(
    `${process.env.DIGIO_CLIENT_ID}:${process.env.DIGIO_CLIENT_SECRET}`
  ).toString("base64");

  const response = await axios.post(
    `${process.env.DIGIO_BASE_URL}/v3/client/kyc/kra/v2/get_pan_status`,
    {
      pan_no: pan,
      dob: dob,
      fetch_type: "I",
      service_provider: "NDML",
      unique_request_id: `pan_${Date.now()}`
    },
    {
      headers: {
        Authorization: `Basic ${auth}`,
        "Content-Type": "application/json",
        X_REFERENCE_ID: `ref_${Date.now()}`
      }
    }
  );

  return response.data;
};