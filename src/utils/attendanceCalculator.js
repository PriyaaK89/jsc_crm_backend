// exports.calculateAttendanceUnit = ({
//   checkInTime,
//   workingMinutes
// }) => {
//   const checkInHour = new Date(checkInTime).getHours();

//   const isLate = checkInHour >= 11;

//   if (workingMinutes >= 360) {
//     return { unit: "full", late: isLate };
//   }

//   if (isLate && workingMinutes < 360 && workingMinutes >= 240) {
//     return { unit: "half", late: 1 };
//   }

//   return { unit: "absent", late: isLate };
// };

exports.calculateAttendanceUnit = ({
  checkInTime,
  workingMinutes
}) => {
  const checkInHour = new Date(checkInTime).getHours();

  const isLate = checkInHour >= 11;

  // FULL DAY (6+ hours)
  if (workingMinutes >= 360) {
    return { unit: "full", late: isLate };
  }

  // HALF DAY (4 to <6 hours)
  if (workingMinutes >= 240) {
    return { unit: "half", late: isLate };
  }

  // LESS THAN 4 HOURS → ABSENT
  return { unit: "absent", late: isLate };
};
