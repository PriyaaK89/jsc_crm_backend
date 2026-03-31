require('../src/jobs/cleanup.job');
require("../src/jobs/attendanceAutoClose");
const app = require('./app');
const PORT = process.env.PORT || 5000;

// const bcrypt = require("bcryptjs");

// bcrypt.hash("SuperAdmin@26", 10).then(console.log);

app.listen(PORT,"0.0.0.0", () => {
  console.log(` Server running on port ${PORT}`);
});
