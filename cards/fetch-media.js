#!/usr/bin/env node
// Chrome 経由で IK の画像・音声を取得してローカル保存し cards.json を更新
const puppeteer = require('puppeteer-core');
const fs = require('fs');
const path = require('path');

const CHROME = '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
const CARDS_JSON = path.join(__dirname, 'data/cards.json');
const MEDIA_DIR = path.join(__dirname, 'media');

if (!fs.existsSync(MEDIA_DIR)) fs.mkdirSync(MEDIA_DIR, { recursive: true });

async function main() {
  const data = JSON.parse(fs.readFileSync(CARDS_JSON, 'utf8'));
  const cards = data.cards;

  const startId = parseInt(process.argv[2] || '1', 10);
  const endId = parseInt(process.argv[3] || String(cards.length), 10);

  console.log(`▶ Target cards: ${startId} ~ ${endId} / ${cards.length}`);

  const browser = await puppeteer.launch({
    executablePath: CHROME,
    headless: 'new',
    args: ['--no-sandbox'],
  });
  const page = await browser.newPage();
  await page.setViewport({ width: 1280, height: 900 });
  await page.setUserAgent('Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36');

  // ネットワークリクエスト傍受 — linodeobjects への GET を記録
  let capturedImg = null;
  let capturedSnd = null;
  page.on('response', async (res) => {
    const url = res.url();
    if (!url.includes('linodeobjects.com/immersionkit')) return;
    if (res.status() !== 200) return;
    try {
      const buf = await res.buffer();
      const fname = decodeURIComponent(url.split('/').pop());
      if (fname.endsWith('.jpg') || fname.endsWith('.webp') || fname.endsWith('.png')) {
        if (!capturedImg) capturedImg = { url, fname, buf };
      } else if (fname.endsWith('.mp3')) {
        if (!capturedSnd) capturedSnd = { url, fname, buf };
      }
    } catch (e) { /* ignore */ }
  });

  let ok = 0, fail = 0;

  for (const card of cards) {
    if (card.id < startId || card.id > endId) continue;
    if (card.examples && card.examples[0] && card.examples[0].image) {
      console.log(`  [${card.id}] ${card.word}  ⏭ already has media`);
      continue;
    }
    // 空 examples 的卡片（新添加的），先抓 API 填充基础例句
    if (!card.examples || !card.examples.length) {
      try {
        const apiData = await page.evaluate(async (word) => {
          const r = await fetch(`https://apiv2.immersionkit.com/search?q=${encodeURIComponent(word)}&exact=true`);
          if (!r.ok) return null;
          return await r.json();
        }, card.word);
        const ikEx = (apiData && apiData.examples) || [];
        card.examples = ikEx.slice(0, 3).map(e => ({
          jp: (e.sentence || '').replace(/\s+/g, ' ').trim(),
          cn: e.translation || ''  // 先用英文占位，之后可人工翻译
        }));
        if (!card.examples.length) {
          console.log(`  [${card.id}] ${card.word}  ⏭ IK no examples`);
          continue;
        }
      } catch (e) {
        console.log(`  [${card.id}] ${card.word}  ❌ API error: ${e.message}`);
        fail++;
        continue;
      }
    }

    capturedImg = null;
    capturedSnd = null;

    try {
      const url = `https://www.immersionkit.com/dictionary?keyword=${encodeURIComponent(card.word)}&exact=true`;
      await page.goto(url, { waitUntil: 'networkidle2', timeout: 25000 });
      // Wait for images to load (they lazy-load)
      await new Promise(r => setTimeout(r, 2500));

      // Trigger click on first result's sound button to fetch MP3 (optional)
      try {
        await page.evaluate(() => {
          const btn = document.querySelector('button[aria-label*="audio"], button[aria-label*="play"]');
          if (btn) btn.click();
        });
        await new Promise(r => setTimeout(r, 1500));
      } catch {}

      if (capturedImg) {
        const cardDir = path.join(MEDIA_DIR, String(card.id));
        if (!fs.existsSync(cardDir)) fs.mkdirSync(cardDir, { recursive: true });
        const ext = capturedImg.fname.split('.').pop();
        fs.writeFileSync(path.join(cardDir, `0.${ext}`), capturedImg.buf);
        card.examples[0].image = `media/${card.id}/0.${ext}`;
        card.examples[0].image_source = capturedImg.fname;

        // 音声取得：API から sound filename を取得 → image URL の末尾を置換
        let sndBytes = 0;
        try {
          const apiData = await page.evaluate(async (word) => {
            const r = await fetch(`https://apiv2.immersionkit.com/search?q=${encodeURIComponent(word)}&exact=true`);
            if (!r.ok) return null;
            return await r.json();
          }, card.word);

          if (apiData && apiData.examples) {
            // image filename にマッチする例を見つける
            const match = apiData.examples.find(e => e.image === capturedImg.fname);
            if (match && match.sound) {
              // image URL の最後のファイル名を sound に置換
              const imgUrlEncoded = encodeURIComponent(capturedImg.fname);
              const sndUrlEncoded = encodeURIComponent(match.sound);
              const sndUrl = capturedImg.url.replace(imgUrlEncoded, sndUrlEncoded)
                                              .replace(capturedImg.fname, match.sound);

              // Chrome 内で fetch → base64 で戻す
              const b64 = await page.evaluate(async (u) => {
                const r = await fetch(u);
                if (!r.ok) return null;
                const buf = await r.arrayBuffer();
                const arr = new Uint8Array(buf);
                let s = '';
                for (let i = 0; i < arr.length; i++) s += String.fromCharCode(arr[i]);
                return btoa(s);
              }, sndUrl);

              if (b64) {
                const sndBuf = Buffer.from(b64, 'base64');
                fs.writeFileSync(path.join(cardDir, '0.mp3'), sndBuf);
                card.examples[0].audio = `media/${card.id}/0.mp3`;
                card.examples[0].audio_source = match.sound;
                sndBytes = sndBuf.length;
              }
            }
          }
        } catch (e) { /* ignore sound errors */ }

        console.log(`  [${card.id}] ${card.word}  ✅ img=${capturedImg.buf.length}B snd=${sndBytes ? sndBytes + 'B' : '—'}`);
        ok++;
      } else {
        console.log(`  [${card.id}] ${card.word}  ⚠ no image captured`);
        fail++;
      }

      fs.writeFileSync(CARDS_JSON, JSON.stringify(data, null, 2));
      await new Promise(r => setTimeout(r, 1500));

    } catch (err) {
      console.log(`  [${card.id}] ${card.word}  ❌ ${err.message}`);
      fail++;
      // 如果 API error，可能被限流，加长等待
      if (err.message && err.message.includes('Failed to fetch')) {
        await new Promise(r => setTimeout(r, 4000));
      }
    }
  }

  await browser.close();
  console.log(`\nDone. OK=${ok}, Fail=${fail}`);
}

main().catch(err => { console.error('FATAL:', err); process.exit(1); });
