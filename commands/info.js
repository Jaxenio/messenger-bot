"use strict";

const os     = require("os");
const config = require("../config.json");
const { LINE, LINE2, row } = require("../utils/ui");

module.exports = {
  name: "info",
  aliases: ["about", "botinfo"],
  description: "عرض معلومات تفصيلية عن البوت.",
  usage: "info",
  category: "General",

  async execute({ api, event }) {
    const total = Math.floor(process.uptime());
    const h = Math.floor(total / 3600);
    const m = Math.floor((total % 3600) / 60);
    const s = total % 60;
    const uptime = `${h}س ${m}د ${s}ث`;

    const memMB  = (process.memoryUsage().rss / 1024 / 1024).toFixed(1);
    const botID  = api.getCurrentUserID();
    const cpu    = os.cpus()[0]?.model?.trim() || "غير معروف";
    const cores  = os.cpus().length;

    const msg = [
      LINE,
      `🤖  ${config.bot.name}`,
      LINE,
      ``,
      row("الاسم    ", config.bot.name),
      row("الإصدار  ", config.bot.version),
      row("البادئة  ", config.prefix),
      row("المعرّف  ", botID),
      ``,
      LINE2,
      `🖥️  النظام`,
      LINE2,
      ``,
      row("المنصة   ", `${os.platform()} (${os.arch()})`),
      row("Node.js  ", process.version),
      row("التشغيل  ", uptime),
      row("الذاكرة  ", `${memMB} MB`),
      row("المعالج  ", cpu.length > 30 ? cpu.slice(0, 30) + "…" : cpu),
      row("الأنوية  ", String(cores)),
    ].join("\n");

    api.sendMessage(msg, event.threadID);
  },
};
