"use strict";

const fs     = require("fs");
const path   = require("path");
const engine = require("../utils/musicEngine");

module.exports = {
  name:        "music",
  aliases:     ["song", "اغنية", "أغنية", "mp3"],
  description: "البحث عن أغنية وإرسالها كملف صوتي.",
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

    const outPath = path.join(
      engine.TMP_DIR,
      `music_${Date.now()}_${Math.random().toString(36).slice(2)}.mp3`
    );

    // ── Step 1: Try YouTube (search → download with 3-method fallback chain) ──
    let track    = null;
    let provider = "youtube";
    let downloaded = false;

    try {
      // Search YouTube first, then YouTube Music as search fallback
      try {
        track = await engine.searchYouTube(query);
      } catch {
        track    = await engine.searchYouTubeMusic(query);
        provider = "ytmusic";
      }

      await api.sendMessage(
        `🎵 ${track.title}` +
        (track.artist   ? `\n🎤 ${track.artist}`   : "") +
        (track.duration ? `\n⏱ ${track.duration}` : "") +
        `\n📦 ${provider === "ytmusic" ? "YouTube Music" : "YouTube"}` +
        "\n⬇️ جاري التحميل...",
        threadID
      ).catch(() => {});

      // downloadYouTube tries ytdl-core → play-dl → yt-dlp internally
      await engine.downloadYouTube(track.url, outPath);
      downloaded = true;
    } catch (ytErr) {
      // ── Step 2: All YouTube methods failed → try SoundCloud ─────────────────
      await api.sendMessage(
        "⚠️ YouTube محجوب، جاري المحاولة عبر SoundCloud...",
        threadID
      ).catch(() => {});

      try {
        const scTrack = await engine.downloadSoundCloud(query, outPath);
        track    = scTrack;
        provider = "soundcloud";
        downloaded = true;
      } catch (scErr) {
        return api.sendMessage(
          "❌ فشل التحميل من جميع المصادر:\n" +
          `YouTube: ${ytErr.message.slice(0, 150)}\n` +
          `SoundCloud: ${scErr.message.slice(0, 100)}`,
          threadID
        ).catch(() => {});
      }
    }

    if (!downloaded) return;

    // ── Step 3: Validate & send ───────────────────────────────────────────────
    try {
      engine.validateFile(outPath);
    } catch (e) {
      engine.safeDelete(outPath, 0);
      return api.sendMessage("❌ " + e.message, threadID).catch(() => {});
    }

    const sourceLabel =
      provider === "soundcloud" ? "🎧 SoundCloud" :
      provider === "ytmusic"    ? "📦 YouTube Music" :
                                  "📦 YouTube";

    const caption =
      `🎵 ${track.title}` +
      (track.artist   ? `\n🎤 ${track.artist}`   : "") +
      (track.duration ? `\n⏱ ${track.duration}` : "") +
      `\n${sourceLabel}`;

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
