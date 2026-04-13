const Location = require("../models/location.model");

exports.saveLocation = async (req, res) => {
  try {
    const employee_id = req.user.id;
    const { attendance_id, latitude, longitude, accuracy, speed } = req.body;

    if (!latitude || !longitude) {
      return res.status(400).json({
        success: false,
        message: "Invalid coordinates",
      });
    }
    //  TIME CHECK (10 PM LIMIT)
    const now = new Date();
    const currentHour = now.getHours();

    if (currentHour >= 22) {  // 22 = 10 PM
      return res.status(200).json({
        success: false,
        message: "Tracking stopped after 10 PM",
      });
    }

    await Location.saveLocation({ employee_id, attendance_id, latitude, longitude, accuracy, speed,});

    return res.status(200).json({
      success: true,
      message: "Location saved",
    });
  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  }
};

exports.getEmployeeRoute = async (req, res) => {
  try {
    const { employeeId, date } = req.query;

     if (!date) {
      return res.status(400).json({
        success: false,
        message: "Date is required",
      });
    }

    const start = `${date} 00:00:00`;
    const end = `${date} 23:59:59`;

    const locations = await Location.getLocationsByDate(employeeId, start, end);
    return res.status(200).json({ success: true, data: locations });
  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  }
};

// exports.getEmployeeRoute = async (req, res) => {
//   try {
//     const { employeeId, date } = req.query;

//     if (!employeeId || !date) {
//       return res.status(400).json({
//         success: false,
//         message: "employeeId and date are required",
//       });
//     }

//     const start = `${date} 00:00:00`;
//     const end = `${date} 23:59:59`;

//     const locations = await Location.getLocationsByDate(
//       employeeId,
//       start,
//       end
//     );

//     if (!locations.length) {
//       return res.status(200).json({
//         success: true,
//         message: "No data found",
//         points: [],
//       });
//     }

//     const startPoint = locations[0];
//     const endPoint = locations[locations.length - 1];

//     const startCoord = `${startPoint.longitude},${startPoint.latitude}`;
//     const endCoord = `${endPoint.longitude},${endPoint.latitude}`;

//     let url = `https://apis.mappls.com/advancedmaps/v1/${MAPPLS_API_KEY}/route_adv/driving/${startCoord};${endCoord}`;

//     const waypointsArr = locations
//       .filter((_, index) => index % 10 === 0)
//       .slice(1, -1)
//       .map((p) => `${p.longitude},${p.latitude}`);

//     if (waypointsArr.length) {
//       const waypoints = waypointsArr.join(";");
//       url += `;${waypoints}`;
//     }

//     const response = await axios.get(url);

//     const routeData = response.data.routes[0];

//     const decodedRoute = polyline.decode(routeData.geometry);

//     const formattedRoute = decodedRoute.map(([lat, lng]) => ({
//       lat,
//       lng,
//     }));

//     return res.status(200).json({
//       success: true,
//       points: locations,
//       route: formattedRoute,
//       distance: (routeData.distance / 1000).toFixed(2), // KM
//       duration: (routeData.duration / 60).toFixed(2),   // minutes
//     });

//   } catch (error) {
//     console.error("Route API Error:", error.response?.data || error.message);

//     return res.status(500).json({
//       success: false,
//       message: "Error fetching route",
//       error: error.response?.data || error.message,
//     });
//   }
// };
