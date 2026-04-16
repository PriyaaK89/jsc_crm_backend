// require('../src/jobs/cleanup.job');
// require("../src/jobs/attendanceAutoClose");
// const app = require('./app');
// const PORT = process.env.PORT || 5000;

// app.listen(PORT,"0.0.0.0", () => {
//   console.log(` Server running on port ${PORT}`);
// });


require('../src/jobs/cleanup.job');
require("../src/jobs/attendanceAutoClose");

const http = require("http");
const app = require('./app');

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

//  Start server (IMPORTANT: use server.listen, NOT app.listen)
server.listen(PORT, "0.0.0.0", () => {
  console.log(`Server running on port ${PORT}`);
});