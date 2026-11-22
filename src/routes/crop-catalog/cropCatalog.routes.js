// /crop-catalog — season list, crops of a season, products (stock items) of a crop in a season.
// Reads: any logged-in user. Writes (season list): Admin / Super Admin / crop_manage (checked in the controller).
// The crop and its seasons are saved through the existing crop routes (/create-crops, /update-crops/:id).
const express = require("express");
const router = express.Router();
const auth = require("../../middleware/auth.middleware");
const c = require("../../controllers/crop-catalog/cropCatalog.controller");

router.use(auth);

router.get("/seasons", c.listSeasons);
router.post("/seasons", c.addSeason);
router.post("/seasons/:id/status", c.setSeasonStatus);

router.get("/crops", c.listCrops);
router.get("/products", c.listProducts);

module.exports = router;
