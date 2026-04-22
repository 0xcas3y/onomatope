#!/usr/bin/env node
// Build script: bundles all MD files into a styled single-page HTML
const fs = require('fs');
const path = require('path');

const ROOT = '/Users/caseyshi/project/onomatope';
const FILES = [
  { id: 'a',  label: 'あ行', file: '01_a-gyou.md',  count: 20 },
  { id: 'ka', label: 'か行', file: '02_ka-gyou.md', count: 79 },
  { id: 'sa', label: 'さ行', file: '03_sa-gyou.md', count: 45 },
  { id: 'ta', label: 'た行', file: '04_ta-gyou.md', count: 17 },
];
const TODO = [
  { label: 'な行', count: 11 },
  { label: 'は行', count: 74 },
  { label: 'ま行', count: 28 },
  { label: 'や行', count: 4  },
  { label: 'ら行', count: 1  },
  { label: 'わ行', count: 3  },
];
// た行は部分完成（17/37）。未完成の20语も合計に含める
const T_REMAINING = 37 - 17;

const mdBlocks = FILES.map(f => {
  const md = fs.readFileSync(path.join(ROOT, f.file), 'utf8')
    // escape </script> defensively
    .replace(/<\/script>/gi, '<\\/script>');
  return `<script type="text/markdown" id="md-${f.id}">\n${md}\n</script>`;
}).join('\n');

const totalDone = FILES.reduce((a, b) => a + b.count, 0);
const totalAll = totalDone + TODO.reduce((a, b) => a + b.count, 0) + T_REMAINING;

const tabs = FILES.map((f, i) =>
  `<button data-target="${f.id}"${i === 0 ? ' class="active"' : ''}>${f.label} <span class="cnt">${f.count}</span></button>`
).join('') + TODO.map(t =>
  `<button class="disabled" disabled>${t.label} <span class="cnt">${t.count}</span></button>`
).join('');

const sections = FILES.map((f, i) =>
  `<section class="content-section${i === 0 ? ' active' : ''}" id="section-${f.id}"></section>`
).join('');

