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
    const teams = await teamModel.getAllTeams();

    res.status(200).json({
      message: 'Teams fetched successfully',
      data: teams
    });

  } catch (error) {
    res.status(500).json({
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

    if (!teamId) {
      return res.status(400).json({
        message: 'Team ID is required'
      });
    }

    const subTeams = await teamModel.getSubTeamsByTeam(teamId);

    res.status(200).json({
      message: 'Sub teams fetched successfully',
      data: subTeams
    });

  } catch (error) {
    res.status(500).json({
      message: error.message
    });
  }
};

exports.assignTarget = async (req, res) => {
  const connection = await db.getConnection();

  try {
    await connection.beginTransaction();

    const { parent_id, parent_type, parent_role, assignments } = req.body;

    // ✅ Validation
    if (!parent_id || !parent_type || !assignments?.length) {
      return res.status(400).json({ message: 'Invalid data' });
    }

    if (parent_type === 'USER' && !parent_role) {
      return res.status(400).json({ message: 'parent_role is required for USER' });
    }

    let parentPending = 0;

    // ✅ 1. Get parent pending target
    if (parent_type === 'SUBTEAM') {
      const [rows] = await connection.query(
        `SELECT pending_target_amount FROM sub_teams WHERE id = ?`,
        [parent_id]
      );

      if (!rows.length) throw new Error('Parent not found');

      parentPending = Number(rows[0].pending_target_amount);

    } else if (parent_type === 'USER') {
      const [rows] = await connection.query(
        `SELECT pending_target 
         FROM target_assignments 
         WHERE user_id = ? AND role = ?`,
        [parent_id, parent_role]
      );

      if (!rows.length) throw new Error('Parent not found');

      parentPending = Number(rows[0].pending_target);
    }

    // ✅ 2. Calculate total assigning target
    let totalAssign = 0;
    assignments.forEach(a => {
      totalAssign += Number(a.target);
    });

    // ✅ FIXED CONDITION
    if (totalAssign > parentPending) {
      throw new Error('Target exceeds parent pending');
    }

    // ✅ 3. Insert assignments
    for (const a of assignments) {
      await connection.query(
        `INSERT INTO target_assignments 
        (parent_id, parent_type, user_id, role, total_target, pending_target, created_by)
        VALUES (?, ?, ?, ?, ?, ?, ?)`,
        [
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

    // ✅ 4. Deduct parent pending
    if (parent_type === 'SUBTEAM') {
      await connection.query(
        `UPDATE sub_teams 
         SET pending_target_amount = pending_target_amount - ?
         WHERE id = ?`,
        [totalAssign, parent_id]
      );

    } else {
      await connection.query(
        `UPDATE target_assignments 
         SET pending_target = pending_target - ?
         WHERE user_id = ? AND role = ?`,
        [totalAssign, parent_id, parent_role]
      );
    }

    await connection.commit();

    res.status(200).json({
      message: 'Target assigned successfully'
    });

  } catch (error) {
    await connection.rollback();
    res.status(400).json({
      message: error.message
    });
  } finally {
    connection.release();
  }
};

exports.getAssignedTargets = async (req, res) => {
  try {
    let { page, limit, role, search } = req.query;

    page = parseInt(page) || 1;
    limit = parseInt(limit) || 10;

    const result = await teamModel.getAssignedTargets({
      page,
      limit,
      role,
      search
    });

    res.status(200).json({
      message: 'Assigned targets fetched successfully',
      data: result.data,
      total: result.total,
      totalPages: Math.ceil(result.total / limit),
      currentPage: page
    });

  } catch (error) {
    res.status(500).json({
      message: error.message
    });
  }
};