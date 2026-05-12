const express = require("express");

const router = express.Router();

const unitController = require("../controllers/unit.controller");

// CREATE
router.post( "/create-unitOfMeasure", unitController.createUnit);

// GET ALL WITH PAGINATION + SEARCH
router.get( "/getAllUnits", unitController.getAllUnits);

// GET BY ID
router.get( "/getUnitById/:id", unitController.getUnitById);

// UPDATE
router.put( "/editUnitOfMeasure/:id", unitController.updateUnit);

// DELETE
router.delete( "/deleteUnit/:id",  unitController.deleteUnit);

// UQC LIST
router.get( "/get-unitOfMeasure-list", unitController.getAllUQC);
router.get("/get-simple-units", unitController.getSimpleUnits);

module.exports = router;