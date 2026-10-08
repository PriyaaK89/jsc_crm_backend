const model = require("../models/employee-performance/performance.model");
const empTargetModel = require("../models/empTarget.model");

// ======================= CONFIG =======================
const WEIGHTS = { attendance: 20, sales: 25, visit: 20, collection: 20, followup: 15 };
const TIERS = [
  { min: 90, key: "EXCELLENT", label: "Excellent" },
  { min: 80, key: "TOP_PERFORMER", label: "Top Performer" },
  { min: 70, key: "GOOD", label: "Good" },
  { min: 0, key: "NEEDS_IMPROVEMENT", label: "Needs Improvement" },
];
const EXCELLENT_SCORE = 90;
const MIN_DAILY_VISITS = 4;     // same rule as the half-day check in markAttendance
const ORDER_STREAK_DAYS = 5;
const EARLY_MONTH_DAYS = 5;     // no "behind pace" warnings in the first days of a month
const CACHE_TTL_MS = 5 * 60 * 1000;
const MONTH_NAMES = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

// ======================= DATE HELPERS (all plain YYYY-MM-DD strings) =======================
const pad = (n) => String(n).padStart(2, "0");
const ymd = (y, m, d) => `${y}-${pad(m)}-${pad(d)}`;
const parseYmd = (s) => {
  const [y, m, d] = s.split("-").map(Number);
  return { y, m, d };
};
const daysInMonth = (y, m) => new Date(Date.UTC(y, m, 0)).getUTCDate();
const addDays = (s, n) => {
  const { y, m, d } = parseYmd(s);
  return new Date(Date.UTC(y, m - 1, d + n)).toISOString().slice(0, 10);
};
const dow = (s) => {
  const { y, m, d } = parseYmd(s);
  return new Date(Date.UTC(y, m - 1, d)).getUTCDay(); // 0 = Sunday
};
const shiftMonth = (y, m, delta) => {
  const idx = y * 12 + (m - 1) + delta;
  return { y: Math.floor(idx / 12), m: (idx % 12) + 1 };
};
const eachDay = (start, end) => {
  const out = [];
  for (let d = start; d <= end; d = addDays(d, 1)) out.push(d);
  return out;
};
const getTodayIST = () =>
  new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Kolkata" }).format(new Date());

// ======================= SMALL HELPERS =======================
const inrShort = (n) => {
  n = Number(n) || 0;
  if (n >= 1e7) return `₹${+(n / 1e7).toFixed(2)}Cr`;
  if (n >= 1e5) return `₹${+(n / 1e5).toFixed(2)}L`;
  if (n >= 1e3) return `₹${+(n / 1e3).toFixed(1)}K`;
  return `₹${Math.round(n)}`;
};
const plural = (n, word) => `${n} ${word}${n === 1 ? "" : "s"}`;
const ceilTo = (n, step) => Math.ceil(n / step) * step;
const pctInt = (v) => (v == null ? null : Math.round(v));

const mapLimit = async (items, limit, fn) => {
  const out = new Array(items.length);
  let next = 0;
  const workers = Array.from({ length: Math.min(limit, items.length) }, async () => {
    while (next < items.length) {
      const i = next++;
      out[i] = await fn(items[i], i);
    }
  });
  await Promise.all(workers);
  return out;
};

// tiny in-memory cache (per server process)
const cache = new Map();
const cacheGet = (key) => {
  const e = cache.get(key);
  if (!e) return null;
  if (Date.now() > e.exp) {
    cache.delete(key);
    return null;
  }
  return e.val;
};
const cacheSet = (key, val) => {
  cache.set(key, { val, exp: Date.now() + CACHE_TTL_MS });
  if (cache.size > 500) cache.delete(cache.keys().next().value);
};

// ======================= SCORE =======================
const percentsOf = (m) => ({
  attendance: m.attendance.pct,
  sales: m.sales ? m.sales.pct : null,
  visit: m.visit_target ? m.visit_target.pct : null,
  collection: m.collection ? m.collection.pct : null,
  followup: m.follow_up ? m.follow_up.pct : null,
});

