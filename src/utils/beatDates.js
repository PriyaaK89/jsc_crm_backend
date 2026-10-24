// Date helpers for the Beat Plan module.
// All dates are plain "YYYY-MM-DD" strings (same style as DATE_FORMAT in your SQL),
// so there are no timezone surprises.

const pad = (n) => String(n).padStart(2, "0");

const fmt = (d) =>
  `${d.getUTCFullYear()}-${pad(d.getUTCMonth() + 1)}-${pad(d.getUTCDate())}`;

const parse = (s) => {
  const [y, m, d] = s.split("-").map(Number);
  return new Date(Date.UTC(y, m - 1, d));
};

const isValidDate = (s) =>
  typeof s === "string" && /^\d{4}-\d{2}-\d{2}$/.test(s) && fmt(parse(s)) === s;

const addDays = (s, n) => {
  const d = parse(s);
  d.setUTCDate(d.getUTCDate() + n);
  return fmt(d);
};

// Today's date in India (IST = UTC+5:30)
const todayIST = () => fmt(new Date(Date.now() + 5.5 * 60 * 60 * 1000));

// 0 = Sunday ... 6 = Saturday
const weekdayIndex = (s) => parse(s).getUTCDay();

const WEEKDAYS = [
  "Sunday",
  "Monday",
  "Tuesday",
  "Wednesday",
  "Thursday",
  "Friday",
  "Saturday",
];
const weekdayName = (s) => WEEKDAYS[weekdayIndex(s)];

// Monday of the week that contains `s`
const weekStartOf = (s) => addDays(s, -((weekdayIndex(s) + 6) % 7));

const weekEndOf = (weekStart) => addDays(weekStart, 6);

// the 7 dates Mon..Sun
const weekDates = (weekStart) =>
  Array.from({ length: 7 }, (_, i) => addDays(weekStart, i));

// users.week_off can be "Sunday", "Sun", "Saturday,Sunday", '["Sunday"]' ...
// If it is empty we treat Sunday as the weekly off.
const SHORT = ["sun", "mon", "tue", "wed", "thu", "fri", "sat"];

const nonWorkingReason = (date, weekOff, holidaySet) => {
  const offText = String(weekOff || "sunday").toLowerCase();
  if (offText.includes(SHORT[weekdayIndex(date)])) return "WEEK_OFF";
  if (holidaySet && holidaySet.has(date)) return "HOLIDAY";
  return null;
};

module.exports = {
  isValidDate,
  addDays,
  todayIST,
  weekdayName,
  weekStartOf,
  weekEndOf,
  weekDates,
  nonWorkingReason,
};