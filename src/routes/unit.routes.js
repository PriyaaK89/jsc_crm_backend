const express = require("express");
const router = express.Router();
const { checkAnyPermission, checkPermission } = require("../middleware/permission.middleware");
const unitController = require("../controllers/unit.controller");
const auth = require("../middleware/auth.middleware");

// CREATE
router.post( "/create-unitOfMeasure", auth, checkPermission("CREATE_UNIT"), unitController.createUnit);

// GET ALL WITH PAGINATION + SEARCH
router.get( "/getAllUnits",auth, unitController.getAllUnits);

// GET BY ID
router.get( "/getUnitById/:id", auth, checkAnyPermission(["VIEW_UNIT", "UPDATE_UNIT"]), unitController.getUnitById);

// UPDATE
router.put( "/editUnitOfMeasure/:id", auth, checkPermission("UPDATE_UNIT"), unitController.updateUnit);

// DELETE
router.delete( "/deleteUnit/:id", auth, checkPermission("DELETE_UNIT"), unitController.deleteUnit);

// UQC LIST
router.get( "/get-unitOfMeasure-list", auth, unitController.getAllUQC);
router.get("/get-simple-units", auth, unitController.getSimpleUnits);

module.exports = router;