'use strict';

const fs    = require('fs');
const path  = require('path');
const https = require('https');
const http  = require('http');
const os    = require('os');

const TMP_DIR     = os.tmpdir();
const COOLDOWNS   = new Map();
const COOLDOWN_MS = 15000;
const MAX_PAGES   = 15;

const LANG_NAMES = {
  en: 'الإنجليزية', ar: 'العربية', ja: 'اليابانية',
  vi: 'الفيتنامية', es: 'الإسبانية', 'es-la': 'الإسبانية (LA)',
  fr: 'الفرنسية', de: 'الألمانية', ru: 'الروسية',
  'pt-br': 'البرتغالية', ko: 'الكورية', zh: 'الصينية',
  tr: 'التركية', id: 'الإندونيسية', th: 'التايلاندية',
  pl: 'البولندية', it: 'الإيطالية', uk: 'الأوكرانية',
};

function download(url, dest) {
  return new Promise((resolve, reject) => {
    const proto = url.startsWith('https') ? https : http;
    const file  = fs.createWriteStream(dest);
    proto.get(url, { headers: { 'User-Agent': 'MangaBot/1.0' } }, (res) => {
      if (res.statusCode === 301 || res.statusCode === 302) {
        file.close();
        return download(res.headers.location, dest).then(resolve).catch(reject);
      }
      if (res.statusCode !== 200) {
        file.close();
        fs.unlink(dest, () => {});
        return reject(new Error('HTTP ' + res.statusCode));
      }
      res.pipe(file);
      file.on('finish', () => file.close(resolve));
      file.on('error', (e) => { fs.unlink(dest, () => {}); reject(e); });
    }).on('error', (e) => { fs.unlink(dest, () => {}); reject(e); });
  });
}

