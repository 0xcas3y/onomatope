#!/usr/bin/env node
// v2: IK dictionary page を直接スクレイプして jp-image-audio 三点セットを取得
// API 呼び出し不要 (IP ブロック回避)
const puppeteer = require('puppeteer-core');
const fs = require('fs');
const path = require('path');

const CHROME = '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
const CARDS = path.join(__dirname, 'data/cards.json');
const MEDIA_DIR = path.join(__dirname, 'media');

function normalize(s) {
  if (!s) return '';
  return s.replace(/[\s　]/g, '').replace(/[「」『』（）()［］\[\]"'.,。、！？!?]/g, '').toLowerCase();
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
  await page.setViewport({ width: 1280, height: 1600 });
  await page.setUserAgent('Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36');

  let ok = 0, skip = 0, fail = 0;

  // ネットワーク傍受: IK 画像と音声を全部バッファ保存
  const byFname = new Map();
  page.on('response', async (res) => {
    const url = res.url();
    if (!url.includes('linodeobjects.com/immersionkit')) return;
    if (res.status() !== 200) return;
    try {
      const buf = await res.buffer();
      const fname = decodeURIComponent(url.split('/').pop());
      byFname.set(fname, { url, buf });
    } catch (e) {}
  });

  for (const card of data.cards) {
    if (card.id < start || card.id > end) continue;
    if (!card.examples || !card.examples.length) { skip++; continue; }

    const firstEx = card.examples[0];
    if (!firstEx.jp) { skip++; continue; }
    const targetJp = normalize(firstEx.jp);

    try {
      byFname.clear();

      // IK dictionary 页を開く
      const url = `https://www.immersionkit.com/dictionary?keyword=${encodeURIComponent(card.word)}&exact=true`;
      await page.goto(url, { waitUntil: 'networkidle2', timeout: 30000 });
      await new Promise(r => setTimeout(r, 4000));

      // ページ上の全例句とその画像URLを抽出
      const results = await page.evaluate(() => {
        const items = [];
        // IK の例句カード：.example-sentence-card や div with jp text + img
        // 一般的に画像 img + ruby または文章を含む要素
        const imgs = Array.from(document.querySelectorAll('img'))
          .filter(i => i.src.includes('linodeobjects') || i.src.includes('immersionkit'));
        for (const img of imgs) {
          // 近くの親要素内の日本語文を探す
          let el = img.closest('div, article, li, section');
          while (el && el.parentElement) {
            const text = el.textContent || '';
            if (text.length > 10 && /[ぁ-ゞァ-ヿ一-龯]/.test(text)) {
              items.push({ src: img.src, text: text.slice(0, 500) });
              break;
            }
            el = el.parentElement;
          }
        }
        return items;
      });

      if (!results.length) {
        console.log(`  [${card.id}] ${card.word}  ⏭ no imgs on page`);
        skip++;
        continue;
      }

      // jp 文に最も一致するものを選ぶ
      let bestMatch = null, bestScore = 0;
      for (const r of results) {
        const rText = normalize(r.text);
        // 部分一致 or Jaccard
        if (rText.includes(targetJp) || targetJp.includes(rText.substring(0, 30))) {
          bestMatch = r;
          bestScore = 1;
          break;
        }
        // Jaccard
        const a = new Set([...targetJp.substring(0, 40)]);
        const b = new Set([...rText.substring(0, 40)]);
        const inter = [...a].filter(x => b.has(x)).length;
        const union = new Set([...a, ...b]).size;
        const score = union ? inter / union : 0;
        if (score > bestScore) { bestScore = score; bestMatch = r; }
      }

      if (!bestMatch || bestScore < 0.4) {
        console.log(`  [${card.id}] ${card.word}  ⏭ no good match (${bestScore.toFixed(2)})`);
        skip++;
        continue;
      }

      // 選ばれた画像の fname
      const imgFname = decodeURIComponent(bestMatch.src.split('/').pop());
      const imgEntry = byFname.get(imgFname);
      if (!imgEntry) {
        console.log(`  [${card.id}] ${card.word}  ⏭ img not in buffer`);
        skip++;
        continue;
      }

      // 音声 URL 推測 (ファイル名変換: 単一タイムスタンプ → 時間範囲)
      // 画像 URL から音声 URL を構築（同じフォルダ、拡張子 .mp3 へ）
      // ただし音声 filename は時間範囲を含むので API 無しで推測困難
      // 代替：同じバッファ内で同じベース名の mp3 を探す
      const imgPrefix = imgFname.replace(/_\d+\.\d+\.\d+\.\d+\.(jpg|jpeg|webp|png)$/, '');
      let sndEntry = null;
      for (const [fname, entry] of byFname.entries()) {
        if (fname.endsWith('.mp3') && fname.startsWith(imgPrefix.replace(/_\d+$/, ''))) {
          sndEntry = entry;
          break;
        }
      }
      // fallback: 一致する時間近いものを選ぶ（画像の timestamp が音声範囲に含まれるもの）
      if (!sndEntry) {
        const tsMatch = imgFname.match(/_(\d+\.\d+\.\d+\.\d+)\.(jpg|jpeg|webp|png)$/);
        if (tsMatch) {
          const imgTs = tsMatch[1];
          for (const [fname, entry] of byFname.entries()) {
            if (!fname.endsWith('.mp3')) continue;
            // 音声 filename: XXX_EE_START-END.mp3
            const rangeMatch = fname.match(/_(\d+\.\d+\.\d+\.\d+)-(\d+\.\d+\.\d+\.\d+)\.mp3$/);
            if (rangeMatch) {
              // imgTs が [start, end] の範囲に含まれるかざっくり判定
              const cmp = (a, b) => a.localeCompare(b);
              if (cmp(imgTs, rangeMatch[1]) >= -1 && cmp(imgTs, rangeMatch[2]) <= 1) {
                // さらに同じエピソードか確認: プレフィックス一致
                const imgBase = imgFname.replace(/_\d+\.\d+\.\d+\.\d+\.(jpg|jpeg|webp|png)$/, '');
                const sndBase = fname.replace(/_\d+\.\d+\.\d+\.\d+-\d+\.\d+\.\d+\.\d+\.mp3$/, '');
                if (imgBase === sndBase) {
                  sndEntry = entry;
                  break;
                }
              }
            }
          }
        }
      }

      // 保存
      const cardDir = path.join(MEDIA_DIR, String(card.id));
      if (!fs.existsSync(cardDir)) fs.mkdirSync(cardDir, { recursive: true });
      fs.writeFileSync(path.join(cardDir, '0.jpg'), imgEntry.buf);
      firstEx.image = `media/${card.id}/0.jpg`;
      firstEx.image_source = imgFname;

      let sndStatus = '—';
      if (sndEntry) {
        fs.writeFileSync(path.join(cardDir, '0.mp3'), sndEntry.buf);
        firstEx.audio = `media/${card.id}/0.mp3`;
        sndStatus = sndEntry.buf.length + 'B';
      } else {
        delete firstEx.audio;
      }

      console.log(`  [${card.id}] ${card.word}  ✅ score=${bestScore.toFixed(2)} img=${imgEntry.buf.length}B snd=${sndStatus}`);
      ok++;

      fs.writeFileSync(CARDS, JSON.stringify(data, null, 2));
      await new Promise(r => setTimeout(r, 1500));

    } catch (err) {
      console.log(`  [${card.id}] ${card.word}  ❌ ${err.message}`);
      fail++;
      await new Promise(r => setTimeout(r, 8000));
    }
  }

  await browser.close();
  console.log(`\nDone. OK=${ok}, Skip=${skip}, Fail=${fail}`);
}

main().catch(e => { console.error(e); process.exit(1); });
