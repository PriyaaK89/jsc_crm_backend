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

  if (!workingMinutes || workingMinutes <= 0) {
    return { unit: "absent", late: isLate };
  }

  if (workingMinutes >= 360) {
    return { unit: "full", late: isLate };
  }

  if (workingMinutes >= 240) {
    return { unit: "half", late: isLate };
  }

  return { unit: "absent", late: isLate };
};