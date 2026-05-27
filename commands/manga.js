'use strict';

const fs   = require('fs');
const path = require('path');
const https = require('https');
const http  = require('http');
const os    = require('os');

const TMP_DIR = os.tmpdir();
const COOLDOWNS = new Map();
const COOLDOWN_MS = 8000;

function download(url, dest) {
  return new Promise((resolve, reject) => {
    const proto = url.startsWith('https') ? https : http;
    const file = fs.createWriteStream(dest);
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

module.exports = {
  name: 'manga',
  aliases: ['مانغا', 'مانجا', 'anime', 'انمي', 'أنمي'],
  description: 'البحث عن مانغا وإرسال صورة غلافها ومعلوماتها.',
  usage: 'manga [اسم المانغا]',
  category: 'Entertainment',

  async execute({ api, event, args }) {
    const { threadID, senderID } = event;
    const query = args.join(' ').trim();

    if (!query) {
      return api.sendMessage(
        '📚 الاستخدام: -manga [اسم المانغا أو الأنمي]
' +
        'أمثلة:
' +
        '  -manga Naruto
' +
        '  -manga One Piece
' +
        '  -manga Attack on Titan
' +
        '  -manga مانغا بلاك كلوفر',
        threadID
      );
    }

    // Cooldown
    const lastUsed = COOLDOWNS.get(senderID) || 0;
    const remaining = Math.ceil((COOLDOWN_MS - (Date.now() - lastUsed)) / 1000);
    if (remaining > 0) {
      return api.sendMessage(`⏳ انتظر ${remaining} ثانية قبل البحث مجدداً.`, threadID);
    }
    COOLDOWNS.set(senderID, Date.now());

    await api.sendMessage(`🔍 جاري البحث عن: ${query}...`, threadID).catch(() => {});

    try {
      // Search MangaDex
      const searchUrl = `https://api.mangadex.org/manga?title=${encodeURIComponent(query)}&limit=5&includes[]=cover_art&includes[]=author&contentRating[]=safe&contentRating[]=suggestive&order[relevance]=desc`;
      const searchData = await fetchJson(searchUrl);

      if (!searchData.data || searchData.data.length === 0) {
        return api.sendMessage(`😕 لم أجد نتائج لـ: ${query}
جرّب اسماً آخر بالإنجليزية.`, threadID);
      }

      const manga = searchData.data[0];
      const mangaId = manga.id;
      const attrs = manga.attributes;

      // Get title
      const title =
        attrs.title['en'] ||
        attrs.title['ja-ro'] ||
        attrs.title['ja'] ||
        Object.values(attrs.title)[0] ||
        query;

      // Get description
      const desc =
        (attrs.description && (attrs.description['en'] || attrs.description['ar'] || Object.values(attrs.description)[0])) || '';
      const shortDesc = desc.length > 200 ? desc.slice(0, 200) + '...' : desc;

      // Get status and year
      const status = attrs.status || 'unknown';
      const year   = attrs.year || '—';
      const statusAr = { ongoing: 'مستمرة', completed: 'مكتملة', hiatus: 'متوقفة', cancelled: 'ملغاة' };

      // Get cover filename
      const coverRel = manga.relationships.find(r => r.type === 'cover_art');
      const authorRel = manga.relationships.find(r => r.type === 'author');
      const coverFile = coverRel && coverRel.attributes ? coverRel.attributes.fileName : null;
      const authorName = authorRel && authorRel.attributes ? authorRel.attributes.name : '—';

      // Get genres
      const genres = (attrs.tags || [])
        .filter(t => t.attributes.group === 'genre')
        .slice(0, 4)
        .map(t => t.attributes.name.en || Object.values(t.attributes.name)[0])
        .join(', ') || '—';

      const caption =
        `📚 ${title}
` +
        `✍️ المؤلف: ${authorName}
` +
        `📅 السنة: ${year}
` +
        `📊 الحالة: ${statusAr[status] || status}
` +
        `🏷️ التصنيفات: ${genres}
` +
        (shortDesc ? `
📖 ${shortDesc}
` : '') +
        `
🔗 mangadex.org/title/${mangaId}`;

      if (!coverFile) {
        return api.sendMessage(caption, threadID);
      }

      // Download cover image
      const coverUrl = `https://uploads.mangadex.org/covers/${mangaId}/${coverFile}.512.jpg`;
      const imgPath  = path.join(TMP_DIR, `manga_${Date.now()}.jpg`);

      try {
        await download(coverUrl, imgPath);
        await api.sendMessage(
          { body: caption, attachment: fs.createReadStream(imgPath) },
          threadID
        );
      } catch {
        // Send without image if download fails
        await api.sendMessage(caption, threadID);
      } finally {
        if (fs.existsSync(imgPath)) fs.unlink(imgPath, () => {});
      }

    } catch (err) {
      await api.sendMessage(
        '❌ حدث خطأ أثناء البحث. حاول مرة أخرى.
' + (err.message || ''),
        threadID
      ).catch(() => {});
    }
  },
};
