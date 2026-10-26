
require('dotenv').config();

const admin = require('./src/config/firebase');

const token = process.argv[2];

if (!token) {
  console.error('Usage: node test-fcm.js "<DEVICE_TOKEN>"');
  process.exit(1);
}

admin.messaging().send({
  token,
  notification: {
    title: 'JSC CRM Test',
    body: 'Your push notifications are working!',
  },
  android: {
    notification: {
      channelId: 'chat_messages',
    },
  },
})
  .then((messageId) => {
    console.log('Push notification accepted by FCM:', messageId);
    process.exit(0);
  })
  .catch((error) => {
    console.error('FCM send failed:', error.code, error.message);
    process.exit(1);
  });
