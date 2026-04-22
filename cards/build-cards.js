#!/usr/bin/env node
// 解析 MD 文件生成 cards.json
const fs = require('fs');
const path = require('path');

const ROOT = '/Users/caseyshi/project/onomatope';
const MD_FILES = [
  '01_a-gyou.md',
  '02_ka-gyou.md',
  '03_sa-gyou.md',
  '04_ta-gyou.md',
];

// 清掉 markdown 格式符号，用于 card 展示
function clean(s) {
  return s
    .replace(/\*\*([^*]+)\*\*/g, '$1')  // **bold** → text
    .replace(/\*([^*]+)\*/g, '$1')      // *italic* → text
    .replace(/`([^`]+)`/g, '$1')        // `code` → text
    .replace(/\[([^\]]+)\]\([^)]+\)/g, '$1')  // [text](url) → text
    .trim();
}

// 从一个 entry 块提取信息
function parseEntry(block) {
  // 标题：### 编号. 词　`p.XX` 或 ### 编号 词 `p.XX` (编号可能是 ①-⑳ 或 1. 2. 等)
  const titleMatch = block.match(/^###\s+([^\s`]+)\s+([^\s`]+)\s+`p\.([\d,\s]+)`/m) ||
                     block.match(/^###\s+(\d+)\.\s+([^\s`]+)\s+`p\.([\d,\s]+)`/m);
  if (!titleMatch) return null;
  const [_, num, word, page] = titleMatch;

  // 词义 — 匹配 "> 📖 **词义**｜..."
  const meaningMatch = block.match(/>\s*📖\s*\*\*词义\*\*[｜|]\s*(.+?)$/m);
  const meaningText = meaningMatch ? clean(meaningMatch[1]) : '';
  // 拆分 meanings：① ② 或 ；或 。
  let meanings = [];
  if (meaningText) {
    const segs = meaningText.split(/[①②③④]\s*/).filter(s => s.trim());
    if (segs.length > 1) {
      meanings = segs.map(s => s.trim().replace(/[。；;]$/, '')).filter(Boolean);
    } else {
      // 按 ；/。拆分
      meanings = meaningText.split(/[；;]/).map(s => s.trim().replace(/。$/, '')).filter(Boolean);
    }
  }

  // 用法核心
  const coreMatch = block.match(/🎯\s*\*\*用法核心\*\*[｜|]\s*(.+?)$/m);
  const core = coreMatch ? clean(coreMatch[1]) : '';

  // 常搭
  const collocMatch = block.match(/🔗\s*\*\*常搭\*\*[｜|]\s*(.+?)$/m);
  const collocations = collocMatch ? clean(collocMatch[1]) : '';

  // 一句话（近义词浓缩）
  const oneLineMatch = block.match(/💡\s*\*\*一句话\*\*[｜|]\s*(.+?)$/m) ||
                       block.match(/💡\s*\*\*怒气强度\*\*[｜|]\s*(.+?)$/m);
  const oneLine = oneLineMatch ? clean(oneLineMatch[1]) : '';

  // 组合 mnemonic（用法核心 + 一句话）
  let mnemonic = core;
  if (oneLine) mnemonic += '\n\n🔍 近义区别：' + oneLine;

  // 例句 — 解析 > **Title** \n > jp_text \n > → *cn_text*
  const examples = [];
  // 匹配 blockquote group：连续的 > 行
  const exRegex = /^>\s*\*\*([^*]+)\*\*\s*\n>\s*(.+?)\s*\n>\s*→\s*\*([^*]+)\*/gm;
  let m;
  while ((m = exRegex.exec(block)) !== null) {
    examples.push({
      source: clean(m[1]),
      jp: clean(m[2]),
      cn: clean(m[3])
    });
  }

  return {
    word: word.trim(),
    kana: word.trim(),
    page: page.trim(),
    meanings,
    mnemonic: mnemonic.trim(),
    collocations,
    examples
  };
}

// 分割 MD 为 entry 块（以 ### 开头的节）
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

// 主流程
const allCards = [];
let cardId = 1;
const gyouMap = { '01': 'あ', '02': 'か', '03': 'さ', '04': 'た' };

for (const file of MD_FILES) {
  const md = fs.readFileSync(path.join(ROOT, file), 'utf8');
  const prefix = file.substring(0, 2);
  const gyou = gyouMap[prefix] || '';
  const entries = splitEntries(md);
  for (const block of entries) {
    const parsed = parseEntry(block);
    if (!parsed) continue;
    if (parsed.examples.length === 0 && parsed.meanings.length === 0) continue;
    allCards.push({
      id: cardId++,
      gyou,
      ...parsed
    });
  }
}

const output = {
  version: 1,
  total: allCards.length,
  cards: allCards
};

const outPath = path.join(ROOT, 'cards/data/cards.json');
fs.writeFileSync(outPath, JSON.stringify(output, null, 2));
console.log('✅ Generated:', outPath);
console.log('   Total cards:', allCards.length);
console.log('   By 行:');
const byGyou = {};
for (const c of allCards) byGyou[c.gyou] = (byGyou[c.gyou] || 0) + 1;
Object.entries(byGyou).forEach(([g, n]) => console.log('     ' + g + '行: ' + n));
// 检查样本
console.log('\n📋 Sample card (first):');
console.log(JSON.stringify(allCards[0], null, 2));