// Each metric capped at 100; metrics without data are dropped and the
// remaining weights are rescaled so the score is still out of 100.
const scoreRaw = (p) => {
  let wSum = 0;
  let acc = 0;
  for (const [key, w] of Object.entries(WEIGHTS)) {
    const v = p[key];
    if (v == null) continue;
    wSum += w;
    acc += (w * Math.min(Math.max(v, 0), 100)) / 100;
  }
  return wSum > 0 ? (acc / wSum) * 100 : null;
};
const scoreOf = (m) => {
  const s = scoreRaw(percentsOf(m));
  return s == null ? null : Math.round(s);
};
const tierOf = (score) => {
  if (score == null) return null;
  const t = TIERS.find((x) => score >= x.min);
  return { key: t.key, label: t.label };
};

// ======================= METRIC CALCULATION =======================
const withPct = (b) =>
  b && b.target > 0
    ? { target: b.target, achieved: b.achieved, pct: (b.achieved / b.target) * 100 }
    : null;

const calcAttendance = (attMap, workingDays, today, firstDate) => {
  const res = { pct: null, credit: 0, days_expected: 0, present_days: 0, half_days: 0, late_days: 0 };
  if (!firstDate) return res;

  for (const d of workingDays) {
    if (d < firstDate) continue; // before the employee's first attendance record
    const r = attMap.get(d);

    if (!r) {
      if (d === today) continue; // today counts only once they have checked in
      res.days_expected++;       // no record on a working day = absent
      continue;
    }

    const unit = r.attendance_unit;
    const status = r.status;
    if (status === "leave" || status === "week_off" || unit === "leave" || unit === "holiday" || unit === "week_off") {
      continue; // leave / week-off: not counted against the employee
    }

    res.days_expected++;
    if (unit === "full") {
      res.credit += 1;
      res.present_days++;
    } else if (unit === "half") {
      res.credit += 0.5;
      res.present_days++;
      res.half_days++;
    } else if (!unit && status === "present" && d === today) {
      res.credit += 1; // checked in today, day not over yet
      res.present_days++;
    } else {
      continue; // absent, or a past day whose day-over was never done: no credit
    }
    if (Number(r.late_login) === 1) res.late_days++;
  }

  res.pct = res.days_expected > 0 ? (res.credit / res.days_expected) * 100 : null;
  return res;
};

const calcVisitsPerDay = (attMap, visitMap) => {
  let fieldDays = 0;
  let total = 0;
  for (const [d, r] of attMap) {
    const closed = r.attendance_unit === "full" || r.attendance_unit === "half";
    if (r.work_type === "field" && closed) {
      fieldDays++;
      total += visitMap.get(d) || 0;
    }
  }
  return { field_days: fieldDays, total, per_day: fieldDays ? total / fieldDays : null };
};

