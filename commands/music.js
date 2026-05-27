"use strict";

const fs     = require("fs");
const path   = require("path");
const engine = require("../utils/musicEngine");

module.exports = {
  name:        "music",
  aliases:     ["song", "اغنية", "أغنية", "mp3"],
  description: "البحث عن أغنية وإرسالها كملف صوتي عبر YouTube Music.",
  usage:       "music [اسم الأغنية أو الفنان]",
  category:    "Entertainment",

  async execute({ api, event, args }) {
    const { threadID, senderID } = event;
    const query = args.join(" ").trim();

    if (!query) {
      return api.sendMessage(
        "🎵 الاستخدام: -music [اسم الأغنية]\n" +
        "أمثلة:\n" +
        "  -music Blinding Lights\n" +
        "  -music محمد عبده\n" +
        "  -music GMFU",
        threadID
      );
    }

    // ── Cooldown ──────────────────────────────────────────────────────────────
    const wait = engine.userCooldown(senderID);
    if (wait > 0) {
      return api.sendMessage(`⏳ انتظر ${wait} ثانية قبل طلب أغنية أخرى.`, threadID);
    }
    engine.markUser(senderID);

    await api.sendMessage(`🔍 جاري البحث عن: ${query}...`, threadID).catch(() => {});

    // ── Step 1: Search — YouTube Music فقط، لا بديل ─────────────────────────
    let track;
    try {
      track = await engine.searchYouTubeMusic(query);
    } catch {
      return api.sendMessage(
        `😕 لم أجد نتائج على YouTube Music لـ: ${query}`,
        threadID
      ).catch(() => {});
    }

    // ── Step 2: إشعار + تحميل ─────────────────────────────────────────────
    const outPath = path.join(
      engine.TMP_DIR,
      `music_${Date.now()}_${Math.random().toString(36).slice(2)}.mp3`
    );

    await api.sendMessage(
      `🎵 ${track.title}` +
      (track.artist   ? `\n🎤 ${track.artist}`   : "") +
      (track.duration ? `\n⏱ ${track.duration}` : "") +
      "\n📦 YouTube Music" +
      "\n⬇️ جاري التحميل...",
      threadID
    ).catch(() => {});

    try {
      await engine.downloadYouTube(track.url, outPath);
    } catch (dlErr) {
      return api.sendMessage(
        "❌ فشل التحميل من YouTube Music:\n" + dlErr.message.slice(0, 200),
        threadID
      ).catch(() => {});
    }

    // ── Step 3: تحقق وإرسال ──────────────────────────────────────────────────
    try {
      engine.validateFile(outPath);
    } catch (e) {
      engine.safeDelete(outPath, 0);
      return api.sendMessage("❌ " + e.message, threadID).catch(() => {});
    }

    const caption =
      `🎵 ${track.title}` +
      (track.artist   ? `\n🎤 ${track.artist}`   : "") +
      (track.duration ? `\n⏱ ${track.duration}` : "") +
      "\n📦 YouTube Music";

    try {
      await Promise.race([
        api.sendMessage(
          { body: caption, attachment: fs.createReadStream(outPath) },
          threadID
        ),
        new Promise((_, rej) =>
          setTimeout(() => rej(new Error("send_timeout")), 90_000)
        ),
      ]);
    } catch (e) {
      await api.sendMessage(
        e.message === "send_timeout"
          ? "❌ انتهت مهلة الإرسال، جرّب أغنية أقصر."
          : "❌ تعذّر إرسال الملف: " + e.message.slice(0, 150),
        threadID
      ).catch(() => {});
    } finally {
      engine.safeDelete(outPath);
    }
  },
};
