"use strict";

const config = require("../config.json");
const { DIV, MARK, row, ok, err } = require("../utils/ui");

module.exports = {
  name: "poll",
  aliases: ["vote"],
  description: "إنشاء تصويت في المجموعة.",
  usage: "poll <السؤال> | خيار1 | خيار2 | ...",
  category: "Group",
  groupOnly: true,
  adminOnly: true,

  async execute({ api, event, args }) {
    const parts = args.join(" ").split("|").map(s => s.trim()).filter(Boolean);

    if (parts.length < 3) {
      return api.sendMessage(
        [
          err("الاستخدام الصحيح:"),
          `  ${config.prefix}poll السؤال؟ | خيار1 | خيار2`,
          ``,
          `مثال:`,
          `  ${config.prefix}poll اللون الأفضل؟ | أحمر | أزرق | أخضر`,
        ].join("\n"),
        event.threadID
      );
    }

    const [question, ...options] = parts;

    if (typeof api.createPoll !== "function") {
      return api.sendMessage(err("التصويت غير مدعوم في هذه النسخة."), event.threadID);
    }

    try {
      await api.createPoll(question, event.threadID, options);
      api.sendMessage(
        [ok("تم إنشاء التصويت"), DIV, row("السؤال  ", question), row("الخيارات", `${options.length} خيارات`)].join("\n"),
        event.threadID
      );
    } catch (e) {
      api.sendMessage(err("فشل إنشاء التصويت: " + e.message), event.threadID);
    }
  },
};
