const { Server } = require("socket.io");
const jwt = require("jsonwebtoken");
const realtime = require("./chat.realtime");
const service = require("./chat.service");
const access = require("./chat.access");

const initChatSocket = (httpServer) => {
  const io = new Server(httpServer, {
    cors: { origin: "*" }, // tighten for the web admin origin if needed
    pingInterval: 25000,
    pingTimeout: 20000,
    maxHttpBufferSize: 1e6,
  });
  realtime.setIO(io);

  // ---- Auth: Flutter connects with { auth: { token: "<same JWT as REST>" } } ----
  io.use(async (socket, next) => {
    try {
      const token =
        (socket.handshake.auth && socket.handshake.auth.token) ||
        String(socket.handshake.headers.authorization || "").replace(/^Bearer\s+/i, "");
      if (!token) return next(new Error("AUTH_REQUIRED"));

      // ADJUST to match your auth middleware (secret + payload field holding the user id)
      const decoded = jwt.verify(token, process.env.JWT_SECRET);
      const userId = Number(decoded.id ?? decoded.user_id ?? decoded.userId);
      if (!userId) return next(new Error("AUTH_INVALID"));

      const user = await access.getChatUser(userId);
      if (!user || !user.is_active) return next(new Error("AUTH_INVALID"));

      socket.data.userId = userId;
      next();
    } catch (e) {
      next(new Error("AUTH_INVALID"));
    }
  });

  io.on("connection", async (socket) => {
    const userId = socket.data.userId;
    socket.join(`user:${userId}`); // all events go to this room, so multi-device works
    const first = realtime.addSocket(userId, socket.id);

    try {
      await service.onSocketConnected(userId, first);
    } catch (e) {
      console.error("[chat] connect handler failed:", e.message);
    }

    const handle = (fn) => async (payload, ack) => {
      const reply = typeof ack === "function" ? ack : () => {};
      try {
        reply({ ok: true, data: await fn(payload || {}) });
      } catch (e) {
        if (!e.status) console.error("[chat] socket error:", e);
        reply({ ok: false, code: e.status || 500, message: e.message });
      }
    };

    socket.on("message:send", handle((p) => service.sendMessage(userId, p)));
    socket.on("message:read", handle((p) => service.markRead(userId, Number(p.conversation_id), p.up_to_id)));
    socket.on("typing", (p) => {
      if (p && p.conversation_id) service.typing(userId, Number(p.conversation_id), p.is_typing).catch(() => {});
    });

    socket.on("disconnect", async () => {
      const last = realtime.removeSocket(userId, socket.id);
      if (last) {
        try {
          await service.onSocketDisconnected(userId);
        } catch (e) {
          console.error("[chat] disconnect handler failed:", e.message);
        }
      }
    });
  });

  return io;
};

module.exports = { initChatSocket };