// Metrics for many employees over [rs, re] (re <= today)
const computeMetricsBulk = async (userIds, rs, re, today) => {
  const out = new Map();
  if (!userIds.length) return out;

  const [holidays, attRows, firstMap, visitRows, targetRows, visitTotals, followUps] =
    await Promise.all([
      model.getHolidayDates(rs, re),
      model.getAttendanceRows(userIds, rs, re),
      model.getFirstAttendanceDates(userIds),
      model.getVisitCountsByDay(userIds, rs, re),
      model.getMonthlyTargets(userIds, rs, re),
      model.getVisitTargetTotals(userIds, rs, re),
      model.getFollowUpStats(userIds, rs, re, today),
    ]);

  const attByUser = new Map();
  attRows.forEach((r) => {
    if (!attByUser.has(r.employee_id)) attByUser.set(r.employee_id, new Map());
    attByUser.get(r.employee_id).set(r.d, r);
  });

  const visitsByUser = new Map();
  visitRows.forEach((r) => {
    if (!visitsByUser.has(r.user_id)) visitsByUser.set(r.user_id, new Map());
    visitsByUser.get(r.user_id).set(r.d, Number(r.c) || 0);
  });

  const workingDays = eachDay(rs, re).filter((d) => dow(d) !== 0 && !holidays.has(d));

  // achievement of each monthly target, counted only up to the cutoff `re`
  const achieved = await mapLimit(targetRows, 8, async (t) => {
    const cappedEnd = t.end_date < re ? t.end_date : re;
    if (cappedEnd < t.start_date) return 0;
    return empTargetModel.calculateAchievement({ ...t, end_date: cappedEnd });
  });

  const targetsByUser = new Map();
  targetRows.forEach((t, i) => {
    const bucket = targetsByUser.get(t.user_id) || {};
    const x = bucket[t.target_type] || { target: 0, achieved: 0 };
    x.target += Number(t.target_amount) || 0;
    x.achieved += Number(achieved[i]) || 0;
    bucket[t.target_type] = x;
    targetsByUser.set(t.user_id, bucket);
  });

  for (const id of userIds) {
    const attMap = attByUser.get(id) || new Map();
    const tb = targetsByUser.get(id) || {};
    const fu = followUps.get(id);

    out.set(id, {
      attendance: calcAttendance(attMap, workingDays, today, firstMap.get(id) || null),
      visits: calcVisitsPerDay(attMap, visitsByUser.get(id) || new Map()),
      sales: withPct(tb.SALE),
      collection: withPct(tb.COLLECTION),
      new_distributor: tb.NEW_DISTRIBUTOR && tb.NEW_DISTRIBUTOR.target > 0 ? tb.NEW_DISTRIBUTOR : null,
      visit_target: withPct(visitTotals.get(id)),
      follow_up:
        fu && fu.due > 0
          ? { due: fu.due, closed: fu.closed, pct: (fu.closed / fu.due) * 100 }
          : null,
    });
  }
  return out;
};

// ======================= CORE (current month-to-date) =======================
const buildCore = async (userId, scope) => {
  const today = getTodayIST();
  const user = await model.getUserBasic(userId);
  if (!user) throw new Error("User not found");

  const { y, m, d } = parseYmd(today);
  const monthStart = ymd(y, m, 1);
  const monthEnd = ymd(y, m, daysInMonth(y, m));

  // previous month, same day range (so the "+N pts" comparison is fair early in the month)
  const prev = shiftMonth(y, m, -1);
  const prevStart = ymd(prev.y, prev.m, 1);
  const prevCutoff = ymd(prev.y, prev.m, Math.min(d, daysInMonth(prev.y, prev.m)));

  const peerIds = await model.getPeerIds(user, scope);

  const [peerMetrics, prevMetrics, openFollowUps, overdue, orderDates, holidays] =
    await Promise.all([
      computeMetricsBulk(peerIds, monthStart, today, today),
      computeMetricsBulk([userId], prevStart, prevCutoff, today),
      model.getOpenFollowUps(userId, today, monthEnd),
      model.getOverdueSummary(userId, today),
      model.getOrderDates(userId, monthStart, today),
      model.getHolidayDates(monthStart, monthEnd),
    ]);

  const mine = peerMetrics.get(userId);
  const score = scoreOf(mine);
  const prevScore = scoreOf(prevMetrics.get(userId));
  const delta = score != null && prevScore != null ? score - prevScore : null;

  const others = peerIds.filter((id) => id !== userId);
  const scoreById = new Map(peerIds.map((id) => [id, scoreOf(peerMetrics.get(id))]));
  const otherScores = others.map((id) => scoreById.get(id)).filter((s) => s != null);

  const teamAverage = otherScores.length
    ? Math.round(otherScores.reduce((a, b) => a + b, 0) / otherScores.length)
    : null;
  const rank =
    score == null
      ? null
      : 1 + others.filter((id) => (scoreById.get(id) ?? -1) > score).length;

  const avgOfOthers = (pick) => {
    const vals = others
      .map((id) => pick(peerMetrics.get(id)))
      .filter((v) => v != null)
      .map((v) => Math.min(v, 100));
    return vals.length ? Math.round(vals.reduce((a, b) => a + b, 0) / vals.length) : null;
  };
  const teamMetricAvg = {
    attendance: avgOfOthers((x) => x.attendance.pct),
    sales: avgOfOthers((x) => (x.sales ? x.sales.pct : null)),
    visit: avgOfOthers((x) => (x.visit_target ? x.visit_target.pct : null)),
    collection: avgOfOthers((x) => (x.collection ? x.collection.pct : null)),
    followup: avgOfOthers((x) => (x.follow_up ? x.follow_up.pct : null)),
  };

  const workingDaysThisMonth = eachDay(monthStart, today).filter(
    (day) => dow(day) !== 0 && !holidays.has(day)
  );

  return {
    today, user, scope,
    mine, score, prevScore, delta,
    tier: tierOf(score),
    rank, teamSize: peerIds.length, teamAverage, teamMetricAvg,
    openFollowUps, overdue, orderDates, workingDaysThisMonth,
  };
};

