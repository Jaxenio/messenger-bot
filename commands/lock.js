"use strict";

const { globalLock, save } = require("../state");

module.exports = {
  name: "lock",
  aliases: ["botlock"],
  description: "قفل البوت عالمياً — عند التفعيل يتجاهل البوت جميع الأوامر في كل المجموعات ولا يستجيب إلا لمدراء البوت.",
  usage: "lock [on|off|status]",
  category: "Admin",
  adminOnly: true,

  async execute({ api, event, args }) {
    const { threadID } = event;
    const sub = (args[0] || "").toLowerCase();

    if (sub === "on") {
      if (globalLock.enabled)
        return api.sendMessage("🔒 البوت مقفل عالمياً بالفعل.\nلا يستجيب إلا لمدراء البوت.", threadID);
      globalLock.enabled = true;
      save();
      return api.sendMessage(
        "🔒 تم تفعيل القفل العالمي للبوت.\nلن يستجيب البوت لأي أمر في أي مجموعة — فقط مدراء البوت يمكنهم استخدام الأوامر الآن.",
        threadID
      );
    }

    if (sub === "off") {
      if (!globalLock.enabled)
        return api.sendMessage("🔓 البوت غير مقفل عالمياً.", threadID);
      globalLock.enabled = false;
      save();
      return api.sendMessage(
        "🔓 تم إلغاء القفل العالمي للبوت.\nيمكن لجميع الأعضاء استخدام الأوامر مجدداً.",
        threadID
      );
    }

    if (sub === "status") {
      const state = globalLock.enabled
        ? "🔒 مقفل عالمياً — مدراء البوت فقط"
        : "🔓 مفتوح — جميع الأعضاء";
      return api.sendMessage("حالة القفل العالمي للبوت:\n" + state, threadID);
    }

    // No arg: toggle
    if (globalLock.enabled) {
      globalLock.enabled = false;
      save();
      return api.sendMessage(
        "🔓 تم إلغاء القفل العالمي للبوت.\nيمكن لجميع الأعضاء استخدام الأوامر مجدداً.",
        threadID
      );
    }
    globalLock.enabled = true;
    save();
    return api.sendMessage(
      "🔒 تم تفعيل القفل العالمي للبوت.\nلن يستجيب البوت لأي أمر في أي مجموعة — فقط مدراء البوت يمكنهم استخدام الأوامر الآن.",
      threadID
    );
  },
};
