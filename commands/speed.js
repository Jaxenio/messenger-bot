'use strict';

const { replyDelay } = require('../state');

const PRESETS = {
  off:    { enabled: false, ms: 0,    label: '⚡ سريع جداً (بدون تأخير)' },
  fast:   { enabled: true,  ms: 500,  label: '🐇 سريع (0.5 ثانية)' },
  normal: { enabled: true,  ms: 1500, label: '🚶 عادي (1.5 ثانية)' },
  slow:   { enabled: true,  ms: 4000, label: '🐢 بطيء (4 ثوانٍ)' },
};

module.exports = {
  name: 'speed',
  aliases: ['سرعة', 'delay', 'تأخير'],
  description: 'التحكم في سرعة رد البوت. (مشرف فقط)',
  usage: 'speed <off | fast | normal | slow | رقم_ms>',
  category: 'Admin',
  adminOnly: true,

  async execute({ api, event, args }) {
    const { threadID } = event;
    const input = (args[0] || '').toLowerCase().trim();

    // عرض الحالة الحالية
    if (!input || input === 'status' || input === 'حالة') {
      const state = replyDelay.enabled
        ? '✅ مفعّل — ' + replyDelay.ms + ' مللي ثانية'
        : '❌ معطّل (ردود فورية)';
      return api.sendMessage(
        '⚡ سرعة الرد الحالية:\n' +
        '─────────────────────\n' +
        state + '\n\n' +
        'الأوضاع المتاحة:\n' +
        '  -speed off     — بدون تأخير\n' +
        '  -speed fast    — 0.5 ثانية\n' +
        '  -speed normal  — 1.5 ثانية\n' +
        '  -speed slow    — 4 ثوانٍ\n' +
        '  -speed 2000    — تأخير مخصص بالمللي ثانية',
        threadID
      );
    }

    // preset محدد
    if (PRESETS[input]) {
      const p = PRESETS[input];
      replyDelay.enabled = p.enabled;
      replyDelay.ms      = p.ms;
      return api.sendMessage(
        '✅ تم تغيير سرعة الرد إلى:\n' + p.label,
        threadID
      );
    }

    // رقم مخصص بالمللي ثانية
    const ms = parseInt(input, 10);
    if (!isNaN(ms) && ms >= 0 && ms <= 30000) {
      replyDelay.enabled = ms > 0;
      replyDelay.ms      = ms;
      const label = ms === 0 ? 'بدون تأخير' : (ms / 1000).toFixed(1) + ' ثانية';
      return api.sendMessage(
        '✅ تم ضبط سرعة الرد على: ' + label,
        threadID
      );
    }

    return api.sendMessage(
      '❌ قيمة غير صالحة.\n' +
      'الاستخدام:\n' +
      '  -speed off / fast / normal / slow\n' +
      '  -speed 2000   (0 – 30000 مللي ثانية)',
      threadID
    );
  },
};