const getCore = async (userId, scope, refresh) => {
  const key = `core:${userId}:${scope}:${getTodayIST()}`;
  if (!refresh) {
    const hit = cacheGet(key);
    if (hit) return hit;
  }
  const core = await buildCore(userId, scope);
  cacheSet(key, core);
  return core;
};

// ======================= TREND =======================
const getTrend = async (userId, period, core, refresh) => {
  const key = `trend:${userId}:${period}:${core.today}`;
  if (!refresh) {
    const hit = cacheGet(key);
    if (hit) return hit;
  }

  const { today } = core;
  const { y, m, d } = parseYmd(today);
  let bars;

  if (period === "1M") {
    // weekly bars, each one = month-to-date score as of that week's end
    const dim = daysInMonth(y, m);
    const weeks = [[1, 7], [8, 14], [15, 21], [22, dim]];
    bars = await Promise.all(
      weeks.map(async ([startDay, endDay], i) => {
        const label = `W${i + 1}`;
        if (startDay > d) return { label, key: label, score: null, is_current: false };
        const cutoff = ymd(y, m, Math.min(endDay, d));
        const isCurrent = cutoff === today;
        const score = isCurrent
          ? core.score
          : scoreOf((await computeMetricsBulk([userId], ymd(y, m, 1), cutoff, today)).get(userId));
        return { label, key: label, score, is_current: isCurrent };
      })
    );
  } else {
    const count = period === "3M" ? 3 : 6;
    bars = await Promise.all(
      Array.from({ length: count }, (_, idx) => count - 1 - idx).map(async (back) => {
        const mm = shiftMonth(y, m, -back);
        const label = MONTH_NAMES[mm.m - 1];
        const key = `${mm.y}-${pad(mm.m)}`;
        if (back === 0) return { label, key, score: core.score, is_current: true };
        const start = ymd(mm.y, mm.m, 1);
        const end = ymd(mm.y, mm.m, daysInMonth(mm.y, mm.m));
        const score = scoreOf((await computeMetricsBulk([userId], start, end, today)).get(userId));
        return { label, key, score, is_current: false };
      })
    );
  }

  const trend = bars.map((b) => ({
    ...b,
    tier_key: b.score == null ? null : tierOf(b.score).key,
    color: b.score != null && b.score < 70 ? "orange" : "green",
  }));

  cacheSet(key, trend);
  return trend;
};

