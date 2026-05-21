"use strict";

const config = require("../config.json");
const { DIV, MARK } = require("../utils/ui");

const CAT_AR = {
  General:       "عام",
  Info:          "معلومات",
  Utility:       "أدوات",
  Group:         "المجموعة",
  Fun:           "مرح",
  Entertainment: "ترفيه",
  Admin:         "الإدارة",
};

const ORDER = ["General", "Info", "Utility", "Group", "Fun", "Entertainment", "Admin"];

module.exports = {
  name: "help",
  aliases: ["h", "cmds", "commands"],
  description: "عرض قائمة الأوامر أو تفاصيل أمر معين.",
  usage: "help [أمر]",
  category: "General",

  async execute({ api, event, args, commands }) {
    const prefix = config.prefix;

    // ── تفاصيل أمر واحد ────────────────────────────────────────────────────
    if (args[0]) {
      const name = args[0].toLowerCase().replace(/^-+/, "");
      const cmd  = commands.get(name) ||
        [...new Set(commands.values())].find(c => c.aliases?.includes(name));

      if (!cmd) {
        return api.sendMessage(
          `✗  الأمر «${name}» غير موجود.\n${prefix}help لعرض قائمة الأوامر.`,
          event.threadID
        );
      }

      const catAr = CAT_AR[cmd.category] || cmd.category || "عام";
      const usageText = Array.isArray(cmd.usage)
        ? cmd.usage.join("\n  ")
        : (cmd.usage || cmd.name);

      const lines = [
        `${MARK} ${prefix}${cmd.name}`,
        DIV,
        ``,
        `الوصف       ·  ${cmd.description}`,
        `الفئة       ·  ${catAr}`,
        `الاستخدام   ·  ${prefix}${usageText}`,
      ];

      if (cmd.aliases?.length) {
        lines.push(`الاختصارات  ·  ${cmd.aliases.map(a => prefix + a).join("  ")}`);
      }

      const flags = [];
      if (cmd.adminOnly) flags.push("للمشرفين فقط");
      if (cmd.groupOnly) flags.push("للمجموعات فقط");
      if (flags.length) {
        lines.push(``);
        lines.push(DIV);
        lines.push(flags.join("  ·  "));
      }

      return api.sendMessage(lines.join("\n"), event.threadID);
    }

    // ── قائمة الأوامر ──────────────────────────────────────────────────────
    const unique     = [...new Set(commands.values())];
    const categories = {};

    for (const cmd of unique) {
      const cat = cmd.category || "General";
      if (!categories[cat]) categories[cat] = [];
      categories[cat].push(cmd.name);
    }

    for (const cat of Object.keys(categories)) {
      categories[cat].sort((a, b) => a.localeCompare(b));
    }

    const sorted = [
      ...ORDER.filter(c => categories[c]),
      ...Object.keys(categories).filter(c => !ORDER.includes(c)),
    ];

    let msg = `${MARK} ${config.bot.name}  v${config.bot.version}\n${DIV}\n`;
    msg    += `البادئة · ${prefix}  |  الأوامر · ${unique.length}\n`;

    for (const cat of sorted) {
      const name = CAT_AR[cat] || cat;
      const cmds = categories[cat].map(n => `${prefix}${n}`).join("  ");
      msg += `\n${name}\n  ${MARK} ${cmds}\n`;
    }

    msg += `\n${DIV}\n${prefix}help <أمر> للتفاصيل`;

    api.sendMessage(msg, event.threadID);
  },
};
