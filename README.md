# ExamHub — MealNow 面试背题

把《MealNow面试题库（整合版）.docx》里的 **全部内容**（571 道正式题 + 37 张阅读卡，共 608 张卡片）
做成了一个类似"背单词软件"的本地背题网站：SM-2 间隔重复算法（Anki 同源），
纯静态、零依赖、数据不出本机。已接入 PWA，可作为独立应用安装到桌面或手机，断网也能刷题。

## 怎么用

**方式一（推荐）**：双击 `index.html`，用浏览器（Chrome / Edge）打开即可。

**方式二**：双击 `start.bat`（需要本机装了 Python），会启动本地服务并自动打开
http://127.0.0.1:8686/

- 学习进度自动保存在本机浏览器的 localStorage 里，换浏览器 / 换电脑前，
  先到「我的 → 导出进度」备份成 JSON 文件，在新环境「导入进度」即可无缝继续。
- 手机想用的话：电脑和手机连同一 WiFi，用方式二启动后，手机浏览器访问
  `http://<电脑局域网IP>:8686`（注意 Windows 防火墙放行）。

## 安装为应用（PWA）

先按上面的「部署到 GitHub Pages」把站点挂到 https（PWA 要求 https 或 `127.0.0.1`），然后：

| 平台 | 操作 |
|------|------|
| Chrome / Edge（桌面） | 地址栏右侧的安装图标，或「我的 → 安装为应用 → 安装 ExamHub」 |
| Android Chrome | 右上角菜单 →「安装应用 / 添加到主屏幕」 |
| iPhone / iPad | Safari →「分享」→「添加到主屏幕」（iOS 不支持 `beforeinstallprompt`，只能走菜单） |

安装后以独立窗口（`display: standalone`）启动，有自己的图标与任务栏项；首次联网打开后
Service Worker 会把整站（含约 1 MB 题库）预缓存到本地，之后断网照样能背题，进度仍只存本机。

> 双击 `index.html` 以 `file://` 方式打开时不能安装（浏览器限制），但页面功能不受影响。


## 功能

| 模块 | 说明 |
|------|------|
| 📅 今日计划 | 到期复习 + 每日新题（默认 20 张/天，可调）。评分：😵忘了 / 🤔模糊 / 🙂记得 / 😎简单，按遗忘曲线自动安排下次复习 |
| 🎯 自由刷题 | 任选一个分类（或全部）顺序/随机刷，不受每日计划限制 |
| ⭐ 收藏夹 | 卡片右上角 ☆ 收藏，可单独成队背诵 |
| 📚 题库 | 全部 608 张卡片浏览 + 全文搜索（标题/题号/正文/来源），点击看详情，可重置单卡进度、手动标记掌握 |
| 📊 统计 | 已掌握数、连续打卡、未来 7 天复习量预测、分类掌握度、近 30 天学习热力图 |
| ⚙️ 我的 | 每日新题数、新题顺序、主题（浅/深/跟随系统）、来源显隐、进度导出/导入/清空 |
| 📲 安装为应用 | 一键触发浏览器安装（PWA），独立窗口启动，Service Worker 预缓存全站供离线使用 |

**键盘快捷键**（学习页）：`空格` 翻面 · `1/2/3/4` 评分 · `S` 收藏 · `Esc` 关闭弹层。

## 算法（SM-2，与 Anki 同源）

- 新题/忘了 → 10 分钟后再来；学习中答对 → 明天再见，然后毕业进入长期复习。
- 复习按卡片难易度（EF 因子 1.3~3.2）拉伸间隔：记得 ≈ 间隔×EF，简单再 ×1.35，
  模糊只 ×1.2，忘了间隔打 4 折重学。
- 间隔 ≥ 21 天自动记为"已掌握"。

## 目录结构

