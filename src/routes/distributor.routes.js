const express = require("express");
const router = express.Router();
const controller = require("../controllers/distributor.controller");
const upload = require("../middleware/upload.middleware");

// dynamic file fields
const uploadFields = [
  { name: "shop_image" },
  { name: "cheque_photo" },
  { name: "pan_photo" },
  { name: "aadhar_photo" },
  { name: "gst_file" },
  { name: "seed_license" },
  { name: "fertilizer_license" },
  { name: "pesticide_license" },
  { name: "bank_diary" },
  { name: "letter_head" },
  { name: "authority_letter" },
  { name: "partnership_deed" },
  { name: "approver_image" },

  // partner photos (max 5 partners example)
  { name: "partner_photo_0" },
  { name: "partner_photo_1" },
  { name: "partner_photo_2" },
  { name: "partner_photo_3" },
  { name: "partner_photo_4" },
];

router.post(
  "/create-distributor",
  upload.fields(uploadFields),
  controller.createDistributor
);

module.exports = router;