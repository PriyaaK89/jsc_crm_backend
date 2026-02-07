const departmentModel = require('../models/department.model');

exports.createDepartment = async (req, res) => {
  try {
    const { name } = req.body;

    if (!name) {
      return res.status(400).json({ message: 'Department name is required' });
    }

    const id = await departmentModel.createDepartment(name);

    res.status(201).json({
      message: 'Department created successfully',
      id
    });
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
};

exports.getDepartments = async (req, res) => {
  try {
    const departments = await departmentModel.getAllDepartments();
    res.json(departments);
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
};
