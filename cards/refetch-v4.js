#!/usr/bin/env node
// v4: Fallback 策で残り語を救出
//  1. exact + hiragana → 2. exact + katakana → 3. non-exact + hiragana
const puppeteer = require('puppeteer-core');
const fs = require('fs');
const path = require('path');
const https = require('https');
const CHROME = '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
const CARDS = path.join(__dirname, 'data/cards.json');
const MEDIA_DIR = path.join(__dirname, 'media');
const LOOKUP = JSON.parse(fs.readFileSync(path.join(__dirname, 'data/ik_lookup.json'), 'utf8'));

function kana(s) {
  return s.split('').map(ch => {
    const c = ch.charCodeAt(0);
    if (c >= 0x3041 && c <= 0x3096) return String.fromCharCode(c + 0x60);
    return ch;
  }).join('');
}
function normalize(s) {
  return (s||'').replace(/[\s　]/g, '').replace(/[「」『』（）()［］\[\]"'.,。、！？!?]/g, '').toLowerCase();
}
function buildUrl(id, fname) {
  if (!fname) return null;
  const parts = id.split('_');
  const cat = parts[0];
  const slug = parts.slice(1, -1).join('_');
  const m = LOOKUP[slug];
  if (!m) return null;
  return 'https://us-southeast-1.linodeobjects.com/immersionkit/' + encodeURI(`media/${cat}/${m.title}/media/${fname}`);
}
function fetchJSON(url) {
  return new Promise((resolve, reject) => {
    https.get(url, { headers: { 'User-Agent': 'Mozilla/5.0' } }, res => {
      let d = ''; res.on('data', c => d += c); res.on('end', () => { try { resolve(JSON.parse(d)); } catch(e) { resolve(null); } });
    }).on('error', reject).setTimeout(12000, () => reject(new Error('timeout')));
  });
}

async function tryFetch(word) {
  const attempts = [
    `https://apiv2express.immersionkit.com/search?q=${encodeURIComponent(word)}&exact=true`,
    `https://apiv2express.immersionkit.com/search?q=${encodeURIComponent(kana(word))}&exact=true`,
    `https://apiv2express.immersionkit.com/search?q=${encodeURIComponent(word)}`,
    `https://apiv2express.immersionkit.com/search?q=${encodeURIComponent(kana(word))}`,
  ];
  for (const url of attempts) {
    const d = await fetchJSON(url);
    const ex = (d && d.examples) || [];
    if (ex.length) return ex;
    await new Promise(r => setTimeout(r, 1500));
  }
  return [];
}

async function main() {
  const data = JSON.parse(fs.readFileSync(CARDS, 'utf8'));

  const browser = await puppeteer.launch({ executablePath: CHROME, headless: 'new', args: ['--no-sandbox'] });
  const page = await browser.newPage();
  await page.setUserAgent('Mozilla/5.0 (Macintosh) Chrome/120');
  await page.goto('https://www.immersionkit.com/', { waitUntil: 'domcontentloaded', timeout: 20000 });

  let ok = 0, skip = 0;

  for (const card of data.cards) {
    // Skip cards already have media
    const has = card.examples?.[0]?.image || card.examples?.[0]?.audio;
    if (has) continue;

    try {
      const examples = await tryFetch(card.word);
      if (!examples.length) {
        console.log(`  [${card.id}] ${card.word}  ⏭ 0 results`);
        skip++;
        await new Promise(r => setTimeout(r, 3000));
        continue;
      }
      // Ensure examples array exists
      if (!card.examples) card.examples = [];
      if (!card.examples[0]) card.examples[0] = { jp: '', cn: '' };

      // 画像あり優先
      const withImg = examples.filter(e => e.image);
      const cands = withImg.length ? withImg : examples;
      // そのまま先頭
      const matched = cands[0];

      const iu = buildUrl(matched.id, matched.image);
      const su = buildUrl(matched.id, matched.sound);
      if (!iu && !su) {
        console.log(`  [${card.id}] ${card.word}  ⏭ unknown anime: ${matched.id}`);
        skip++;
        continue;
      }

      const dl = await page.evaluate(async (iu, su) => {
        async function grab(u) {
          if (!u) return null;
          try {
            const r = await fetch(u); if (!r.ok) return null;
            const arr = new Uint8Array(await r.arrayBuffer());
            let s = ''; for (let i = 0; i < arr.length; i++) s += String.fromCharCode(arr[i]);
            return btoa(s);
          } catch { return null; }
        }
        return { img: await grab(iu), snd: await grab(su) };
      }, iu, su);

      if (!dl.img && !dl.snd) {
        console.log(`  [${card.id}] ${card.word}  ❌ DL fail`);
        continue;
      }

      const cardDir = path.join(MEDIA_DIR, String(card.id));
      if (!fs.existsSync(cardDir)) fs.mkdirSync(cardDir, { recursive: true });
      let il=0, sl=0;
      if (dl.img) {
        const b = Buffer.from(dl.img, 'base64');
        fs.writeFileSync(path.join(cardDir, '0.jpg'), b);
        card.examples[0].image = `media/${card.id}/0.jpg`;
        card.examples[0].image_source = matched.image;
        il = b.length;
      }
      if (dl.snd) {
        const b = Buffer.from(dl.snd, 'base64');
        fs.writeFileSync(path.join(cardDir, '0.mp3'), b);
        card.examples[0].audio = `media/${card.id}/0.mp3`;
        card.examples[0].audio_source = matched.sound;
        sl = b.length;
      }
      // Use IK's sentence
      card.examples[0].jp = matched.sentence;

      console.log(`  [${card.id}] ${card.word}  ✅ img=${il||'—'} snd=${sl||'—'}`);
      ok++;
      fs.writeFileSync(CARDS, JSON.stringify(data, null, 2));
      await new Promise(r => setTimeout(r, 1000));
    } catch (e) {
      console.log(`  [${card.id}] ${card.word}  ❌ ${e.message}`);
    }
  }

  await browser.close();
  console.log(`\nDone. OK=${ok}, Skip=${skip}`);
}
main();
