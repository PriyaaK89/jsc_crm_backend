// scripts/registerWhatsappNumber.js
const axios = require("axios");
const config = require("../config/whatsapp");

console.log(config.apiVersion, "config")

const registerNumber = async () => {
  const url = `https://graph.facebook.com/${config.apiVersion}/${config.phoneNumberId}/register`;
console.log("Calling URL:", url)
  try {
    const response = await axios.post(
      url,
      {
        messaging_product: "whatsapp",
        pin: "654456", // choose your own 6-digit PIN, keep it saved
      },
      {
        headers: {
          Authorization: `Bearer ${config.accessToken}`,
          "Content-Type": "application/json",
        },
      }
    );
    console.log("Registration success:", response.data);
  } catch (err) {
    console.error("Registration failed:", err.response?.data || err.message);
  }
};

registerNumber();