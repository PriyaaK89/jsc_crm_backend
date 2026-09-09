// require('../src/jobs/cleanup.job');
// require("../src/jobs/attendanceAutoClose");
// const app = require('./app');
// const PORT = process.env.PORT || 5000;

// app.listen(PORT,"0.0.0.0", () => {
//   console.log(` Server running on port ${PORT}`);
// });
require('dotenv').config({
  path: require('path').resolve(__dirname, '../.env')
});

process.on("uncaughtException", (err) => {
  console.error("UNCAUGHT EXCEPTION:", err);
});

process.on("unhandledRejection", (reason, promise) => {
  console.error("UNHANDLED REJECTION:", reason);
});
console.log("SERVER FILE STARTED");
// require('dotenv').config();
require('../src/jobs/cleanup.job');
require("../src/jobs/attendanceAutoClose");
require("../src/jobs/visitTargetSheduler");
require("../src/jobs/reminderCron");
require("../src/jobs/attendanceReminder.cron");
// require("../src/jobs/ledgerOutstandingReminder.cron");
const db = require('./config/db');

const http = require("http");
const app = require('./app');
app.disable("etag");
// app.use((req, res, next) => {
//   res.setHeader(
//     "Cache-Control",
//     "no-store, no-cache, must-revalidate, private"
//   );
//   next();
// });

const { Server } = require("socket.io");

const PORT = process.env.PORT || 5000;

//  Create HTTP server manually
const server = http.createServer(app);

//  Attach Socket.IO
const io = new Server(server, {
  cors: {
    origin: "*",
    methods: ["GET", "POST", "PUT", "DELETE"]
  }
});

// Make io globally available
global.io = io;

//  Socket connection
io.on("connection", (socket) => {
  console.log("Client connected:", socket.id);

  // Admin joins room
  socket.on("joinAdmin", () => {
    socket.join("admins");
    console.log("Admin joined");
  });

  socket.on("disconnect", () => {
    console.log("Client disconnected:", socket.id);
  });
});

console.log("ENV CHECK:", {
  host: process.env.DB_HOST,
  user: process.env.DB_USER,
  pass: process.env.DB_PASS,
  db: process.env.DB_NAME
});
// quick manual test, e.g. in a scratch file or temp route
// const { processExpiredAssignments } = require("../src/jobs/visitTargetSheduler");
// processExpiredAssignments()
//   .then(() => console.log("rollover done"))
//   .catch(err => console.error("rollover failed:", err));

//  Start server (IMPORTANT: use server.listen, NOT app.listen)
server.listen(PORT, "0.0.0.0", () => {
  console.log(`Server running on port ${PORT}`);
});