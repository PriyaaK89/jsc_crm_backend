// routes/whatsappRoutes.js
const express = require("express");
const router = express.Router();

router.get("/webhook", (req, res) => {
    const mode = req.query["hub.mode"];
    const token = req.query["hub.verify_token"];
    const challenge = req.query["hub.challenge"];

    const VERIFY_TOKEN = process.env.WHATSAPP_VERIFY_TOKEN;

    console.log("Webhook verify hit:", mode, token, challenge);

    if (mode === "subscribe" && token === VERIFY_TOKEN) {
        console.log("WhatsApp webhook verified");
        return res.status(200).send(challenge);
    }

    return res.sendStatus(403);
});

module.exports = router;