"use strict";

const config = require("../config.json");
const { DIV, MARK, err } = require("../utils/ui");

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
        err(`اكتب نص الإعلان.\nالاستخدام: ${config.prefix}announce <النص>`),
        event.threadID
      );
    }

    let senderName = event.senderID;
    try {
      const info = await api.getUserInfo([event.senderID]);
      senderName = info[event.senderID]?.name || event.senderID;
    } catch {}

    api.sendMessage(
      [`${MARK} إعلان`, DIV, ``, text, ``, DIV, `من: ${senderName}`].join("\n"),
      event.threadID
    );
  },
};
