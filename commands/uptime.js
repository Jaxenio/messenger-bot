"use strict";

const { createCanvas, GlobalFonts } = require("@napi-rs/canvas");
const fs     = require("fs");
const os     = require("os");
const path   = require("path");
const config = require("../config.json");

try {
  GlobalFonts.registerFromPath(
    path.join(__dirname, "../assets/JetBrainsMono-Bold.ttf"),
    "JBMono"
  );
} catch {}

// ── Helpers ───────────────────────────────────────────────────────────────────

function f(size, bold = true) {
  return (bold ? "bold " : "") + size + "px JBMono, monospace";
}

function randHex(len = 8) {
  let s = "";
  for (let i = 0; i < len; i++) s += Math.floor(Math.random() * 16).toString(16).toUpperCase();
  return s;
}

/** Small pixel-noise grid for header decoration */
function pixelNoise(ctx, x, y, w, h) {
  const palette = ["#00ff41", "#00cc33", "#008822", "#005511", "#00ff8844"];
  const sz = 7;
  for (let px = x; px < x + w; px += sz + 1) {
    for (let py = y; py < y + h; py += sz + 1) {
      if (Math.random() > 0.45) {
        ctx.fillStyle = palette[Math.floor(Math.random() * palette.length)];
        ctx.fillRect(px, py, sz, sz);
      }
    }
  }
}

/** Horizontal line */
function hline(ctx, y, x1, x2, color, lw = 1) {
  ctx.save();
  ctx.strokeStyle = color; ctx.lineWidth = lw;
  ctx.beginPath(); ctx.moveTo(x1, y); ctx.lineTo(x2, y); ctx.stroke();
  ctx.restore();
}

/** Vertical line */
function vline(ctx, x, y1, y2, color, lw = 1) {
  ctx.save();
  ctx.strokeStyle = color; ctx.lineWidth = lw;
  ctx.beginPath(); ctx.moveTo(x, y1); ctx.lineTo(x, y2); ctx.stroke();
  ctx.restore();
}

/** Progress bar with label pct inside */
function progressBar(ctx, x, y, w, h, pct, fillColor) {
  const BG_BAR = "#021408";
  // Track
  ctx.fillStyle = BG_BAR;
  ctx.fillRect(x, y, w, h);
  // Fill
  const fillW = Math.max(0, Math.floor(w * Math.min(pct, 100) / 100));
  ctx.fillStyle = fillColor;
  ctx.fillRect(x, y, fillW, h);
  // Segmented overlay (looks like the reference image blocks)
  ctx.fillStyle = "rgba(0,0,0,0.25)";
  const seg = Math.floor(w / 14);
  for (let i = seg; i < w; i += seg + 1) ctx.fillRect(x + i, y, 1, h);
  // Percentage text
  const label = Math.round(pct) + "%";
  ctx.save();
  ctx.fillStyle = "#000000";
  ctx.font = f(11);
  ctx.textAlign = "right";
  ctx.fillText(label, x + w - 5, y + h - 4);
  ctx.restore();
  // Small squares at end (like reference)
  for (let i = 0; i < 3; i++) {
    ctx.strokeStyle = fillColor;
    ctx.lineWidth = 1;
    ctx.strokeRect(x + w + 4 + i * 9, y + 2, 7, h - 4);
  }
}

// ── Card builder ──────────────────────────────────────────────────────────────

