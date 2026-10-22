const model = require("../../models/teams/teamOverview.model");
const empTargetModel = require("../../models/empTarget.model");
const performanceService = require("../../services/performance.service");
// const { toMember, minutesLabel, abbreviate, inrShort } = require("../../utils/teamStatus.helper");
const { toMember, minutesLabel, abbreviate, inrShort, cleanRole, roleCode } =
  require("../../utils/teamStatus.helper"); // keep your existing relative path

const LIVE_WINDOW_MIN = 15; // GPS ping newer than this = "live"
// roles shown as chips in the Team page chain (match the codes in your job_roles names)
const SALES_CHAIN = ["ZSM", "RSM", "ASM", "TSM", "SO", "FA"];

// ---------- helpers ----------
const parseMemberId = (req) => {
  const id = Number(req.params.id);
  return Number.isInteger(id) && id > 0 ? id : null;
};

// Returns the member row, or sends the error response and returns null
const authorizeMember = async (req, res) => {
  const memberId = parseMemberId(req);
  if (!memberId) {
    res.status(400).json({ message: "Invalid member id" });
    return null;
  }
  // only managers ABOVE the member can open this (never yourself, never a peer)
  const allowed = await model.isInHierarchy(req.user.id, memberId);
  if (!allowed) {
    res.status(403).json({ message: "You can only view members of your own team" });
    return null;
  }
  const member = await model.getMemberWithAttendance(memberId);
  if (!member) {
    res.status(404).json({ message: "Member not found" });
    return null;
  }
  return member;
};

// Location is only shared while the employee is checked in today.
// No reverse geocoding: text comes from the attendance record, map uses lat/lng.
const buildLocation = (member, loc) => {
  const m = toMember(member);
  const checkedIn = m.status === "in_field" || m.status === "in_office";

  if (!checkedIn || !loc) {
    return {
      available: false,
      reason: m.status === "on_leave" ? "on_leave" : checkedIn ? "no_gps_data" : "not_checked_in",
      location_text: m.location_text,
    };
  }

  const minutesAgo = Number(loc.minutes_ago);
  const dayOver = member.attendance_status === "day_over";
  const lat = Number(loc.latitude);
  const lng = Number(loc.longitude);

  return {
    available: true,
    latitude: lat,
    longitude: lng,
    accuracy: loc.accuracy != null ? Number(loc.accuracy) : null,
    recorded_at: loc.recorded_at,
    minutes_ago: minutesAgo,
    updated_label: minutesLabel(minutesAgo),
    is_live: !dayOver && minutesAgo <= LIVE_WINDOW_MIN,
    day_over: dayOver,
    location_text: m.location_text,
    navigate_url: `https://www.google.com/maps/dir/?api=1&destination=${lat},${lng}`,
  };
};

const sumTarget = (rows, type) => {
  const list = rows.filter((t) => t.target_type === type);
  if (!list.length) return null;
  const target = list.reduce((s, t) => s + (Number(t.target_amount) || 0), 0);
  const achieved = list.reduce((s, t) => s + (Number(t.achieved_amount) || 0), 0);
  return {
    target,
    achieved,
    target_label: inrShort(target),
    achieved_label: inrShort(achieved),
    percent: target > 0 ? Math.round((achieved / target) * 100) : null,
  };
};

const safeSummary = async (userId) => {
  try {
    return await performanceService.getSummary(Number(userId), { scope: "team" });
  } catch (e) {
    console.error("performance summary failed:", e.message);
    return null;
  }
};

