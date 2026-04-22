#!/usr/bin/env node
// MD から新しい jp/cn を取得して cards.json の対応 card に上書き（image/audio は保持）
const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const MD_FILES = ['01_a-gyou.md', '02_ka-gyou.md', '03_sa-gyou.md', '04_ta-gyou.md'];

function clean(s) {
  return s.replace(/\*\*([^*]+)\*\*/g, '$1').replace(/\*([^*]+)\*/g, '$1').replace(/`([^`]+)`/g, '$1').trim();
}

function parseEntry(block) {
  const titleMatch = block.match(/^###\s+([^\s`]+)\s+([^\s`]+)/m) ||
                     block.match(/^###\s+(\d+)\.\s+([^\s`]+)/m);
  if (!titleMatch) return null;
  const [, num, word] = titleMatch;
  const examples = [];
  const lines = block.split('\n');
  let i = 0;
  while (i < lines.length) {
    const titleMatch2 = lines[i].match(/^>\s*\*\*([^*]+)\*\*\s*$/);
    if (titleMatch2 && i + 2 < lines.length) {
      const jpMatch = lines[i + 1].match(/^>\s*(.+?)\s*$/);
      const arrowLine = lines[i + 2];
      const arrowIdx = arrowLine.indexOf('→');
      if (jpMatch && arrowIdx >= 0) {
        const after = arrowLine.substring(arrowIdx + 1);
        const firstStar = after.indexOf('*');
        const lastStar = after.lastIndexOf('*');
        if (firstStar >= 0 && lastStar > firstStar) {
          const cn = after.substring(firstStar + 1, lastStar);
          examples.push({ source: clean(titleMatch2[1]), jp: clean(jpMatch[1]), cn: clean(cn) });
          i += 3; continue;
        }
      }
    }
    i++;
  }
  return { word: word.trim(), examples };
}

function splitEntries(md) {
  const lines = md.split('\n');
  const entries = [];
  let current = null;
  for (const line of lines) {
    if (line.startsWith('### ')) {
      if (current) entries.push(current.join('\n'));
      current = [line];
    } else if (current) {
      if (line.startsWith('## ') || line.match(/^\*\*进度\*\*/) || line.match(/^## 📊/)) {
        entries.push(current.join('\n'));
        current = null;
      } else {
        current.push(line);
      }
    }
  }
  if (current) entries.push(current.join('\n'));
  return entries;
}

// 解析 MD → word → examples
const wordToExamples = {};
for (const f of MD_FILES) {
  const md = fs.readFileSync(path.join(ROOT, f), 'utf8');
  for (const block of splitEntries(md)) {
    const p = parseEntry(block);
    if (p && p.examples.length) wordToExamples[p.word] = p.examples;
  }
}

// cards.json 更新
const CARDS = path.join(__dirname, 'data/cards.json');
const data = JSON.parse(fs.readFileSync(CARDS, 'utf8'));

let updated = 0;
for (const card of data.cards) {
  const fresh = wordToExamples[card.word];
  if (!fresh || !fresh.length) continue;

  // 既存 examples の image/audio を保持しつつ jp/cn を更新
  const existing = card.examples || [];
  const mergedEx = fresh.map((f, i) => {
    const old = existing[i] || {};
    return {
      ...f,
      image: old.image,
      image_source: old.image_source,
      audio: old.audio,
      audio_source: old.audio_source,
    };
  });
  // existing の余分は捨てる？ or 残す？ fresh を優先採用
  card.examples = mergedEx;
  updated++;
}

fs.writeFileSync(CARDS, JSON.stringify(data, null, 2));
console.log(`✅ Updated ${updated} cards from MD`);

// 检查某些 sample
for (const w of ['あたふた', 'うきうき', 'ざあざあ', 'ぎょっと']) {
  const c = data.cards.find(c => c.word === w);
  if (!c) continue;
  console.log('\n' + c.id + ' ' + c.word + ':');
  for (const ex of c.examples.slice(0, 2)) {
    console.log('  JP:', ex.jp.substring(0, 60));
    console.log('  CN:', ex.cn.substring(0, 60));
  }
}
