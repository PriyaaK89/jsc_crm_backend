const { getUserWithRole } = require("../models/rollingUser.model");
const { getSubordinates } = require("./rollingUser.controller"); // adjust file name if different
const GroupTracking = require("../models/groupTracking.model");


const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

/**
 * Single source of truth for "who can this user see".
 * Returns { error: {status, message} } or { me, members }.
 * - me: the logged-in employee (always viewable)
 * - members: subordinates whose level is strictly BELOW the caller's designation
 *   (higher level number). Anyone at the same or a higher designation is dropped,
 *   even if bad data places them inside the reporting chain.
 */
const resolveScope = async (userId) => {
  const meRow = await getUserWithRole(userId);
  if (!meRow) return { error: { status: 404, message: "User not found" } };

  if (meRow.level === null || meRow.level === undefined || !Number.isFinite(Number(meRow.level))) {
    return { error: { status: 403, message: "Group tracking is not available for your role" } };
  }
  const myLevel = Number(meRow.level);

  const lowestLevel = await GroupTracking.getLowestLevel();
  if (lowestLevel === null || myLevel >= lowestLevel) {
    return { error: { status: 403, message: "Group tracking is not available for your role" } };
  }

  const subs = await getSubordinates(userId);
  const seen = new Set();
  const members = [];

  for (const s of subs) {
    const lvl = Number(s.level);
    if (!Number.isFinite(lvl) || s.level === null) continue;
    if (lvl <= myLevel) continue; // never same or upper level
    if (seen.has(s.id)) continue;
    seen.add(s.id);
    members.push({ id: Number(s.id), name: s.name, job_role: s.job_role, level: lvl });
  }

  members.sort((a, b) => a.level - b.level || String(a.name).localeCompare(String(b.name)));

  return {
    me: {
      id: Number(meRow.id),
      name: meRow.name,
      job_role: meRow.job_role,
      level: myLevel,
    },
    members,
  };
};

// GET /group-tracking/filters
exports.getFilters = async (req, res) => {
  try {
    const scope = await resolveScope(req.user.id);
    if (scope.error) {
      return res.status(scope.error.status).json({ success: false, message: scope.error.message });
    }

    const levelMap = new Map();
    for (const m of scope.members) {
      if (!levelMap.has(m.level)) {
        levelMap.set(m.level, { level: m.level, label: m.job_role || `Level ${m.level}`, count: 0 });
      }
      levelMap.get(m.level).count += 1;
    }

    return res.status(200).json({
      success: true,
      data: {
        me: { ...scope.me, is_self: true },
        levels: [...levelMap.values()].sort((a, b) => a.level - b.level),
        members: scope.members,
      },
    });
  } catch (error) {
    return res.status(500).json({ success: false, message: error.message });
  }
};

// GET /group-tracking/routes?date=YYYY-MM-DD&level=all|me|<n>&employeeId=<id>
exports.getGroupRoutes = async (req, res) => {
  try {
    const { date, level, employeeId } = req.query;

    if (!date || !DATE_RE.test(date)) {
      return res.status(400).json({ success: false, message: "Valid date (YYYY-MM-DD) is required" });
    }

    const scope = await resolveScope(req.user.id);
    if (scope.error) {
      return res.status(scope.error.status).json({ success: false, message: scope.error.message });
    }

    const selfEntry = { ...scope.me, is_self: true };
    let targets;

    if (level === "me" || (employeeId && Number(employeeId) === scope.me.id)) {
      targets = [selfEntry];
    } else {
      let pool = scope.members.map((m) => ({ ...m, is_self: false }));

      if (level && level !== "all") {
        const lvl = Number(level);
        if (!Number.isInteger(lvl)) {
          return res.status(400).json({ success: false, message: "Invalid level" });
        }
        pool = pool.filter((m) => m.level === lvl);
      }

      if (employeeId) {
        const eid = Number(employeeId);
        const found = pool.find((m) => m.id === eid);
        // Not in the caller's eligible set => forbidden (covers upper-level and unrelated users)
        if (!found) {
          return res.status(403).json({
            success: false,
            message: "You are not allowed to view this employee's location",
          });
        }
        pool = [found];
      }

      const includeSelf = !employeeId && (!level || level === "all");
      targets = includeSelf ? [selfEntry, ...pool] : pool;
    }

    const start = `${date} 00:00:00`;
    const end = `${date} 23:59:59`;

    const rows = await GroupTracking.getLocationsForEmployees(targets.map((t) => t.id), start, end);

    const byEmployee = new Map();
    for (const r of rows) {
      const key = Number(r.employee_id);
      if (!byEmployee.has(key)) byEmployee.set(key, []);
      byEmployee.get(key).push({
        latitude: r.latitude,
        longitude: r.longitude,
        recorded_at: r.recorded_at,
      });
    }

    const data = targets.map((t) => ({
      employee: t,
      points: byEmployee.get(t.id) || [],
    }));

    return res.status(200).json({ success: true, date, data });
  } catch (error) {
    return res.status(500).json({ success: false, message: error.message });
  }
};