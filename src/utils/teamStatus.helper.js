// green = present + field work, blue = present + office/wfh, orange = leave, grey = not checked in
const resolveStatus = (m) => {
  if (m.attendance_status === "leave") return "on_leave";
  if (m.attendance_status === "present" || m.attendance_status === "day_over") {
    return m.work_type === "field" ? "in_field" : "in_office";
  }
  return "not_checked_in";
};

const resolveLocationText = (m, status) => {
  if (status === "on_leave") return "On Leave";
  if (status === "not_checked_in") return "Not checked in";
  if (m.attendance_status === "day_over" && m.day_over_location) return m.day_over_location;
  return m.visit_location || (status === "in_office" ? "Office" : m.headquarter || "In field");
};

const toMember = (m) => {
  const status = resolveStatus(m);
  return {
    id: m.id,
    name: m.name,
    contact_no: m.contact_no,
    profile_image: m.profile_image,
    // job_role: m.job_role,
        job_role: cleanRole(m.job_role),
    level: m.level,
    work_type: m.work_type || null,
    status, // in_field | in_office | on_leave | not_checked_in
    location_text: resolveLocationText(m, status),
  };
};

const minutesLabel = (min) => {
  if (min == null) return null;
  if (min < 1) return "Just now";
  if (min < 60) return `${min} min ago`;
  const h = Math.floor(min / 60);
  return h < 24 ? `${h} hr ago` : `${Math.floor(h / 24)} d ago`;
};

// "Regional Sales Manager (R.S.M)" -> "Regional Sales Manager"
const cleanRole = (name) =>
  String(name || "").replace(/\s*\(.*?\)\s*/g, " ").replace(/\s+/g, " ").trim();

// "Regional Sales Manager (R.S.M)" -> "RSM"   |   "Field Assistant" -> "FA"
const roleCode = (name) => {
  const m = String(name || "").match(/\(([^)]*)\)/);
  if (m) {
    const code = m[1].replace(/[^A-Za-z]/g, "").toUpperCase();
    if (code) return code;
  }
  return cleanRole(name)
    .split(/\s+/)
    .filter(Boolean)
    .map((w) => w[0].toUpperCase())
    .join("");
};

const inrShort = (n) => {
  n = Number(n) || 0;
  if (n >= 1e7) return `₹${+(n / 1e7).toFixed(2)}Cr`;
  if (n >= 1e5) return `₹${+(n / 1e5).toFixed(1)}L`;
  if (n >= 1e3) return `₹${+(n / 1e3).toFixed(1)}K`;
  return `₹${Math.round(n)}`;
};

// module.exports = { resolveStatus, toMember, minutesLabel, abbreviate, inrShort };
module.exports = { resolveStatus, toMember, minutesLabel, inrShort, cleanRole, roleCode, abbreviate: roleCode,};