async function buildCard(info) {
  const W = 920, H = 520;
  const canvas = createCanvas(W, H);
  const ctx    = canvas.getContext("2d");

  // Palette
  const BG      = "#060b18";
  const PANEL   = "#0a1525";
  const GREEN   = "#00ff41";
  const G_MED   = "#00cc33";
  const G_DIM   = "#005511";
  const G_DARK  = "#021408";
  const CYAN    = "#00d4ff";
  const MAGENTA = "#ff00ee";

  // ── Background ────────────────────────────────────────────────────────────
  ctx.fillStyle = BG;
  ctx.fillRect(0, 0, W, H);

  // ══════════════════════════════════════════════════════════════════════════
  // SECTION 1 — HEADER  (y: 0 → 102)
  // ══════════════════════════════════════════════════════════════════════════
  ctx.fillStyle = "#040910";
  ctx.fillRect(0, 0, W, 102);

  // — Pixel noise left
  pixelNoise(ctx, 14, 8, 155, 58);

  // — Pixel noise right
  pixelNoise(ctx, W - 169, 8, 155, 58);

  // — Title box (center)
  const TITLE    = "SYSTEM TERMINAL";
  ctx.font = f(26);
  const titleW = ctx.measureText(TITLE).width + 48;
  const titleX = Math.floor((W - titleW) / 2);
  ctx.fillStyle = G_DARK;
  ctx.fillRect(titleX, 8, titleW, 58);
  ctx.strokeStyle = GREEN; ctx.lineWidth = 2;
  ctx.strokeRect(titleX, 8, titleW, 58);

  ctx.fillStyle = GREEN;
  ctx.textAlign = "center";
  ctx.font = f(26);
  ctx.fillText(TITLE, W / 2, 46);

  // — Subtitle
  ctx.fillStyle = G_MED;
  ctx.font = f(11, false);
  ctx.textAlign = "center";
  ctx.fillText(">>> REAL-TIME SYSTEM MONITOR v2.8 <<<", W / 2, 72);

  // — Separator
  hline(ctx, 82, 14, W - 14, G_DIM, 1);

  // — Connection info
  ctx.fillStyle = GREEN;
  ctx.font = f(11, false);
  ctx.textAlign = "left";
  ctx.fillText(`CONNECTED TO: ${info.botID}`, 18, 97);
  ctx.textAlign = "right";
  ctx.fillText(`SESSION: ${randHex(8)}`, W - 18, 97);

  // ══════════════════════════════════════════════════════════════════════════
  // SECTION 2 — MAIN PANEL  (y: 108 → 390)
  // ══════════════════════════════════════════════════════════════════════════
  const PY = 108, PH = 278;
  ctx.fillStyle = PANEL;
  ctx.fillRect(18, PY, W - 36, PH);
  ctx.strokeStyle = GREEN; ctx.lineWidth = 1.5;
  ctx.strokeRect(18, PY, W - 36, PH);

  // — Vertical divider
  vline(ctx, W / 2, PY, PY + PH, GREEN, 1);

  // ── LEFT: SYSTEM SPECIFICATIONS ──────────────────────────────────────────
  const LX = 34;

  ctx.fillStyle = GREEN;
  ctx.font = f(13);
  ctx.textAlign = "left";
  ctx.fillText("> SYSTEM SPECIFICATIONS", LX, PY + 24);

  hline(ctx, PY + 30, LX, W / 2 - 10, G_DIM);

  const specs = [
    `OS: ${info.platform.toUpperCase()} ${info.arch.toUpperCase()}`,
    `CPU CORES: ${info.cores}`,
    `CPU: ${info.cpu}`,
    `NETWORK: ${info.networkIF} ACTIVE INTERFACE${info.networkIF !== 1 ? "S" : ""}`,
    `NODE: ${info.nodeVer}`,
    `LOAD: ${info.loadAvg}`,
    `COMMANDS: ${info.commands}`,
    `GROUPS: ${info.groups}`,
  ];

  specs.forEach((spec, i) => {
    const sy = PY + 50 + i * 28;
    // Bullet dot
    ctx.fillStyle = GREEN;
    ctx.beginPath(); ctx.arc(LX + 7, sy - 5, 5, 0, Math.PI * 2); ctx.fill();
    // Inner dot
    ctx.fillStyle = G_DARK;
    ctx.beginPath(); ctx.arc(LX + 7, sy - 5, 2, 0, Math.PI * 2); ctx.fill();
    // Text
    ctx.fillStyle = GREEN;
    ctx.font = f(11, false);
    ctx.textAlign = "left";
    ctx.fillText(spec, LX + 20, sy);
  });

  // ── RIGHT: LIVE METRICS ───────────────────────────────────────────────────
  const RX  = W / 2 + 18;
  const BW  = W / 2 - 60;   // bar width

  ctx.fillStyle = GREEN;
  ctx.font = f(13);
  ctx.textAlign = "left";
  ctx.fillText("> LIVE METRICS", RX, PY + 24);

  hline(ctx, PY + 30, W / 2 + 10, W - 24, G_DIM);

  const metrics = [
    { label: "CPU LOAD",      pct: info.cpuPct,  color: GREEN   },
    { label: "MEMORY USAGE",  pct: info.memPct,  color: CYAN    },
    { label: "HEAP USAGE",    pct: info.heapPct, color: MAGENTA },
  ];

  metrics.forEach(({ label, pct, color }, i) => {
    const MY = PY + 52 + i * 74;
    ctx.fillStyle = G_MED;
    ctx.font = f(11, false);
    ctx.textAlign = "left";
    ctx.fillText(label, RX, MY);
    progressBar(ctx, RX, MY + 8, BW, 24, pct, color);
  });

  // ══════════════════════════════════════════════════════════════════════════
  // SECTION 3 — BOT UPTIME  (y: 394 → 440)
  // ══════════════════════════════════════════════════════════════════════════
  const UY = 394, UH = 44;
  ctx.fillStyle = PANEL;
  ctx.fillRect(18, UY, W - 36, UH);
  ctx.strokeStyle = GREEN; ctx.lineWidth = 1;
  ctx.strokeRect(18, UY, W - 36, UH);

  // Clock circle icon
  const CX = 46, CY = UY + UH / 2;
  ctx.strokeStyle = GREEN; ctx.lineWidth = 1.5;
  ctx.beginPath(); ctx.arc(CX, CY, 11, 0, Math.PI * 2); ctx.stroke();
  ctx.beginPath(); ctx.moveTo(CX, CY); ctx.lineTo(CX, CY - 7); ctx.stroke();
  ctx.beginPath(); ctx.moveTo(CX, CY); ctx.lineTo(CX + 6, CY); ctx.stroke();

  ctx.fillStyle = GREEN;
  ctx.font = f(14);
  ctx.textAlign = "left";
  ctx.fillText("BOT UPTIME:", 66, UY + UH / 2 + 6);

  const upStr = `[ ${info.days}d ${info.hours}h ${info.mins}m ]`;
  ctx.font = f(16);
  const upW = ctx.measureText(upStr).width + 22;
  const upX = 200;
  ctx.fillStyle = G_DARK;
  ctx.fillRect(upX, UY + 8, upW, UH - 16);
  ctx.strokeStyle = GREEN; ctx.lineWidth = 1;
  ctx.strokeRect(upX, UY + 8, upW, UH - 16);
  ctx.fillStyle = GREEN;
  ctx.textAlign = "left";
  ctx.fillText(upStr, upX + 10, UY + UH / 2 + 6);

  // ══════════════════════════════════════════════════════════════════════════
  // SECTION 4 — RESPONSE TIME  (y: 442 → 486)
  // ══════════════════════════════════════════════════════════════════════════
  const RY = 442, RH = 44;
  ctx.fillStyle = PANEL;
  ctx.fillRect(18, RY, W - 36, RH);
  ctx.strokeStyle = GREEN; ctx.lineWidth = 1;
  ctx.strokeRect(18, RY, W - 36, RH);

  // Arrow icon
  ctx.fillStyle = GREEN;
  ctx.font = f(18);
  ctx.textAlign = "left";
  ctx.fillText("✈", 34, RY + RH / 2 + 7);

  ctx.font = f(14);
  ctx.fillText("RESPONSE TIME:", 62, RY + RH / 2 + 6);

  const quality = info.latency < 300 ? "EXCELLENT"
    : info.latency < 700 ? "GOOD"
    : "SLOW";
  const rtStr = `[ ${info.latency}ms  |  ${quality} ]`;
  ctx.font = f(14, false);
  ctx.fillText(rtStr, 226, RY + RH / 2 + 6);

  // ══════════════════════════════════════════════════════════════════════════
  // SECTION 5 — FOOTER  (y: 492 → 520)
  // ══════════════════════════════════════════════════════════════════════════
  hline(ctx, 492, 14, W - 14, G_DIM);

  ctx.fillStyle = GREEN;
  ctx.font = f(12);
  ctx.textAlign = "center";
  ctx.fillText("<<< SYSTEM STATUS: OPTIMAL >>>", W / 2, 510);

  // Hex address decorations
  const hexCount = 6;
  const hexStep  = (W - 40) / hexCount;
  ctx.fillStyle = G_DIM;
  ctx.font = f(9, false);
  for (let i = 0; i < hexCount; i++) {
    ctx.textAlign = "center";
    ctx.fillText("0x" + randHex(6), 20 + i * hexStep + hexStep / 2, 520);
  }

  return canvas.toBuffer("image/png");
}

