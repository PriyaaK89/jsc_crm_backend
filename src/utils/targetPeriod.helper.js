const formatDate = (date) => {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");

  return `${year}-${month}-${day}`;
};

exports.formatDate = formatDate;
exports.calculateEndDate = (startDate, frequency) => {
  const end = new Date(startDate);

  switch (frequency) {
    case "DAILY":
      break;

    case "WEEKLY":
      end.setDate(end.getDate() + 6);
      break;

    case "FORTNIGHT":
      end.setDate(end.getDate() + 14);
      break;

    case "MONTHLY":
      end.setMonth(end.getMonth() + 1);
      end.setDate(end.getDate() - 1);
      break;

    default:
      throw new Error("Invalid target frequency");
  }

  return formatDate(end);
};

exports.getNextPeriod = (currentEndDate, frequency) => {
  const start = new Date(currentEndDate);
  start.setDate(start.getDate() + 1);

  const startDate = formatDate(start);
  const endDate = exports.calculateEndDate(startDate, frequency);

  return {
    start_date: startDate,
    end_date: endDate,
  };
};

/**
 * Days remaining
 */

exports.calculateDaysRemaining = (endDate) => {
  const today = new Date();
  today.setHours(0, 0, 0, 0);

  const end = new Date(endDate);
  end.setHours(0, 0, 0, 0);

  const diff = end.getTime() - today.getTime();

  return Math.max(Math.ceil(diff / (1000 * 60 * 60 * 24)), 0);
};

/**
 * Is target expired
 */
exports.isExpired = (endDate) => {
  const today = new Date();
  today.setHours(0, 0, 0, 0);

  const end = new Date(endDate);
  end.setHours(0, 0, 0, 0);

  return end.getTime() < today.getTime();
};

/**
 * Is target active
 */
exports.isActive = (startDate, endDate) => {
  const today = new Date();
  today.setHours(0, 0, 0, 0);

  const start = new Date(startDate);
  start.setHours(0, 0, 0, 0);

  const end = new Date(endDate);
  end.setHours(0, 0, 0, 0);

  return (
    today.getTime() >= start.getTime() &&
    today.getTime() <= end.getTime()
  );
};

/**
 * Completion Percentage
 */
exports.calculatePercentage = (achieved, target) => {
  if (target <= 0) return 0;

  const percent = (achieved / target) * 100;

  return Math.min(Number(percent.toFixed(2)), 100);
};

/**
 * Remaining Visits
 */
exports.calculateRemaining = (achieved, target) => {
  return Math.max(target - achieved, 0);
};
