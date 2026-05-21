"use strict";

const config     = require("../config.json");
const banManager = require("../utils/banManager");
const { LINE2, ok, err, ban: banFmt, row } = require("../utils/ui");

module.exports = {
  name: "ban",
  aliases: ["botban", "unban", "bans"],
  description: "حظر / رفع حظر مستخدم من استخدام البوت.",
  usage: [
    "-ban @عضو [السبب]    — حظر مستخدم",
    "-unban @عضو          — رفع الحظر",
    "-ban check @عضو      — التحقق من حالة الحظر",
    "-bans                 — قائمة المحظورين",
  ].join("\n"),
  category: "Admin",
  adminOnly: true,

  async execute({ api, event, args }) {
    const { threadID, senderID } = event;
    const botAdmins  = config.bot.adminIDs || [];
    const mentions   = event.mentions || {};
    const mentionIDs = Object.keys(mentions);
    const prefix     = config.prefix;

    let sub     = (args[0] || "").toLowerCase();
    const cmdName = (event.body || "").trim().split(/\s+/)[0].toLowerCase().replace(/^-+/, "");
    if (cmdName === "unban")     sub = "unban";
    else if (cmdName === "bans") sub = "list";

    // ── list ──────────────────────────────────────────────────────────────────
    if (sub === "list" || sub === "bans") {
      const all = banManager.listBans();
      if (!all.length) return api.sendMessage(ok("لا يوجد أي مستخدم محظور."), threadID);
      const lines = all.slice(0, 20).map((b, i) =>
        `  ${i + 1}. ${b.userID}\n     ${row("السبب", b.reason)}\n     ${row("التاريخ", new Date(b.bannedAt).toLocaleDateString("ar-SA"))}`
      );
      return api.sendMessage(
        [`🚫  المحظورون (${all.length})`, LINE2, ...lines].join("\n"),
        threadID
      );
    }

    // ── check ────────────────────────────────────────────────────────────────
    if (sub === "check") {
      const uid = mentionIDs[0] || args[1];
      if (!uid) return api.sendMessage(err("اذكر مستخدماً."), threadID);
      const b = banManager.getBan(uid);
      if (!b) return api.sendMessage(ok(`المستخدم ${uid} غير محظور.`), threadID);
      return api.sendMessage(
        [
          banFmt("المستخدم محظور"),
          ``,
          row("المعرّف", uid),
          row("السبب  ", b.reason),
          row("التاريخ", new Date(b.bannedAt).toLocaleDateString("ar-SA")),
        ].join("\n"),
        threadID
      );
    }

    // ── unban ────────────────────────────────────────────────────────────────
    if (sub === "unban") {
      const uid = mentionIDs[0] || args[1];
      if (!uid) return api.sendMessage(err(`اذكر مستخدماً. مثال: ${prefix}unban @عضو`), threadID);
      const removed = banManager.unban(uid);
      return api.sendMessage(
        removed ? ok(`تم رفع حظر ${uid}.`) : `ℹ️  ${uid} ليس محظوراً أصلاً.`,
        threadID
      );
    }

    // ── ban ───────────────────────────────────────────────────────────────────
    const uid = mentionIDs[0] || args[0];
    if (!uid || uid === sub) {
      return api.sendMessage(err(`اذكر مستخدماً. مثال: ${prefix}ban @عضو السبب`), threadID);
    }
    if (botAdmins.includes(String(uid))) {
      return api.sendMessage(err("لا يمكن حظر مشرف البوت."), threadID);
    }

    const reason = args.slice(mentionIDs.length || 1).join(" ").trim() || "مخالفة متكررة";
    banManager.ban(uid, { reason, bannedBy: senderID, threadID });

    api.sendMessage(
      [
        banFmt("تم حظر المستخدم"),
        ``,
        row("المستخدم", uid),
        row("السبب   ", reason),
        ``,
        `لرفع الحظر: ${prefix}unban @${uid}`,
      ].join("\n"),
      threadID
    );
  },
};