// ======================= KEY METRICS =======================
const buildKeyMetrics = (c) => {
  const m = c.mine;
  const a = m.attendance;

  const rows = [
    {
      key: "attendance",
      label: "Attendance Consistency",
      pct: a.pct,
      detail: a.days_expected
        ? `${a.present_days} of ${a.days_expected} working days${a.half_days ? ` (${plural(a.half_days, "half day")})` : ""}`
        : null,
    },
    {
      key: "sales",
      label: "Sales Target Achievement",
      pct: m.sales ? m.sales.pct : null,
      detail: m.sales ? `${inrShort(m.sales.achieved)} of ${inrShort(m.sales.target)}` : "No monthly target assigned",
    },
    {
      key: "visit",
      label: "Visit Target Achievement",
      pct: m.visit_target ? m.visit_target.pct : null,
      detail: m.visit_target ? `${m.visit_target.achieved} of ${m.visit_target.target} visits` : "No visit target assigned",
    },
    {
      key: "collection",
      label: "Collection Efficiency",
      pct: m.collection ? m.collection.pct : null,
      detail: m.collection ? `${inrShort(m.collection.achieved)} of ${inrShort(m.collection.target)}` : "No monthly target assigned",
    },
    {
      key: "followup",
      label: "Follow-up Closure Rate",
      pct: m.follow_up ? m.follow_up.pct : null,
      detail: m.follow_up ? `${m.follow_up.closed} of ${m.follow_up.due} closed on time` : "No follow-ups due yet",
    },
  ];

  return rows.map((r) => ({
    key: r.key,
    label: r.label,
    percent: pctInt(r.pct),
    bar_percent: r.pct == null ? 0 : Math.min(100, Math.round(r.pct)),
    has_data: r.pct != null,
    detail: r.detail,
    team_average: c.teamMetricAvg[r.key],
    weight: WEIGHTS[r.key],
  }));
};

