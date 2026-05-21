"use strict";

const config      = require("../config.json");
const warnManager = require("../utils/warnManager");
const { DIV, MARK, row, ok, err } = require("../utils/ui");

const MAX_WARNS = 3;

module.exports = {
  name: "warn",
  aliases: ["w", "تحذير"],
  description: "إصدار تحذير لعضو. عند بلوغ الحد يُطرد تلقائياً.",
  usage: [
    "-warn @عضو [السبب]",
    "-warn check @عضو",
    "-warn clear @عضو",
    "-warn clearall",
    "-warn list",
  ].join("\n"),
  category: "Admin",
  groupOnly: true,
  adminOnly: true,

  async execute({ api, event, args }) {
    const { threadID }  = event;
    const sub           = (args[0] || "").toLowerCase();
    const mentions      = event.mentions || {};
    const mentionIDs    = Object.keys(mentions);
    const prefix        = config.prefix;

    // ── check ────────────────────────────────────────────────────────────────
    if (sub === "check") {
      if (!mentionIDs.length) {
        return api.sendMessage(err(`اذكر عضواً.\nمثال: ${prefix}warn check @عضو`), threadID);
      }
      const uid  = mentionIDs[0];
      const name = (Object.values(mentions)[0] || "").replace(/@/, "") || uid;
      const w    = warnManager.getWarns(threadID, uid);

      if (w.count === 0) return api.sendMessage(ok(`لا توجد تحذيرات بحق ${name}.`), threadID);

      const lines = w.reasons.slice(-5).map((r, i) =>
        `  ${i + 1}. ${r.reason}  (${new Date(r.at).toLocaleDateString("ar-SA")})`
      );
      return api.sendMessage(
        [`${MARK} تحذيرات ${name}`, DIV, row("العدد", `${w.count} / ${MAX_WARNS}`), ``, ...lines].join("\n"),
        threadID
      );
    }

    // ── clear ────────────────────────────────────────────────────────────────
    if (sub === "clear") {
      if (!mentionIDs.length) {
        return api.sendMessage(err(`اذكر عضواً.\nمثال: ${prefix}warn clear @عضو`), threadID);
      }
      const uid  = mentionIDs[0];
      const name = (Object.values(mentions)[0] || "").replace(/@/, "") || uid;
      warnManager.clearWarns(threadID, uid);
      return api.sendMessage(ok(`تم مسح تحذيرات ${name}.`), threadID);
    }

    // ── clearall ──────────────────────────────────────────────────────────────
    if (sub === "clearall") {
      warnManager.clearWarns(threadID, null);
      return api.sendMessage(ok("تم مسح جميع التحذيرات في المجموعة."), threadID);
    }

    // ── list ──────────────────────────────────────────────────────────────────
    if (sub === "list") {
      const all = warnManager.listWarns(threadID);
      if (!all.length) return api.sendMessage(ok("لا توجد تحذيرات نشطة."), threadID);
      const lines = all
        .sort((a, b) => b.count - a.count)
        .map((w, i) => `  ${i + 1}. ${w.userID}  ·  ${w.count}/${MAX_WARNS}`);
      return api.sendMessage(
        [`${MARK} التحذيرات النشطة  (${all.length})`, DIV, ...lines].join("\n"),
        threadID
      );
    }

    // ── إصدار تحذير ──────────────────────────────────────────────────────────
    if (!mentionIDs.length) {
      return api.sendMessage(err(`اذكر العضو.\nمثال: ${prefix}warn @عضو السبب`), threadID);
    }

    const uid    = mentionIDs[0];
    const name   = (Object.values(mentions)[0] || "").replace(/@/, "") || uid;
    const reason = args.slice(1)
      .filter(a => !Object.values(mentions).includes(a))
      .join(" ").trim() || "مخالفة قوانين المجموعة";

    if ((config.bot.adminIDs || []).includes(String(uid))) {
      return api.sendMessage(err("لا يمكن تحذير مشرف البوت."), threadID);
    }

    const w         = warnManager.addWarn(threadID, uid, reason);
    const remaining = MAX_WARNS - w.count;

    if (w.count >= MAX_WARNS) {
      try {
        await api.gcmember("remove", uid, threadID);
        warnManager.clearWarns(threadID, uid);
        return api.sendMessage(
          [`${MARK} طرد تلقائي`, DIV, row("العضو ", name), row("السبب ", reason), row("التحذيرات", `${MAX_WARNS}/${MAX_WARNS}`)].join("\n"),
          threadID
        );
      } catch (e) {
        return api.sendMessage(
          [`${MARK} تجاوز الحد — الطرد فشل`, DIV, row("العضو ", name), row("الخطأ ", e.message), ``, `يُرجى طرده يدوياً.`].join("\n"),
          threadID
        );
      }
    }

    const lines = [
      `${MARK} تحذير رسمي`,
      DIV,
      row("العضو      ", name),
      row("السبب      ", reason),
      row("التحذيرات  ", `${w.count} / ${MAX_WARNS}`),
    ];
    if (remaining === 1) {
      lines.push(DIV);
      lines.push(`تحذير واحد متبقٍ قبل الطرد التلقائي.`);
    }

    api.sendMessage(lines.join("\n"), threadID);
  },
};
