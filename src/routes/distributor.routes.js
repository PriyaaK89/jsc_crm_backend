const express = require("express");
const router = express.Router();
const controller = require("../controllers/distributor.controller");
const upload = require("../middleware/upload.middleware");
const auth = require("../middleware/auth.middleware");

// UPDATED FILE FIELDS (IMPORTANT )
const uploadFields = [
  { name: "shop_image", maxCount: 4 },        // 4 images
  { name: "cheque_photo", maxCount: 2 },      // 2 images

  { name: "aadhar_front", maxCount: 1 },      // front
  { name: "aadhar_back", maxCount: 1 },       // back

  { name: "pan_photo", maxCount: 1 },
  { name: "gst_file", maxCount: 1 },
  { name: "seed_license", maxCount: 1 },
  { name: "fertilizer_license", maxCount: 1 },
  { name: "pesticide_license", maxCount: 1 },
  { name: "bank_diary", maxCount: 1 },
  { name: "letter_head", maxCount: 1 },
  { name: "authority_letter", maxCount: 1 },
  { name: "partnership_deed", maxCount: 1 },

  { name: "approver_image", maxCount: 1 },
  { name: "owner_photo", maxCount: 1 },

  // partner photos (max 5 partners)
  { name: "partner_photo_0", maxCount: 1 },
  { name: "partner_photo_1", maxCount: 1 },
  { name: "partner_photo_2", maxCount: 1 },
  { name: "partner_photo_3", maxCount: 1 },
  { name: "partner_photo_4", maxCount: 1 },
];

router.post( "/create-distributor", auth, upload.fields(uploadFields), controller.createDistributor);
router.get("/get-distributor/:id", auth, controller.getDistributor);
router.put("/update-distributor/:id", auth, controller.updateDistributor);
router.get("/get-distributorsList", auth, controller.getAllDistributors);

module.exports = router;