// ── Module export ─────────────────────────────────────────────────────────────

module.exports = {
  name: "uptime",
  aliases: ["up"],
  description: "عرض تفاصيل البوت كصورة.",
  usage: "uptime",
  category: "General",

  async execute({ api, event, commands }) {
    const total = Math.floor(process.uptime());
    const days  = Math.floor(total / 86400);
    const hours = Math.floor((total % 86400) / 3600);
    const mins  = Math.floor((total % 3600) / 60);
    const secs  = total % 60;

    const mem       = process.memoryUsage();
    const memRSS    = mem.rss;
    const memTotal  = os.totalmem();
    const memFreeB  = os.freemem();
    const memPct    = Math.min(100, (memRSS / memTotal) * 100);
    const heapPct   = Math.min(100, (mem.heapUsed / mem.heapTotal) * 100);

    const loadAvg   = os.loadavg()[0];
    const cpuCount  = os.cpus().length;
    const cpuPct    = Math.min(100, (loadAvg / cpuCount) * 100);

    const latency   = event.timestamp ? Date.now() - event.timestamp : 0;

    // Network interfaces count (non-internal)
    const networkIF = Object.values(os.networkInterfaces())
      .flat()
      .filter(n => !n.internal && n.family === "IPv4").length;

    let groups = 0;
    try { const st = require("../state"); groups = st.groupsCache?.size || 0; } catch {}

    const cmdCount  = commands ? [...new Set(commands.values())].length : 0;
    const cpuModel  = (os.cpus()[0]?.model || "Unknown").trim();

    const info = {
      botName:     config.bot.name,
      version:     config.bot.version,
      botID:       String(api.getCurrentUserID()).slice(0, 14),
      platform:    os.platform(),
      arch:        os.arch(),
      cores:       cpuCount,
      cpu:         cpuModel.length > 26 ? cpuModel.slice(0, 26) + "…" : cpuModel,
      nodeVer:     process.version,
      networkIF,
      loadAvg:     loadAvg.toFixed(2),
      memTotal:    Math.round(memTotal / 1024 / 1024),
      memFree:     Math.round(memFreeB / 1024 / 1024),
      memPct:      Math.round(memPct),
      heapPct:     Math.round(heapPct),
      cpuPct:      Math.round(cpuPct),
      days, hours, mins, secs,
      commands:    cmdCount,
      groups,
      latency,
    };

    const tmpFile = path.join(os.tmpdir(), "uptime_" + Date.now() + ".png");
    try {
      const buf = await buildCard(info);
      fs.writeFileSync(tmpFile, buf);
      await api.sendMessage(
        { body: "", attachment: fs.createReadStream(tmpFile) },
        event.threadID
      );
    } catch (e) {
      api.sendMessage(
        `${info.botName} v${info.version}\nUptime: ${days}d ${hours}h ${mins}m ${secs}s\nRAM: ${Math.round(memRSS / 1024 / 1024)} MB`,
        event.threadID
      );
    } finally {
      try { fs.unlinkSync(tmpFile); } catch {}
    }
  },
};
