// Holds the Socket.IO instance + who is online. No business logic here (avoids circular imports).
let io = null;
const online = new Map(); // userId -> Set(socketId)

const setIO = (instance) => { io = instance; };

const addSocket = (userId, socketId) => {
  userId = Number(userId);
  if (!online.has(userId)) online.set(userId, new Set());
  const set = online.get(userId);
  const first = set.size === 0;
  set.add(socketId);
  return first; // true if this is the user's first connection
};

const removeSocket = (userId, socketId) => {
  userId = Number(userId);
  const set = online.get(userId);
  if (!set) return false;
  set.delete(socketId);
  if (set.size === 0) {
    online.delete(userId);
    return true; // last connection closed
  }
  return false;
};

const isOnline = (userId) => (online.get(Number(userId)) || { size: 0 }).size > 0;

const emitToUser = (userId, event, payload) => {
  if (io) io.to(`user:${userId}`).emit(event, payload);
};
const emitToUsers = (userIds, event, payload) => userIds.forEach((id) => emitToUser(id, event, payload));

module.exports = { setIO, addSocket, removeSocket, isOnline, emitToUser, emitToUsers };