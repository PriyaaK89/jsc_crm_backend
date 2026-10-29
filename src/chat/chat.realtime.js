// Holds the Socket.IO instance + who is online. No business logic here (avoids circular imports).
let io = null;
const online = new Map(); // userId -> Set(socketId)
const background = new Map(); // userId -> Set(socketId) whose app is in the background

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
  const bg = background.get(userId);
  if (bg) { bg.delete(socketId); if (!bg.size) background.delete(userId); }
  if (set.size === 0) {
    online.delete(userId);
    return true; // last connection closed
  }
  return false;
};

// The app tells us when it goes to the background / comes back.
const setForeground = (userId, socketId, foreground) => {
  userId = Number(userId);
  if (foreground) {
    const bg = background.get(userId);
    if (bg) { bg.delete(socketId); if (!bg.size) background.delete(userId); }
  } else {
    if (!background.has(userId)) background.set(userId, new Set());
    background.get(userId).add(socketId);
  }
};

// true only if at least one of the user's connected apps is open on screen
const isForeground = (userId) => {
  userId = Number(userId);
  const all = online.get(userId);
  if (!all || !all.size) return false;
  const bg = background.get(userId);
  return !bg || bg.size < all.size;
};

const isOnline = (userId) => (online.get(Number(userId)) || { size: 0 }).size > 0;

const emitToUser = (userId, event, payload) => {
  if (io) io.to(`user:${userId}`).emit(event, payload);
};
const emitToUsers = (userIds, event, payload) => userIds.forEach((id) => emitToUser(id, event, payload));

module.exports = { setIO, addSocket, removeSocket, setForeground, isForeground, isOnline, emitToUser, emitToUsers };