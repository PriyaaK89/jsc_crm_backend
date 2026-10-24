// Requires firebase-admin to be initialised ONCE at startup (admin.initializeApp(...)).
// If you already have FCM set up in the project, this just reuses that default app.
const admin = require("firebase-admin");
const model = require("./chat.model");

const BAD_TOKEN_CODES = [
  "messaging/registration-token-not-registered",
  "messaging/invalid-registration-token",
];

const toStringMap = (obj) =>
  Object.fromEntries(Object.entries(obj || {}).map(([k, v]) => [k, String(v)]));

const sendChatPush = async ({ userIds, title, body, data }) => {
  if (!userIds || !userIds.length) return;
  const tokens = await model.getTokensForUsers(userIds);
  if (!tokens.length) return;

  const badTokens = [];
  for (let i = 0; i < tokens.length; i += 500) {
    const chunk = tokens.slice(i, i + 500);
    const res = await admin.messaging().sendEachForMulticast({
      tokens: chunk,
      notification: { title, body },
      data: toStringMap(data),
      android: {
        priority: "high",
        notification: { channelId: "chat_messages", tag: `chat_${data.conversation_id}` },
      },
      apns: { payload: { aps: { sound: "default", "thread-id": `chat_${data.conversation_id}` } } },
    });
    res.responses.forEach((r, idx) => {
      if (!r.success && r.error && BAD_TOKEN_CODES.includes(r.error.code)) badTokens.push(chunk[idx]);
    });
  }
  if (badTokens.length) await model.deleteTokens(badTokens);
};

module.exports = { sendChatPush };