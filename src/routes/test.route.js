const express = require("express");
const router = express.Router();

const whatsapp = require("../services/whatsapp.service");

router.get("/test-template", async (req, res) => {

    try {

        const response = await whatsapp.sendTemplateMessage(
            "919636843365",
            "jaspers_market_plain_text_v1"
        );

        res.json(response);

    } catch (err) {

        res.status(500).json(err.response?.data || err.message);

    }

});

module.exports = router;