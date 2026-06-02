import { promises as fs } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import sharp from 'sharp';

// 一次性图标库压缩：把 public/blueprint-icons 下的 PNG（多为 512×512 RGBA，UI 实际只显示 ≤64px）
// 降分辨率到 ≤192（只缩不放）并转成 WebP（保留透明），同步把 generated.json 里的 .png 引用改成 .webp。
// 体积从 ~81MB 降到个位数 MB，UI 视觉无损（192 足够覆盖到 3x 高分屏）。
// 运行：npm run compress-icons

const MAX_SIZE = 192;
const QUALITY = 82;

const projectRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const iconsDir = path.join(projectRoot, 'public', 'blueprint-icons');
const generatedJson = path.join(projectRoot, 'src', 'shared', 'blueprintIconLibrary.generated.json');

async function main(): Promise<void> {
  const files = (await fs.readdir(iconsDir)).filter((f) => f.toLowerCase().endsWith('.png'));
  let before = 0;
  let after = 0;
  let done = 0;

  for (const file of files) {
    const pngPath = path.join(iconsDir, file);
    const webpPath = path.join(iconsDir, `${path.basename(file, '.png')}.webp`);
    const original = await fs.readFile(pngPath);
    before += original.length;

    const webp = await sharp(original)
      .resize(MAX_SIZE, MAX_SIZE, { fit: 'inside', withoutEnlargement: true })
      .webp({ quality: QUALITY, alphaQuality: 90, effort: 6 })
      .toBuffer();

    await fs.writeFile(webpPath, webp);
    await fs.unlink(pngPath);
    after += webp.length;
    done += 1;
    if (done % 100 === 0) console.log(`  ${done}/${files.length} ...`);
  }

  // 同步 generated.json：只替换 /blueprint-icons/<数字>.png（placeholder 的 .svg 不受影响）。
  const json = await fs.readFile(generatedJson, 'utf8');
  const updated = json.replace(/(\/blueprint-icons\/\d+)\.png/g, '$1.webp');
  await fs.writeFile(generatedJson, updated);

  const mb = (n: number): string => (n / 1048576).toFixed(1);
  console.log(`完成：${done} 张 PNG -> WebP`);
  console.log(`体积：${mb(before)}MB -> ${mb(after)}MB（省 ${(100 - (after / before) * 100).toFixed(0)}%）`);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
