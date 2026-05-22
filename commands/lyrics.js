"use strict";

// ── HTTP GET helper (JSON) ─────────────────────────────────────────────────────
const https = require("https");

function getJson(hostname, urlPath) {
  return new Promise((resolve, reject) => {
    const req = https.get(
      { hostname, path: urlPath, headers: { "User-Agent": "Mozilla/5.0" }, timeout: 10_000 },
      res => {
        let d = "";
        res.on("data", c => d += c);
        res.on("end", () => {
          try { resolve(JSON.parse(d)); }
          catch { reject(new Error("Bad JSON from " + hostname)); }
        });
      }
    );
    req.on("error",   reject);
    req.on("timeout", () => { req.destroy(); reject(new Error("Request timed out")); });
  });
}

// ── Primary: lrclib.net ───────────────────────────────────────────────────────
async function fetchFromLrclib(query) {
  const res = await getJson("lrclib.net", "/api/search?q=" + encodeURIComponent(query));
  if (!Array.isArray(res) || !res.length) return null;
  const hit = res.find(r => r.plainLyrics) || res[0];
  if (!hit || !hit.plainLyrics) return null;
  return {
    lyrics:   hit.plainLyrics.trim(),
    track:    hit.trackName  || query,
    artist:   hit.artistName || "",
    album:    hit.albumName  || "",
    duration: hit.duration   || 0,
  };
}

// ── Fallback: lyrics.ovh (needs "artist - title") ────────────────────────────
async function fetchFromLyricsOvh(query) {
  const parts  = query.split(/\s+-\s+/);
  const artist = parts.length > 1 ? parts[0].trim() : "unknown";
  const title  = parts.length > 1 ? parts.slice(1).join(" - ").trim() : query;
  const res    = await getJson(
    "api.lyrics.ovh",
    "/v1/" + encodeURIComponent(artist) + "/" + encodeURIComponent(title)
  );
  if (!res || !res.lyrics) return null;
  return { lyrics: res.lyrics.trim(), track: title, artist, album: "", duration: 0 };
}

// ── Format duration mm:ss ─────────────────────────────────────────────────────
function fmtDur(sec) {
  if (!sec) return "";
  return " · ⏱ " + Math.floor(sec / 60) + ":" + String(Math.floor(sec % 60)).padStart(2, "0");
}

// ── Split long lyrics into ≤1800-char chunks at line boundaries ───────────────
function chunkLyrics(text, maxLen = 1800) {
  const lines  = text.split("\n");
  const chunks = [];
  let   buf    = "";
  for (const line of lines) {
    if ((buf + "\n" + line).length > maxLen) {
      if (buf) chunks.push(buf.trim());
      buf = line;
    } else {
      buf = buf ? buf + "\n" + line : line;
    }
  }
  if (buf.trim()) chunks.push(buf.trim());
  return chunks;
}

// ── Command ───────────────────────────────────────────────────────────────────
module.exports = {
  name: "lyrics",
  aliases: ["كلمات", "lyric", "lrc"],
  description: "جلب كلمات أي أغنية.",
  usage: "lyrics [اسم الأغنية] أو [الفنان - الأغنية]",
  category: "Entertainment",

  async execute({ api, event, args }) {
    const { threadID } = event;
    const query = args.join(" ").trim();

    if (!query) {
      return api.sendMessage(
        "🎵 الاستخدام: -lyrics [اسم الأغنية]\n" +
        "أمثلة:\n" +
        "  -lyrics Blinding Lights\n" +
        "  -lyrics The Weeknd - Blinding Lights\n" +
        "  -lyrics ليلى مراد",
        threadID
      );
    }

    await api.sendMessage("🔍 جاري البحث عن كلمات: " + query + " ...", threadID);

    let result = null;
    try { result = await fetchFromLrclib(query); }   catch { /* try fallback */ }
    if (!result) {
      try { result = await fetchFromLyricsOvh(query); } catch { /* ignore */ }
    }

    if (!result) {
      return api.sendMessage(
        "😕 لم يُعثر على كلمات هذه الأغنية.\n" +
        "جرّب: -lyrics [الفنان] - [اسم الأغنية]",
        threadID
      );
    }

    const header =
      "🎵 " + result.track +
      (result.artist   ? "\n🎤 " + result.artist : "") +
      (result.album    ? "\n💿 " + result.album  : "") +
      fmtDur(result.duration) +
      "\n\n─────────────────\n";

    const chunks = chunkLyrics(result.lyrics);

    // إرسال الرأس مع الجزء الأول معاً
    await api.sendMessage(header + chunks[0], threadID);

    // الأجزاء التالية — msgQueue يضيف التأخير البشري تلقائياً
    for (let i = 1; i < chunks.length; i++) {
      await api.sendMessage(chunks[i], threadID);
    }
  },
};
