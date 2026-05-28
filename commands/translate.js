'use strict';

const https = require('https');

const LANG_MAP = {
  // عربي
  'ar': 'ar', 'عربي': 'ar', 'عربية': 'ar', 'arabic': 'ar',
  // إنجليزي
  'en': 'en', 'انجليزي': 'en', 'إنجليزي': 'en', 'english': 'en',
  // فرنسي
  'fr': 'fr', 'فرنسي': 'fr', 'فرنسية': 'fr', 'french': 'fr',
  // ألماني
  'de': 'de', 'الماني': 'de', 'ألماني': 'de', 'german': 'de',
  // إسباني
  'es': 'es', 'اسباني': 'es', 'إسباني': 'es', 'spanish': 'es',
  // تركي
  'tr': 'tr', 'تركي': 'tr', 'تركية': 'tr', 'turkish': 'tr',
  // روسي
  'ru': 'ru', 'روسي': 'ru', 'روسية': 'ru', 'russian': 'ru',
  // صيني
  'zh': 'zh', 'صيني': 'zh', 'chinese': 'zh',
  // ياباني
  'ja': 'ja', 'ياباني': 'ja', 'japanese': 'ja',
  // كوري
  'ko': 'ko', 'كوري': 'ko', 'korean': 'ko',
  // برتغالي
  'pt': 'pt', 'برتغالي': 'pt', 'portuguese': 'pt',
  // إيطالي
  'it': 'it', 'ايطالي': 'it', 'إيطالي': 'it', 'italian': 'it',
  // هندي
  'hi': 'hi', 'هندي': 'hi', 'hindi': 'hi',
  // فارسي
  'fa': 'fa', 'فارسي': 'fa', 'persian': 'fa',
  // أوردو
  'ur': 'ur', 'اردو': 'ur', 'urdu': 'ur',
  // هولندي
  'nl': 'nl', 'هولندي': 'nl', 'dutch': 'nl',
  // بولندي
  'pl': 'pl', 'بولندي': 'pl', 'polish': 'pl',
  // سواحيلي
  'sw': 'sw', 'سواحيلي': 'sw', 'swahili': 'sw',
};

const LANG_NAMES = {
  ar:'العربية', en:'الإنجليزية', fr:'الفرنسية', de:'الألمانية',
  es:'الإسبانية', tr:'التركية', ru:'الروسية', zh:'الصينية',
  ja:'اليابانية', ko:'الكورية', pt:'البرتغالية', it:'الإيطالية',
  hi:'الهندية', fa:'الفارسية', ur:'الأوردو', nl:'الهولندية',
  pl:'البولندية', sw:'السواحيلية',
};

function translate(text, from, to) {
  return new Promise((resolve, reject) => {
    const langpair = encodeURIComponent(from + '|' + to);
    const q        = encodeURIComponent(text.slice(0, 500));
    const urlPath  = '/get?q=' + q + '&langpair=' + langpair + '&de=bot@example.com';

    https.get({
      hostname: 'api.mymemory.translated.net',
      path: urlPath,
      headers: { 'User-Agent': 'Mozilla/5.0' },
      timeout: 12000,
    }, (res) => {
      let d = '';
      res.on('data', c => d += c);
      res.on('end', () => {
        try {
          const json = JSON.parse(d);
          if (json.responseStatus !== 200) {
            return reject(new Error(json.responseDetails || 'خطأ في الترجمة'));
          }
          resolve(json.responseData.translatedText);
        } catch (e) { reject(e); }
      });
    }).on('error', reject)
      .on('timeout', function() { this.destroy(); reject(new Error('انتهت مهلة الاتصال')); });
  });
}

module.exports = {
  name: 'translate',
  aliases: ['ترجم', 'tr', 'trans'],
  description: 'ترجمة النصوص بين أكثر من 15 لغة.',
  usage: 'translate [لغة الهدف] [النص] | translate [من] [إلى] [النص]',
  category: 'Utility',

  async execute({ api, event, args }) {
    const { threadID } = event;

    if (!args.length) {
      return api.sendMessage(
        '🌍 الاستخدام:\n' +
        '  -ترجم [لغة] [نص]         ← من أي لغة تلقائياً\n' +
        '  -ترجم [من] [إلى] [نص]   ← تحديد اللغتين\n\n' +
        'أمثلة:\n' +
        '  -ترجم عربي Hello World\n' +
        '  -ترجم انجليزي عربي مرحباً بالعالم\n' +
        '  -ترجم fr Bonjour le monde\n\n' +
        'اللغات: ar en fr de es tr ru zh ja ko pt it hi fa\n' +
        '       عربي إنجليزي فرنسي ألماني إسباني تركي روسي كوري',
        threadID
      );
    }

    let fromLang = 'auto';
    let toLang   = '';
    let text     = '';

    const firstKey  = (args[0] || '').toLowerCase();
    const secondKey = (args[1] || '').toLowerCase();

    // صيغة: translate [من] [إلى] [نص]
    if (LANG_MAP[firstKey] && LANG_MAP[secondKey] && args.length >= 3) {
      fromLang = LANG_MAP[firstKey];
      toLang   = LANG_MAP[secondKey];
      text     = args.slice(2).join(' ');
    }
    // صيغة: translate [إلى] [نص]
    else if (LANG_MAP[firstKey] && args.length >= 2) {
      toLang = LANG_MAP[firstKey];
      text   = args.slice(1).join(' ');
    }
    else {
      return api.sendMessage(
        '❌ لغة غير معروفة: "' + args[0] + '"\n' +
        'مثال: -ترجم عربي Hello\nأو: -ترجم en ar مرحباً',
        threadID
      );
    }

    if (!text.trim()) {
      return api.sendMessage('❌ أدخل النص المراد ترجمته.', threadID);
    }

    await api.sendMessage('🔄 جاري الترجمة...', threadID).catch(() => {});

    try {
      const result  = await translate(text, fromLang, toLang);
      const toLName = LANG_NAMES[toLang] || toLang;
      const frLName = fromLang === 'auto' ? 'تلقائي' : (LANG_NAMES[fromLang] || fromLang);

      await api.sendMessage(
        '🌍 ترجمة: ' + frLName + ' → ' + toLName + '\n' +
        '─'.repeat(26) + '\n' +
        '📝 الأصل:\n' + text + '\n\n' +
        '✅ الترجمة:\n' + result,
        threadID
      );
    } catch (err) {
      await api.sendMessage(
        '❌ فشلت الترجمة: ' + (err.message || '') + '\n' +
        'جرب مرة أخرى أو تحقق من النص.',
        threadID
      ).catch(() => {});
    }
  },
};
