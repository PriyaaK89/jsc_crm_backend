const customerModel = require("../models/customer.model");

exports.getCustomers = async (req, res) => {
  try {
    const { type } = req.query;
    if (!type) {
      return res.status(400).json({ message: "Type is required (distributor/retailer/farmer)"});
    }

    const data = await customerModel.getCustomersByType(type);
    res.json({
      success: true,
      count: data.length,
      data
    });

  } catch (err) {
    res.status(500).json({ error: err.message });
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