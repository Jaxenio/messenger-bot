"use strict";

/**
 * musicEngine v4
 *
 * Search:   play-dl (YouTube)  +  YouTube Music internal API (fallback)
 * Download: yt-dlp binary  →  mp3  (play.stream was broken — Invalid URL)
 *
 * yt-dlp is auto-downloaded once to TMP_DIR if not found on the system.
 * Retries 4 YouTube player clients: android → ios → tv_embedded → mweb
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
  // `which` resolves the current nix store path dynamically
  try {
    const { execSync } = require("child_process");
    const p = execSync("which ffmpeg", { stdio: ["ignore", "pipe", "ignore"] }).toString().trim();
    if (p && fs.existsSync(p)) return p;
  } catch {}
  const HOME = process.env.HOME || "/root";
  const candidates = [
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

// ── yt-dlp helpers ────────────────────────────────────────────────────────────
const YTDLP_CACHED = path.join(TMP_DIR, "yt-dlp");
let _ytdlpPath = null;

const YT_CLIENTS = ["android", "ios", "tv_embedded", "mweb"];

function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }

function _spawnAsync(cmd, args, { timeout = 60_000 } = {}) {
  return new Promise((resolve, reject) => {
    let done = false;
    const proc  = spawn(cmd, args, { stdio: ["ignore", "pipe", "pipe"] });
    const out   = [];
    const err   = [];
    proc.stdout.on("data", d => out.push(d));
    proc.stderr.on("data", d => err.push(d));
    proc.on("error", e => { if (!done) { done = true; reject(e); } });
    proc.on("close", code => {
      if (done) return;
      done = true;
      clearTimeout(timer);
      const stderr = Buffer.concat(err).toString();
      if (code === 0) return resolve(Buffer.concat(out).toString() + stderr);
      reject(new Error(`${path.basename(cmd)} exit ${code}: ${stderr.slice(0, 300)}`));
    });
    const timer = setTimeout(() => {
      if (done) return;
      done = true;
      try { proc.kill("SIGKILL"); } catch {}
      reject(new Error(`${path.basename(cmd)} timeout (${Math.round(timeout / 1000)}s)`));
    }, timeout);
  });
}

async function _httpFetchBinary(url) {
  return new Promise((resolve, reject) => {
    const mod = url.startsWith("https") ? https : require("http");
    const req = mod.get(url, { timeout: 90_000, headers: { "User-Agent": "curl/7.88" } }, res => {
      if ([301, 302, 303, 307, 308].includes(res.statusCode) && res.headers.location) {
        req.destroy();
        return _httpFetchBinary(res.headers.location).then(resolve, reject);
      }
      if (res.statusCode !== 200) { req.destroy(); return reject(new Error("HTTP " + res.statusCode)); }
      const chunks = [];
      res.on("data", c => chunks.push(c));
      res.on("end", () => resolve(Buffer.concat(chunks)));
      res.on("error", reject);
    });
    req.on("error", reject);
    req.on("timeout", () => { req.destroy(); reject(new Error("fetch timeout")); });
  });
}

async function _ensureYtDlp() {
  if (_ytdlpPath) return _ytdlpPath;

  const HOME = process.env.HOME || "/root";
  const candidates = [
    YTDLP_CACHED,
    "/usr/local/bin/yt-dlp",
    "/usr/bin/yt-dlp",
    path.join(HOME, ".local/bin/yt-dlp"),
    "/nix/var/nix/profiles/default/bin/yt-dlp",
    path.join(HOME, ".nix-profile/bin/yt-dlp"),
  ];

  for (const c of candidates) {
    try {
      const ver = await _spawnAsync(c, ["--version"], { timeout: 5_000 });
      logger.info("MusicEngine", `yt-dlp found: ${c} (${ver.trim()})`);
      _ytdlpPath = c;
      return c;
    } catch {}
  }

  // Download from GitHub releases
  logger.info("MusicEngine", "Downloading yt-dlp binary...");
  const buf = await withTimeout(_httpFetchBinary(
    "https://github.com/yt-dlp/yt-dlp/releases/latest/download/yt-dlp_linux"
  ), 90_000, "yt-dlp download");
  fs.writeFileSync(YTDLP_CACHED, buf, { mode: 0o755 });
  const ver = await _spawnAsync(YTDLP_CACHED, ["--version"], { timeout: 5_000 });
  logger.success("MusicEngine", `yt-dlp ready: ${ver.trim()}`);
  _ytdlpPath = YTDLP_CACHED;
  return YTDLP_CACHED;
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

// ── Primary downloader: play-dl stream → ffmpeg pipe → mp3 ───────────────────
// Uses play-dl's own YouTube access (no yt-dlp, no bot-detection wall).
async function _downloadWithPlayDl(url, outPath) {
  const ffmpeg = _findFfmpeg();

  const source = await withTimeout(
    play.stream(url),
    SEARCH_TIMEOUT + 5_000,
    "play-dl stream"
  );

  return new Promise((resolve, reject) => {
    let done = false;
    const proc = spawn(ffmpeg, [
      "-i", "pipe:0",
      "-vn", "-ar", "44100", "-ac", "2", "-b:a", "128k",
      "-f", "mp3", "-y", outPath,
    ], { stdio: ["pipe", "ignore", "pipe"] });

    const errChunks = [];
    proc.stderr.on("data", d => errChunks.push(d));
    proc.on("error", e => { if (!done) { done = true; reject(e); } });
    proc.on("close", code => {
      if (done) return;
      done = true;
      if (code === 0 && fs.existsSync(outPath) && fs.statSync(outPath).size > 1024) {
        resolve();
      } else {
        const msg = Buffer.concat(errChunks).toString().slice(0, 200);
        reject(new Error(`ffmpeg exit ${code}: ${msg}`));
      }
    });

    source.stream.pipe(proc.stdin);
    source.stream.on("error", e => {
      if (!done) { done = true; try { proc.kill(); } catch {} reject(e); }
    });
  });
}

// ── Fallback downloader: yt-dlp with bot-bypass player clients ────────────────
async function _downloadWithYtDlp(url, outPath) {
  const bin    = await withTimeout(_ensureYtDlp(), 95_000, "تجهيز yt-dlp");
  const ffmpeg = _findFfmpeg();

  const base = outPath.endsWith(".mp3") ? outPath.slice(0, -4) : outPath;

  const FORMAT_CHAINS = [
    "bestaudio[ext=m4a]/bestaudio[ext=webm]/bestaudio",
    "18",
  ];

  // Clients that don't require sign-in
  const PLAYER_CLIENTS = ["tv_embedded", "mediaconnect", "web_creator", "ios"];

  const YTDLP_BASE = [
    "--no-playlist",
    "--no-part", "--no-cache-dir",
    "--quiet", "--no-warnings",
    "--force-ipv4", "--geo-bypass", "--no-check-certificates",
    "--socket-timeout", "30",
  ];

  let rawFile = null;
  let lastErr  = null;
  const RAW_EXTS = ["m4a", "webm", "mp4", "opus", "ogg", "aac"];

  outer:
  for (const fmt of FORMAT_CHAINS) {
    for (const client of PLAYER_CLIENTS) {
      for (const ext of RAW_EXTS) { try { fs.unlinkSync(`${base}.${ext}`); } catch {} }
      logger.info("MusicEngine", `yt-dlp client="${client}" fmt="${fmt}": ${url.slice(-15)}`);
      try {
        await withTimeout(
          _spawnAsync(bin, [
            ...YTDLP_BASE,
            "--extractor-args", `youtube:player_client=${client}`,
            "-f", fmt,
            "-o", `${base}.%(ext)s`,
            url,
          ], { timeout: DOWNLOAD_TIMEOUT }),
          DOWNLOAD_TIMEOUT + 5_000, `تحميل (${client}/${fmt})`
        );
        for (const ext of RAW_EXTS) {
          const fp = `${base}.${ext}`;
          if (fs.existsSync(fp) && fs.statSync(fp).size > 10_240) { rawFile = fp; break; }
        }
        if (rawFile) break outer;
        throw new Error("output file missing or empty after download");
      } catch (e) {
        lastErr = e;
        logger.warn("MusicEngine", `client="${client}" fmt="${fmt}" failed: ${e.message.slice(0, 120)}`);
      }
    }
  }

  if (!rawFile) throw new Error(lastErr?.message || "yt-dlp: تعذّر إيجاد stream صالح");

  logger.info("MusicEngine", `ffmpeg: ${path.extname(rawFile)} → mp3`);
  try {
    await withTimeout(
      _spawnAsync(ffmpeg,
        ["-i", rawFile, "-vn", "-ar", "44100", "-ac", "2", "-b:a", "128k", "-f", "mp3", "-y", outPath],
        { timeout: 60_000 }),
      65_000, "ffmpeg convert"
    );
  } finally {
    try { fs.unlinkSync(rawFile); } catch {}
  }

  if (!fs.existsSync(outPath) || fs.statSync(outPath).size < 1024) {
    throw new Error("ffmpeg produced empty or missing mp3");
  }
}

// ── Public download: play-dl first, yt-dlp as fallback ───────────────────────
async function downloadYouTube(url, outPath) {
  // Step 1 — play-dl stream (bypasses bot-detection entirely)
  try {
    logger.info("MusicEngine", `play-dl stream: ${url.slice(-15)}`);
    await withTimeout(_downloadWithPlayDl(url, outPath), DOWNLOAD_TIMEOUT, "play-dl download");
    if (fs.existsSync(outPath) && fs.statSync(outPath).size > 1024) {
      logger.success("MusicEngine", `play-dl OK: ${path.basename(outPath)}`);
      return;
    }
  } catch (e) {
    logger.warn("MusicEngine", `play-dl failed, falling back to yt-dlp: ${e.message.slice(0, 120)}`);
    try { if (fs.existsSync(outPath)) fs.unlinkSync(outPath); } catch {}
  }

  // Step 2 — yt-dlp fallback with player-client rotation
  logger.info("MusicEngine", `yt-dlp fallback: ${url.slice(-15)}`);
  await _downloadWithYtDlp(url, outPath);

  // Step 2: convert raw audio to mp3 with ffmpeg
  logger.info("MusicEngine",
    `ffmpeg: ${path.extname(rawFile)} → mp3  [${path.basename(rawFile)}]`);
  try {
    await withTimeout(
      _spawnAsync(ffmpeg,
        ["-i", rawFile, "-vn", "-ar", "44100", "-ac", "2", "-b:a", "128k", "-f", "mp3", "-y", outPath],
        { timeout: 60_000 }),
      65_000, "ffmpeg convert"
    );
  } finally {
    try { fs.unlinkSync(rawFile); } catch {}
  }

  if (!fs.existsSync(outPath) || fs.statSync(outPath).size < 1024) {
    throw new Error("ffmpeg produced empty or missing mp3");
  }
  logger.success("MusicEngine",
    `Ready: ${path.basename(outPath)} (${Math.round(fs.statSync(outPath).size / 1024)}KB)`);
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
