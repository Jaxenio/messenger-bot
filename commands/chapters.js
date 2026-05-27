'use strict';

const https = require('https');

async function fetchJson(url) {
  return new Promise((resolve, reject) => {
    https.get(url, { headers: { 'User-Agent': 'MangaBot/1.0' } }, (res) => {
      let data = '';
      res.on('data', c => data += c);
      res.on('end', () => {
        try { resolve(JSON.parse(data)); }
        catch (e) { reject(e); }
      });
    }).on('error', reject);
  });
}

module.exports = {
  name: 'chapters',
  aliases: ['فصول', 'chlist', 'chaplist'],
  description: 'عرض قائمة الفصول المتاحة لمانغا معينة.',
  usage: 'chapters [اسم المانغا]',
  category: 'Entertainment',

  async execute({ api, event, args }) {
    const { threadID } = event;
    const query = args.join(' ').trim();

    if (!query) {
      return api.sendMessage(
        '📚 الاستخدام: -chapters [اسم المانغا]\n\n' +
        'أمثلة:\n' +
        '  -chapters Naruto\n' +
        '  -chapters One Piece\n' +
        '  -chapters Demon Slayer\n\n' +
        'بعد معرفة رقم الفصل استخدم:\n' +
        '  -manga [الاسم] [رقم الفصل]',
        threadID
      );
    }

    await api.sendMessage(`🔍 جاري البحث عن فصول: ${query}...`, threadID).catch(() => {});

    try {
      // 1. Search manga
      const searchUrl =
        'https://api.mangadex.org/manga?title=' + encodeURIComponent(query) +
        '&limit=5&contentRating[]=safe&contentRating[]=suggestive&order[relevance]=desc';
      const searchData = await fetchJson(searchUrl);

      if (!searchData.data || searchData.data.length === 0) {
        return api.sendMessage(`😕 لم أجد مانغا باسم: ${query}\nجرّب اسماً بالإنجليزية.`, threadID);
      }

      const manga   = searchData.data[0];
      const mangaId = manga.id;
      const attrs   = manga.attributes;
      const title   =
        attrs.title['en'] ||
        attrs.title['ja-ro'] ||
        attrs.title['ja'] ||
        Object.values(attrs.title)[0] ||
        query;

      // 2. Fetch chapters (English first)
      let feed = await fetchJson(
        'https://api.mangadex.org/manga/' + mangaId +
        '/feed?translatedLanguage[]=en&order[chapter]=asc&limit=500' +
        '&contentRating[]=safe&contentRating[]=suggestive'
      );

      let chapters = feed.data || [];

      // Fallback: any language if no English
      if (chapters.length === 0) {
        feed = await fetchJson(
          'https://api.mangadex.org/manga/' + mangaId +
          '/feed?order[chapter]=asc&limit=500' +
          '&contentRating[]=safe&contentRating[]=suggestive'
        );
        chapters = feed.data || [];
      }

      if (chapters.length === 0) {
        return api.sendMessage(
          `😕 لا توجد فصول متاحة لـ "${title}" على MangaDex حالياً.`,
          threadID
        );
      }

      // 3. Deduplicate by chapter number
      const seen = new Set();
      const unique = [];
      for (const ch of chapters) {
        const num = ch.attributes.chapter;
        if (num && !seen.has(num)) {
          seen.add(num);
          unique.push(ch);
        }
      }

      const total   = unique.length;
      const display = unique.slice(0, 60);
      const lang    = display[0] && display[0].attributes.translatedLanguage || 'en';
      const nums    = display.map(c => c.attributes.chapter);

      // 4. Build message
      let msg = `📚 ${title}\n`;
      msg += `🌐 اللغة: ${lang} | إجمالي الفصول: ${total}\n`;
      msg += '─'.repeat(28) + '\n';

      for (let i = 0; i < nums.length; i += 5) {
        msg += nums.slice(i, i + 5).map(n => `[${n}]`).join('  ') + '\n';
      }

      if (total > 60) {
        msg += `\n... و${total - 60} فصل آخر\n`;
      }

      msg += `\n📖 لقراءة فصل:\n-manga ${title} [رقم الفصل]\n`;
      msg += `مثال: -manga ${title} ${nums[0]}`;

      await api.sendMessage(msg, threadID);

    } catch (err) {
      await api.sendMessage(
        '❌ حدث خطأ أثناء جلب الفصول. حاول مرة أخرى.\n' + (err.message || ''),
        threadID
      ).catch(() => {});
    }
  },
};
