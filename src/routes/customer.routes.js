const express = require("express");
const router = express.Router();
const ctrl = require("../controllers/customer.controller");
const auth = require('../middleware/auth.middleware');

router.get("/getCustomers",auth, ctrl.getCustomersByType);
router.get("/get_customer_details/:id",auth, ctrl.getCustomerById);
router.get("/retailers-by-distributor", auth, ctrl.getRetailersByDistributor);
 
router.get("/assigned-distributors", auth, ctrl.getAssignedDistributors);
router.get("/farmers-by-retailer", auth, ctrl.getFarmersByRetailer);
router.get("/unmapped-farmers", auth, ctrl.getUnmappedFarmers);
router.patch("/update-customer-mapping/:id", auth, ctrl.updateCustomerMapping);
router.get("/get-customer-mapping/:id", auth, ctrl.getCustomerMapping);

router.get("/get-customer-links/:id", auth, ctrl.getCustomerLinks);
router.post("/add-customer-links/:id", auth, ctrl.addCustomerLink);
router.delete("/remove-customer-links/:id", auth, ctrl.removeCustomerLink);

router.get("/get-distributor-links/:ledgerId", auth, ctrl.getDistributorLinks);
router.get("/get-distributor-candidates/:ledgerId", auth, ctrl.getDistributorCandidates);
router.post("/add-distributor-links/:ledgerId", auth, ctrl.addDistributorLinks);
router.delete("/remove-distributor-links/:ledgerId", auth, ctrl.removeDistributorLink);

router.get("/get-farmer-candidates/:retailerId", auth, ctrl.getFarmerCandidatesForRetailer);
router.post("/add-farmers-to-retailer/:retailerId", auth, ctrl.addFarmersToRetailer);
router.delete("/remove-farmers-from-retailer/:retailerId", auth, ctrl.removeFarmerFromRetailer);
 
module.exports = router;