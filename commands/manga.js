'use strict';

const fs    = require('fs');
const path  = require('path');
const https = require('https');
const http  = require('http');
const os    = require('os');

const TMP_DIR    = os.tmpdir();
const COOLDOWNS  = new Map();
const COOLDOWN_MS = 15000;
const MAX_PAGES   = 15; // max pages to send per chapter

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
        '📚 الاستخدام: -manga [اسم المانغا] [رقم الفصل]

' +
        'أمثلة:
' +
        '  -manga Naruto 1
' +
        '  -manga One Piece 5
' +
        '  -manga Attack on Titan 10
' +
        '  -manga Demon Slayer 3',
        threadID
      );
    }

    // Parse: last arg = chapter number if numeric, rest = manga name
    const lastArg = args[args.length - 1];
    const chapterNum = parseFloat(lastArg);
    let mangaName, targetChapter;

    if (!isNaN(chapterNum) && args.length > 1) {
      mangaName    = args.slice(0, -1).join(' ').trim();
      targetChapter = String(chapterNum);
    } else {
      return api.sendMessage(
        '📚 يجب تحديد رقم الفصل.
' +
        'مثال: -manga Naruto 1',
        threadID
      );
    }

    // Cooldown
    const lastUsed  = COOLDOWNS.get(senderID) || 0;
    const remaining = Math.ceil((COOLDOWN_MS - (Date.now() - lastUsed)) / 1000);
    if (remaining > 0) {
      return api.sendMessage(`⏳ انتظر ${remaining} ثانية قبل الطلب التالي.`, threadID);
    }
    COOLDOWNS.set(senderID, Date.now());

    await api.sendMessage(`🔍 جاري البحث عن: ${mangaName} — الفصل ${targetChapter}...`, threadID).catch(() => {});

    try {
      // ── 1. Search manga ───────────────────────────────────────────────────
      const searchUrl =
        'https://api.mangadex.org/manga?title=' + encodeURIComponent(mangaName) +
        '&limit=5&includes[]=cover_art&contentRating[]=safe&contentRating[]=suggestive&order[relevance]=desc';
      const searchData = await fetchJson(searchUrl);

      if (!searchData.data || searchData.data.length === 0) {
        return api.sendMessage(`😕 لم أجد مانغا باسم: ${mangaName}
جرّب اسماً آخر بالإنجليزية.`, threadID);
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

      // ── 2. Fetch chapter (English first, then any language) ───────────────
      let chapterData = await fetchJson(
        'https://api.mangadex.org/manga/' + mangaId +
        '/feed?translatedLanguage[]=en&chapter=' + encodeURIComponent(targetChapter) +
        '&order[chapter]=asc&limit=5&contentRating[]=safe&contentRating[]=suggestive'
      );

      // Fallback: any language
      if (!chapterData.data || chapterData.data.length === 0) {
        chapterData = await fetchJson(
          'https://api.mangadex.org/manga/' + mangaId +
          '/feed?chapter=' + encodeURIComponent(targetChapter) +
          '&order[chapter]=asc&limit=5&contentRating[]=safe&contentRating[]=suggestive'
        );
      }

      if (!chapterData.data || chapterData.data.length === 0) {
        return api.sendMessage(
          `😕 لم أجد الفصل ${targetChapter} لمانغا ${title}.
` +
          'تأكد من رقم الفصل أو أن المانغا متاحة على MangaDex.',
          threadID
        );
      }

      const chapter   = chapterData.data[0];
      const chapterId = chapter.id;
      const chapterTitle = chapter.attributes.title
        ? ` — ${chapter.attributes.title}`
        : '';
      const lang = chapter.attributes.translatedLanguage || 'en';

      await api.sendMessage(
        `📖 ${title} — الفصل ${targetChapter}${chapterTitle}
` +
        `🌐 اللغة: ${lang}
` +
        `⬇️ جاري تحميل الصفحات...`,
        threadID
      ).catch(() => {});

      // ── 3. Get page URLs ──────────────────────────────────────────────────
      const serverData = await fetchJson('https://api.mangadex.org/at-home/server/' + chapterId);
      const baseUrl    = serverData.baseUrl;
      const hash       = serverData.chapter.hash;
      const pages      = serverData.chapter.data; // full quality
      const dataSaver  = serverData.chapter.dataSaver; // compressed

      // Use dataSaver (smaller files = faster sending)
      const pageFiles = (dataSaver && dataSaver.length > 0 ? dataSaver : pages)
        .slice(0, MAX_PAGES);

      const total = pageFiles.length;
      const mode  = (dataSaver && dataSaver.length > 0) ? 'data-saver' : 'data';

      await api.sendMessage(
        `📄 إجمالي الصفحات: ${pages.length} | سيتم إرسال أول ${total} صفحة...`,
        threadID
      ).catch(() => {});

      // ── 4. Download & send pages ──────────────────────────────────────────
      let sent = 0;
      let failed = 0;
      const tmpFiles = [];

      for (let i = 0; i < pageFiles.length; i++) {
        const filename = pageFiles[i];
        const pageUrl  = `${baseUrl}/${mode}/${hash}/${filename}`;
        const tmpPath  = path.join(TMP_DIR, `manga_p${i + 1}_${Date.now()}.jpg`);
        tmpFiles.push(tmpPath);

        try {
          await download(pageUrl, tmpPath);
          await api.sendMessage(
            {
              body: `📄 ${title} | فصل ${targetChapter} | صفحة ${i + 1}/${total}`,
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

        // Small delay to avoid flooding
        await new Promise(r => setTimeout(r, 500));
      }

      // ── 5. Summary ────────────────────────────────────────────────────────
      const more = pages.length > MAX_PAGES
        ? `
📌 المانغا تحتوي ${pages.length} صفحة. للحصول على المزيد، راجع: mangadex.org/chapter/${chapterId}`
        : '';

      await api.sendMessage(
        `✅ تم إرسال ${sent} صفحة${failed > 0 ? ' (فشل ' + failed + ')' : ''}.${more}`,
        threadID
      ).catch(() => {});

    } catch (err) {
      await api.sendMessage(
        '❌ حدث خطأ أثناء جلب المانغا. حاول مرة أخرى.
' + (err.message || ''),
        threadID
      ).catch(() => {});
    }
  },
};
