#!/usr/bin/env node
// 残り 36 語を YouTube から取得：字幕でタイムスタンプを特定 → 5 秒クリップ → 画像+音声抽出
const fs = require('fs');
const path = require('path');
const { spawnSync, execSync } = require('child_process');

const CARDS = path.join(__dirname, 'data/cards.json');
const MEDIA_DIR = path.join(__dirname, 'media');
const TMP = '/tmp/ytfetch';
fs.mkdirSync(TMP, { recursive: true });

function ts2sec(ts) {
  const m = ts.match(/(\d+):(\d+):(\d+)\.(\d+)/);
  if (!m) return 0;
  return parseInt(m[1])*3600 + parseInt(m[2])*60 + parseInt(m[3]) + parseInt(m[4])/1000;
}
function sec2ts(s) {
  const h = Math.floor(s/3600), m = Math.floor((s%3600)/60), sec = (s%60).toFixed(2);
  return `${String(h).padStart(2,'0')}:${String(m).padStart(2,'0')}:${String(sec).padStart(5,'0')}`;
}

// VTT を解析して指定語の最初の出現タイムスタンプ（秒）と前後文脈を返す
function findTimestamp(vttFile, word) {
  const text = fs.readFileSync(vttFile, 'utf8');
  const lines = text.split('\n');
  const wordKana = word; // hiragana
  const wordKata = word.split('').map(ch => {
    const c = ch.charCodeAt(0);
    if (c >= 0x3041 && c <= 0x3096) return String.fromCharCode(c + 0x60);
    return ch;
  }).join('');

  let blockStart = null;
  for (let i = 0; i < lines.length; i++) {
    const l = lines[i];
    const tsMatch = l.match(/^(\d+:\d+:\d+\.\d+)\s*-->/);
    if (tsMatch) {
      blockStart = ts2sec(tsMatch[1]);
      continue;
    }
    if (l.includes(word) || l.includes(wordKata)) {
      // Inline word-level timestamps: "word<00:00:30.123>" 形式があれば優先
      const inline = l.match(new RegExp(`<(\\d+:\\d+:\\d+\\.\\d+)>(?:<c>)?[^<]*?(${word}|${wordKata})`));
      let exact = null;
      if (inline) exact = ts2sec(inline[1]);
      // 単純なテキスト内出現
      const t = exact ?? blockStart;
      // 前後文脈（その block の最初のテキスト行）
      const ctx = (l.replace(/<[^>]+>/g, '').trim()) || word;
      return { time: t, sentence: ctx.slice(0, 80) };
    }
  }
  return null;
}

async function processWord(card) {
  const word = card.word;
  const dir = path.join(TMP, String(card.id));
  fs.mkdirSync(dir, { recursive: true });

  // Step 1: search + download subs
  const searchQuery = `${word} 意味`; // 「意味」で「説明動画」が当たりやすい
  console.log(`  [${card.id}] ${word}  searching...`);
  const search = spawnSync('yt-dlp', [
    '--write-auto-subs', '--sub-lang', 'ja',
    '--skip-download', '--no-warnings', '--max-downloads', '3',
    '-o', `${dir}/%(id)s.%(ext)s`,
    `ytsearch5:${searchQuery}`
  ], { encoding: 'utf8', timeout: 60000 });

  // Find any vtt file containing the word
  const vtts = fs.readdirSync(dir).filter(f => f.endsWith('.vtt'));
  let bestVtt = null, bestVidId = null, bestTime = null, bestCtx = null;
  for (const vtt of vtts) {
    const result = findTimestamp(path.join(dir, vtt), word);
    if (result) {
      bestVtt = vtt;
      bestVidId = vtt.replace(/\.ja\.vtt$/, '');
      bestTime = result.time;
      bestCtx = result.sentence;
      break;
    }
  }

  if (!bestVidId) {
    console.log(`    ⏭ word not in any subtitle`);
    return false;
  }

  // Step 2: download a 6-second clip
  const start = Math.max(0, bestTime - 1.5);
  const end = bestTime + 4.5;
  const startTs = sec2ts(start);
  const endTs = sec2ts(end);
  const clipPath = path.join(dir, 'clip.mp4');

  console.log(`    found in ${bestVidId} at ${sec2ts(bestTime)} → clip ${startTs}-${endTs}`);
  const dlClip = spawnSync('yt-dlp', [
    '-f', 'best[ext=mp4]/mp4/best',
    '--download-sections', `*${startTs}-${endTs}`,
    '--no-warnings',
    '-o', clipPath,
    `https://www.youtube.com/watch?v=${bestVidId}`
  ], { encoding: 'utf8', timeout: 60000 });

  if (!fs.existsSync(clipPath)) {
    console.log(`    ❌ clip download failed`);
    return false;
  }

  // Step 3: extract image at offset 1.5s (where the word starts) + audio
  const cardDir = path.join(MEDIA_DIR, String(card.id));
  fs.mkdirSync(cardDir, { recursive: true });
  const jpgPath = path.join(cardDir, '0.jpg');
  const mp3Path = path.join(cardDir, '0.mp3');

  spawnSync('ffmpeg', ['-y', '-ss', '1.5', '-i', clipPath, '-frames:v', '1', '-q:v', '3', '-vf', 'scale=640:-1', jpgPath], { encoding: 'utf8', timeout: 30000 });
  spawnSync('ffmpeg', ['-y', '-i', clipPath, '-vn', '-acodec', 'libmp3lame', '-ab', '96k', mp3Path], { encoding: 'utf8', timeout: 30000 });

  if (!fs.existsSync(jpgPath) || !fs.existsSync(mp3Path)) {
    console.log(`    ❌ extract failed`);
    return false;
  }

  if (!card.examples) card.examples = [];
  if (!card.examples[0]) card.examples[0] = {};
  card.examples[0].image = `media/${card.id}/0.jpg`;
  card.examples[0].audio = `media/${card.id}/0.mp3`;
  card.examples[0].image_source = `youtube:${bestVidId}@${sec2ts(bestTime)}`;
  card.examples[0].audio_source = `youtube:${bestVidId}@${startTs}-${endTs}`;
  card.examples[0].jp = bestCtx;

  // Cleanup
  try { fs.rmSync(dir, { recursive: true, force: true }); } catch {}

  const imgSize = fs.statSync(jpgPath).size;
  const sndSize = fs.statSync(mp3Path).size;
  console.log(`    ✅ img=${imgSize}B snd=${sndSize}B  jp="${bestCtx}"`);
  return true;
}

async function main() {
  const data = JSON.parse(fs.readFileSync(CARDS, 'utf8'));
  const missing = data.cards.filter(c => !(c.examples?.[0]?.image || c.examples?.[0]?.audio));
  console.log(`Targets: ${missing.length}`);
  let ok = 0, fail = 0;

  for (const card of missing) {
    try {
      const success = await processWord(card);
      if (success) {
        ok++;
        fs.writeFileSync(CARDS, JSON.stringify(data, null, 2));
      } else {
        fail++;
      }
    } catch (e) {
      console.log(`    ❌ ${e.message}`);
      fail++;
    }
    await new Promise(r => setTimeout(r, 1500));
  }

  console.log(`\nDone. OK=${ok}, Fail=${fail}`);
}
main();
