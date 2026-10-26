// Quick manual test (no Flutter needed):  npm i -D socket.io-client
// Terminal A: node chat.test-client.js http://localhost:5000 <JWT_USER_A>
// Terminal B: node chat.test-client.js http://localhost:5000 <JWT_USER_B> <conversation_id> "hello"
const { io } = require("socket.io-client");
const [, , url, token, convId, text] = process.argv;

// const socket = io(`${url}/chat`, { auth: { token }, transports: ["websocket"] });
const socket = io(`${url}/chat`, { auth: { token }, transports: ["polling", "websocket"] });

socket.on("connect", () => {
  console.log("connected", socket.id);
  if (convId && text) {
    socket.emit(
      "message:send",
      { conversation_id: Number(convId), type: "TEXT", body: text, client_msg_id: String(Date.now()) },
      (r) => console.log("ack", JSON.stringify(r))
    );
  }
});
socket.on("connect_error", (e) =>
  console.log("connect_error:", e.message, "|", e.description, "|", e.context && e.context.status));
socket.on("connect_error", (e) => console.log("connect_error:", e.message));
["message:new", "message:receipt", "message:deleted", "conversation:updated", "conversation:read", "presence", "typing"]
  .forEach((ev) => socket.on(ev, (d) => console.log(ev, JSON.stringify(d))));