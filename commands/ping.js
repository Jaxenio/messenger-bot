"use strict";

const { row } = require("../utils/ui");

module.exports = {
  name: "ping",
  aliases: ["pong"],
  description: "التحقق من استجابة البوت وقياس زمن التأخير.",
  usage: "ping",
  category: "General",

  async execute({ api, event }) {
    const latency = event.timestamp ? Date.now() - event.timestamp : null;
    const latencyText = latency !== null ? `${latency}ms` : "—";

    const status = latency === null        ? "—"
      : latency < 300 ? "🟢 ممتاز"
      : latency < 700 ? "🟡 جيد"
                      : "🔴 بطيء";

    const msg = [
      `🏓  بونج!`,
      ``,
      row("الاستجابة", latencyText),
      row("الحالة   ", status),
    ].join("\n");

    api.sendMessage(msg, event.threadID);
  },
};