// ======================================================
// 1) TEAM PAGE
// ======================================================
exports.getTeamOverview = async (req, res) => {
  try {
    const userId = req.user.id;

    const [me, roles, rows] = await Promise.all([
      model.getMemberWithAttendance(userId),
      model.getRoleChain(),
      model.getTeamWithTodayAttendance(userId),
    ]);
    if (!me) return res.status(404).json({ message: "User not found" });

    const stats = { total: 0, in_field: 0, in_office: 0, on_leave: 0, not_checked_in: 0 };
    const groupMap = new Map();

    for (const row of rows) {
      const member = toMember(row);
      stats.total++;
      stats[member.status]++;

      const key = row.level ?? 999;
      if (!groupMap.has(key)) {
        groupMap.set(key, {
          level: row.level,
          role_id: row.job_role_id,
          // role_name: row.job_role || "No Role",
                    role_name: cleanRole(row.job_role) || "No Role",
          count: 0,
          members: [],
        });
      }
      const g = groupMap.get(key);
      g.count++;
      g.members.push(member);
    }

    const groups = [...groupMap.values()].sort((a, b) => (a.level ?? 999) - (b.level ?? 999));

    return res.status(200).json({
      current_user: {
        id: me.id,
        name: me.name,
        profile_image: me.profile_image,
        job_role: me.job_role,
        level: me.level,
        headquarter: me.headquarter,
      },
      is_top_of_hierarchy: me.reporting_under == null,
      hierarchy_chain: roles
        .map((r) => ({
          id: r.id,
          name: cleanRole(r.name),
          short: roleCode(r.name),
          level: r.level,
          is_current: r.id === me.job_role_id,
        }))
        .filter((r) => SALES_CHAIN.includes(r.short))
        .sort((a, b) => SALES_CHAIN.indexOf(a.short) - SALES_CHAIN.indexOf(b.short)),
      stats,
      groups,
    });
  } catch (error) {
    console.error("getTeamOverview error:", error);
    return res.status(500).json({ message: "Something went wrong", error: error.message });
  }
};

// ======================================================
// 2) MEMBER DETAILS
// ======================================================
exports.getMemberDetails = async (req, res) => {
  try {
    const member = await authorizeMember(req, res);
    if (!member) return;

    const [visitsToday, loc, reports, perf] = await Promise.all([
      model.getVisitsTodayCount(member.id),
      model.getLatestLocationToday(member.id),
      model.getDirectReportsWithAttendance(member.id),
      safeSummary(member.id),
    ]);

    const m = toMember(member);
    const checkedIn = m.status === "in_field" || m.status === "in_office";

    return res.status(200).json({
      member: {
        id: m.id,
        name: m.name,
        profile_image: m.profile_image,
        job_role: m.job_role,
        level: m.level,
        headquarter: member.headquarter,
        status: m.status,
        work_type: m.work_type,
      },
      performance_score: perf ? perf.score : null,
      visits_today: checkedIn ? visitsToday : null, // null -> show "—"
      contact: { contact_no: member.contact_no },
      location: buildLocation(member, loc),
      reports: {
        count: reports.length,
        members: reports.map(toMember),
      },
    });
  } catch (error) {
    console.error("getMemberDetails error:", error);
    return res.status(500).json({ message: "Something went wrong", error: error.message });
  }
};

// ======================================================
// 3) MEMBER DASHBOARD (read-only)
// ======================================================
exports.getMemberDashboard = async (req, res) => {
  try {
    const member = await authorizeMember(req, res);
    if (!member) return;

    const [targets, attendance, plan, points, reports, perf] = await Promise.all([
      empTargetModel.getTargetsByFilters({ userIds: [member.id], durationType: "MONTHLY" }),
      model.getMonthAttendanceCounts(member.id),
      model.getTodayPlanStats(member.id),
      model.getTodayVisitPoints(member.id),
      model.getDirectReportsWithAttendance(member.id),
      safeSummary(member.id),
    ]);

    const m = toMember(member);

    return res.status(200).json({
      read_only: true,
      member: {
        id: m.id,
        name: m.name,
        profile_image: m.profile_image,
        job_role: m.job_role,
        level: m.level,
        headquarter: member.headquarter,
      },
      targets: {
        sales: sumTarget(targets, "SALE"),
        collection: sumTarget(targets, "COLLECTION"),
      },
      today_plan: plan, // { planned, completed, pending }
      performance: perf && {
        score: perf.score,
        tier: perf.tier,
        delta: perf.delta,
        team_average: perf.team_average,
        vs_team: perf.vs_team,
        attendance_percent: perf.attendance_percent,
        sales_percent: perf.sales_percent,
        visit_percent: perf.visit_percent,
      },
      attendance_overview: attendance, // { present, absent, leave } (this month)
      route: {
        region: member.headquarter,
        planned: plan.planned,
        completed: plan.completed,
        pending: plan.pending,
        points, // today's visits with GPS, in order
      },
      direct_reports: reports.map(toMember),
    });
  } catch (error) {
    console.error("getMemberDashboard error:", error);
    return res.status(500).json({ message: "Something went wrong", error: error.message });
  }
};