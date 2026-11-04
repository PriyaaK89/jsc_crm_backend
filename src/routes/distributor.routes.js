const express = require("express");
const router = express.Router();
const { checkAnyPermission, checkPermission } = require("../middleware/permission.middleware");
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

router.post( "/create-distributor", auth, checkPermission("CREATE_DISTRIBUTOR"), upload.fields(uploadFields), controller.createDistributor);
router.get("/get-distributor/:id", auth, checkAnyPermission(["VIEW_DISTRIBUTOR", "UPDATE_DISTRIBUTOR"]), controller.getDistributor);
router.put(
  "/update-distributor/:id", auth, checkPermission("UPDATE_DISTRIBUTOR"),
  upload.fields(uploadFields),
  controller.updateDistributor
);
router.get("/get-distributorsList", auth, checkPermission("VIEW_DISTRIBUTOR"), controller.getAllDistributors);
router.delete( "/delete-distributor/:id", auth, checkPermission("DELETE_DISTRIBUTOR"), controller.deleteDistributor);
router.post("/upload-agreement", auth, checkPermission("UPDATE_DISTRIBUTOR"), upload.single("file"), controller.uploadAgreement);

router.get("/get-distributor-agreement/:distributor_id", auth, controller.getDistributorDocument)

module.exports = router;