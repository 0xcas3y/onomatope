# 🌸 オノマトペ速记

日本語拟声拟态词（オノマトペ）卡片速记工具。共 **303 个词**，按五十音「行」分类，每张卡片配漫画截图 + 日语原声 + 中文解说。

## 📱 使用方式

浏览器打开 `cards/index.html`（需要通过 HTTP 服务器，不要直接 `file://`）：

```bash
cd cards
python3 -m http.server 8000
# 然后访问 http://localhost:8000/
```

## 🎮 卡片操作

| 手势 | 作用 |
|---|---|
| 单击 | 🔊 播放 Immersion Kit 音频（无则用浏览器 TTS） |
| 双击 | 翻面看详细解说 |
| 上滑 / ↑ | 标记「不熟」并前进 |
| 下滑 / ↓ | 标记「已会」并前进 |
| 左/右滑 · ←/→ | 上一张 / 下一张 |
| Enter / f | 翻面 |

## 📄 卡片内容

**正面**：
- 词（大字）
- 漫画截图（来自 Immersion Kit）
- 日语例句 + 中文翻译
- 音频标记 🔊

**背面**：
- 词义
- 用法核心
- 近义区别（一句话对比）
- 常用搭配
- 漫画例句（最多 2 条，与正面去重）

## 🗂 项目结构

```
cards/
├── index.html       # 主入口：行选择
├── viewer.html      # 卡片查看器
├── app.js           # 卡片逻辑
├── styles.css       # 样式（漫画风）
├── build-cards.js   # 从 MD 解析生成 JSON
├── remaining-cards.js  # 剩余词的数据
├── fetch-media.js   # 用 Chrome 抓取 IK 图片/音频
├── data/
│   └── cards.json   # 所有卡片数据
└── media/           # 本地保存的图片/音频
    └── <id>/
        ├── 0.jpg
        └── 0.mp3

01_a-gyou.md         # あ行 详细解说（MD）
02_ka-gyou.md        # か行
03_sa-gyou.md        # さ行
04_ta-gyou.md        # た行
```

## 🔧 重新生成数据

从 MD 文件重建卡片 JSON：

```bash
cd cards
node build-cards.js          # 从 MD 解析词条
node remaining-cards.js      # 追加剩余词
node fetch-media.js          # 抓取图片+音频（需 Chrome）
```

## 📦 依赖

- Node.js 18+
- `puppeteer-core` → 通过系统 Chrome 抓取媒体（不下载额外 Chromium）
- Google Chrome.app

## 🙏 致谢

所有漫画截图与音频来自 [Immersion Kit](https://www.immersionkit.com/) ——一个把动画字幕与对应画面/音频做成可搜索字典的项目。
