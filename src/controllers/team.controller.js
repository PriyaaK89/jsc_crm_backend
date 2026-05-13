const teamModel = require('../models/team.model');
const db = require("../config/db");

exports.createTeam = async (req, res) => {
  try {
    const { name, target_amount } = req.body;

    if (!name) {
      return res.status(400).json({
        message: 'Team name is required'
      });
    }

    const created_by = req.user.id;

    const teamId = await teamModel.createTeam(
      name,
      target_amount,
      created_by
    );

    res.status(201).json({
      message: 'Team created successfully',
      teamId
    });

  } catch (error) {
    res.status(500).json({
      message: error.message
    });
  }
};

exports.getTeams = async (req, res) => {
  try {
    let {
      page,
      limit,
      search
    } = req.query;

    page = parseInt(page) || 1;

    limit = parseInt(limit) || 10;

    const result =
      await teamModel.getAllTeams({

        page,
        limit,
        search
      });

    return res.status(200).json({

      message: 'Teams fetched successfully',

      data: result.data,

      total: result.total,

      totalPages:
        Math.ceil(result.total / limit),

      currentPage: page
    });

  } catch (error) {

    return res.status(500).json({
      message: error.message
    });
  }
};

exports.getTeamById = async (req, res) => {
  try {
    const { id } = req.params;

    if (!id) {
      return res.status(400).json({
        message: 'Team ID is required'
      });
    }

    const team = await teamModel.getTeamById(id);

    if (!team) {
      return res.status(404).json({
        message: 'Team not found'
      });
    }

    res.status(200).json({
      message: 'Team fetched successfully',
      data: team
    });

  } catch (error) {
    res.status(500).json({
      message: error.message
    });
  }
};

exports.createSubTeam = async (req, res) => {
  try {
    const {
      name,
      parent_team_id,
      category_ids,
      sub_team_target_amount
    } = req.body;

    if (!name || !parent_team_id || !category_ids || !sub_team_target_amount) {
      return res.status(400).json({
        message: 'All fields are required'
      });
    }

    const created_by = req.user.id;

    const subTeamId = await teamModel.createSubTeam({
      name,
      parent_team_id,
      category_ids,
      sub_team_target_amount,
      created_by
    });

    res.status(201).json({
      message: 'Sub team created successfully',
      subTeamId
    });

  } catch (error) {
    res.status(400).json({
      message: error.message
    });
  }
};

exports.getSubTeams = async (req, res) => {

  try {

    const { teamId } = req.params;

    let {
      page,
      limit,
      search
    } = req.query;

    page = parseInt(page) || 1;

    limit = parseInt(limit) || 10;

    const result =
      await teamModel.getSubTeamsByTeam({

        teamId,

        page,
        limit,
        search
      });

    return res.status(200).json({

      message:
        'Sub teams fetched successfully',

      data: result.data,

      total: result.total,

      totalPages:
        Math.ceil(result.total / limit),

      currentPage: page
    });

  } catch (error) {

    return res.status(500).json({
      message: error.message
    });
  }
};

