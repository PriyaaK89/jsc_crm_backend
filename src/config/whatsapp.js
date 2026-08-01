require("dotenv").config();

console.log("Access Token:", process.env.WHATSAPP_ACCESS_TOKEN?.substring(0, 20));
console.log("Phone Number ID:", process.env.WHATSAPP_PHONE_NUMBER_ID);
console.log("API Version:", process.env.WHATSAPP_API_VERSION);


module.exports = {
    apiVersion: process.env.WHATSAPP_API_VERSION,
    phoneNumberId: process.env.WHATSAPP_PHONE_NUMBER_ID,
    accessToken: process.env.WHATSAPP_ACCESS_TOKEN,
    businessAccountId: process.env.WHATSAPP_BUSINESS_ACCOUNT_ID
};