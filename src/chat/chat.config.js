module.exports = {
  // roles.name values (normalized: lowercase, spaces/hyphens -> underscore) that can do everything in chat
  UNRESTRICTED_ROLES: ["admin", "super_admin"],

  // job_roles.id allowed to create groups: 8 = Zonal Sales Manager (ZSM), 2 = Regional Sales Manager (RSM)
  GROUP_CREATOR_JOB_ROLE_IDS: [5, 2],

  // permissions.code values (insert them with 02_chat_permissions.sql, then tick them per user in your permission screen)
  PERMISSION_MESSAGE_ANYONE: "chat_message_anyone", // can start a chat with any user
  PERMISSION_CREATE_GROUP: "chat_create_group",     // can create groups
  PERMISSION_VIEW_ALL: "chat_view_all",             // can view all chats in the React dashboard

  MAX_GROUP_MEMBERS: 256,
  MAX_BODY_LENGTH: 4000,
  DELETE_FOR_EVERYONE_WINDOW_MIN: 0, // 0 = no time limit
  MAX_FILE_SIZE: 15 * 1024 * 1024,
};