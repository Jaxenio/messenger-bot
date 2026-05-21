"use strict";

const { row } = require("../utils/ui");

module.exports = {
  name: "coinflip",
  aliases: ["flip", "coin"],
  description: "رمي عملة معدنية.",
  usage: "coinflip",
  category: "Fun",

  async execute({ api, event }) {
    const isHeads = Math.random() < 0.5;
    const result  = isHeads ? "وجه 🌕" : "ظهر 🌑";
    api.sendMessage(
      [`🪙  رمي العملة`, ``, row("النتيجة", result)].join("\n"),
      event.threadID
    );
  },
};
