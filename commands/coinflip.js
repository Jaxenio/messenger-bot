"use strict";

const { MARK, DIV, row } = require("../utils/ui");

module.exports = {
  name: "coinflip",
  aliases: ["flip", "coin"],
  description: "رمي عملة معدنية.",
  usage: "coinflip",
  category: "Fun",

  async execute({ api, event }) {
    const result = Math.random() < 0.5 ? "وجه" : "ظهر";
    api.sendMessage(
      [`${MARK} رمي العملة`, DIV, row("النتيجة", result)].join("\n"),
      event.threadID
    );
  },
};
