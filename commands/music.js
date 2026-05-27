"use strict";

const fs     = require("fs");
const path   = require("path");
const engine = require("../utils/musicEngine");

module.exports = {
  name:        "music",
  aliases:     ["song", "اغنية", "أغنية", "mp3"],
  description: "البحث عن أغنية وإرسالها كملف صوتي عبر YouTube Music أو SoundCloud.",
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

    // ── Cooldown ───────────────────────────────────────────────────────────
    const wait = engine.userCooldown(senderID);
    if (wait > 0) {
      return api.sendMessage(`⏳ انتظر ${wait} ثانية قبل طلب أغنية أخرى.`, threadID);
    }
    engine.markUser(senderID);

    await api.sendMessage(`🔍 جاري البحث عن: ${query}...`, threadID).catch(() => {});

    // ── Step 1: Search — YouTube Music ────────────────────────────────────
    let track;
    try {
      track = await engine.searchYouTubeMusic(query);
    } catch {
      return api.sendMessage(
        `😕 لم أجد نتائج لـ: ${query}`,
        threadID
      ).catch(() => {});
    }

    // ── Step 2: تجهيز مسار الملف ─────────────────────────────────────────
    const outPath = path.join(
      engine.TMP_DIR,
      `music_${Date.now()}_${Math.random().toString(36).slice(2)}.mp3`
    );

    await api.sendMessage(
      `🎵 ${track.title}` +
      (track.artist   ? `\n🎤 ${track.artist}`   : "") +
      (track.duration ? `\n⏱ ${track.duration}` : "") +
      "\n📦 YouTube Music\n⬇️ جاري التحميل...",
      threadID
    ).catch(() => {});

    // ── Step 3: تحميل — YouTube أولاً، ثم SoundCloud كبديل ───────────────
    let usedSource = "YouTube Music";
    let scTrack    = null;

    try {
      await engine.downloadYouTube(track.url, outPath);
    } catch (ytErr) {
      // كل طرق YouTube فشلت — جرّب SoundCloud
      await api.sendMessage(
        "⚠️ تعذّر التحميل من YouTube، جاري المحاولة من SoundCloud...",
        threadID
      ).catch(() => {});

      try {
        scTrack    = await engine.downloadSoundCloud(query, outPath);
        usedSource = "SoundCloud";
      } catch (scErr) {
        return api.sendMessage(
          "❌ فشل التحميل من جميع المصادر:\n" +
          "YouTube: " + ytErr.message.slice(0, 120) + "\n" +
          "SoundCloud: " + scErr.message.slice(0, 100),
          threadID
        ).catch(() => {});
      }
    }

    // ── Step 4: تحقق من الملف ────────────────────────────────────────────
    try {
      engine.validateFile(outPath);
    } catch (e) {
      engine.safeDelete(outPath, 0);
      return api.sendMessage("❌ " + e.message, threadID).catch(() => {});
    }

    // ── Step 5: إرسال ─────────────────────────────────────────────────────
    const finalTitle  = scTrack ? scTrack.title  : track.title;
    const finalArtist = scTrack ? scTrack.artist : track.artist;
    const finalDur    = scTrack ? scTrack.duration : track.duration;

    const caption =
      `🎵 ${finalTitle}` +
      (finalArtist ? `\n🎤 ${finalArtist}` : "") +
      (finalDur    ? `\n⏱ ${finalDur}`    : "") +
      `\n📦 ${usedSource}`;

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
