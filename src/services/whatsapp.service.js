const axios = require("axios");
const FormData = require("form-data"); // npm i form-data
const config = require("../config/whatsapp");

const BASE_URL = `https://graph.facebook.com/${config.apiVersion}/${config.phoneNumberId}/messages`;
const MEDIA_URL = `https://graph.facebook.com/${config.apiVersion}/${config.phoneNumberId}/media`;

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

        const response = await axios.post( BASE_URL, payload, { headers } );
        return response.data;

    } catch (err) {
        console.error(err.response?.data || err.message);
        throw err;
    }
};

const sendTemplateMessage = async ( to, templateName, language = "en_US", components = [] ) => {
    try {
        const payload = {
            messaging_product: "whatsapp",
            to,
            type: "template",
            template: {
                name: templateName,
                language: { code: language }
            }
        };

        if (components.length) {
            payload.template.components = components;
        }

        const response = await axios.post(BASE_URL, payload, { headers });
        return response.data;
    } catch (err) {
        console.error(err.response?.data || err.message);
        throw err;
    }
};

/**
 * Uploads a file buffer (e.g. req.files.bill_t_image[0].buffer) to WhatsApp
 * and returns a media_id usable in a template header parameter.
 */
const uploadMedia = async (buffer, mimeType, filename = "upload") => {
    try {
        const form = new FormData();
        form.append("messaging_product", "whatsapp");
        form.append("file", buffer, { filename, contentType: mimeType });
        form.append("type", mimeType);

        const response = await axios.post(MEDIA_URL, form, {
            headers: {
                Authorization: `Bearer ${config.accessToken}`,
                ...form.getHeaders()
            }
        });

        return response.data.id; // media_id
    } catch (err) {
        console.error(err.response?.data || err.message);
        throw err;
    }
};

module.exports = { sendTextMessage, sendTemplateMessage, uploadMedia };