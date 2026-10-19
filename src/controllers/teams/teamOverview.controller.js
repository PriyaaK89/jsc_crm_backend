const {
  getCurrentUser,
  getRoleChain,
  getTeamWithTodayAttendance,
} = require("../../models/teams/teamOverview.model");

// "Regional Sales Manager" -> "RSM"
const abbreviate = (name = "") =>
  name.split(/\s+/).filter(Boolean).map((w) => w[0].toUpperCase()).join("");

// green = in_field, blue = office/wfh, orange = leave, grey = not checked in
const resolveStatus = (m) => {
  if (m.attendance_status === "leave") return "on_leave";
  if (m.attendance_status === "present" || m.attendance_status === "day_over") {
    return m.work_type === "field" ? "in_field" : "in_office";
  }
  return "not_checked_in";
};

const resolveLocationText = (m, status) => {
  if (status === "on_leave") return "On Leave";
  if (m.visit_location) return m.visit_location;
  if (status === "in_office") return "Office";
  return m.headquarter || "Not checked in";
};

exports.getTeamOverview = async (req, res) => {
  try {
    const userId = req.user.id;

    const [me, roles, rows] = await Promise.all([
      getCurrentUser(userId),
      getRoleChain(),
      getTeamWithTodayAttendance(userId),
    ]);

    if (!me) return res.status(404).json({ message: "User not found" });

    // ---- members + stats ----
    const stats = { total: 0, active: 0, in_field: 0, on_leave: 0, not_checked_in: 0 };
    const groupMap = new Map(); // level -> group

    for (const m of rows) {
      const status = resolveStatus(m);

      stats.total++;
      if (status === "on_leave") stats.on_leave++;
      else if (status === "not_checked_in") stats.not_checked_in++;
      else {
        stats.active++; // marked attendance today (present / day_over)
        if (status === "in_field") stats.in_field++;
      }

      const key = m.level ?? 999;
      if (!groupMap.has(key)) {
        groupMap.set(key, {
          level: m.level,
          role_id: m.job_role_id,
          role_name: m.job_role || "No Role",
          count: 0,
          members: [],
        });
      }
      const g = groupMap.get(key);
      g.count++;
      g.members.push({
        id: m.id,
        name: m.name,
        contact_no: m.contact_no,
        profile_image: m.profile_image,
        job_role: m.job_role,
        level: m.level,
        status,                                   // in_field | in_office | on_leave | not_checked_in
        location_text: resolveLocationText(m, status),
      });
    }

    const groups = [...groupMap.values()].sort((a, b) => (a.level ?? 999) - (b.level ?? 999));

    return res.status(200).json({
      current_user: {
        id: me.id,
        name: me.name,
        contact_no: me.contact_no,
        profile_image: me.profile_image,
        job_role: me.job_role,
        level: me.level,
        headquarter: me.headquarter,
      },
      is_top_of_hierarchy: me.reporting_under == null,
      hierarchy_chain: roles.map((r) => ({
        id: r.id,
        name: r.name,
        short: abbreviate(r.name),
        level: r.level,
        is_current: r.id === me.job_role_id,
      })),
      stats,
      groups,
    });
  } catch (error) {
    console.error("getTeamOverview error:", error);
    return res.status(500).json({ message: "Something went wrong", error: error.message });
  }
};