// 拟声拟态词卡片 viewer
const COLORS = ['pink', 'coral', 'teal', 'green', 'blue', 'purple'];

// URL 参数
const urlParams = new URLSearchParams(location.search);
const GYOU = urlParams.get('gyou') || 'a';
const GYOU_JP = { a: 'あ', ka: 'か', sa: 'さ', ta: 'た', na: 'な', ha: 'は', ma: 'ま', ya: 'や', ra: 'ら', wa: 'わ' }[GYOU] || 'あ';
const STORAGE_PREFIX = `onomatope:${GYOU}:`;

// 数据层
const DataStore = {
  cards: [],
  async load() {
    const res = await fetch('data/cards.json');
    if (!res.ok) throw new Error('加载 cards.json 失败');
    const data = await res.json();
    this.cards = data.cards.filter(c => c.gyou === GYOU_JP);
    return this.cards;
  }
};

// 进度持久化
const Progress = {
  _progress: {},
  _lastIdx: 0,
  load() {
    try {
      const p = localStorage.getItem(STORAGE_PREFIX + 'progress');
      if (p) this._progress = JSON.parse(p);
      const i = localStorage.getItem(STORAGE_PREFIX + 'lastIdx');
      if (i) this._lastIdx = parseInt(i, 10) || 0;
    } catch {}
  },
  save() {
    try {
      localStorage.setItem(STORAGE_PREFIX + 'progress', JSON.stringify(this._progress));
      localStorage.setItem(STORAGE_PREFIX + 'lastIdx', String(this._lastIdx));
    } catch {}
  },
  mark(id, status) {
    this._progress[id] = { status, t: Date.now() };
    this.save();
  },
  getStatus(id) { return this._progress[id]?.status || null; },
  setLastIdx(i) { this._lastIdx = i; this.save(); },
  getLastIdx() { return this._lastIdx; },
  stats() {
    const s = { known: 0, unknown: 0 };
    for (const k in this._progress) {
      if (this._progress[k].status === 'known') s.known++;
      else if (this._progress[k].status === 'unknown') s.unknown++;
    }
    return s;
  }
};

// TTS
const TTS = {
  _voice: null,
  init() {
    const pick = () => {
      const voices = speechSynthesis.getVoices();
      this._voice = voices.find(v => v.lang.startsWith('ja')) || null;
    };
    pick();
    if ('speechSynthesis' in window) {
      speechSynthesis.addEventListener('voiceschanged', pick);
    }
  },
  speak(text, rate = 0.9) {
    if (!('speechSynthesis' in window)) return;
    speechSynthesis.cancel();
    const u = new SpeechSynthesisUtterance(text);
    u.lang = 'ja-JP';
    if (this._voice) u.voice = this._voice;
    u.rate = rate;
    speechSynthesis.speak(u);
  },
  cancel() {
    if ('speechSynthesis' in window) speechSynthesis.cancel();
  }
};

// 手势
const Gestures = {
  attach(el, { onTap, onDoubleTap, onSwipe }) {
    let tapTimer = null;
    let touchStart = null;
    const clearTap = () => { if (tapTimer) { clearTimeout(tapTimer); tapTimer = null; } };

    el.addEventListener('pointerdown', (e) => {
      if (e.target.closest('.sentence-row')) { touchStart = null; return; }
      touchStart = { x: e.clientX, y: e.clientY, t: performance.now() };
    });
    el.addEventListener('pointercancel', () => { touchStart = null; clearTap(); });
    el.addEventListener('pointerup', (e) => {
      if (e.target.closest('.sentence-row')) { touchStart = null; clearTap(); return; }
      if (!touchStart) return;
      const dx = e.clientX - touchStart.x;
      const dy = e.clientY - touchStart.y;
      const dt = performance.now() - touchStart.t;
      const speed = Math.hypot(dx, dy) / dt;

      if (Math.abs(dy) > 40 && Math.abs(dy) > Math.abs(dx) * 1.5 && speed > 0.3) {
        clearTap();
        onSwipe?.(dy < 0 ? 'up' : 'down');
        touchStart = null;
        return;
      }
      if (Math.abs(dx) > 40 && Math.abs(dx) > Math.abs(dy) * 1.5 && speed > 0.3) {
        clearTap();
        onSwipe?.(dx < 0 ? 'left' : 'right');
        touchStart = null;
        return;
      }
      if (Math.hypot(dx, dy) < 10) {
        if (tapTimer) {
          clearTap();
          onDoubleTap?.(e);
        } else {
          tapTimer = setTimeout(() => {
            tapTimer = null;
            onTap?.(e);
          }, 200);
        }
      }
      touchStart = null;
    });
  }
};

