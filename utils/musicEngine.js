"use strict";

/**
 * musicEngine v3 — uses play-dl (pure Node.js) + ffmpeg.
 * No external binaries required beyond ffmpeg (available in Nix env).
 *
 * Provider chain:
 *   1. YouTube       via play-dl search  → play-dl stream → ffmpeg → mp3
 *   2. YouTube Music via internal API    → play-dl stream → ffmpeg → mp3 (fallback)
 *
 * Both providers deliver full-length tracks through the same download pipeline.
 */

const fs    = require("fs");
const os    = require("os");
const path  = require("path");
const https = require("https");
const { spawn } = require("child_process");

const play   = require("play-dl");
const logger = require("./logger");

// ── Config ────────────────────────────────────────────────────────────────────
const TMP_DIR          = path.join(os.tmpdir(), "madox_music");
const MAX_DURATION_SEC = 600;
const MAX_FILE_BYTES   = 48 * 1024 * 1024;
const USER_COOLDOWN_MS = 30_000;
const SEARCH_TIMEOUT   = 15_000;
const DOWNLOAD_TIMEOUT = 120_000;

try { fs.mkdirSync(TMP_DIR, { recursive: true }); } catch {}

// Hourly stale-file cleanup
setImmediate(_cleanStale);
setInterval(_cleanStale, 60 * 60 * 1000).unref();

function _cleanStale() {
  try {
    const cutoff = Date.now() - 3_600_000;
    for (const f of fs.readdirSync(TMP_DIR)) {
      if (!f.startsWith("music_")) continue;
      const fp = path.join(TMP_DIR, f);
      try { if (fs.statSync(fp).mtimeMs < cutoff) fs.unlinkSync(fp); } catch {}
    }
  } catch {}
}

// ── ffmpeg resolution ─────────────────────────────────────────────────────────
function _findFfmpeg() {
  if (process.env.FFMPEG_PATH && fs.existsSync(process.env.FFMPEG_PATH)) {
    return process.env.FFMPEG_PATH;
  }
  const HOME = process.env.HOME || "/root";
  const candidates = [
    "/nix/store/y7m7h744qpw8hidkkxnhx7wzgv59w287-replit-runtime-path/bin/ffmpeg",
    "/usr/bin/ffmpeg",
    "/usr/local/bin/ffmpeg",
    path.join(HOME, ".nix-profile/bin/ffmpeg"),
    "/nix/var/nix/profiles/default/bin/ffmpeg",
    "ffmpeg",
  ];
  for (const p of candidates) {
    try { if (p === "ffmpeg" || fs.statSync(p).isFile()) return p; } catch {}
  }
  return "ffmpeg";
}

// ── Per-user cooldown ─────────────────────────────────────────────────────────
const _cooldowns = new Map();

function userCooldown(id) {
  const elapsed = Date.now() - (_cooldowns.get(id) || 0);
  return elapsed < USER_COOLDOWN_MS ? Math.ceil((USER_COOLDOWN_MS - elapsed) / 1000) : 0;
}

function markUser(id) { _cooldowns.set(id, Date.now()); }

// ── Helpers ───────────────────────────────────────────────────────────────────
function withTimeout(promise, ms, label) {
  return Promise.race([
    promise,
    new Promise((_, rej) =>
      setTimeout(() => rej(new Error(`انتهت مهلة: ${label} (${Math.round(ms / 1000)}s)`)), ms)
    ),
  ]);
}

// Recursively find all values for a given key anywhere in a nested object.
function _findInTree(obj, key, out = []) {
  if (!obj || typeof obj !== "object") return out;
  if (key in obj) out.push(obj[key]);
  for (const v of Object.values(obj)) _findInTree(v, key, out);
  return out;
}

// Format milliseconds → "m:ss"
function _msToTimestamp(ms) {
  if (!ms || isNaN(ms)) return "";
  const total = Math.round(ms / 1000);
  const m = Math.floor(total / 60);
  const s = total % 60;
  return `${m}:${s.toString().padStart(2, "0")}`;
}

// ── Provider 1: YouTube via play-dl ──────────────────────────────────────────
async function searchYouTube(query) {
  const results = await withTimeout(
    play.search(query, { source: { youtube: "video" }, limit: 8 }),
    SEARCH_TIMEOUT,
    "YouTube search"
  );
  const valid = (results || []).filter(
    v => v.durationInSec && v.durationInSec > 10 && v.durationInSec < MAX_DURATION_SEC
  );
  if (!valid.length) throw new Error("no_results");
  const v = valid[0];
  return {
    provider:  "youtube",
    url:       v.url,
    title:     v.title || query,
    artist:    v.channel?.name || "",
    duration:  v.durationRaw || "",
    seconds:   v.durationInSec,
    isPreview: false,
  };
}

// Shared download function used by both YouTube and YouTube Music providers.
async function downloadYouTube(url, outPath) {
  const ffmpeg = _findFfmpeg();
  logger.info("MusicEngine", `Streaming → ffmpeg → ${path.basename(outPath)}`);

  const audioInfo = await withTimeout(play.stream(url, { quality: 2 }), 30_000, "play-dl stream");

  return new Promise((resolve, reject) => {
    const args = [
      "-i", "pipe:0",
      "-vn",
      "-ar", "44100",
      "-ac", "2",
      "-b:a", "128k",
      "-f", "mp3",
      "-y",
      outPath,
    ];

    const ff = spawn(ffmpeg, args, { stdio: ["pipe", "ignore", "pipe"] });
    const errs = [];
    ff.stderr.on("data", d => errs.push(d));

    audioInfo.stream.pipe(ff.stdin);
    audioInfo.stream.on("error", err => { try { ff.kill(); } catch {} reject(err); });
    ff.stdin.on("error", () => {});

    let settled = false;
    const done = (err) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      if (err) return reject(err);
      if (fs.existsSync(outPath) && fs.statSync(outPath).size > 1024) {
        resolve();
      } else {
        reject(new Error("ffmpeg produced an empty file"));
      }
    };

    ff.on("close", code => {
      if (code === 0) return done(null);
      done(new Error("ffmpeg exit " + code + ": " + Buffer.concat(errs).toString().slice(-300)));
    });
    ff.on("error", done);

    const timer = setTimeout(() => {
      try { ff.kill("SIGKILL"); } catch {}
      done(new Error("انتهت مهلة التحميل (120s)"));
    }, DOWNLOAD_TIMEOUT);
  });
}

