const axios = require("axios");
const config = require("../config/whatsapp");

const BASE_URL = `https://graph.facebook.com/${config.apiVersion}/${config.phoneNumberId}/messages`;

const headers = {
    Authorization: `Bearer ${config.accessToken}`,
    "Content-Type": "application/json"
};

const sendTextMessage = async (to, body) => {
    try {

        const payload = {
            messaging_product: "whatsapp",
            recipient_type: "individual",
            to,
            type: "text",
            text: {
                preview_url: false,
                body
            }
        };

        const response = await axios.post(
            BASE_URL,
            payload,
            { headers }
        );

        return response.data;

    } catch (err) {

        console.error(err.response?.data || err.message);
        throw err;
    }
};

const sendTemplateMessage = async (
    to,
    templateName,
    language = "en_US",
    components = []
) => {

    try {

        const payload = {
            messaging_product: "whatsapp",
            to,
            type: "template",
            template: {
                name: templateName,
                language: {
                    code: language
                }
            }
        };

        if (components.length) {
            payload.template.components = components;
        }

        const response = await axios.post(
            BASE_URL,
            payload,
            { headers }
        );

        return response.data;

    } catch (err) {

        console.error(err.response?.data || err.message);
        throw err;
    }
};

module.exports = {
    sendTextMessage,
    sendTemplateMessage
};