"use strict";

/**
 * ui.js — نظام التنسيق الموحّد لمادوكس
 * كل رسائل البوت تمر من هنا لضمان هوية بصرية واحدة
 */

const LINE  = "━━━━━━━━━━━━━━━━━━━━━━━━━";
const LINE2 = "─────────────────────────";

/** عنوان قسم */
function header(emoji, title) {
  return `${LINE}\n${emoji}  ${title}\n${LINE}`;
}

/** فاصل خفيف */
function divider() { return LINE2; }

/** زوج مفتاح ← قيمة */
function row(label, value) {
  return `${label}  ›  ${value}`;
}

/** رسالة نجاح */
function ok(text)   { return `✅  ${text}`; }

/** رسالة خطأ */
function err(text)  { return `❌  ${text}`; }

/** رسالة تحذير */
function warn(text) { return `⚠️  ${text}`; }

/** رسالة حظر */
function ban(text)  { return `🚫  ${text}`; }

/** رسالة معلومة */
function info(text) { return `ℹ️  ${text}`; }

module.exports = { LINE, LINE2, header, divider, row, ok, err, warn, ban, info };
