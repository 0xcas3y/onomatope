#!/usr/bin/env node
// カードの jp 文に合致する IK 例句を検索して画像/音声を正しくペアリング
const puppeteer = require('puppeteer-core');
const fs = require('fs');
const path = require('path');

const CHROME = '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
const CARDS = path.join(__dirname, 'data/cards.json');
const MEDIA_DIR = path.join(__dirname, 'media');

// 正規化：スペース・句読点・半/全角統一・カナ揃え
function normalize(s) {
  if (!s) return '';
  return s.replace(/[\s　]/g, '').replace(/[「」『』（）()［］\[\]]/g, '').toLowerCase();
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
  await page.setViewport({ width: 1280, height: 900 });
  await page.setUserAgent('Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36');
  await page.goto('https://www.immersionkit.com/', { waitUntil: 'domcontentloaded', timeout: 20000 });

  let ok = 0, skip = 0, fail = 0;

  for (const card of data.cards) {
    if (card.id < start || card.id > end) continue;
    if (!card.examples || !card.examples.length) { skip++; continue; }

    const firstEx = card.examples[0];
    if (!firstEx.jp) { skip++; continue; }

    try {
      // API 呼び出し
      const apiData = await page.evaluate(async (word) => {
        const r = await fetch(`https://apiv2.immersionkit.com/search?q=${encodeURIComponent(word)}&exact=true`);
        if (!r.ok) return null;
        return await r.json();
      }, card.word);

      if (!apiData || !apiData.examples || !apiData.examples.length) {
        console.log(`  [${card.id}] ${card.word}  ⏭ IK no data`);
        skip++;
        continue;
      }

      // jp 文に最も合致する例を探す
      const targetJp = normalize(firstEx.jp);
      let matched = null;
      for (const ikEx of apiData.examples) {
        const ikJp = normalize(ikEx.sentence);
        // 包含関係で判定
        if (ikJp.includes(targetJp) || targetJp.includes(ikJp.substring(0, 20))) {
          matched = ikEx;
          break;
        }
      }
      if (!matched) {
        // fuzzy: 上位 15 件から文字列長が最も近いものを選ぶ
        const targets = apiData.examples.slice(0, 15);
        let best = null, bestScore = -1;
        for (const ikEx of targets) {
          // jaccard 系でざっくりマッチ
          const a = new Set([...normalize(ikEx.sentence).substring(0, 30)]);
          const b = new Set([...targetJp.substring(0, 30)]);
          const inter = [...a].filter(x => b.has(x)).length;
          const union = new Set([...a, ...b]).size;
          const score = union ? inter / union : 0;
          if (score > bestScore) { bestScore = score; best = ikEx; }
        }
        if (bestScore < 0.35) {
          console.log(`  [${card.id}] ${card.word}  ⏭ no good match (${bestScore.toFixed(2)})`);
          skip++;
          continue;
        }
        matched = best;
      }

      // 画像・音声を Chrome で DL
      const targetImgFname = matched.image;
      const targetSndFname = matched.sound;

      // 画像 URL を IK 辞書页 で探す
      let capturedImg = null, capturedSnd = null;
      const handler = async (res) => {
        const url = res.url();
        if (!url.includes('linodeobjects.com/immersionkit')) return;
        if (res.status() !== 200) return;
        try {
          const buf = await res.buffer();
          const fname = decodeURIComponent(url.split('/').pop());
          if (fname === targetImgFname) capturedImg = { url, buf };
          else if (fname === targetSndFname) capturedSnd = { url, buf };
        } catch (e) {}
      };
      page.on('response', handler);

      await page.goto(`https://www.immersionkit.com/dictionary?keyword=${encodeURIComponent(card.word)}&exact=true`,
        { waitUntil: 'networkidle2', timeout: 25000 });
      await new Promise(r => setTimeout(r, 3500));

      // 音声 URL 補完（画像 URL の末尾置換で推測）
      if (capturedImg && !capturedSnd) {
        try {
          const urlLast = capturedImg.url.split('/').pop();
          const sndEncoded = encodeURIComponent(targetSndFname);
          const sndUrl = capturedImg.url.replace(urlLast, sndEncoded);
          const b64 = await page.evaluate(async (u) => {
            const r = await fetch(u);
            if (!r.ok) return null;
            const buf = await r.arrayBuffer();
            const arr = new Uint8Array(buf);
            let s = '';
            for (let i = 0; i < arr.length; i++) s += String.fromCharCode(arr[i]);
            return btoa(s);
          }, sndUrl);
          if (b64) capturedSnd = { url: sndUrl, buf: Buffer.from(b64, 'base64') };
        } catch {}
      }

      page.off('response', handler);

      if (capturedImg) {
        const cardDir = path.join(MEDIA_DIR, String(card.id));
        if (!fs.existsSync(cardDir)) fs.mkdirSync(cardDir, { recursive: true });
        fs.writeFileSync(path.join(cardDir, '0.jpg'), capturedImg.buf);
        firstEx.image = `media/${card.id}/0.jpg`;
        firstEx.image_source = targetImgFname;
        if (capturedSnd) {
          fs.writeFileSync(path.join(cardDir, '0.mp3'), capturedSnd.buf);
          firstEx.audio = `media/${card.id}/0.mp3`;
          firstEx.audio_source = targetSndFname;
        }
        // JP を IK の方に更新（より自然）
        firstEx.jp = matched.sentence;
        // MD の CN 翻訳を保持
        console.log(`  [${card.id}] ${card.word}  ✅ matched & updated`);
        ok++;
      } else {
        console.log(`  [${card.id}] ${card.word}  ⚠ img not captured`);
        fail++;
      }

      fs.writeFileSync(CARDS, JSON.stringify(data, null, 2));
      await new Promise(r => setTimeout(r, 2000));

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
