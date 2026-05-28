"use strict";

const fs            = require("fs");
const path          = require("path");
const config        = require("../config.json");
const restartSignal = require("../utils/restartSignal");

const APP_STATE_PATH = path.resolve(__dirname, "..", config.appStatePath);

module.exports = {
  name: "restart",
  aliases: ["reboot", "rs"],
  description: "حفظ الكوكيز وإعادة الاتصال بالبوت داخلياً.",
  usage: "restart",
  category: "Admin",
  adminOnly: true,

  async execute({ api, event }) {
    const { threadID } = event;

    if (!restartSignal.isReady()) {
      return api.sendMessage(
        "⚠️ البوت غير مهيأ بعد أو الاتصال مقطوع. حاول بعد ثوانٍ.",
        threadID
      ).catch(() => {});
    }

    // 1. حفظ الكوكيز الحالية قبل الإعادة
    try {
      const state = api.getAppState();
      if (Array.isArray(state) && state.length > 0) {
        fs.writeFileSync(APP_STATE_PATH, JSON.stringify(state, null, 2));
      }
    } catch {}

    // 2. إشعار المستخدم
    await api.sendMessage(
      "🔄 جارٍ إعادة الاتصال...\nسيعود البوت خلال 5-10 ثوانٍ.",
      threadID
    ).catch(() => {});

    // 3. تشغيل إعادة الاتصال الداخلية بعد 1.5 ثانية
    //    (نترك وقتاً لإرسال الرسالة أولاً)
    setTimeout(() => restartSignal.trigger(), 1500);
  },
};
