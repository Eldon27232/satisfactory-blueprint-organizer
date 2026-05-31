# Satisfactory Blueprint Classifier · 幸福工厂蓝图整理器

[English](#english) | [简体中文](#简体中文)

A Windows desktop tool that organizes your Satisfactory blueprints into in-game categories / subcategories with a visual, draft-based editor — drag, rename, re-icon, then write the changes back into the save (with automatic backup and re-read verification). The game's blueprint folder stays flat; only the in-save category metadata changes.

一个 Windows 桌面工具，用可视化的「草稿」编辑器把幸福工厂（Satisfactory）的蓝图整理进游戏内的分类 / 子分类——拖拽、改名、换图标，确认后再写回存档（写前自动备份、写后重读校验）。游戏的蓝图文件目录保持平铺，只修改存档内的分类元数据。

---

## English

### Features

- **Auto-locate saves** — finds `%LOCALAPPDATA%\FactoryGame\Saved\SaveGames`, lists users / game accounts / saves in cascading dropdowns. Steam account folders are resolved to persona names (best-effort, online).
- **Visual blueprint manager** — a draft workspace: create categories / subcategories, drag blueprints between them, rename, set icons, copy / cut / paste, delete to a recycle bin. Nothing touches the save until you apply.
- **External mapping import** — map an external folder tree onto the in-game categories.
- **Safe apply** — before writing, the save and the entire blueprint folder are backed up to `Backups/`; after writing, the save is re-read and verified.
- **Backups & rollback** — list backups and roll back to any of them.
- **Player-state repair** — clean up stale player-state references.
- **Bilingual UI** — English / 简体中文, switchable at runtime.
- **Diagnostics** — CLI scripts to dump and diff save structures.

### Requirements

- Windows
- Node.js 18+ and npm
- Satisfactory installed with at least one save

### Commands

```powershell
npm install
npm run dev     # run in development
npm run build   # type-check + build
npm run dist    # package to release/win-unpacked
npm test        # run unit tests (vitest)
```

`npm run dist` produces `release/win-unpacked/Satisfactory Blueprint Classifier.exe`.
`npm run dist:nsis` builds an NSIS installer (may need Windows symlink permission, since electron-builder downloads a resource-edit helper).

### Save discovery

Pick the game blueprint folder, e.g.:

```text
...\FactoryGame\Saved\SaveGames\blueprints\<SessionName>
```

The app derives `SaveGames`, lists account / user directories under it, and scans the selected account for `.sav` files (one level deep by default, prioritizing files named `<SessionName>_*.sav`).

### Diagnostics

```powershell
npm run dump-save -- "C:\path\Save.sav"
npm run scan-blueprint-structure -- "C:\path\Save.sav"
npm run diff-save-blueprint-category -- "C:\path\before.sav" "C:\path\after.sav"
```

### Tech stack

TypeScript · Electron · electron-vite · React · plain CSS. Save parsing via [`@etothepii/satisfactory-file-parser`](https://github.com/etothepii4/satisfactory-file-parser). The mac-style title bar is adapted from [`guasam/electron-window`](https://github.com/guasam/electron-window).

### ⚠️ Back up your saves

This tool rewrites `.sav` files. It backs up automatically before every apply, but **always keep your own copy of important saves**, and close the game and any dedicated server before applying.

---

## 简体中文

### 功能

- **自动定位存档** —— 自动找到 `%LOCALAPPDATA%\FactoryGame\Saved\SaveGames`，用级联下拉列出用户 / 游戏账户 / 存档；Steam 账户文件夹会尽力联网解析成昵称。
- **可视化蓝图管理器** —— 草稿工作区：新建分类 / 子分类，在它们之间拖拽蓝图，改名、设图标、复制 / 剪切 / 粘贴、删除到回收站。应用之前不会改动存档。
- **外部映射导入** —— 把一个外部文件夹结构映射到游戏内分类。
- **安全写入** —— 写入前会把存档和整个蓝图目录备份到 `Backups/`；写入后重读存档并校验。
- **备份与回滚** —— 列出历史备份并回滚到任意一个。
- **玩家状态修复** —— 清理失效的玩家状态引用。
- **双语界面** —— 中文 / English，运行时切换。
- **诊断工具** —— 命令行脚本，导出和对比存档结构。

### 环境要求

- Windows
- Node.js 18+ 与 npm
- 已安装幸福工厂且至少有一个存档

### 命令

```powershell
npm install
npm run dev     # 开发模式运行
npm run build   # 类型检查 + 构建
npm run dist    # 打包到 release/win-unpacked
npm test        # 运行单元测试（vitest）
```

`npm run dist` 生成 `release/win-unpacked/Satisfactory Blueprint Classifier.exe`。
`npm run dist:nsis` 生成 NSIS 安装包（可能需要 Windows 符号链接权限，因为 electron-builder 会下载资源编辑辅助工具）。

### 存档定位

选择游戏蓝图目录，例如：

```text
...\FactoryGame\Saved\SaveGames\blueprints\<SessionName>
```

应用会据此推导出 `SaveGames`，列出其下的账户 / 用户目录，并在所选账户里扫描 `.sav` 文件（默认只扫一层，优先匹配 `<SessionName>_*.sav`）。

### 诊断

```powershell
npm run dump-save -- "C:\path\Save.sav"
npm run scan-blueprint-structure -- "C:\path\Save.sav"
npm run diff-save-blueprint-category -- "C:\path\before.sav" "C:\path\after.sav"
```

### 技术栈

TypeScript · Electron · electron-vite · React · 纯 CSS。存档解析使用 [`@etothepii/satisfactory-file-parser`](https://github.com/etothepii4/satisfactory-file-parser)。mac 风格标题栏改编自 [`guasam/electron-window`](https://github.com/guasam/electron-window)。

### ⚠️ 请备份存档

本工具会重写 `.sav` 文件。每次应用前都会自动备份，但**请务必自行保留重要存档的副本**，并在应用前关闭游戏和专用服务器。

---

## License / 许可证

See [LICENSE](LICENSE). The blueprint icons under `public/blueprint-icons/` are game assets from Satisfactory (© Coffee Stain Studios) and are **not** covered by this project's license.

见 [LICENSE](LICENSE)。`public/blueprint-icons/` 下的蓝图图标是幸福工厂的游戏素材（© Coffee Stain Studios），**不**在本项目许可证范围内。
