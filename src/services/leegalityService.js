const axios = require("axios");

const BASE_URL = process.env.LEEGALITY_BASE_URL;
const AUTH_TOKEN = process.env.LEEGALITY_AUTH_TOKEN;

const headers = {
  Authorization: `Bearer ${AUTH_TOKEN}`,
  "Content-Type": "application/json"
};

exports.sendForESign = async (pdfBase64, employee) => {
  const res = await axios.post(
    `${BASE_URL}/sign/request`,
    {
      file: {
        name: `Offer_Letter_${employee.name}.pdf`,
        file: pdfBase64
      },
      invitees: [
        {
          name: employee.name,
          email: employee.email,
          phone: employee.phone
        }
      ]
    },
    { headers }
  );

  return res.data.data;
};