// ======================= INSIGHTS =======================
const buildInsights = (c) => {
  const m = c.mine;
  const { y, m: mo, d } = parseYmd(c.today);
  const dim = daysInMonth(y, mo);
  const pace = Math.round((d / dim) * 100);
  const daysLeft = Math.max(dim - d, 1);
  const early = d < EARLY_MONTH_DAYS;

  const strengths = [];
  const growth = [];
  const add = (list, priority, key, title, message) => list.push({ priority, key, title, message });

  // attendance
  const a = m.attendance;
  if (a.pct != null && a.days_expected >= 3) {
    const teamNote = c.teamMetricAvg.attendance != null ? ` Team average is ${c.teamMetricAvg.attendance}%.` : "";
    if (a.pct >= 90) {
      add(strengths, 1, "attendance", "Excellent Attendance Discipline",
        `${Math.round(a.pct)}% attendance this month (${a.present_days} of ${a.days_expected} working days)${a.late_days ? `, ${plural(a.late_days, "late login")}` : ", no late logins"}.${teamNote}`);
    } else if (a.pct < 85) {
      add(growth, 6, "attendance", "Attendance Needs Attention",
        `${Math.round(a.pct)}% attendance this month — ${a.present_days} of ${a.days_expected} working days${a.half_days ? ` including ${plural(a.half_days, "half day")}` : ""}. Attendance carries ${WEIGHTS.attendance}% of your score.`);
    }
  }

  // visits per day
  const vpd = m.visits.per_day;
  if (vpd != null && m.visits.field_days >= 3) {
    if (vpd >= MIN_DAILY_VISITS) {
      add(strengths, 2, "visits", "Strong Visit Frequency",
        `You're averaging ${vpd.toFixed(1)} visits/day, ahead of the ${MIN_DAILY_VISITS.toFixed(1)} target — great field coverage of your beat.`);
    } else {
      add(growth, 4, "visits", "Visit Frequency Below Target",
        `You're averaging ${vpd.toFixed(1)} visits/day against the ${MIN_DAILY_VISITS} daily minimum. Field days with fewer than ${MIN_DAILY_VISITS} visits count as half days.`);
    }
  }

  // sales
  if (m.sales) {
    const s = m.sales;
    const pending = Math.max(s.target - s.achieved, 0);
    if (s.pct >= 100) {
      add(strengths, 3, "sales", "Sales Target Achieved", `You've reached ${Math.round(s.pct)}% of your ${inrShort(s.target)} sales target.`);
    } else if (s.pct >= pace) {
      add(strengths, 3, "sales", "Sales On Track", `${Math.round(s.pct)}% of your ${inrShort(s.target)} sales target is done with ${pace}% of the month gone.`);
    } else if (!early) {
      add(growth, 1, "sales", "Sales Target Behind Pace",
        `${inrShort(pending)} is still pending against your ${inrShort(s.target)} sales target — about ${inrShort(Math.ceil(pending / daysLeft))} per day for the rest of the month.`);
    }
  }

  // collection
  if (m.collection) {
    const cl = m.collection;
    const pending = Math.max(cl.target - cl.achieved, 0);
    if (cl.pct >= 100) {
      add(strengths, 4, "collection", "Collection Target Achieved", `You've collected ${Math.round(cl.pct)}% of your ${inrShort(cl.target)} collection target.`);
    } else if (cl.pct >= pace) {
      add(strengths, 4, "collection", "Collection On Track", `${Math.round(cl.pct)}% of your ${inrShort(cl.target)} collection target is done with ${pace}% of the month gone.`);
    } else if (!early) {
      const overdueNote = c.overdue.parties > 0
        ? ` Prioritize the ${plural(c.overdue.parties, "overdue account")} flagged on your Dashboard this week.`
        : "";
      add(growth, 2, "collection", "Collection Efficiency Below Target",
        `${inrShort(pending)} is still pending against your ${inrShort(cl.target)} collection target.${overdueNote}`);
    }
  }

  // follow-ups
  if (m.follow_up && m.follow_up.due >= 3) {
    const f = m.follow_up;
    if (f.pct >= 80) {
      add(strengths, 5, "followup", "Reliable Follow-ups", `${f.closed} of ${f.due} scheduled follow-ups were closed on time (${Math.round(f.pct)}%).`);
    } else if (f.pct < 70) {
      add(growth, 3, "followup", "Follow-up Closure Needs Attention",
        `Only ${Math.round(f.pct)}% of scheduled follow-ups were closed on time. Try setting reminders 1 day before the promised date to avoid slippage.`);
    }
  }

  // visit target
  if (m.visit_target) {
    const v = m.visit_target;
    if (v.pct >= 100) {
      add(strengths, 6, "visit_target", "Visit Target Achieved", `${v.achieved} of ${v.target} target visits completed.`);
    } else if (!early && v.pct < pace - 10) {
      add(growth, 5, "visit_target", "Visit Target Behind Pace", `${v.achieved} of ${v.target} target visits done (${Math.round(v.pct)}%) with ${pace}% of the month gone.`);
    }
  }

  const top = (list, n) =>
    list.sort((x, y2) => x.priority - y2.priority).slice(0, n).map(({ priority, ...rest }) => rest);

  return { strengths: top(strengths, 3), growth_areas: top(growth, 3) };
};

