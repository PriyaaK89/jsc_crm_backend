const jobRoleModel = require('../models/jobRole.model');

exports.createJobRole = async (req, res) => {
  try {
    const { department_id, name } = req.body;

    if (!department_id || !name) {
      return res.status(400).json({
        message: 'Department ID and job role name are required'
      });
    }

    const id = await jobRoleModel.createJobRole(department_id, name);

    res.status(201).json({
      message: 'Job role created successfully',
      id
    });
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
};

exports.getRolesByDepartment = async (req, res) => {
  try {
    const roles = await jobRoleModel.getRolesByDepartment(
      req.params.departmentId
    );
    res.json(roles);
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
};