// 卡片渲染
const CardView = {
  colorOf(card) {
    return COLORS[(card.id - 1) % COLORS.length];
  },
  renderFront(card) {
    const color = this.colorOf(card);
    const el = document.createElement('div');
    el.className = `flash-card color-${color} enter`;
    const firstEx = (card.examples && card.examples[0]) || null;
    const hasImg = firstEx && firstEx.image;
    const hasAudio = firstEx && firstEx.audio;
    const srcLabel = firstEx ? escapeHTML(firstEx.source) : '';
    el.innerHTML = `
      <div class="card-id"><span class="gyou">${card.gyou}</span>${card.id}</div>
      <div class="front-top">
        <div class="front-word" data-len="${[...card.word].length}">${card.word}</div>
      </div>
      ${hasImg ? `<div class="front-image"><img src="${firstEx.image}" alt=""></div>` : '<div class="front-image-placeholder">（图片未加载）</div>'}
      ${firstEx ? `
        <div class="front-sentence">
          <div class="front-jp">${escapeHTML(firstEx.jp)}${hasAudio ? ' <span class="audio-badge">🔊</span>' : ''}</div>
        </div>` : ''}
      ${hasAudio ? `<audio class="front-audio" preload="auto" src="${firstEx.audio}"></audio>` : ''}
      <div class="hint-bottom">单击播放 · 双击翻面 · ↑难 ↓易</div>
    `;
    return el;
  },
  renderBack(card) {
    const color = this.colorOf(card);
    const el = document.createElement('div');
    el.className = `flash-card back color-${color} enter`;

    const meaningsHTML = card.meanings.length
      ? card.meanings.map((m, i) => {
          const num = card.meanings.length > 1 ? `<span class="num">${['①','②','③','④'][i] || '·'}</span>` : '';
          return `<div class="meaning-item">${num}${escapeHTML(m)}</div>`;
        }).join('')
      : '<div class="meaning-item">(无词义)</div>';

    // 拆分 mnemonic
    const parts = (card.mnemonic || '').split('🔍 近义区别：');
    const core = parts[0].trim();
    const syn = parts[1]?.trim() || '';

    // 背面例句：除去与正面相同的那句（通常是 examples[0]），最多保留 2 条
    const frontJp = (card.examples[0] && card.examples[0].jp) || '';
    const backExamples = card.examples.filter(ex => ex.jp !== frontJp).slice(0, 2);
    const examplesHTML = backExamples.length
      ? backExamples.map((ex, i) => `
          <div class="sentence-row" data-ex-index="${card.examples.indexOf(ex)}">
            <div class="jp">${escapeHTML(ex.jp)}</div>
            <div class="cn">${escapeHTML(ex.cn)}</div>
          </div>
        `).join('')
      : '<div class="sentence-row"><div class="cn" style="opacity:0.5;">（正面已展示例句）</div></div>';

    el.innerHTML = `
      <div class="card-id"><span class="gyou">${card.gyou}</span>${card.id}</div>
      <div class="back-head">${card.word}</div>
      <div class="back-kana">副詞</div>

      <div class="section">
        <div class="section-title">词 义</div>
        <div class="section-body">${meaningsHTML}</div>
      </div>

      ${core ? `
      <div class="section">
        <div class="section-title">用法核心</div>
        <div class="section-body">${escapeHTML(core)}</div>
      </div>` : ''}

      ${syn ? `
      <div class="section">
        <div class="section-title">近义区别</div>
        <div class="synonym-box">${escapeHTML(syn)}</div>
      </div>` : ''}

      ${card.collocations ? `
      <div class="section">
        <div class="section-title">常用搭配</div>
        <div class="collocations">${escapeHTML(card.collocations)}</div>
      </div>` : ''}

      <div class="section">
        <div class="section-title">漫画例句</div>
        <div class="section-body">${examplesHTML}</div>
      </div>

      <div class="ik-link-wrap">
        <a class="ik-link" href="https://www.immersionkit.com/dictionary?keyword=${encodeURIComponent(card.word)}&exact=true" target="_blank" rel="noopener">🔗 在 Immersion Kit 查看更多例句</a>
      </div>
    `;
    return el;
  }
};

function escapeHTML(s) {
  return String(s)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');
}

