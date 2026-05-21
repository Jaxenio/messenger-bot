"use strict";

/**
 * ui.js — نظام التنسيق الموحّد لمادوكس
 * هادئ · منظّم · غير مبالغ فيه
 */

const DIV  = "─────────────────────────";
const MARK = "❏";

/** عنوان قسم رئيسي */
function header(title) {
  return `${MARK} ${title}\n${DIV}`;
}

/** زوج مفتاح · قيمة */
function row(label, value) {
  return `${label}  ·  ${value}`;
}

/** رسالة نجاح */
function ok(text)   { return `✓  ${text}`; }

/** رسالة خطأ */
function err(text)  { return `✗  ${text}`; }

/** رسالة تحذير */
function warn(text) { return `!  ${text}`; }

/** رسالة حظر */
function ban(text)  { return `✗  ${text}`; }

/** فاصل */
function divider()  { return DIV; }

module.exports = { DIV, MARK, header, row, ok, err, warn, ban, divider };
