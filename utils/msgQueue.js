"use strict";

/**
 * msgQueue.js — قائمة انتظار الرسائل الصادرة
 *
 * تضمن هذا الملف أن كل رسائل البوت تسير بشكل بشري:
 *  1. تسلسل — رسالة واحدة في كل مرة لكل محادثة
 *  2. مؤشر الكتابة — يظهر قبل كل رسالة بزمن نسبي لطول النص
 *  3. فجوة بشرية — تأخير عشوائي بين كل رسالتين
 *  4. حد معدل — لا أكثر من N رسالة في 10 ثوانٍ لنفس المحادثة
 */

const logger = require("./logger");

// ── إعدادات التوقيت ────────────────────────────────────────────────────────

const TYPING_CPS    = 38;        // حروف/ثانية (سرعة كتابة بشرية عادية)
const MIN_TYPING_MS = 700;       // حد أدنى لمؤشر الكتابة
const MAX_TYPING_MS = 3800;      // حد أقصى لمؤشر الكتابة
const ATTACH_TYPE   = 1100;      // زمن typing للمرفقات (صور/ملفات)

const MIN_GAP_MS    = 1100;      // أقل فجوة بين إرسالين لنفس المحادثة
const MAX_GAP_MS    = 3200;      // أعلى فجوة بين إرسالين لنفس المحادثة

const RATE_WINDOW   = 12_000;    // نافذة حد المعدل (12 ثانية)
const RATE_MAX      = 3;         // أقصى رسائل في النافذة قبل إضافة تأخير إضافي
const RATE_EXTRA_MS = 3000;      // تأخير إضافي عند تجاوز الحد

// ── الحالة الداخلية ────────────────────────────────────────────────────────

const _chains   = new Map();   // threadID → Promise (ذيل السلسلة)
const _lastSent = new Map();   // threadID → timestamp
const _rateLog  = new Map();   // threadID → number[]

// ── مساعدات ───────────────────────────────────────────────────────────────

function _jitter(min, max) {
  return min + Math.floor(Math.random() * (max - min));
}

function _sleep(ms) {
  return new Promise(r => setTimeout(r, ms));
}

/** حساب مدة مؤشر الكتابة بناءً على طول الرسالة */
function _typingMs(payload) {
  if (payload && typeof payload === "object" && payload.attachment) {
    return ATTACH_TYPE;
  }
  const text = typeof payload === "string" ? payload : (payload?.body || "");
  if (!text) return MIN_TYPING_MS;
  const calc = Math.floor((text.length / TYPING_CPS) * 1000);
  return Math.min(MAX_TYPING_MS, Math.max(MIN_TYPING_MS, calc));
}

/** تسجيل إرسال وإعادة عدد الرسائل في النافذة */
function _trackRate(threadID) {
  const now   = Date.now();
  const times = (_rateLog.get(threadID) || []).filter(t => now - t < RATE_WINDOW);
  times.push(now);
  _rateLog.set(threadID, times);
  return times.length;
}

// ── الإرسال الفعلي ────────────────────────────────────────────────────────

async function _doSend(origSend, api, payload, threadID) {
  // 1. تحقق من حد المعدل — أضف تأخيراً إضافياً إذا لزم
  const rateCount = _trackRate(threadID);
  if (rateCount > RATE_MAX) {
    logger.debug("MsgQueue", `Rate limit on ${threadID} (${rateCount} msgs) — extra delay`);
    await _sleep(_jitter(RATE_EXTRA_MS, RATE_EXTRA_MS + 2000));
  }

  // 2. فرض الفجوة البشرية منذ آخر إرسال لهذه المحادثة
  const elapsed = Date.now() - (_lastSent.get(threadID) || 0);
  const gap     = _jitter(MIN_GAP_MS, MAX_GAP_MS);
  if (elapsed < gap) {
    await _sleep(gap - elapsed);
  }

  // 3. مؤشر الكتابة
  const typingMs = _typingMs(payload);
  let stopTyping = null;
  try {
    if (typeof api.sendTypingIndicator === "function") {
      stopTyping = await api.sendTypingIndicator(threadID);
    }
  } catch {}
  await _sleep(typingMs);
  try { if (typeof stopTyping === "function") stopTyping(); } catch {}

  // 4. الإرسال الفعلي باستخدام الدالة الأصلية (لا wrapper)
  _lastSent.set(threadID, Date.now());
  return origSend(payload, threadID);
}

// ── الواجهة العامة ────────────────────────────────────────────────────────

/**
 * ضع رسالة في قائمة الانتظار.
 * @param {Function} origSend  - api.sendMessage الأصلية (غير ملفوفة)
 * @param {object}   api       - كائن الـ API (لـ sendTypingIndicator)
 * @param {*}        payload   - محتوى الرسالة (نص أو { body, attachment })
 * @param {string}   threadID  - معرّف المحادثة
 * @returns {Promise}
 */
function enqueue(origSend, api, payload, threadID) {
  const prev  = _chains.get(threadID) || Promise.resolve();

  // العمل: انتظر المهمة السابقة ثم أرسل
  const work  = prev
    .catch(() => {})
    .then(() => _doSend(origSend, api, payload, threadID));

  // ذيل هادئ (لا يُلقي خطأ) — يُسلسل المهام القادمة
  const quiet = work.catch(() => {});
  _chains.set(threadID, quiet);

  // تنظيف بعد الانتهاء لمنع تسريب الذاكرة
  quiet.finally(() => {
    if (_chains.get(threadID) === quiet) _chains.delete(threadID);
  });

  return work;
}

// ── Periodic cleanup to prevent memory growth during long runs ────────────────
// _chains self-cleans via .finally(); _lastSent and _rateLog need manual eviction.
setInterval(() => {
  const now   = Date.now();
  const STALE = 10 * 60_000; // 10 minutes idle → forget thread entry
  for (const [tid, ts] of _lastSent) {
    if (now - ts > STALE) _lastSent.delete(tid);
  }
  for (const [tid, times] of _rateLog) {
    const fresh = times.filter(t => now - t < RATE_WINDOW);
    if (!fresh.length) _rateLog.delete(tid);
    else _rateLog.set(tid, fresh);
  }
  logger.debug("MsgQueue", `Cleanup: lastSent=${_lastSent.size} rateLog=${_rateLog.size}`);
}, 15 * 60_000).unref();

module.exports = { enqueue };