// ======================= HOW TO REACH "EXCELLENT" =======================
const buildSteps = (c) => {
  const m = c.mine;
  const base = percentsOf(m);
  const baseRaw = scoreRaw(base);
  if (baseRaw == null) return [];

  const gain = (patch) => scoreRaw({ ...base, ...patch }) - baseRaw;
  const steps = [];

  // close pending follow-ups on time
  if (c.openFollowUps > 0 && (!m.follow_up || m.follow_up.pct < 100)) {
    const k = Math.min(3, c.openFollowUps);
    const due = m.follow_up ? m.follow_up.due : 0;
    const closed = m.follow_up ? m.follow_up.closed : 0;
    steps.push({
      key: "close_followups",
      label: `Close ${k} more pending follow-up${k > 1 ? "s" : ""} on time`,
      points: Math.round(gain({ followup: ((closed + k) / (due + k)) * 100 })),
    });
  }

  // collection
  if (m.collection && m.collection.pct < 100) {
    const pending = m.collection.target - m.collection.achieved;
    const cap = c.overdue.amount > 0 ? Math.min(pending, c.overdue.amount) : pending;
    const amount = Math.min(cap, ceilTo(m.collection.target * 0.15, 10000));
    if (amount > 0) {
      steps.push({
        key: "collect_overdue",
        label: c.overdue.amount > 0 ? `Recover ${inrShort(amount)}+ from overdue accounts` : `Collect ${inrShort(amount)} more`,
        points: Math.round(gain({ collection: ((m.collection.achieved + amount) / m.collection.target) * 100 })),
      });
    }
  }

  // sales
  if (m.sales && m.sales.pct < 100) {
    const pending = m.sales.target - m.sales.achieved;
    const amount = Math.min(pending, ceilTo(m.sales.target * 0.15, 10000));
    if (amount > 0) {
      steps.push({
        key: "add_sales",
        label: `Add ${inrShort(amount)} in sales`,
        points: Math.round(gain({ sales: ((m.sales.achieved + amount) / m.sales.target) * 100 })),
      });
    }
  }

  // visit target
  if (m.visit_target && m.visit_target.pct < 100) {
    const remaining = m.visit_target.target - m.visit_target.achieved;
    const k = Math.min(remaining, Math.max(3, Math.ceil(m.visit_target.target * 0.1)));
    if (k > 0) {
      steps.push({
        key: "complete_visits",
        label: `Complete ${k} more target visits`,
        points: Math.round(gain({ visit: ((m.visit_target.achieved + k) / m.visit_target.target) * 100 })),
      });
    }
  }

  const scored = steps.filter((s) => s.points >= 1).sort((a, b) => b.points - a.points).slice(0, 3);

  // new distributors are NOT part of the score: suggestion only, no points
  const nd = m.new_distributor;
  if (nd && nd.achieved < nd.target && scored.length < 3) {
    const n = Math.round(nd.target - nd.achieved);
    scored.push({
      key: "onboard_distributors",
      label: `Onboard ${n} more distributor${n > 1 ? "s" : ""}`,
      points: null,
    });
  }
  return scored;
};

// ======================= BADGES =======================
const bestOrderStreak = (workingDays, orderSet) => {
  let best = 0;
  let cur = 0;
  for (const d of workingDays) {
    if (orderSet.has(d)) {
      cur++;
      best = Math.max(best, cur);
    } else {
      cur = 0;
    }
  }
  return best;
};

const buildBadges = (c) => {
  const m = c.mine;
  const a = m.attendance;
  const streak = bestOrderStreak(c.workingDaysThisMonth, new Set(c.orderDates));
  const vt = m.visit_target;
  const col = m.collection;
  const fu = m.follow_up;

  return [
    {
      key: "PERFECT_ATTENDANCE", label: "Perfect Attendance",
      unlocked: a.pct != null && a.days_expected >= 5 && a.pct >= 100,
      progress: a.pct != null ? `${Math.round(a.pct)}% / 100%` : "No data yet",
    },
    {
      key: "VISIT_CHAMPION", label: "Visit Champion",
      unlocked: !!vt && vt.pct >= 100,
      progress: vt ? `${Math.round(vt.pct)}% of visit target` : "No visit target",
    },
    {
      key: "ORDER_STREAK", label: "Order Streak",
      unlocked: streak >= ORDER_STREAK_DAYS,
      progress: `${streak} / ${ORDER_STREAK_DAYS} days in a row`,
    },
    {
      key: "COLLECTION_PRO", label: "Collection Pro",
      unlocked: !!col && col.pct >= 100,
      progress: col ? `${Math.round(col.pct)}% of collection target` : "No collection target",
    },
    {
      key: "TOP_CLOSER", label: "Top Closer",
      unlocked: !!fu && fu.due >= 5 && fu.pct >= 90,
      progress: fu ? `${Math.round(fu.pct)}% closed on time (${fu.due} due)` : "No follow-ups due yet",
    },
  ];
};

