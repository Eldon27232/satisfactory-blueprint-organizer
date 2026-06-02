# CLAUDE.md — Satisfactory Blueprint Organizer

桌面工具：把外部文件夹结构 / 游戏内分类整理成 Satisfactory 蓝图分类，草稿编辑（拖拽/改名/换图标/删除/导入压缩包），确认后写回存档。
技术栈：TypeScript + Electron + electron-vite + React + 纯 CSS（不用 Less/Tailwind）。Windows + Linux 双平台。

## 红线（最重要）
点击「应用到存档」之前，**绝不**对 游戏蓝图文件夹 / `.sav` / 外部映射文件夹 做任何写改。所有改动先暂存在草稿（内存中的 DraftTree），apply 时才写盘。脏标记、导入暂存（`.import-staging/`）都落在应用数据目录，不写存档夹。

## 开发与验证
- 改完必过：`npm run build`（= `tsc --noEmit && electron-vite build`）和 `npm test`（vitest）。两者必须通过。
- UI 微调优先让用户 `npm run dev` 热更新看，别每次重打包。
- 不引入重依赖（现有轻依赖：rcedit、electron-updater、fflate、sharp[仅 dev]）。
- 平台相关测试要条件化：Windows 专属用 `it.runIf(process.platform === 'win32')`，跨平台逻辑抽成纯函数直接喂临时目录测。

## 关键技术约束（踩过的坑，别破坏）
- **exe 图标**：`win.signAndEditExecutable:false` + `build.afterPack: scripts/afterPack.cjs`（用 rcedit 把 `build/icon.ico` 写进 exe）。别删这两个。
- **afterPack** 还负责裁剪 Chromium 多余语言包（只留 en-US/zh-CN，省 ~39MB）；rcedit 仅 win32，裁语言包 win32+linux 都做。
- **产物命名用连字符**：`artifactName` 形如 `Satisfactory-Blueprint-Organizer-Setup-${version}.${ext}`。带空格会被 GitHub 转成点号，导致 `latest.yml` 里的 url 对不上、自动更新找不到资源。
- **更新公告必须走 `latest.yml` 的 `releaseNotes`**：`build.releaseInfo.releaseNotesFile = RELEASE_NOTES.md`。否则 electron-updater 会回退去拉 GitHub atom 的 **HTML**，客户端按 Markdown 解析失败 → 公告显示成源码且中英文两段都显示。客户端 `src/shared/releaseNotes.ts` 也做了 HTML→Markdown 容错兜底。
- **图标库**：`public/blueprint-icons/` 是 WebP（PNG 降分辨率压缩，省 ~93%）；`generated.json` 的 imagePath 用 `.webp`。重新生成图标后跑 `npm run compress-icons`。
- **数据目录**：主进程启动 `process.chdir(resolveDataRoot())`（打包=exe 同级，只读则回退 userData；dev=项目根）。
- **Linux 存档定位**：Satisfactory 无原生 Linux 版，走 Steam Proton，存档在 `<Steam库>/steamapps/compatdata/526870/pfx/drive_c/users/steamuser/AppData/Local/FactoryGame/Saved/SaveGames`；探测 `~/.steam`、`~/.local/share/Steam`、Flatpak 等根 + 解析 `libraryfolders.vdf`。见 `src/core/locateSaves.ts`（按 `process.platform` 分发，Windows 逻辑不要动）。

## 发布流程（Windows 本机打包 + Linux 用 VPS 构建；不用 GitHub Actions）

> Linux 包用一台 VPS（Debian）构建：本机是 Windows，打不了 AppImage（需 Linux 工具链）。
> **VPS 连接信息在本机私有文件 `release.local.env`（已 gitignore，不入库）**，含 `VPS_HOST` / `SSH_KEY` / `VPS_REPO`。
> 本仓库是 public，切勿把真实 IP / 私钥路径写进任何被提交的文件。

1. 改 `package.json` 的 `version`。
2. 更新 `RELEASE_NOTES.md`（双语模板，会被写进 `latest.yml`/`latest-linux.yml` 供应用内公告）：
   ```
   ## 简体中文
   - ...
   ## English
   - ...
   ```
3. 本地必过：`npm run build && npm test`。
4. `git add -A && git commit`，`git tag -a vX.Y.Z -m vX.Y.Z`，`git push origin main`，`git push origin vX.Y.Z`。
5. **Windows 包（本机）**：`npx electron-builder --win --publish never`
   → 产出 `release/` 下：`*-Setup-X.Y.Z.exe`、`.exe.blockmap`、`latest.yml`（afterPack 自动嵌图标 + 裁语言包）。
6. **Linux AppImage（VPS）**：用 `release.local.env` 里的连接信息 SSH 上去构建：
   ```
   ssh -i "$SSH_KEY" "$VPS_HOST" 'cd "$VPS_REPO" && git fetch && git reset --hard origin/main && npm ci && npm run build && npm test && npx electron-builder --linux --publish never'
   scp -i "$SSH_KEY" "$VPS_HOST":"$VPS_REPO"/release/*.AppImage "$VPS_HOST":"$VPS_REPO"/release/latest-linux.yml ./release/
   ssh -i "$SSH_KEY" "$VPS_HOST" 'rm -rf "$VPS_REPO"/release'   # VPS 磁盘/内存有限，构建完删产物（保留 repo+node_modules 供下次）
   ```
   （首次用的 VPS 需先装 Node 20：`curl -fsSL https://deb.nodesource.com/setup_20.x | bash - && apt-get install -y nodejs`。）
7. **发布**：`gh release create vX.Y.Z` 上传 **5 个产物**（exe + exe.blockmap + latest.yml + AppImage + latest-linux.yml），`--notes-file RELEASE_NOTES.md`。
   三个 Windows 文件 + 两个 Linux 文件都要传，否则对应平台的自动更新会失败。
8. `gh release list` 确认该版为 `Latest`。

## 自动更新
electron-updater + `build.publish: github`。Windows 读 `latest.yml`、Linux（AppImage）读 `latest-linux.yml`。已设 `autoUpdater.disableDifferentialDownload = true`（整包下载，避免跨境差量 Range 请求拖慢）。dev 模式 electron-updater 不工作。