exports.assignTarget = async (req, res) => {

  const connection = await db.getConnection();

  try {

    await connection.beginTransaction();

    const {
      team_id,
      sub_team_id,
      parent_id,
      parent_type,
      parent_assignment_id,
      assignments
    } = req.body;


    if (
      !team_id ||
      !sub_team_id ||
      !parent_id ||
      !parent_type ||
      !assignments?.length
    ) {
      return res.status(400).json({
        message: 'All fields are required'
      });
    }

    const validParentTypes = [
      'SUBTEAM',
      'ZSM',
      'RSM',
      'ASM',
      'TSM',
      'SM'
    ];

    if (!validParentTypes.includes(parent_type)) {
      return res.status(400).json({
        message: 'Invalid parent type'
      });
    }

    const [teamRows] = await connection.query( `SELECT id FROM teams WHERE id = ?`, [team_id] );

    if (!teamRows.length) {
      throw new Error('Team not found');
    }

    const [subRows] = await connection.query(
      `SELECT id, pending_target_amount FROM sub_teams WHERE id = ?`, [sub_team_id]
    );

    if (!subRows.length) {
      throw new Error('SubTeam not found');
    }

    const uniqueUsers = new Set();

    for (const a of assignments) {
      if (uniqueUsers.has(a.user_id)) {
        throw new Error('Duplicate users are not allowed');
      }

      uniqueUsers.add(a.user_id);
    }

    let parentPending = 0;

    if (parent_type === 'SUBTEAM') {

      parentPending = Number(
        subRows[0].pending_target_amount
      );
    }

    else {
      if (!parent_assignment_id) {
        return res.status(400).json({
          message: 'parent_assignment_id is required'
        });
      }
      const [rows] = await connection.query(
        `SELECT pending_target
         FROM target_assignments
         WHERE id = ?`,
        [parent_assignment_id]
      );

      if (!rows.length) {
        throw new Error('Parent assignment not found');
      }

      parentPending = Number(
        rows[0].pending_target
      );
    }

    let totalAssign = 0;
    for (const a of assignments) {
      if (!a.target || Number(a.target) <= 0) {
        throw new Error(
          'Target must be greater than 0'
        );
      }
      totalAssign += Number(a.target);
    }

    if (totalAssign > parentPending) {
      throw new Error(
        'Assigned target exceeds pending target'
      );
    }

    for (const a of assignments) {
      const [userRows] = await connection.query(
        `SELECT id
         FROM users
         WHERE id = ?`,
        [a.user_id]
      );

      if (!userRows.length) {
        throw new Error(
          `User not found: ${a.user_id}`
        );
      }

      await connection.query(
        `INSERT INTO target_assignments
        (
          team_id,
          sub_team_id,
          parent_assignment_id,
          parent_id,
          parent_type,
          user_id,
          role,
          total_target,
          pending_target,
          created_by
        )
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        [
          team_id,
          sub_team_id,
          parent_assignment_id || null,
          parent_id,
          parent_type,
          a.user_id,
          a.role,
          a.target,
          a.target,
          req.user.id
        ]
      );
    }

    if (parent_type === 'SUBTEAM') {
      await connection.query(
        `UPDATE sub_teams
         SET pending_target_amount =
             pending_target_amount - ?
         WHERE id = ?`,
        [
          totalAssign,
          sub_team_id
        ]
      );
    }

    else {

      await connection.query(
        `UPDATE target_assignments
         SET pending_target =
             pending_target - ?
         WHERE id = ?`,
        [
          totalAssign,
          parent_assignment_id
        ]
      );
    }

    await connection.commit();

    return res.status(200).json({
      message: 'Target assigned successfully',
      data: {
        team_id,
        sub_team_id,
        total_assigned: totalAssign,
        remaining_target:
          parentPending - totalAssign
      }
    });

  } catch (error) {

    await connection.rollback();

    return res.status(400).json({
      message: error.message
    });

  } finally {

    connection.release();
  }
};

exports.getAssignedTargets = async (req, res) => {
  try {
    let { page, limit, search } = req.query;
    page = parseInt(page) || 1;
    limit = parseInt(limit) || 10;

    const result = await teamModel.getAssignedTargets({
      page,
      limit,
      search
    });

    return res.status(200).json({
      message: "Assigned targets fetched successfully",
      data: result.data,
      total: result.total,
      totalPages: Math.ceil(result.total / limit),
      currentPage: page
    });

  } catch (error) {
    return res.status(500).json({
      message: error.message
    });

  }
};

// exports.getAssignedTargets = async (req, res) => {
//   try {
//     let { page, limit, role, search, team_id, sub_team_id } = req.query;

//     page = parseInt(page) || 1;
//     limit = parseInt(limit) || 10;

//     const result =
//       await teamModel.getAssignedTargets({
//         page,
//         limit,
//         role,
//         search,
//         team_id,
//         sub_team_id });

//     return res.status(200).json({

//       message: 'Assigned targets fetched successfully',
//       data: result.data,
//       total: result.total,
//       totalPages: Math.ceil(result.total / limit),
//       currentPage: page
//     });

//   } catch (error) {
//     return res.status(500).json({
//       message: error.message
//     });
//   }
// };

exports.updateTeam = async (req, res) => {

  try {

    const { id } = req.params;

    const {
      name,
      target_amount
    } = req.body;

    if (!name || !target_amount) {

      return res.status(400).json({
        message: 'All fields are required'
      });
    }

    await teamModel.updateTeam({

      id,
      name,
      target_amount
    });

    return res.status(200).json({
      message: 'Team updated successfully'
    });

  } catch (error) {

    return res.status(500).json({
      message: error.message
    });
  }
};

exports.deleteTeam = async (req, res) => {

  try {

    const { id } = req.params;

    await teamModel.deleteTeam(id);

    return res.status(200).json({
      message: 'Team deleted successfully'
    });

  } catch (error) {

    return res.status(500).json({
      message: error.message
    });
  }
};

exports.updateSubTeam = async (req, res) => {

  try {
    const { id } = req.params;
    const { name, sub_team_target_amount } = req.body;

    if (!name || !sub_team_target_amount) {
      return res.status(400).json({
        message: 'All fields are required'
      });
    }

    await teamModel.updateSubTeam({ id, name, sub_team_target_amount });

    return res.status(200).json({
      message: 'SubTeam updated successfully'
    });

  } catch (error) {
    return res.status(500).json({
      message: error.message
    });
  }
};

exports.deleteSubTeam = async (req, res) => {
    try {
      const { id } = req.params;

      if (!id) {

        return res.status(400)
          .json({

            message:
              "Sub team id is required"
          });
      }

      await teamModel.deleteSubTeam(id);

      return res.status(200)
        .json({

          message:
            "Sub team deleted successfully"
        });

    } catch (error) {

      console.log(error);

      return res.status(500)
        .json({

          message:
            error.message ||
            "Something went wrong"
        });
    }
  };

  exports.getAssignedTargetById = async (req, res) => {

  try {

    const { id } = req.params;

    if (!id) {
      return res.status(400).json({
        message: 'Assignment ID is required'
      });
    }

    const assignment =
      await teamModel.getAssignmentById(id);

    if (!assignment) {
      return res.status(404).json({
        message: 'Assignment not found'
      });
    }

    return res.status(200).json({
      message:
        'Assigned target fetched successfully',
      data: assignment
    });

  } catch (error) {

    return res.status(500).json({
      message: error.message
    });
  }
};

exports.updateAssignedTarget = async (req, res) => {

  const connection = await db.getConnection();

  try {

    await connection.beginTransaction();

    const { id } = req.params;

    const {
      target,
      role
    } = req.body;

    if (!target || Number(target) <= 0) {
      return res.status(400).json({
        message: 'Valid target is required'
      });
    }

    // GET CURRENT ASSIGNMENT

    const assignment =
      await teamModel.getAssignmentById(
        id,
        connection
      );

    if (!assignment) {
      throw new Error('Assignment not found');
    }

    const oldTarget =
      Number(assignment.total_target);

    const oldPending =
      Number(assignment.pending_target);

    const newTarget =
      Number(target);

    // USED TARGET

    const usedTarget =
      oldTarget - oldPending;

    // PREVENT INVALID REDUCTION

    if (newTarget < usedTarget) {
      throw new Error(
        `Target cannot be less than already distributed target (${usedTarget})`
      );
    }

    const difference =
      newTarget - oldTarget;

    let parentPending = 0;

    // CHECK EXTRA TARGET AVAILABILITY

    if (difference > 0) {

      // SUBTEAM PARENT

      if (assignment.parent_type === 'SUBTEAM') {

        const [rows] = await connection.query(
          `SELECT pending_target_amount
           FROM sub_teams
           WHERE id = ?`,
          [assignment.sub_team_id]
        );

        if (!rows.length) {
          throw new Error('Sub team not found');
        }

        parentPending =
          Number(rows[0].pending_target_amount);
      }

      // OTHER ASSIGNMENT PARENT

      else {

        const [rows] = await connection.query(
          `SELECT pending_target
           FROM target_assignments
           WHERE id = ?`,
          [assignment.parent_assignment_id]
        );

        if (!rows.length) {
          throw new Error(
            'Parent assignment not found'
          );
        }

        parentPending =
          Number(rows[0].pending_target);
      }

      if (difference > parentPending) {
        throw new Error(
          'Insufficient pending target available'
        );
      }
    }

    // NEW PENDING

    const newPending =
      oldPending + difference;

    // UPDATE ASSIGNMENT

    await connection.query(
      `UPDATE target_assignments
       SET
         total_target = ?,
         pending_target = ?,
         role = ?
       WHERE id = ?`,
      [
        newTarget,
        newPending,
        role || assignment.role,
        id
      ]
    );

    // UPDATE PARENT TARGET

    if (difference !== 0) {

      if (assignment.parent_type === 'SUBTEAM') {

        await connection.query(
          `UPDATE sub_teams
           SET pending_target_amount =
               pending_target_amount - ?
           WHERE id = ?`,
          [
            difference,
            assignment.sub_team_id
          ]
        );
      }

      else {

        await connection.query(
          `UPDATE target_assignments
           SET pending_target =
               pending_target - ?
           WHERE id = ?`,
          [
            difference,
            assignment.parent_assignment_id
          ]
        );
      }
    }

    await connection.commit();

    return res.status(200).json({
      message:
        'Assigned target updated successfully'
    });

  } catch (error) {

    await connection.rollback();

    return res.status(400).json({
      message: error.message
    });

  } finally {

    connection.release();
  }
};

exports.deleteAssignedTarget = async (req, res) => {

  const connection = await db.getConnection();

  try {

    await connection.beginTransaction();

    const { id } = req.params;

    // GET ASSIGNMENT

    const assignment =
      await teamModel.getAssignmentById(
        id,
        connection
      );

    if (!assignment) {
      throw new Error('Assignment not found');
    }

    // CHECK CHILD ASSIGNMENTS

    const [childRows] = await connection.query(
      `SELECT id
       FROM target_assignments
       WHERE parent_assignment_id = ?`,
      [id]
    );

    if (childRows.length) {
      throw new Error(
        'Cannot delete assignment with child targets'
      );
    }

    // RESTORE PENDING TARGET TO PARENT

    if (assignment.parent_type === 'SUBTEAM') {

      await connection.query(
        `UPDATE sub_teams
         SET pending_target_amount =
             pending_target_amount + ?
         WHERE id = ?`,
        [
          assignment.pending_target,
          assignment.sub_team_id
        ]
      );
    }

    else {

      await connection.query(
        `UPDATE target_assignments
         SET pending_target =
             pending_target + ?
         WHERE id = ?`,
        [
          assignment.pending_target,
          assignment.parent_assignment_id
        ]
      );
    }

    // DELETE ASSIGNMENT

    await connection.query(
      `DELETE FROM target_assignments
       WHERE id = ?`,
      [id]
    );

    await connection.commit();

    return res.status(200).json({
      message:
        'Assigned target deleted successfully'
    });

  } catch (error) {

    await connection.rollback();

    return res.status(400).json({
      message: error.message
    });

  } finally {

    connection.release();
  }
};