// 主路由/状态机
const Router = {
  currentIndex: 0,
  isBack: false,
  cards: [],

  init(cards) {
    this.cards = cards;
    this.currentIndex = Math.min(Progress.getLastIdx() || 0, cards.length - 1);
    this.render();
  },

  next() {
    if (this.currentIndex < this.cards.length - 1) {
      this.currentIndex++;
      this.isBack = false;
      Progress.setLastIdx(this.currentIndex);
      this.render();
    } else {
      // 结束提示
      this.showComplete();
    }
  },

  prev() {
    if (this.currentIndex > 0) {
      this.currentIndex--;
      this.isBack = false;
      Progress.setLastIdx(this.currentIndex);
      this.render();
    }
  },

  flip() {
    this.isBack = !this.isBack;
    this.render();
  },

  render() {
    const stage = document.getElementById('cardstage');
    stage.innerHTML = '';
    if (!this.cards.length) {
      stage.innerHTML = '<div style="text-align:center;padding:40px;opacity:0.6;">暂无卡片</div>';
      return;
    }
    const card = this.cards[this.currentIndex];
    const el = this.isBack ? CardView.renderBack(card) : CardView.renderFront(card);
    stage.appendChild(el);

    Gestures.attach(el, {
      onTap: () => {
        const word = el.querySelector('.front-word');
        if (word) word.classList.add('pulse');
        setTimeout(() => word?.classList.remove('pulse'), 350);
        const audio = el.querySelector('audio.front-audio');
        if (audio) {
          audio.currentTime = 0;
          audio.play().catch(() => TTS.speak(card.word));
        } else {
          TTS.speak(card.word);
        }
      },
      onDoubleTap: () => this.flip(),
      onSwipe: (dir) => {
        if (dir === 'up') {
          Progress.mark(card.id, 'unknown');
          this.next();
        } else if (dir === 'down') {
          Progress.mark(card.id, 'known');
          this.next();
        } else if (dir === 'left') {
          this.next();
        } else if (dir === 'right') {
          this.prev();
        }
      }
    });

    // 例句不朗读（背面只展示）

    TopBar.render();
  },

  showComplete() {
    const stage = document.getElementById('cardstage');
    const s = Progress.stats();
    stage.innerHTML = `
      <div style="text-align:center;padding:40px;">
        <div style="font-size:48px;margin-bottom:16px;">🎉</div>
        <div style="font-size:22px;font-weight:600;margin-bottom:8px;">${GYOU_JP}行 刷完啦！</div>
        <div style="opacity:0.7;font-size:14px;margin-bottom:20px;">
          已掌握 ${s.known} · 需复习 ${s.unknown}
        </div>
        <button onclick="Router.currentIndex=0; Router.isBack=false; Progress.setLastIdx(0); Router.render();"
          style="background:#4FA896;color:#fff;border:none;padding:10px 22px;border-radius:8px;font-size:14px;cursor:pointer;">
          🔄 重新开始
        </button>
      </div>
    `;
    TopBar.render();
  }
};

// 顶栏
const TopBar = {
  render() {
    const bar = document.getElementById('topbar');
    const total = Router.cards.length;
    const idx = Router.currentIndex + 1;
    const s = Progress.stats();
    bar.innerHTML = `
      <a class="topbar-left" href="index.html">← ${GYOU_JP}行</a>
      <span class="topbar-center">${idx} / ${total} · 已会 <span style="color:#7FD1B8">${s.known}</span> · 待复习 <span style="color:#E89B7A">${s.unknown}</span></span>
      <div class="topbar-right">
        <button id="btn-prev" aria-label="上一张">‹</button>
        <button id="btn-flip" aria-label="翻面">翻</button>
        <button id="btn-next" aria-label="下一张">›</button>
      </div>
    `;
    document.getElementById('btn-prev').onclick = () => Router.prev();
    document.getElementById('btn-flip').onclick = () => Router.flip();
    document.getElementById('btn-next').onclick = () => Router.next();
  }
};

// 启动
(async () => {
  Progress.load();
  TTS.init();
  try {
    const cards = await DataStore.load();
    if (!cards.length) {
      document.getElementById('cardstage').innerHTML = `<div style="text-align:center;opacity:0.6;padding:40px;">此行暂无数据</div>`;
      return;
    }
    Router.init(cards);
  } catch (err) {
    document.getElementById('cardstage').innerHTML = `<div style="text-align:center;color:#ff6b6b;padding:40px;">❌ 加载失败：${err.message}</div>`;
  }
})();

// 键盘导航（方便桌面测试）
document.addEventListener('keydown', (e) => {
  if (e.key === 'ArrowRight' || e.key === ' ') Router.next();
  else if (e.key === 'ArrowLeft') Router.prev();
  else if (e.key === 'ArrowUp') { Progress.mark(Router.cards[Router.currentIndex].id, 'unknown'); Router.next(); }
  else if (e.key === 'ArrowDown') { Progress.mark(Router.cards[Router.currentIndex].id, 'known'); Router.next(); }
  else if (e.key === 'Enter' || e.key === 'f') Router.flip();
});
