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

exports.getRoleById = async (req, res) => {
  try {
    const role = await jobRoleModel.getRoleById(req.params.id);
    if (!role) {
      return res.status(404).json({
        message: 'Job role not found'
      });
    }
    res.status(200).json(role);
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
};

exports.updateJobRole = async (req, res) => {
  try {
    const { id } = req.params;
    const { department_id, name } = req.body;

    if (!department_id || !name) {
      return res.status(400).json({
        message: 'Department ID and job role name are required'
      });
    }

    const updated = await jobRoleModel.updateJobRole(id, department_id, name);

    if (!updated) {
      return res.status(404).json({
        message: 'Job role not found'
      });
    }

    res.json({
      message: 'Job role updated successfully'
    });

  } catch (error) {
    res.status(500).json({ message: error.message });
  }
};

exports.deleteJobRole = async (req, res) => {
  try {
    const { id } = req.params;

    const deleted = await jobRoleModel.deleteJobRole(id);

    if (!deleted) {
      return res.status(404).json({
        message: 'Job role not found'
      });
    }

    res.json({
      message: 'Job role deleted successfully'
    });

  } catch (error) {
    res.status(500).json({ message: error.message });
  }
};

exports.getUsersByLevel = async (req, res) => {
  try {
    const { level } = req.params;

    if (!level) {
      return res.status(400).json({
        message: 'Level is required'
      });
    }

    const users = await jobRoleModel.getUsersByLevel(level);

    res.json(users);

  } catch (error) {
    res.status(500).json({ message: error.message });
  }
};
