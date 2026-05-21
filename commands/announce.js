"use strict";

const config = require("../config.json");
const { LINE2, err } = require("../utils/ui");

module.exports = {
  name: "announce",
  aliases: ["ann", "broadcast"],
  description: "إرسال إعلان رسمي للمجموعة.",
  usage: "announce <النص>",
  category: "Group",
  groupOnly: true,
  adminOnly: true,

  async execute({ api, event, args }) {
    const text = args.join(" ").trim();
    if (!text) {
      return api.sendMessage(
        err(`اكتب نص الإعلان. الاستخدام: ${config.prefix}announce <النص>`),
        event.threadID
      );
    }

    let senderName = event.senderID;
    try {
      const info = await api.getUserInfo([event.senderID]);
      senderName = info[event.senderID]?.name || event.senderID;
    } catch {}

    const msg = [
      `📢  إعلان رسمي`,
      LINE2,
      ``,
      text,
      ``,
      LINE2,
      `من: ${senderName}`,
    ].join("\n");

    api.sendMessage(msg, event.threadID);
  },
};
