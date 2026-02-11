exports.calculateAttendanceUnit = ({
  checkInTime,
  workingMinutes
}) => {
  const checkInHour = new Date(checkInTime).getHours();

  const isLate = checkInHour >= 11;

  if (workingMinutes >= 360) {
    return { unit: "full", late: isLate };
  }

  if (isLate && workingMinutes < 360 && workingMinutes >= 180) {
    return { unit: "half", late: 1 };
  }

  return { unit: "absent", late: isLate };
};
