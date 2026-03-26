const express = require("express");
const router = express.Router();
const { getCustomers, getCustomerById} = require("../controllers/customer.controller");
const auth = require('../middleware/auth.middleware');

router.get("/getCustomers",auth, getCustomers);
router.get("/get_customer_details/:id",auth, getCustomerById);

module.exports = router;