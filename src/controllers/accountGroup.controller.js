const { createAccountGroup, findGroupByName, getAllGroups, getGroupById, updateAccountGroup,
  deleteAccountGroup,} = require("../models/accountGroup.model");

const isValidBoolean = (value) => {
  return value === 0 || value === 1;
};

// CREATE GROUP
const createGroup = async (req, res) => {
  try {
    const {
      group_name,  
      parent_group_id,
      behaves_like_subledger,
      nett_debit_credit,
      used_for_calculation,
      method_to_allocate,
    } = req.body;

    if (!group_name || !group_name.trim()) {
      return res.status(400).json({
        success: false,
        message: "Group name is required",
      });
    }


    if (
      behaves_like_subledger !== undefined &&
      !isValidBoolean(behaves_like_subledger)
    ) {
      return res.status(400).json({
        success: false,
        message: "Invalid behaves_like_subledger value",
      });
    }

    if (
      nett_debit_credit !== undefined &&
      !isValidBoolean(nett_debit_credit)
    ) {
      return res.status(400).json({
        success: false,
        message: "Invalid nett_debit_credit value",
      });
    }

    if (
      used_for_calculation !== undefined &&
      !isValidBoolean(used_for_calculation)
    ) {
      return res.status(400).json({
        success: false,
        message: "Invalid used_for_calculation value",
      });
    }

    if (
      method_to_allocate !== undefined &&
      !isValidBoolean(method_to_allocate)
    ) {
      return res.status(400).json({
        success: false,
        message: "Invalid method_to_allocate value",
      });
    }

    const existingGroup = await findGroupByName(group_name.trim());

    if (existingGroup) {
      return res.status(400).json({
        success: false,
        message: "Group already exists",
      });
    }

    if (parent_group_id) {
      const parentGroup = await getGroupById(parent_group_id);

      if (!parentGroup) {
        return res.status(404).json({
          success: false,
          message: "Parent group not found",
        });
      }
    }

    await createAccountGroup({
      group_name: group_name.trim(), 

      parent_group_id: parent_group_id || null,

      behaves_like_subledger:
        behaves_like_subledger ?? 0,

      nett_debit_credit:
        nett_debit_credit ?? 0,

      used_for_calculation:
        used_for_calculation ?? 0,

      method_to_allocate:
        method_to_allocate ?? 0,

      created_by: req.user?.id || null,
    });

    return res.status(201).json({
      success: true,
      message: "Group created successfully",
    });

  } catch (error) {

    console.log("CREATE GROUP ERROR:", error);

    return res.status(500).json({
      success: false,
      message: "Internal server error",
    });
  }
};


const getGroups = async (req, res) => {

  try {

    const page = Number(req.query.page) || 1;

    const limit = Number(req.query.limit) || 10;

    const search = req.query.search || "";

    const { rows, total } = await getAllGroups({
      page,
      limit,
      search,
    });

    const totalPages = Math.ceil(total / limit);

    return res.status(200).json({
      success: true,

      data: rows,

      pagination: {
        total,
        page,
        limit,
        totalPages,
      },
    });

  } catch (error) {

    console.log("GET GROUPS ERROR:", error);

    return res.status(500).json({
      success: false,
      message: "Internal server error",
    });
  }
};

// GET GROUP BY ID
const getSingleGroup = async (req, res) => {

  try {

    const { id } = req.params;

    const group = await getGroupById(id);

    if (!group) {
      return res.status(404).json({
        success: false,
        message: "Group not found",
      });
    }

    return res.status(200).json({
      success: true,
      data: group,
    });

  } catch (error) {

    console.log("GET GROUP BY ID ERROR:", error);

    return res.status(500).json({
      success: false,
      message: "Internal server error",
    });
  }
};

// UPDATE GROUP
const updateGroup = async (req, res) => {

  try {

    const { id } = req.params;

    const {
      group_name,
      parent_group_id,
      behaves_like_subledger,
      nett_debit_credit,
      used_for_calculation,
      method_to_allocate,
    } = req.body;

    // CHECK EXISTING GROUP
    const existingGroup = await getGroupById(id);

    if (!existingGroup) {
      return res.status(404).json({
        success: false,
        message: "Group not found",
      });
    }

    // REQUIRED VALIDATION
    if (!group_name || !group_name.trim()) {
      return res.status(400).json({
        success: false,
        message: "Group name is required",
      });
    }

    // BOOLEAN VALIDATION
    if (
      behaves_like_subledger !== undefined &&
      !isValidBoolean(behaves_like_subledger)
    ) {
      return res.status(400).json({
        success: false,
        message: "Invalid behaves_like_subledger value",
      });
    }

    if (
      nett_debit_credit !== undefined &&
      !isValidBoolean(nett_debit_credit)
    ) {
      return res.status(400).json({
        success: false,
        message: "Invalid nett_debit_credit value",
      });
    }

    if (
      used_for_calculation !== undefined &&
      !isValidBoolean(used_for_calculation)
    ) {
      return res.status(400).json({
        success: false,
        message: "Invalid used_for_calculation value",
      });
    }

    if (
      method_to_allocate !== undefined &&
      !isValidBoolean(method_to_allocate)
    ) {
      return res.status(400).json({
        success: false,
        message: "Invalid method_to_allocate value",
      });
    }

    // DUPLICATE NAME CHECK
    const duplicateGroup = await findGroupByName(group_name.trim());

    if (duplicateGroup && duplicateGroup.id != id) {
      return res.status(400).json({
        success: false,
        message: "Group name already exists",
      });
    }

    // PARENT GROUP VALIDATION
    if (parent_group_id) {

      if (Number(parent_group_id) === Number(id)) {
        return res.status(400).json({
          success: false,
          message: "Group cannot be its own parent",
        });
      }

      const parentGroup = await getGroupById(parent_group_id);

      if (!parentGroup) {
        return res.status(404).json({
          success: false,
          message: "Parent group not found",
        });
      }
    }

    await updateAccountGroup(id, {
      group_name: group_name.trim(),
      parent_group_id: parent_group_id || null,

      behaves_like_subledger:
        behaves_like_subledger ?? 0,

      nett_debit_credit:
        nett_debit_credit ?? 0,

      used_for_calculation:
        used_for_calculation ?? 0,

      method_to_allocate:
        method_to_allocate ?? 0,
    });

    return res.status(200).json({
      success: true,
      message: "Group updated successfully",
    });

  } catch (error) {

    console.log("UPDATE GROUP ERROR:", error);

    return res.status(500).json({
      success: false,
      message: "Internal server error",
    });
  }
};

// DELETE GROUP
const deleteGroup = async (req, res) => {

  try {

    const { id } = req.params;

    const existingGroup = await getGroupById(id);

    if (!existingGroup) {
      return res.status(404).json({
        success: false,
        message: "Group not found",
      });
    }

    await deleteAccountGroup(id);

    return res.status(200).json({
      success: true,
      message: "Group deleted successfully",
    });

  } catch (error) {

    console.log("DELETE GROUP ERROR:", error);

    return res.status(500).json({
      success: false,
      message: "Internal server error",
    });
  }
};

module.exports = {
  createGroup,
  getGroups, getSingleGroup, updateGroup, deleteGroup
};