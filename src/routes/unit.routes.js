const express = require("express");
const router = express.Router();
const unitController = require("../controllers/unit.controller");
const auth = require("../middleware/auth.middleware");

// CREATE
router.post( "/create-unitOfMeasure",auth, unitController.createUnit);

// GET ALL WITH PAGINATION + SEARCH
router.get( "/getAllUnits",auth, unitController.getAllUnits);

// GET BY ID
router.get( "/getUnitById/:id",auth, unitController.getUnitById);

// UPDATE
router.put( "/editUnitOfMeasure/:id",auth, unitController.updateUnit);

// DELETE
router.delete( "/deleteUnit/:id",auth,  unitController.deleteUnit);

// UQC LIST
router.get( "/get-unitOfMeasure-list", auth, unitController.getAllUQC);
router.get("/get-simple-units", auth, unitController.getSimpleUnits);

module.exports = router;