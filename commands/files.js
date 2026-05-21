"use strict";

const fs     = require("fs");
const path   = require("path");
const config = require("../config.json");
const { DIV, MARK, row, ok, err } = require("../utils/ui");

// ── Constants ─────────────────────────────────────────────────────────────────

/** جذر مجلد البوت */
const ROOT = path.resolve(__dirname, "..");

/** الملفات المحمية — لا يمكن حذفها */
const PROTECTED = new Set([
  "config.json", "appstate.json", "package.json", "package-lock.json",
  "index.js", "state.js", "api.js", "yarn.lock",
]);

/** المجلدات المُخفاة من النتائج */
const SKIP_DIRS = new Set(["node_modules", ".git", ".npm", ".cache"]);

/** أقصى حجم للقراءة النصية */
const READ_LIMIT = 3600;

/** أقصى حجم للإرسال كمرفق (5 MB) */
const SEND_LIMIT = 5 * 1024 * 1024;

// ── Utilities ─────────────────────────────────────────────────────────────────

/** تحويل bytes لوحدة مقروءة */
function humanSize(bytes) {
  if (bytes < 1024)              return bytes + " B";
  if (bytes < 1024 * 1024)       return (bytes / 1024).toFixed(1) + " KB";
  if (bytes < 1024 * 1024 * 1024) return (bytes / 1024 / 1024).toFixed(1) + " MB";
  return (bytes / 1024 / 1024 / 1024).toFixed(2) + " GB";
}

/** التحقق من المسار وإعادته آمناً (يمنع path traversal) */
function safePath(input) {
  if (!input) return null;
  const resolved = path.resolve(ROOT, input.replace(/\\/g, "/"));
  if (!resolved.startsWith(ROOT + path.sep) && resolved !== ROOT) return null;
  return resolved;
}

/** مسار نسبي من ROOT */
function rel(absPath) {
  const r = path.relative(ROOT, absPath);
  return r || ".";
}

/** قراءة محتوى مجلد مُرتّب (مجلدات أولاً ثم ملفات) */
function readDir(dirPath) {
  const entries = fs.readdirSync(dirPath, { withFileTypes: true });
  const list = entries
    .filter(e => !SKIP_DIRS.has(e.name))
    .map(e => {
      let size = "";
      if (e.isFile()) {
        try { size = humanSize(fs.statSync(path.join(dirPath, e.name)).size); } catch {}
      }
      return { name: e.name, isDir: e.isDirectory(), size };
    })
    .sort((a, b) => {
      if (a.isDir !== b.isDir) return a.isDir ? -1 : 1;
      return a.name.localeCompare(b.name);
    });
  return list;
}

/** حجم مجلد بشكل تكراري */
function dirSize(dirPath, depth = 0) {
  if (depth > 6) return 0;
  let total = 0;
  try {
    for (const e of fs.readdirSync(dirPath, { withFileTypes: true })) {
      if (SKIP_DIRS.has(e.name)) continue;
      const full = path.join(dirPath, e.name);
      if (e.isFile())      { try { total += fs.statSync(full).size; } catch {} }
      else if (e.isDir())  { total += dirSize(full, depth + 1); }
    }
  } catch {}
  return total;
}

/** بحث تكراري عن اسم الملف */
function findFiles(dir, pattern, results = [], depth = 0) {
  if (depth > 6 || results.length >= 40) return results;
  try {
    for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
      if (SKIP_DIRS.has(e.name)) continue;
      const full = path.join(dir, e.name);
      if (e.name.toLowerCase().includes(pattern.toLowerCase())) {
        results.push({ path: rel(full), isDir: e.isDirectory() });
      }
      if (e.isDirectory()) findFiles(full, pattern, results, depth + 1);
    }
  } catch {}
  return results;
}

// ── Command ───────────────────────────────────────────────────────────────────