// ======================= HERO TEXT =======================
const buildHero = (c) => {
  const first = String(c.user.name || "").trim().split(/\s+/)[0] || "there";
  const { score, tier, delta, teamAverage } = c;

  let headline;
  if (score == null) headline = `Welcome, ${first}!`;
  else if (tier.key === "EXCELLENT") headline = `Outstanding work, ${first}!`;
  else if (tier.key === "TOP_PERFORMER") headline = `Great work, ${first}!`;
  else if (tier.key === "GOOD") headline = `Good going, ${first}!`;
  else headline = `Let's pick it up, ${first}.`;

  let message;
  if (score == null) {
    message = "Your score will appear once you have attendance, visits or targets recorded this month.";
  } else {
    const parts = [];
    if (delta == null) parts.push(`Your performance score is ${score} this month`);
    else if (delta === 0) parts.push("Your performance score is unchanged this month");
    else parts.push(`Your performance score is ${delta > 0 ? "up" : "down"} ${plural(Math.abs(delta), "point")} this month`);

    if (teamAverage != null) {
      const diff = score - teamAverage;
      parts.push(
        diff === 0
          ? `in line with the team average of ${teamAverage}`
          : `${plural(Math.abs(diff), "point")} ${diff > 0 ? "above" : "below"} the team average of ${teamAverage}`
      );
    }
    message = `${parts.join(" — ")}.`;
  }
  return { headline, message };
};

const buildTip = (c, steps) => {
  if (c.score == null) return "Mark attendance and log visits to start building your score.";
  if (c.score >= EXCELLENT_SCORE) return "You're in the Excellent tier — keep it up!";
  const first = steps.find((s) => s.points != null);
  if (first) return `${first.label} to reach "Excellent" tier`;
  return 'Stay consistent with attendance, visits and follow-ups to reach "Excellent" tier';
};

// ======================= PUBLIC API =======================
exports.getFullReport = async (userId, { period = "6M", scope = "team", refresh = false } = {}) => {
  const core = await getCore(userId, scope, refresh);
  const [trend] = await Promise.all([getTrend(userId, period, core, refresh)]);
  const steps = buildSteps(core);
  const hero = buildHero(core);
  const m = core.mine;

  return {
    generated_at: new Date().toISOString(),
    period,
    scope,
    employee: {
      id: core.user.id,
      name: core.user.name,
      role_name: core.user.role_name,
      level: core.user.level,
    },
    hero: {
      score: core.score,
      tier: core.tier,
      headline: hero.headline,
      message: hero.message,
      delta: core.delta,
      rank: core.rank,
      team_size: core.teamSize,
      team_average: core.teamAverage,
      vs_team: core.score != null && core.teamAverage != null ? core.score - core.teamAverage : null,
      attendance_percent: pctInt(m.attendance.pct),
    },
    trend,
    metrics: buildKeyMetrics(core),
    insights: buildInsights(core),
    how_to_reach_excellent: {
      target_score: EXCELLENT_SCORE,
      reached: core.score != null && core.score >= EXCELLENT_SCORE,
      points_needed: core.score == null ? null : Math.max(EXCELLENT_SCORE - core.score, 0),
      steps,
    },
    badges: buildBadges(core),
    new_distributor: m.new_distributor
      ? {
          target: m.new_distributor.target,
          achieved: m.new_distributor.achieved,
          percent: pctInt((m.new_distributor.achieved / m.new_distributor.target) * 100),
        }
      : null,
  };
};

// light payload for the dashboard "Performance Tracker" card
exports.getSummary = async (userId, { scope = "team", refresh = false } = {}) => {
  const core = await getCore(userId, scope, refresh);
  const steps = buildSteps(core);
  const m = core.mine;

  return {
    score: core.score,
    tier: core.tier,
    delta: core.delta,
    rank: core.rank,
    team_size: core.teamSize,
    team_average: core.teamAverage,
    vs_team: core.score != null && core.teamAverage != null ? core.score - core.teamAverage : null,
    tip: buildTip(core, steps),
    attendance_percent: pctInt(m.attendance.pct),
    sales_percent: pctInt(m.sales ? m.sales.pct : null),
    visit_percent: pctInt(m.visit_target ? m.visit_target.pct : null),
    has_data: core.score != null,
  };
};