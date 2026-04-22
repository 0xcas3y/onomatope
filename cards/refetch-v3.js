#!/usr/bin/env node
// v3: API (express) で例句を取得 → URL 自前構築 → Chrome で DL
// 画像と音声を確実に同一例句からペアリング
const puppeteer = require('puppeteer-core');
const fs = require('fs');
const path = require('path');

const CHROME = '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
const CARDS = path.join(__dirname, 'data/cards.json');
const MEDIA_DIR = path.join(__dirname, 'media');
const LOOKUP = JSON.parse(fs.readFileSync(path.join(__dirname, 'data/ik_lookup.json'), 'utf8'));

function normalize(s) {
  if (!s) return '';
  return s.replace(/[\s　]/g, '').replace(/[「」『』（）()［］\[\]"'.,。、！？!?]/g, '').toLowerCase();
}

// id: "anime_hunter_x_hunter_000029933" → build URL
function buildUrl(id, fname) {
  if (!fname) return null;
  const parts = id.split('_');
  const category = parts[0];
  const slug = parts.slice(1, -1).join('_');
  const meta = LOOKUP[slug];
  if (!meta) return null;
  const title = meta.title;
  // path = media/<category>/<title>/media/<fname>
  const path = `media/${category}/${title}/media/${fname}`;
  return 'https://us-southeast-1.linodeobjects.com/immersionkit/' + encodeURI(path);
}

async function fetchJSON(url) {
  const https = require('https');
  return new Promise((resolve, reject) => {
    const req = https.get(url, { headers: { 'User-Agent': 'Mozilla/5.0' } }, res => {
      let data = '';
      res.on('data', c => data += c);
      res.on('end', () => {
        try { resolve(JSON.parse(data)); } catch (e) { reject(e); }
      });
    });
    req.on('error', reject);
    req.setTimeout(12000, () => { req.destroy(new Error('timeout')); });
  });
}

async function main() {
  const data = JSON.parse(fs.readFileSync(CARDS, 'utf8'));
  const start = parseInt(process.argv[2] || '1', 10);
  const end = parseInt(process.argv[3] || String(data.cards.length), 10);

  const browser = await puppeteer.launch({
    executablePath: CHROME,
    headless: 'new',
    args: ['--no-sandbox'],
  });
  const page = await browser.newPage();
  await page.setUserAgent('Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 Chrome/120.0.0.0 Safari/537.36');
  // 事前に IK でセッション確立
  await page.goto('https://www.immersionkit.com/', { waitUntil: 'domcontentloaded', timeout: 20000 });

  let ok = 0, skip = 0, fail = 0;

  for (const card of data.cards) {
    if (card.id < start || card.id > end) continue;
    if (!card.examples || !card.examples.length) { skip++; continue; }

    const firstEx = card.examples[0];
    if (!firstEx.jp) { skip++; continue; }
    const targetJp = normalize(firstEx.jp);

    try {
      // API 呼び出し (express)
      const apiData = await fetchJSON(`https://apiv2express.immersionkit.com/search?q=${encodeURIComponent(card.word)}&exact=true`);
      const examples = (apiData && apiData.examples) || [];
      if (!examples.length) {
        console.log(`  [${card.id}] ${card.word}  ⏭ IK no data`);
        skip++;
        continue;
      }

      // 対応する例句を探す
      let matched = null, bestScore = 0;
      for (const ikEx of examples) {
        const ikJp = normalize(ikEx.sentence);
        if (ikJp.includes(targetJp) || targetJp.includes(ikJp.substring(0, 25))) {
          matched = ikEx;
          bestScore = 1;
          break;
        }
        const a = new Set([...targetJp.substring(0, 50)]);
        const b = new Set([...ikJp.substring(0, 50)]);
        const inter = [...a].filter(x => b.has(x)).length;
        const union = new Set([...a, ...b]).size;
        const score = union ? inter / union : 0;
        if (score > bestScore) { bestScore = score; matched = ikEx; }
      }
      // どうしてもマッチしなければ先頭例に fallback
      if (!matched || bestScore < 0.35) {
        matched = examples[0];
        bestScore = 0;
      }

      const imgUrl = buildUrl(matched.id, matched.image);
      const sndUrl = buildUrl(matched.id, matched.sound);

      if (!imgUrl) {
        console.log(`  [${card.id}] ${card.word}  ⏭ unknown media: ${matched.id}`);
        skip++;
        continue;
      }

      // Chrome で DL
      const dl = await page.evaluate(async (iu, su) => {
        async function grab(url) {
          try {
            const r = await fetch(url);
            if (!r.ok) return null;
            const buf = await r.arrayBuffer();
            const arr = new Uint8Array(buf);
            let s = '';
            for (let i = 0; i < arr.length; i++) s += String.fromCharCode(arr[i]);
            return btoa(s);
          } catch (e) { return null; }
        }
        return { img: await grab(iu), snd: su ? await grab(su) : null };
      }, imgUrl, sndUrl);

      if (!dl.img) {
        console.log(`  [${card.id}] ${card.word}  ⚠ img DL fail`);
        fail++;
        continue;
      }

      const cardDir = path.join(MEDIA_DIR, String(card.id));
      if (!fs.existsSync(cardDir)) fs.mkdirSync(cardDir, { recursive: true });
      const imgBuf = Buffer.from(dl.img, 'base64');
      fs.writeFileSync(path.join(cardDir, '0.jpg'), imgBuf);
      firstEx.image = `media/${card.id}/0.jpg`;
      firstEx.image_source = matched.image;

      let sndSize = 0;
      if (dl.snd) {
        const sndBuf = Buffer.from(dl.snd, 'base64');
        fs.writeFileSync(path.join(cardDir, '0.mp3'), sndBuf);
        firstEx.audio = `media/${card.id}/0.mp3`;
        firstEx.audio_source = matched.sound;
        sndSize = sndBuf.length;
      } else {
        delete firstEx.audio;
      }

      // jp を IK 側に揃える（画像内字幕と一致するように）
      firstEx.jp = matched.sentence;
      // MD の CN を保持

      console.log(`  [${card.id}] ${card.word}  ✅ score=${bestScore.toFixed(2)} img=${imgBuf.length}B snd=${sndSize||'—'}`);
      ok++;

      fs.writeFileSync(CARDS, JSON.stringify(data, null, 2));
      await new Promise(r => setTimeout(r, 1200));

    } catch (err) {
      console.log(`  [${card.id}] ${card.word}  ❌ ${err.message}`);
      fail++;
      await new Promise(r => setTimeout(r, 5000));
    }
  }

  await browser.close();
  console.log(`\nDone. OK=${ok}, Skip=${skip}, Fail=${fail}`);
}

main().catch(e => { console.error(e); process.exit(1); });