// ── Provider 2: YouTube Music via internal API ────────────────────────────────
const YTM_ENDPOINT =
  "https://music.youtube.com/youtubei/v1/search" +
  "?key=AIzaSyC9XL3ZjWddXya6X74dJoCTL-FUBU6QkLc&prettyPrint=false";

// Songs-only filter param for the YouTube Music search API.
const YTM_SONGS_PARAM = "EgWKAQIIAWoKEAkQBRAKEAMQBA%3D%3D";

function _ytMusicPost(query) {
  return new Promise((resolve, reject) => {
    const body = Buffer.from(JSON.stringify({
      query,
      params: YTM_SONGS_PARAM,
      context: {
        client: {
          clientName:    "WEB_REMIX",
          clientVersion: "1.20240101.01.00",
          hl:            "en",
        },
      },
    }));

    const options = new URL(YTM_ENDPOINT);
    const req = https.request(
      {
        hostname: options.hostname,
        path:     options.pathname + options.search,
        method:   "POST",
        headers:  {
          "Content-Type":   "application/json",
          "Content-Length": body.length,
          "User-Agent":     "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36",
          "Origin":         "https://music.youtube.com",
          "Referer":        "https://music.youtube.com/",
          "X-Goog-Visitor-Id": "",
        },
        timeout: 20_000,
      },
      res => {
        const chunks = [];
        res.on("data", c => chunks.push(c));
        res.on("end", () => {
          try { resolve(JSON.parse(Buffer.concat(chunks).toString())); }
          catch (e) { reject(new Error("YTMusic JSON parse error: " + e.message)); }
        });
        res.on("error", reject);
      }
    );
    req.on("error",   reject);
    req.on("timeout", () => { req.destroy(); reject(new Error("YTMusic API timeout")); });
    req.write(body);
    req.end();
  });
}

function _parseYTMusicItems(data) {
  const items = _findInTree(data, "musicResponsiveListItemRenderer");
  const songs = [];

  for (const item of items) {
    try {
      const videoIds = _findInTree(item, "videoId").filter(id => id?.length === 11);
      if (!videoIds.length) continue;

      const fc     = item.flexColumns || [];
      const title  = fc[0]?.musicResponsiveListItemFlexColumnRenderer?.text?.runs?.[0]?.text || "";
      if (!title) continue;

      // Artist is often in fc[1] runs[0], sometimes after a separator run
      const artistRuns = fc[1]?.musicResponsiveListItemFlexColumnRenderer?.text?.runs || [];
      const artist = artistRuns.find(r => r.text && r.text.trim() && r.text !== " • " && r.text !== "•")?.text || "";

      // Duration: try fixedColumns first, then lengthMs
      let duration = "";
      const fixedText = item.fixedColumns?.[0]
        ?.musicResponsiveListItemFixedColumnRenderer?.text?.runs?.[0]?.text;
      if (fixedText) {
        duration = fixedText;
      } else {
        const ms = _findInTree(item, "lengthMs")[0];
        if (ms) duration = _msToTimestamp(Number(ms));
      }

      songs.push({ videoId: videoIds[0], title, artist, duration });
    } catch {}
  }
  return songs;
}

async function searchYouTubeMusic(query) {
  const data  = await withTimeout(_ytMusicPost(query), SEARCH_TIMEOUT, "YouTube Music search");
  const songs = _parseYTMusicItems(data);
  if (!songs.length) throw new Error("no_results");
  const s = songs[0];
  return {
    provider:  "ytmusic",
    url:       `https://www.youtube.com/watch?v=${s.videoId}`,
    title:     s.title  || query,
    artist:    s.artist || "",
    duration:  s.duration || "",
    seconds:   0,
    isPreview: false,
  };
}

// ── File validation ───────────────────────────────────────────────────────────
function validateFile(fp) {
  if (!fs.existsSync(fp)) throw new Error("الملف الصوتي لم يُنشأ");
  const sz = fs.statSync(fp).size;
  if (sz < 1024)           throw new Error("الملف فارغ (" + sz + " bytes)");
  if (sz > MAX_FILE_BYTES) throw new Error("الملف كبير جداً (" + Math.round(sz / 1048576) + "MB)");
  return sz;
}

// ── Safe delete ───────────────────────────────────────────────────────────────
function safeDelete(fp, delayMs = 30_000) {
  if (delayMs === 0) {
    try { if (fp && fs.existsSync(fp)) fs.unlinkSync(fp); } catch {}
    return;
  }
  setTimeout(() => { try { if (fp && fs.existsSync(fp)) fs.unlinkSync(fp); } catch {} }, delayMs);
}

module.exports = {
  TMP_DIR,
  searchYouTube,
  searchYouTubeMusic,
  downloadYouTube,
  validateFile,
  safeDelete,
  userCooldown,
  markUser,
};