```
├── index.html              # 网站（双击打开）
├── manifest.webmanifest    # PWA 清单：应用名 ExamHub、图标、standalone 启动
├── sw.js                   # Service Worker：预缓存全站 + 离线回落（改文件后记得改 VERSION）
├── css/style.css           # 样式（浅色/深色主题）
├── js/app.js               # 界面逻辑（含 SW 注册与安装引导）
├── js/srs.js               # SM-2 间隔重复引擎 + 进度存储
├── js/marked.min.js        # Markdown 渲染库（MIT，本地化）
├── data/questions.js       # 题库数据（由 docx 生成，608 张卡片）
├── icons/                  # 应用图标（192/512、maskable、apple-touch、favicon）
├── IMG_20260130_191935.jpg # 图标源图
├── tools/make_icons.py     # 由源图生成全套图标（需 Pillow）
├── tools/build_bank.py     # docx → 题库 解析脚本（含行级覆盖校验）
├── tools/verify_bank.py    # 独立校验脚本：原文每行都在题库里
├── start.bat               # 本地服务一键启动（可选）
├── MealNow面试题库（整合版）.docx   # 原始文档（未改动）
├── .gitignore              # 忽略 _work/ 提取产物、Python 缓存、系统临时文件
├── .gitattributes          # 换行规则（.bat 保持 CRLF）与二进制文件声明
├── .editorconfig           # 统一 UTF-8 / LF / 缩进
├── .nojekyll               # 让 GitHub Pages 跳过 Jekyll 处理
└── LICENSE                 # MIT（仅覆盖代码，题库内容版权归原作者）
```

## 内容完整性保证

网站题库由文档**逐行切片**生成，不做任何删改：

- 解析器按标题边界切卡片，每张卡片 = 原文精确行区间；
- `tools/build_bank.py` 内置"行覆盖校验"：文档 21332 行中所有非标题行
  必须被某张卡片覆盖，否则构建失败；
- `tools/verify_bank.py` 独立二次校验：原文 13716 个非空行逐一反查题库，
  全部命中（标题→标题字段、来源→src 字段、附录A分组→grp 字段、正文→body 字段）。

最终入库：**正式题 528 道（C00~C18 各章，与章节标题标注的数量逐一相符）
+ 附录 A 项目深挖题 43 道 = 571 道；另有第 0 章项目介绍、附录 B/C/D、
文档目录等阅读卡 37 张，合计 608 张。**

## 重建题库（可选）

改了 docx 或想重新生成时：

```bash
python tools/build_bank.py     # 需要已安装 pandoc；会自动重新提取并校验
python tools/verify_bank.py    # 独立复核
```

中间产物落在 `_work/`（已在 `.gitignore` 中忽略），脚本需在项目根目录执行。

## 部署到 GitHub Pages

纯静态站点，无构建步骤，推送到 GitHub 后：

1. 仓库 **Settings → Pages**；
2. **Source** 选 `Deploy from a branch`，分支选 `main`，目录选 `/ (root)`；
3. 保存后等一分钟，访问 `https://<用户名>.github.io/<仓库名>/`。

`.nojekyll` 已就位，Jekyll 不会改写或忽略任何资源；`data/questions.js`（约 1 MB）
是普通静态文件，不触及 Pages 的体积限制。学习进度仍只存在访问者本机 localStorage。

部署到 https 后即可在浏览器里「安装为应用」。缓存注意两点：

- **改站点文件时必须同步改 `sw.js` 顶部的 `VERSION`**，否则老访客一直用旧缓存；
- 更新策略是「有缓存先给缓存、后台拉新」，所以新版本在访客**第二次打开**时生效；
  调试时可在 DevTools → Application → Service Workers 里勾 Bypass for network 或 Unregister。

## 重建图标（可选）

```bash
python tools/make_icons.py     # 需要 Pillow，仅此脚本依赖
```

从 `IMG_20260130_191935.jpg` 生成 `icons/` 下全套图标：192/512 普通图标、maskable
（裁到中心 80% 再放大填满，保证任意遮罩下人物都在安全区）、180 的 apple-touch-icon
与 32 的 favicon。换源图后重跑一次即可。

## 许可

代码部分为 MIT（见 `LICENSE`）；题库内容版权归原文档作者，仅随仓库作为可复现的示例数据提供。
`js/marked.min.js` 为第三方 MIT 库。