module.exports = {
  name: "files",
  aliases: ["file", "fs", "ملفات"],
  description: "إدارة ملفات البوت — للمشرفين فقط.",
  usage: [
    "-files ls [مسار]      — عرض محتوى مجلد",
    "-files read <ملف>     — قراءة محتوى ملف",
    "-files info <مسار>    — معلومات الملف",
    "-files find <نمط>     — البحث عن ملف",
    "-files size           — مساحة الملفات",
    "-files send <ملف>     — إرسال ملف كمرفق",
    "-files del <ملف>      — حذف ملف",
  ].join("\n"),
  category: "Admin",
  adminOnly: true,

  async execute({ api, event, args }) {
    const { threadID } = event;
    const sub  = (args[0] || "ls").toLowerCase();
    const arg1 = args[1] || "";
    const p    = config.prefix;

    // ══════════════════════════════════════════════════════════════════════════
    // ls — عرض محتوى مجلد
    // ══════════════════════════════════════════════════════════════════════════
    if (sub === "ls" || sub === "list" || sub === "dir") {
      const target = arg1 ? safePath(arg1) : ROOT;
      if (!target)                  return api.sendMessage(err("مسار غير صالح."), threadID);
      if (!fs.existsSync(target))   return api.sendMessage(err("المسار غير موجود."), threadID);
      if (!fs.statSync(target).isDirectory()) return api.sendMessage(err("المسار ليس مجلداً."), threadID);

      const entries = readDir(target);
      const dirs    = entries.filter(e => e.isDir);
      const files_  = entries.filter(e => !e.isDir);

      const lines = [
        `${MARK} ${rel(target)}`,
        DIV,
        ...dirs.map(d   => `  📁  ${d.name}/`),
        ...files_.map(f => `  ❏   ${f.name}  ·  ${f.size}`),
        DIV,
        `مجلدات: ${dirs.length}  ·  ملفات: ${files_.length}`,
      ];
      return api.sendMessage(lines.join("\n"), threadID);
    }

    // ══════════════════════════════════════════════════════════════════════════
    // read — قراءة محتوى ملف
    // ══════════════════════════════════════════════════════════════════════════
    if (sub === "read" || sub === "cat" || sub === "view") {
      if (!arg1) {
        return api.sendMessage(err(`اذكر الملف.\nمثال: ${p}files read config.json`), threadID);
      }
      const target = safePath(arg1);
      if (!target)                  return api.sendMessage(err("مسار غير صالح."), threadID);
      if (!fs.existsSync(target))   return api.sendMessage(err("الملف غير موجود."), threadID);

      const stat = fs.statSync(target);
      if (!stat.isFile())           return api.sendMessage(err("المسار ليس ملفاً."), threadID);
      if (stat.size > 600 * 1024)   return api.sendMessage(err(`الملف كبير جداً (${humanSize(stat.size)}).\nاستخدم ${p}files send للتنزيل.`), threadID);

      let content   = fs.readFileSync(target, "utf8");
      let truncated = false;
      if (content.length > READ_LIMIT) {
        content   = content.slice(0, READ_LIMIT);
        truncated = true;
      }

      const lines = [`${MARK} ${rel(target)}`, DIV, content];
      if (truncated) {
        lines.push(DIV, `مقتطع · الملف ${humanSize(stat.size)} — استخدم ${p}files send للتنزيل الكامل.`);
      }
      return api.sendMessage(lines.join("\n"), threadID);
    }

    // ══════════════════════════════════════════════════════════════════════════
    // info — معلومات ملف أو مجلد
    // ══════════════════════════════════════════════════════════════════════════
    if (sub === "info" || sub === "stat") {
      if (!arg1) {
        return api.sendMessage(err(`اذكر المسار.\nمثال: ${p}files info commands/help.js`), threadID);
      }
      const target = safePath(arg1);
      if (!target)                return api.sendMessage(err("مسار غير صالح."), threadID);
      if (!fs.existsSync(target)) return api.sendMessage(err("المسار غير موجود."), threadID);

      const stat = fs.statSync(target);
      const isDir = stat.isDirectory();
      const size  = isDir ? humanSize(dirSize(target)) : humanSize(stat.size);
      const ext   = isDir ? "مجلد" : (path.extname(target) || "—");

      const lines = [
        `${MARK} ${rel(target)}`,
        DIV,
        row("النوع    ", isDir ? "مجلد" : "ملف"),
        row("الامتداد ", ext),
        row("الحجم    ", size),
        row("آخر تعديل", new Date(stat.mtimeMs).toLocaleString("ar-SA")),
        row("تاريخ الإنشاء", new Date(stat.birthtimeMs).toLocaleString("ar-SA")),
      ];
      if (isDir) {
        try {
          const count = fs.readdirSync(target).filter(n => !SKIP_DIRS.has(n)).length;
          lines.push(row("المحتوى  ", `${count} عنصر`));
        } catch {}
      }
      if (PROTECTED.has(path.basename(target))) {
        lines.push(DIV, "🔒  ملف محمي");
      }
      return api.sendMessage(lines.join("\n"), threadID);
    }

    // ══════════════════════════════════════════════════════════════════════════
    // find — البحث عن ملف بالاسم
    // ══════════════════════════════════════════════════════════════════════════
    if (sub === "find" || sub === "search") {
      const pattern = args.slice(1).join(" ").trim();
      if (!pattern) {
        return api.sendMessage(err(`اذكر النمط.\nمثال: ${p}files find music`), threadID);
      }

      const results = findFiles(ROOT, pattern);
      if (!results.length) {
        return api.sendMessage(ok(`لا توجد ملفات تطابق «${pattern}».`), threadID);
      }

      const lines = [
        `${MARK} نتائج «${pattern}»  (${results.length})`,
        DIV,
        ...results.map(r => `  ${r.isDir ? "📁" : "❏"}  ${r.path}`),
      ];
      if (results.length >= 40) lines.push(DIV, "تُعرض أول 40 نتيجة.");
      return api.sendMessage(lines.join("\n"), threadID);
    }

    // ══════════════════════════════════════════════════════════════════════════
    // size — حجم المجلدات
    // ══════════════════════════════════════════════════════════════════════════
    if (sub === "size" || sub === "du") {
      const entries = fs.readdirSync(ROOT, { withFileTypes: true })
        .filter(e => !SKIP_DIRS.has(e.name));

      const items = [];
      let total = 0;
      for (const e of entries) {
        const full = path.join(ROOT, e.name);
        const s    = e.isDirectory() ? dirSize(full) : fs.statSync(full).size;
        total += s;
        items.push({ name: e.name + (e.isDirectory() ? "/" : ""), size: s });
      }
      items.sort((a, b) => b.size - a.size);

      const lines = [
        `${MARK} مساحة الملفات`,
        DIV,
        ...items.map(i => row(i.name.slice(0, 22).padEnd(22), humanSize(i.size))),
        DIV,
        row("الإجمالي".padEnd(22), humanSize(total)),
      ];
      return api.sendMessage(lines.join("\n"), threadID);
    }

    // ══════════════════════════════════════════════════════════════════════════
    // send — إرسال ملف كمرفق
    // ══════════════════════════════════════════════════════════════════════════
    if (sub === "send" || sub === "download" || sub === "get") {
      if (!arg1) {
        return api.sendMessage(err(`اذكر الملف.\nمثال: ${p}files send config.json`), threadID);
      }
      const target = safePath(arg1);
      if (!target)                  return api.sendMessage(err("مسار غير صالح."), threadID);
      if (!fs.existsSync(target))   return api.sendMessage(err("الملف غير موجود."), threadID);

      const stat = fs.statSync(target);
      if (!stat.isFile())           return api.sendMessage(err("المسار ليس ملفاً."), threadID);
      if (stat.size > SEND_LIMIT)   return api.sendMessage(err(`الملف أكبر من 5 MB (${humanSize(stat.size)}).`), threadID);

      try {
        await api.sendMessage(
          { body: `❏ ${rel(target)}  ·  ${humanSize(stat.size)}`, attachment: fs.createReadStream(target) },
          threadID
        );
      } catch (e) {
        api.sendMessage(err("فشل الإرسال: " + e.message), threadID);
      }
      return;
    }

    // ══════════════════════════════════════════════════════════════════════════
    // del — حذف ملف
    // ══════════════════════════════════════════════════════════════════════════
    if (sub === "del" || sub === "delete" || sub === "rm") {
      if (!arg1) {
        return api.sendMessage(err(`اذكر الملف.\nمثال: ${p}files del logs/old.log`), threadID);
      }
      const target = safePath(arg1);
      if (!target)                  return api.sendMessage(err("مسار غير صالح."), threadID);

      const base = path.basename(target);
      if (PROTECTED.has(base)) {
        return api.sendMessage(err(`الملف «${base}» محمي ولا يمكن حذفه.`), threadID);
      }
      if (!fs.existsSync(target))   return api.sendMessage(err("الملف غير موجود."), threadID);

      const stat = fs.statSync(target);
      if (stat.isDirectory()) {
        return api.sendMessage(err("لا يمكن حذف مجلد بهذا الأمر.\nاحذف الملفات بداخله أولاً."), threadID);
      }

      try {
        fs.unlinkSync(target);
        return api.sendMessage(ok(`تم حذف الملف: ${rel(target)}`), threadID);
      } catch (e) {
        return api.sendMessage(err("فشل الحذف: " + e.message), threadID);
      }
    }

    // ══════════════════════════════════════════════════════════════════════════
    // help — دليل الاستخدام
    // ══════════════════════════════════════════════════════════════════════════
    api.sendMessage(
      [
        `${MARK} إدارة الملفات`,
        DIV,
        row(`${p}files ls [مسار]  `, "عرض محتوى مجلد"),
        row(`${p}files read <ملف> `, "قراءة محتوى ملف"),
        row(`${p}files info <مسار>`, "معلومات الملف"),
        row(`${p}files find <نمط> `, "البحث عن ملف"),
        row(`${p}files size       `, "مساحة الملفات"),
        row(`${p}files send <ملف> `, "إرسال ملف كمرفق"),
        row(`${p}files del <ملف>  `, "حذف ملف"),
        DIV,
        "🔒 للمشرفين فقط",
      ].join("\n"),
      threadID
    );
  },
};
