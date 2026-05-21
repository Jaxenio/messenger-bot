"use strict";

const config = require("../config.json");
const { LINE, LINE2 } = require("../utils/ui");

const CAT_AR = {
  General:       "عام",
  Info:          "معلومات",
  Utility:       "أدوات",
  Group:         "المجموعة",
  Fun:           "مرح",
  Entertainment: "ترفيه",
  Admin:         "الإدارة",
};

const CAT_ICON = {
  General:       "◈",
  Info:          "◈",
  Utility:       "◉",
  Group:         "◎",
  Fun:           "◉",
  Entertainment: "♫",
  Admin:         "◆",
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
          `❌  الأمر «${name}» غير موجود.\nاكتب ${prefix}help لعرض قائمة الأوامر.`,
          event.threadID
        );
      }

      const catAr = CAT_AR[cmd.category] || cmd.category || "عام";
      const lines = [
        `${LINE}`,
        `📖  تفاصيل الأمر`,
        `${LINE}`,
        ``,
        `الأمر       ›  ${prefix}${cmd.name}`,
        `الوصف       ›  ${cmd.description}`,
        `الفئة       ›  ${catAr}`,
        `الاستخدام   ›  ${prefix}${Array.isArray(cmd.usage) ? cmd.usage[0] : (cmd.usage || cmd.name)}`,
      ];

      if (cmd.aliases?.length) {
        lines.push(`الاختصارات  ›  ${cmd.aliases.map(a => prefix + a).join("  ·  ")}`);
      }

      const flags = [];
      if (cmd.adminOnly) flags.push("🔒 للمشرفين فقط");
      if (cmd.groupOnly) flags.push("👥 للمجموعات فقط");
      if (flags.length) {
        lines.push(``);
        lines.push(...flags);
      }

      return api.sendMessage(lines.join("\n"), event.threadID);
    }

    // ── قائمة كل الأوامر ──────────────────────────────────────────────────
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

    const total = unique.length;
    let msg = `${LINE}\n🤖  ${config.bot.name}  ·  v${config.bot.version}\n${LINE}\n\n`;
    msg += `البادئة: ${prefix}  |  الأوامر: ${total}\n\n`;

    for (const cat of sorted) {
      const icon = CAT_ICON[cat] || "▸";
      const name = CAT_AR[cat] || cat;
      const cmds = categories[cat].map(n => `${prefix}${n}`).join("  ·  ");
      msg += `${icon}  ${name}\n  ${cmds}\n\n`;
    }

    msg += `${LINE2}\naكتب ${prefix}help <أمر> للتفاصيل`;

    api.sendMessage(msg, event.threadID);
  },
};