const html = `<!DOCTYPE html>
<html lang="zh-CN">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>🌸 拟声拟态词辞典</title>
<script src="https://cdn.jsdelivr.net/npm/marked@12/marked.min.js"><\/script>
<style>
:root {
  --pink: #ffe4ec;
  --pink-s: #ffc9d7;
  --pink-d: #ff6b9e;
  --pink-dd: #c04d7a;
  --cream: #fff9ed;
  --mint: #e4f7ef;
  --mint-d: #5c8d76;
  --lavender: #eee4f7;
  --text: #2a2a2a;
  --muted: #888;
}
* { box-sizing: border-box; margin: 0; padding: 0; }
html { scroll-behavior: smooth; }
body {
  font-family: -apple-system, BlinkMacSystemFont, "Hiragino Sans", "PingFang SC", "Microsoft YaHei", sans-serif;
  background: linear-gradient(135deg, var(--pink) 0%, var(--cream) 50%, var(--mint) 100%);
  background-attachment: fixed;
  color: var(--text);
  line-height: 1.75;
  min-height: 100vh;
}
header {
  background: rgba(255,255,255,0.92);
  backdrop-filter: blur(10px);
  padding: 1em 1em 0.6em;
  text-align: center;
  box-shadow: 0 2px 16px rgba(0,0,0,0.06);
  position: sticky;
  top: 0;
  z-index: 100;
}
header h1 {
  font-size: 1.6em;
  color: var(--pink-d);
  font-weight: 800;
  letter-spacing: 0.02em;
}
header .subtitle {
  color: var(--muted);
  font-size: 0.85em;
  margin-top: 0.1em;
}
nav.tabs {
  display: flex;
  justify-content: center;
  gap: 0.4em;
  margin-top: 0.8em;
  flex-wrap: wrap;
}
nav.tabs button {
  background: white;
  border: 2px solid var(--pink-s);
  color: var(--pink-d);
  padding: 0.35em 0.9em;
  border-radius: 999px;
  cursor: pointer;
  font-weight: 600;
  font-size: 0.95em;
  transition: all 0.18s;
  font-family: inherit;
}
nav.tabs button.active {
  background: var(--pink-d);
  color: white;
  border-color: var(--pink-d);
  box-shadow: 0 3px 10px rgba(255,107,158,0.3);
}
nav.tabs button:hover:not(.active):not(.disabled) {
  background: #ffdce6;
}
nav.tabs button.disabled {
  opacity: 0.4;
  cursor: not-allowed;
  background: #f4f4f4;
  color: #999;
  border-color: #ddd;
}
nav.tabs button .cnt {
  background: rgba(255,255,255,0.3);
  padding: 0.05em 0.5em;
  border-radius: 999px;
  font-size: 0.82em;
  margin-left: 0.2em;
}
nav.tabs button.active .cnt {
  background: rgba(255,255,255,0.3);
}
nav.tabs button:not(.active) .cnt {
  background: #fff0f5;
}
nav.tabs button.disabled .cnt {
  background: #e8e8e8;
}
.search-bar {
  text-align: center;
  padding: 0.7em 1em;
  background: rgba(255,249,237,0.8);
  border-bottom: 1px solid var(--pink-s);
  position: sticky;
  top: 128px;
  z-index: 99;
}
@media (max-width: 600px) {
  .search-bar { top: 148px; }
}
.search-bar input {
  padding: 0.5em 1em;
  border: 2px solid var(--pink-s);
  border-radius: 999px;
  font-size: 0.95em;
  width: 70%;
  max-width: 420px;
  font-family: inherit;
  background: white;
}
.search-bar input:focus {
  outline: none;
  border-color: var(--pink-d);
  box-shadow: 0 0 0 3px rgba(255,107,158,0.15);
}
.search-info {
  color: var(--muted);
  font-size: 0.8em;
  margin-top: 0.3em;
}
main {
  max-width: 880px;
  margin: 1.2em auto;
  padding: 0 0.8em 3em;
}
.content-section { display: none; }
.content-section.active { display: block; }
/* Markdown elements */
main h1 {
  font-size: 1.5em;
  color: var(--pink-d);
  border-bottom: 3px dashed var(--pink-s);
  padding-bottom: 0.3em;
  margin-bottom: 0.8em;
}
main h2 {
  font-size: 1.25em;
  color: var(--mint-d);
  margin-top: 2em;
  margin-bottom: 0.6em;
  padding: 0.55em 1em;
  background: white;
  border-radius: 14px;
  box-shadow: 0 2px 8px rgba(0,0,0,0.04);
}
.entry {
  background: white;
  margin: 1.3em 0;
  padding: 1.1em 1.2em;
  border-radius: 16px;
  box-shadow: 0 3px 12px rgba(0,0,0,0.05);
  border-left: 5px solid var(--pink-d);
  transition: transform 0.2s, box-shadow 0.2s;
}
.entry:hover {
  transform: translateY(-2px);
  box-shadow: 0 6px 18px rgba(255,107,158,0.15);
}
.entry h3 {
  font-size: 1.15em;
  color: var(--text);
  margin: 0 0 0.6em 0;
  padding: 0;
  background: none;
  border: none;
  display: flex;
  align-items: center;
  gap: 0.4em;
}
.entry h3 code {
  background: #fff0f5;
  color: var(--pink-d);
  padding: 0.1em 0.5em;
  border-radius: 999px;
  font-size: 0.75em;
  font-weight: normal;
  margin-left: auto;
}
.entry p {
  margin: 0.6em 0;
}
.entry table {
  width: 100%;
  border-collapse: separate;
  border-spacing: 0;
  background: linear-gradient(135deg, #fffafc, #fff);
  border-radius: 10px;
  overflow: hidden;
  margin: 0.8em 0;
  font-size: 0.9em;
  border: 1px solid #fff0f5;
}
.entry th, .entry td {
  padding: 0.5em 0.7em;
  border-bottom: 1px solid #ffe9f0;
  text-align: left;
  vertical-align: top;
}
.entry th {
  background: var(--pink);
  color: var(--pink-dd);
  font-weight: 700;
  font-size: 0.88em;
}
.entry tr:last-child td { border-bottom: none; }
.entry tr:hover td { background: #fffafc; }
.entry blockquote {
  margin: 0.7em 0;
  padding: 0.7em 1em;
  background: #fafdf9;
  border-left: 4px solid #b0dbc7;
  border-radius: 0 10px 10px 0;
  color: #333;
}
.entry blockquote em {
  color: var(--muted);
  font-style: normal;
  display: block;
  margin-top: 0.25em;
  font-size: 0.95em;
}
.entry blockquote strong {
  color: var(--mint-d);
}
.entry p strong {
  color: var(--pink-dd);
}
.entry hr {
  border: none;
  border-top: 1px dashed var(--pink-s);
  margin: 1em 0;
}
.entry a {
  color: var(--pink-d);
  text-decoration: none;
  border-bottom: 1px dotted var(--pink-s);
}
.entry a:hover {
  border-bottom-style: solid;
}
.entry code {
  background: #fff0f5;
  color: var(--pink-d);
  padding: 0.12em 0.4em;
  border-radius: 4px;
  font-size: 0.88em;
}
/* First p (词义 block) */
.entry > blockquote:first-of-type {
  background: #fffaf2;
  border-left-color: #f4c27a;
  font-weight: 500;
}
.hidden { display: none !important; }
.no-match {
  text-align: center;
  padding: 3em 1em;
  color: var(--muted);
}
/* Summary tables (top-level outside entries) */
.content-section > table {
  width: 100%;
  border-collapse: separate;
  border-spacing: 0;
  background: white;
  border-radius: 12px;
  overflow: hidden;
  margin: 1em 0;
  font-size: 0.9em;
  box-shadow: 0 2px 8px rgba(0,0,0,0.04);
}
.content-section > table th,
.content-section > table td {
  padding: 0.55em 0.9em;
  border-bottom: 1px solid #f0f0f0;
  text-align: left;
}
.content-section > table th {
  background: var(--pink);
  color: var(--pink-dd);
}
/* Top-level blockquote (header note) */
.content-section > h1 + blockquote {
  background: rgba(255,255,255,0.7);
  padding: 0.8em 1em;
  border-radius: 10px;
  border-left: 4px solid var(--pink-s);
  font-size: 0.9em;
  color: var(--muted);
}
/* Scrollbar */
::-webkit-scrollbar { width: 10px; }
::-webkit-scrollbar-track { background: var(--pink); }
::-webkit-scrollbar-thumb {
  background: var(--pink-s);
  border-radius: 10px;
}
::-webkit-scrollbar-thumb:hover { background: var(--pink-d); }
/* Mobile */
@media (max-width: 600px) {
  header h1 { font-size: 1.3em; }
  main { padding: 0 0.5em 2em; }
  .entry { padding: 0.9em; }
  .entry h3 { font-size: 1.05em; flex-wrap: wrap; }
  .entry table { font-size: 0.82em; }
  .entry th, .entry td { padding: 0.4em 0.5em; }
  nav.tabs { gap: 0.3em; }
  nav.tabs button { padding: 0.3em 0.7em; font-size: 0.85em; }
}
</style>
</head>
<body>
<header>
  <h1>🌸 拟声拟态词辞典</h1>
  <div class="subtitle">出典：オノマトペ辞典　｜　进度 ${totalDone}/${totalAll} (${Math.round(totalDone/totalAll*100)}%)</div>
  <nav class="tabs">${tabs}</nav>
</header>
<div class="search-bar">
  <input type="text" id="searchInput" placeholder="🔎 搜索词（日文/中文意思均可）...">
  <div class="search-info" id="searchInfo"></div>
</div>
<main>
${sections}
<div class="no-match hidden" id="noMatch">😢 没有匹配的词条</div>
</main>
${mdBlocks}
<script>
// 配置 marked
marked.setOptions({ breaks: false, gfm: true });

// 渲染所有 MD
const SECTIONS = ['a', 'ka', 'sa', 'ta'];
SECTIONS.forEach(id => {
  const md = document.getElementById('md-' + id).textContent;
  const html = marked.parse(md);
  document.getElementById('section-' + id).innerHTML = html;
});

// 将每个 h3 + 后续兄弟节点直到下一个 h3/h2/hr 包装成 .entry
SECTIONS.forEach(id => {
  const sec = document.getElementById('section-' + id);
  const children = Array.from(sec.children);
  let i = 0;
  while (i < children.length) {
    const el = children[i];
    if (el.tagName === 'H3') {
      const group = [el];
      let j = i + 1;
      while (j < children.length) {
        const next = children[j];
        if (next.tagName === 'H3' || next.tagName === 'H2' || next.tagName === 'HR') break;
        group.push(next);
        j++;
      }
      const wrap = document.createElement('div');
      wrap.className = 'entry';
      el.parentNode.insertBefore(wrap, el);
      group.forEach(g => wrap.appendChild(g));
      // Also absorb trailing <hr> to keep layout clean
      if (j < children.length && children[j].tagName === 'HR') {
        children[j].remove();
        j++;
      }
      i = j;
    } else {
      i++;
    }
  }
});

// Tab 切换
document.querySelectorAll('nav.tabs button[data-target]').forEach(btn => {
  btn.addEventListener('click', () => {
    document.querySelectorAll('nav.tabs button').forEach(b => b.classList.remove('active'));
    btn.classList.add('active');
    document.querySelectorAll('.content-section').forEach(s => s.classList.remove('active'));
    document.getElementById('section-' + btn.dataset.target).classList.add('active');
    window.scrollTo({ top: 0, behavior: 'smooth' });
    document.getElementById('searchInput').value = '';
    filterEntries('');
  });
});

// 搜索
const searchInput = document.getElementById('searchInput');
const searchInfo = document.getElementById('searchInfo');
const noMatch = document.getElementById('noMatch');

function filterEntries(q) {
  q = q.trim().toLowerCase();
  const activeSection = document.querySelector('.content-section.active');
  const entries = activeSection.querySelectorAll('.entry');
  let matchCount = 0;
  entries.forEach(e => {
    if (!q) {
      e.classList.remove('hidden');
      matchCount++;
      return;
    }
    const txt = e.textContent.toLowerCase();
    if (txt.includes(q)) {
      e.classList.remove('hidden');
      matchCount++;
    } else {
      e.classList.add('hidden');
    }
  });
  if (q) {
    searchInfo.textContent = '找到 ' + matchCount + ' 条';
    noMatch.classList.toggle('hidden', matchCount > 0);
    // 同时隐藏 h2
    activeSection.querySelectorAll('h2').forEach(h => h.classList.add('hidden'));
  } else {
    searchInfo.textContent = '';
    noMatch.classList.add('hidden');
    activeSection.querySelectorAll('h2').forEach(h => h.classList.remove('hidden'));
  }
}
searchInput.addEventListener('input', () => filterEntries(searchInput.value));

// 支持 URL hash（例如 #section-ka）
if (location.hash && location.hash.startsWith('#section-')) {
  const id = location.hash.replace('#section-', '');
  const btn = document.querySelector('nav.tabs button[data-target="' + id + '"]');
  if (btn) btn.click();
}
<\/script>
</body>
</html>`;

fs.writeFileSync(path.join(ROOT, 'index.html'), html);
console.log('✅ Built: ' + path.join(ROOT, 'index.html'));
console.log('   Size: ' + (html.length/1024).toFixed(1) + ' KB');
console.log('   Entries: ' + totalDone + '/' + totalAll);
