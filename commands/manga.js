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
        '  -manga One Piece 5\n' +
        '  -manga Attack on Titan 10\n' +
        '  -manga Demon Slayer 3',
        threadID
      );
    }

    // آخر argument = رقم الفصل، الباقي = اسم المانغا
    const lastArg    = args[args.length - 1];
    const chapterNum = parseFloat(lastArg);

    if (isNaN(chapterNum) || args.length < 2) {
      return api.sendMessage(
        '📚 يجب تحديد رقم الفصل.\n' +
        'مثال: -manga Naruto 1',
        threadID
      );
    }

    const mangaName    = args.slice(0, -1).join(' ').trim();
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
      // 1. Search manga
      const searchUrl =
        'https://api.mangadex.org/manga?title=' + encodeURIComponent(mangaName) +
        '&limit=5&includes[]=cover_art&contentRating[]=safe&contentRating[]=suggestive&order[relevance]=desc';
      const searchData = await fetchJson(searchUrl);

      if (!searchData.data || searchData.data.length === 0) {
        return api.sendMessage(
          '😕 لم أجد مانغا باسم: ' + mangaName + '\nجرّب اسماً آخر بالإنجليزية.',
          threadID
        );
      }

      const manga   = searchData.data[0];
      const mangaId = manga.id;
      const attrs   = manga.attributes;
      const title   =
        attrs.title['en'] ||
        attrs.title['ja-ro'] ||
        attrs.title['ja'] ||
        Object.values(attrs.title)[0] ||
        mangaName;

      // 2. Fetch chapter (English first, then any language)
      let chapterData = await fetchJson(
        'https://api.mangadex.org/manga/' + mangaId +
        '/feed?translatedLanguage[]=en&chapter=' + encodeURIComponent(targetChapter) +
        '&order[chapter]=asc&limit=5&contentRating[]=safe&contentRating[]=suggestive'
      );

      if (!chapterData.data || chapterData.data.length === 0) {
        chapterData = await fetchJson(
          'https://api.mangadex.org/manga/' + mangaId +
          '/feed?chapter=' + encodeURIComponent(targetChapter) +
          '&order[chapter]=asc&limit=5&contentRating[]=safe&contentRating[]=suggestive'
        );
      }

      if (!chapterData.data || chapterData.data.length === 0) {
        return api.sendMessage(
          '😕 لم أجد الفصل ' + targetChapter + ' لمانغا "' + title + '".\n' +
          'تأكد من رقم الفصل أو أن المانغا متاحة على MangaDex.',
          threadID
        );
      }

      const chapter      = chapterData.data[0];
      const chapterId    = chapter.id;
      const chapterTitle = chapter.attributes.title ? ' — ' + chapter.attributes.title : '';
      const lang         = chapter.attributes.translatedLanguage || 'en';

      await api.sendMessage(
        '📖 ' + title + ' — الفصل ' + targetChapter + chapterTitle + '\n' +
        '🌐 اللغة: ' + lang + '\n' +
        '⬇️ جاري تحميل الصفحات...',
        threadID
      ).catch(() => {});

      // 3. Get page URLs
      const serverData = await fetchJson('https://api.mangadex.org/at-home/server/' + chapterId);
      const baseUrl    = serverData.baseUrl;
      const hash       = serverData.chapter.hash;
      const pages      = serverData.chapter.data;
      const dataSaver  = serverData.chapter.dataSaver;

      const useDataSaver = dataSaver && dataSaver.length > 0;
      const pageFiles    = (useDataSaver ? dataSaver : pages).slice(0, MAX_PAGES);
      const mode         = useDataSaver ? 'data-saver' : 'data';
      const total        = pageFiles.length;

      await api.sendMessage(
        '📄 إجمالي الصفحات: ' + pages.length + ' | سيتم إرسال أول ' + total + ' صفحة...',
        threadID
      ).catch(() => {});

      // 4. Download & send pages
      let sent   = 0;
      let failed = 0;

      for (let i = 0; i < pageFiles.length; i++) {
        const pageUrl = baseUrl + '/' + mode + '/' + hash + '/' + pageFiles[i];
        const tmpPath = path.join(TMP_DIR, 'manga_p' + (i + 1) + '_' + Date.now() + '.jpg');

        try {
          await download(pageUrl, tmpPath);
          await api.sendMessage(
            {
              body: '📄 ' + title + ' | فصل ' + targetChapter + ' | صفحة ' + (i + 1) + '/' + total,
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

      // 5. Summary
      const more = pages.length > MAX_PAGES
        ? '\n📌 المانغا تحتوي ' + pages.length + ' صفحة. للمزيد: mangadex.org/chapter/' + chapterId
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