function fetchJson(url) {
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

// جلب كل فصول المانغا (مع pagination تلقائي)
async function fetchAllChapters(mangaId) {
  const all = [];
  let offset = 0;
  while (true) {
    const data = await fetchJson(
      'https://api.mangadex.org/manga/' + mangaId +
      '/feed?order[chapter]=asc&limit=500&offset=' + offset
    );
    if (!data.data || data.data.length === 0) break;
    all.push(...data.data);
    if (data.data.length < 500) break;
    offset += 500;
  }
  return all;
}

// اختيار أفضل نسخة للفصل: إنجليزي → أي لغة غير خارجية → خارجي
function pickBestChapter(matching) {
  const nonExt    = matching.filter(c => !c.attributes.externalUrl);
  const enChapter = nonExt.find(c => c.attributes.translatedLanguage === 'en');
  return enChapter || nonExt[0] || matching[0] || null;
}

function safeDelete(p) {
  try { if (fs.existsSync(p)) fs.unlinkSync(p); } catch {}
}

module.exports = {
  name: 'manga',
  aliases: ['مانغا', 'مانجا'],
  description: 'البحث عن مانغا وإرسال صفحات فصل محدد.',
  usage: 'manga [اسم المانغا] [رقم الفصل]',
  category: 'Entertainment',

  async execute({ api, event, args }) {
    const { threadID, senderID } = event;

    if (!args.length) {
      return api.sendMessage(
        '📚 الاستخدام: -manga [اسم المانغا] [رقم الفصل]\n\n' +
        'أمثلة:\n' +
        '  -manga Naruto 1\n' +
        '  -manga Blue Lock 282\n' +
        '  -manga One Piece 5\n' +
        '  -manga Demon Slayer 3',
        threadID
      );
    }

    const lastArg    = args[args.length - 1];
    const chapterNum = parseFloat(lastArg);

    if (isNaN(chapterNum) || args.length < 2) {
      return api.sendMessage(
        '📚 يجب تحديد رقم الفصل.\n' +
        'مثال: -manga Naruto 1',
        threadID
      );
    }

    const mangaName     = args.slice(0, -1).join(' ').trim();
    const targetChapter = String(chapterNum);

    // Cooldown
    const lastUsed  = COOLDOWNS.get(senderID) || 0;
    const remaining = Math.ceil((COOLDOWN_MS - (Date.now() - lastUsed)) / 1000);
    if (remaining > 0) {
      return api.sendMessage('⏳ انتظر ' + remaining + ' ثانية قبل الطلب التالي.', threadID);
    }
    COOLDOWNS.set(senderID, Date.now());

    await api.sendMessage(
      '🔍 جاري البحث عن: ' + mangaName + ' — الفصل ' + targetChapter + '...',
      threadID
    ).catch(() => {});

    try {
      // 1. بحث المانغا
      const searchData = await fetchJson(
        'https://api.mangadex.org/manga?title=' + encodeURIComponent(mangaName) +
        '&limit=5&includes[]=cover_art&contentRating[]=safe&contentRating[]=suggestive&order[relevance]=desc'
      );

      if (!searchData.data || searchData.data.length === 0) {
        return api.sendMessage(
          '😕 لم أجد مانغا باسم: ' + mangaName + '\nجرّب الاسم بالإنجليزية.',
          threadID
        );
      }

      const manga   = searchData.data[0];
      const mangaId = manga.id;
      const attrs   = manga.attributes;
      const title   =
        attrs.title['en'] || attrs.title['ja-ro'] ||
        attrs.title['ja'] || Object.values(attrs.title)[0] || mangaName;

      // 2. جلب كل الفصول والبحث عن الرقم المطلوب
      const allChapters = await fetchAllChapters(mangaId);
      const matching    = allChapters.filter(
        c => parseFloat(c.attributes.chapter) === chapterNum
      );

      // الفصل غير موجود نهائياً
      if (matching.length === 0) {
        const available = [...new Set(
          allChapters.map(c => c.attributes.chapter).filter(Boolean)
        )].sort((a, b) => parseFloat(a) - parseFloat(b)).slice(0, 25).join(', ');

        return api.sendMessage(
          '😕 الفصل ' + targetChapter + ' غير متاح لـ "' + title + '".\n' +
          (available ? '📋 فصول متاحة: ' + available : '') +
          '\n\nاستخدم: -chapters ' + mangaName,
          threadID
        );
      }

      // 3. اختيار أفضل نسخة
      const chapter = pickBestChapter(matching);

      // 4. الفصل متاح فقط كرابط خارجي في جميع اللغات
      if (chapter.attributes.externalUrl) {
        // ابحث عن الفصول القريبة المستضافة كبديل
        const nonExtAll = allChapters.filter(c => !c.attributes.externalUrl);
        const nearest   = nonExtAll
          .map(c => ({ num: parseFloat(c.attributes.chapter), ch: c }))
          .sort((a, b) => Math.abs(a.num - chapterNum) - Math.abs(b.num - chapterNum))
          .slice(0, 3);

        let altMsg = '';
        if (nearest.length > 0) {
          const altNums = [...new Set(nearest.map(x => x.num))];
          altMsg = '\n\n📋 أقرب فصول متاحة للقراءة: ' +
            altNums.map(n => '-manga ' + mangaName + ' ' + n).join(' | ');
        }

        return api.sendMessage(
          '📖 ' + title + ' — الفصل ' + targetChapter + '\n' +
          '⚠️ هذا الفصل مرخّص رسمياً ومستضاف على موقع خارجي فقط.\n' +
          '🔗 اقرأه هنا: ' + chapter.attributes.externalUrl +
          altMsg,
          threadID
        );
      }

      // 5. فصل مستضاف — جلب الصفحات
      const chapterId    = chapter.id;
      const chapterTitle = chapter.attributes.title ? ' — ' + chapter.attributes.title : '';
      const lang         = chapter.attributes.translatedLanguage || 'en';
      const langName     = LANG_NAMES[lang] || lang;

      await api.sendMessage(
        '📖 ' + title + ' — الفصل ' + targetChapter + chapterTitle + '\n' +
        '🌐 اللغة: ' + langName + '\n' +
        '⬇️ جاري تحميل الصفحات...',
        threadID
      ).catch(() => {});

      const serverData = await fetchJson(
        'https://api.mangadex.org/at-home/server/' + chapterId
      );
      const baseUrl   = serverData.baseUrl;
      const hash      = serverData.chapter.hash;
      const pages     = serverData.chapter.data;
      const dataSaver = serverData.chapter.dataSaver;

      const useDS     = dataSaver && dataSaver.length > 0;
      const pageFiles = (useDS ? dataSaver : pages).slice(0, MAX_PAGES);
      const mode      = useDS ? 'data-saver' : 'data';
      const total     = pageFiles.length;

      await api.sendMessage(
        '📄 إجمالي الصفحات: ' + pages.length +
        ' | سيتم إرسال أول ' + total + ' صفحة...',
        threadID
      ).catch(() => {});

      // 6. تحميل وإرسال الصفحات
      let sent   = 0;
      let failed = 0;

      for (let i = 0; i < pageFiles.length; i++) {
        const pageUrl = baseUrl + '/' + mode + '/' + hash + '/' + pageFiles[i];
        const tmpPath = path.join(TMP_DIR, 'manga_' + Date.now() + '_p' + (i + 1) + '.jpg');

        try {
          await download(pageUrl, tmpPath);
          await api.sendMessage(
            {
              body: '📄 ' + title + ' | فصل ' + targetChapter +
                    ' | صفحة ' + (i + 1) + '/' + total +
                    (lang !== 'en' ? ' [' + langName + ']' : ''),
              attachment: fs.createReadStream(tmpPath)
            },
            threadID
          );
          sent++;
        } catch {
          failed++;
        } finally {
          safeDelete(tmpPath);
        }

        await new Promise(r => setTimeout(r, 500));
      }

      // 7. ملخص
      const more = pages.length > MAX_PAGES
        ? '\n📌 الفصل يحتوي ' + pages.length +
          ' صفحة. للمزيد: mangadex.org/chapter/' + chapterId
        : '';

      await api.sendMessage(
        '✅ تم إرسال ' + sent + ' صفحة' +
        (failed > 0 ? ' (فشل ' + failed + ')' : '') + '.' + more,
        threadID
      ).catch(() => {});

    } catch (err) {
      await api.sendMessage(
        '❌ حدث خطأ أثناء جلب المانغا. حاول مرة أخرى.\n' + (err.message || ''),
        threadID
      ).catch(() => {});
    }
  },
};
