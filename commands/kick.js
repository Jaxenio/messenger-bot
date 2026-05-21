"use strict";

const config = require("../config.json");
const { DIV, MARK, row, ok, err } = require("../utils/ui");

module.exports = {
  name: "kick",
  aliases: ["remove", "rm"],
  description: "طرد عضو من المجموعة.",
  usage: "kick @عضو [السبب]",
  category: "Group",
  groupOnly: true,
  adminOnly: true,

  async execute({ api, event, args }) {
    const mentions   = event.mentions || {};
    const mentionIDs = Object.keys(mentions);

    if (!mentionIDs.length) {
      return api.sendMessage(
        err(`اذكر العضو.\nالاستخدام: ${config.prefix}kick @عضو [السبب]`),
        event.threadID
      );
    }

    const botID    = api.getCurrentUserID();
    const targetID = mentionIDs[0];

    if (targetID === botID) return api.sendMessage(err("لا يمكنني طرد نفسي."), event.threadID);

    let adminIDs = [];
    try {
      const threadInfo = await api.getThreadInfo(event.threadID);
      adminIDs = (threadInfo.adminIDs || []).map(a => a.id || a);
    } catch {}

    if (adminIDs.includes(targetID)) {
      return api.sendMessage(err("لا يمكن طرد مشرف المجموعة."), event.threadID);
    }

    const name   = Object.values(mentions)[0]?.replace(/@/, "") || targetID;
    const reason = args.slice(mentionIDs.length).join(" ").trim() || "مخالفة قوانين المجموعة";

    try {
      const result = await api.gcmember("remove", targetID, event.threadID);
      if (result?.type === "error_gc") {
        return api.sendMessage(err("فشل الطرد: " + result.error), event.threadID);
      }
      api.sendMessage(
        [`${MARK} تم الطرد`, DIV, row("العضو", name), row("السبب", reason)].join("\n"),
        event.threadID
      );
    } catch (e) {
      api.sendMessage(err("فشل الطرد: " + e.message), event.threadID);
    }
  },
};
