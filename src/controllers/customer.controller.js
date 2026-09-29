const customerModel = require("../models/customer.model");

const isAdmin = (role) => ["ADMIN", "SUPER_ADMIN"].includes(role);

exports.getAssignedDistributors = async (req, res) => {
  try {
    const rows = await customerModel.getAssignedDistributorLedgers(req.user.id);
    res.json({ success: true, data: rows });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
};

exports.getRetailersByDistributor = async (req, res) => {
  try {
    const { distributor_ledger_id, include_all } = req.query;
    if (!distributor_ledger_id) {
      return res.status(400).json({ success: false, message: "distributor_ledger_id is required" });
    }
    const rows = await customerModel.getRetailersByDistributor(
      distributor_ledger_id,
      req.user.id,
      isAdmin(req.user.role),
      include_all === "true"
    );
    res.json({ success: true, data: rows });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
};

exports.getFarmersByRetailer = async (req, res) => {
  try {
    const { retailer_id } = req.query;
    if (!retailer_id) {
      return res.status(400).json({ success: false, message: "retailer_id is required" });
    }
    const rows = await customerModel.getFarmersByRetailer(
      retailer_id,
      req.user.id,
      isAdmin(req.user.role)
    );
    res.json({ success: true, data: rows });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
};


exports.getCustomersByType = async (req, res) => {
  try {
    const { type } = req.query;
    if (!["retailer", "farmer", "distributor"].includes(type)) {
      return res.status(400).json({ success: false, message: "Invalid type" });
    }
    const rows = await customerModel.getCustomersByType(type, req.user.id, isAdmin(req.user.role));
    res.json({ success: true, data: rows });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
};

// GET /api/customers/unmapped-farmers
// Powers: the standalone mapping page's farmer picker.
exports.getUnmappedFarmers = async (req, res) => {
  try {
    const rows = await customerModel.getUnmappedFarmers(req.user.id, isAdmin(req.user.role));
    res.json({ success: true, data: rows });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
};

// PATCH /api/customers/:id/mapping   body: { retailerId, distributorLedgerId }
// Powers: the standalone mapping page's "Save" action.
exports.updateCustomerMapping = async (req, res) => {
  try {
    const { id } = req.params;
    const { retailerId, distributorLedgerId } = req.body;
    if (!retailerId || !distributorLedgerId) {
      return res.status(400).json({ success: false, message: "retailerId and distributorLedgerId are required" });
    }
   const affected = await customerModel.updateCustomerMapping({
  customerId: id,
  retailerId,
  distributorLedgerId,
  employeeId: req.user.id,
});
    res.json({ success: true, affectedRows: affected });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
};

exports.getCustomerById = async (req, res) => {
  try {
    const data = await customerModel.getCustomerById(req.params.id);
    if (!data) {
      return res.status(404).json({ message: "Customer not found" });
    }
    res.json(data);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
};

exports.getCustomerMapping = async (req, res) => {
  try {
    const data = await customerModel.getCustomerMappingById(req.params.id);
    if (!data) return res.status(404).json({ success: false, message: "Not found" });
    res.json({ success: true, data });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
};

// GET /api/customers/:id/links
exports.getCustomerLinks = async (req, res) => {
  try {
    const customerId = Number(req.params.id);
    const admin = isAdmin(req.user.role);

    if (!(await customerModel.canManageCustomer(customerId, req.user.id, admin))) {
      return res.status(403).json({ success: false, message: "You cannot view this customer's mapping" });
    }
    const data = await customerModel.getCustomerLinks(customerId);
    if (!data) return res.status(404).json({ success: false, message: "Customer not found" });

    res.json({ success: true, data });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
};

// POST /api/customers/:id/links
// retailer: { distributorLedgerId }
// farmer:   { distributorLedgerId, retailerId }
exports.addCustomerLink = async (req, res) => {
  try {
    const customerId = Number(req.params.id);
    const distributorLedgerId = Number(req.body.distributorLedgerId);
    const retailerId = req.body.retailerId ? Number(req.body.retailerId) : null;
    const admin = isAdmin(req.user.role);
    const employeeId = req.user.id;

    if (!customerId || !distributorLedgerId) {
      return res.status(400).json({ success: false, message: "distributorLedgerId is required" });
    }

    const customer = await customerModel.getCustomerById(customerId);
    if (!customer) {
      return res.status(404).json({ success: false, message: "Customer not found" });
    }
    if (!["retailer", "farmer"].includes(customer.type)) {
      return res.status(400).json({ success: false, message: "Only retailers and farmers can be mapped" });
    }
    if (!(await customerModel.canManageCustomer(customerId, employeeId, admin))) {
      return res.status(403).json({ success: false, message: "You cannot edit this customer's mapping" });
    }

    const ledger = await customerModel.getLedgerForEmployee(distributorLedgerId, employeeId, admin);
    if (!ledger) {
      return res.status(403).json({ success: false, message: "This distributor is not assigned to you" });
    }

    // ---------- Retailer -> Distributor ----------
    if (customer.type === "retailer") {
      const created = await customerModel.linkRetailerToDistributor(customerId, distributorLedgerId, employeeId);
      await customerModel.syncLegacyColumns(customerId, "retailer");
      return res.json({
        success: true,
        created: created === 1,
        message: created ? "Retailer linked to distributor" : "Already linked to this distributor",
      });
    }

    // ---------- Farmer -> Retailer (under a distributor) ----------
    if (!retailerId) {
      return res.status(400).json({ success: false, message: "retailerId is required for a farmer" });
    }
    const retailer = await customerModel.getCustomerById(retailerId);
    if (!retailer || retailer.type !== "retailer") {
      return res.status(400).json({ success: false, message: "Selected retailer is invalid" });
    }

    const alreadyUnderDistributor = await customerModel.isRetailerLinkedToDistributor(retailerId, distributorLedgerId);
    if (
      !alreadyUnderDistributor &&
      !(await customerModel.canManageCustomer(retailerId, employeeId, admin))
    ) {
      return res.status(403).json({ success: false, message: "You cannot use this retailer" });
    }

    // the "forgotten retailer" rule: retailer joins this distributor if it wasn't there
    await customerModel.linkRetailerToDistributor(retailerId, distributorLedgerId, employeeId);
    const created = await customerModel.linkFarmerToRetailer(customerId, retailerId, employeeId);

    await customerModel.syncLegacyColumns(retailerId, "retailer");
    await customerModel.syncLegacyColumns(customerId, "farmer");

    return res.json({
      success: true,
      created: created === 1,
      message: created ? "Farmer linked to retailer" : "Farmer is already linked to this retailer",
    });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
};

// DELETE /api/customers/:id/links?distributorLedgerId=..   (retailer)
//                                ?retailerId=..            (farmer)
exports.removeCustomerLink = async (req, res) => {
  try {
    const customerId = Number(req.params.id);
    const distributorLedgerId = Number(req.query.distributorLedgerId) || null;
    const retailerId = Number(req.query.retailerId) || null;
    const admin = isAdmin(req.user.role);
    const employeeId = req.user.id;

    const customer = await customerModel.getCustomerById(customerId);
    if (!customer) {
      return res.status(404).json({ success: false, message: "Customer not found" });
    }
    if (!(await customerModel.canManageCustomer(customerId, employeeId, admin))) {
      return res.status(403).json({ success: false, message: "You cannot edit this customer's mapping" });
    }

    let removed = 0;
    if (customer.type === "retailer") {
      if (!distributorLedgerId) {
        return res.status(400).json({ success: false, message: "distributorLedgerId is required" });
      }
      const ledger = await customerModel.getLedgerForEmployee(distributorLedgerId, employeeId, admin);
      if (!ledger) {
        return res.status(403).json({ success: false, message: "This distributor is not assigned to you" });
      }
      removed = await customerModel.unlinkRetailerFromDistributor(customerId, distributorLedgerId);
    } else if (customer.type === "farmer") {
      if (!retailerId) {
        return res.status(400).json({ success: false, message: "retailerId is required" });
      }
      removed = await customerModel.unlinkFarmerFromRetailer(customerId, retailerId);
    } else {
      return res.status(400).json({ success: false, message: "Only retailers and farmers can be mapped" });
    }

    await customerModel.syncLegacyColumns(customerId, customer.type);
    res.json({ success: true, removed, message: removed ? "Mapping removed" : "Mapping not found" });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
};

const toIds = (arr) => [
  ...new Set(
    (Array.isArray(arr) ? arr : [])
      .map(Number)
      .filter((n) => Number.isInteger(n) && n > 0)
  ),
];

// GET /api/customers/distributor/:ledgerId/links
exports.getDistributorLinks = async (req, res) => {
  try {
    const ledgerId = Number(req.params.ledgerId);
    const ledger = await customerModel.getLedgerForEmployee(ledgerId, req.user.id, isAdmin(req.user.role));
    if (!ledger) {
      return res.status(403).json({ success: false, message: "This distributor is not assigned to you" });
    }
    const data = await customerModel.getDistributorLinks(ledgerId);
    res.json({ success: true, data });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
};

// GET /api/customers/distributor/:ledgerId/candidates?type=retailer|farmer
exports.getDistributorCandidates = async (req, res) => {
  try {
    const ledgerId = Number(req.params.ledgerId);
    const { type } = req.query;
    if (!["retailer", "farmer"].includes(type)) {
      return res.status(400).json({ success: false, message: "type must be retailer or farmer" });
    }
    const admin = isAdmin(req.user.role);
    const ledger = await customerModel.getLedgerForEmployee(ledgerId, req.user.id, admin);
    if (!ledger) {
      return res.status(403).json({ success: false, message: "This distributor is not assigned to you" });
    }
    const rows = await customerModel.getDistributorCandidates(ledgerId, type, req.user.id, admin);
    res.json({ success: true, data: rows });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
};

// POST /api/customers/distributor/:ledgerId/links   body: { retailerIds: [], farmerIds: [] }
exports.addDistributorLinks = async (req, res) => {
  try {
    const ledgerId = Number(req.params.ledgerId);
    const admin = isAdmin(req.user.role);
    const employeeId = req.user.id;

    const ledger = await customerModel.getLedgerForEmployee(ledgerId, employeeId, admin);
    if (!ledger) {
      return res.status(403).json({ success: false, message: "This distributor is not assigned to you" });
    }

    const retailerIds = toIds(req.body.retailerIds);
    const farmerIds = toIds(req.body.farmerIds);
    if (retailerIds.length === 0 && farmerIds.length === 0) {
      return res.status(400).json({ success: false, message: "Select at least one retailer or farmer" });
    }
    if (retailerIds.length > 200 || farmerIds.length > 200) {
      return res.status(400).json({ success: false, message: "Too many items in one request (max 200 each)" });
    }

    const retailerResult = await customerModel.addDistributorLinks(ledgerId, "retailer", retailerIds, employeeId, admin);
    const farmerResult = await customerModel.addDistributorLinks(ledgerId, "farmer", farmerIds, employeeId, admin);

    const parts = [];
    if (retailerResult.added) parts.push(`${retailerResult.added} retailer(s)`);
    if (farmerResult.added) parts.push(`${farmerResult.added} farmer(s)`);
    const skipped = retailerResult.notAllowed + farmerResult.notAllowed;

    let message = parts.length ? `Linked ${parts.join(" and ")}` : "Nothing new to link";
    if (skipped) message += ` (${skipped} skipped, not allowed)`;

    res.json({ success: true, retailers: retailerResult, farmers: farmerResult, message });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
};

// DELETE /api/customers/distributor/:ledgerId/links?type=retailer|farmer&customerId=..
exports.removeDistributorLink = async (req, res) => {
  try {
    const ledgerId = Number(req.params.ledgerId);
    const { type } = req.query;
    const customerId = Number(req.query.customerId);
    const admin = isAdmin(req.user.role);

    if (!["retailer", "farmer"].includes(type) || !customerId) {
      return res.status(400).json({ success: false, message: "type and customerId are required" });
    }
    const ledger = await customerModel.getLedgerForEmployee(ledgerId, req.user.id, admin);
    if (!ledger) {
      return res.status(403).json({ success: false, message: "This distributor is not assigned to you" });
    }

    const removed = await customerModel.removeDistributorLink(ledgerId, type, customerId);
    res.json({ success: true, removed, message: removed ? "Mapping removed" : "Mapping not found" });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
};

// GET /api/customers/retailer/:retailerId/farmer-candidates
exports.getFarmerCandidatesForRetailer = async (req, res) => {
  try {
    const retailerId = Number(req.params.retailerId);
    const admin = isAdmin(req.user.role);

    if (!(await customerModel.canManageCustomer(retailerId, req.user.id, admin))) {
      return res.status(403).json({ success: false, message: "You cannot edit this retailer's mapping" });
    }
    const retailer = await customerModel.getCustomerById(retailerId);
    if (!retailer || retailer.type !== "retailer") {
      return res.status(400).json({ success: false, message: "Not a retailer" });
    }

    const rows = await customerModel.getFarmerCandidatesForRetailer(retailerId, req.user.id, admin);
    res.json({ success: true, data: rows });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
};

// POST /api/customers/retailer/:retailerId/farmers   body: { farmerIds: [] }
exports.addFarmersToRetailer = async (req, res) => {
  try {
    const retailerId = Number(req.params.retailerId);
    const admin = isAdmin(req.user.role);
    const employeeId = req.user.id;

    if (!(await customerModel.canManageCustomer(retailerId, employeeId, admin))) {
      return res.status(403).json({ success: false, message: "You cannot edit this retailer's mapping" });
    }
    const retailer = await customerModel.getCustomerById(retailerId);
    if (!retailer || retailer.type !== "retailer") {
      return res.status(400).json({ success: false, message: "Not a retailer" });
    }

    const farmerIds = [
      ...new Set(
        (Array.isArray(req.body.farmerIds) ? req.body.farmerIds : [])
          .map(Number)
          .filter((n) => Number.isInteger(n) && n > 0)
      ),
    ];
    if (farmerIds.length === 0) {
      return res.status(400).json({ success: false, message: "Select at least one farmer" });
    }
    if (farmerIds.length > 200) {
      return res.status(400).json({ success: false, message: "Too many items in one request (max 200)" });
    }

    const result = await customerModel.addFarmersToRetailer(retailerId, farmerIds, employeeId, admin);
    let message = result.added ? `Linked ${result.added} farmer(s)` : "Nothing new to link";
    if (result.notAllowed) message += ` (${result.notAllowed} skipped, not allowed)`;

    res.json({ success: true, ...result, message });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
};

// DELETE /api/customers/retailer/:retailerId/farmers?farmerId=..
exports.removeFarmerFromRetailer = async (req, res) => {
  try {
    const retailerId = Number(req.params.retailerId);
    const farmerId = Number(req.query.farmerId);
    const admin = isAdmin(req.user.role);

    if (!farmerId) {
      return res.status(400).json({ success: false, message: "farmerId is required" });
    }
    if (!(await customerModel.canManageCustomer(retailerId, req.user.id, admin))) {
      return res.status(403).json({ success: false, message: "You cannot edit this retailer's mapping" });
    }

    const removed = await customerModel.unlinkFarmerFromRetailer(farmerId, retailerId);
    await customerModel.syncLegacyColumns(farmerId, "farmer");

    res.json({ success: true, removed, message: removed ? "Mapping removed" : "Mapping not found" });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
};