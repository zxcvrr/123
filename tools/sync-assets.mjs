/* 把网页资源同步进 Android 工程的 assets/www。
 *
 * 网页代码只有一份真源（本目录），Android 侧是拷贝 —— 改了 index.html / app.js / styles.css
 * 之后必须重新跑一次这个脚本，否则打进 APK 的还是旧页面。
 *
 * 用法：node tools/sync-assets.mjs
 */
import fs from 'node:fs';
import path from 'node:path';

const ROOT = path.resolve(import.meta.dirname, '..');
const DEST = path.join(ROOT, 'android', 'app', 'src', 'main', 'assets', 'www');
const ITEMS = ['index.html', 'styles.css', 'app.js', 'manifest.webmanifest', 'sw.js', 'icons'];

let copied = 0;
const walk = (src, dst) => {
  fs.mkdirSync(dst, { recursive: true });
  for (const entry of fs.readdirSync(src, { withFileTypes: true })) {
    const from = path.join(src, entry.name);
    const to = path.join(dst, entry.name);
    if (entry.isDirectory()) walk(from, to);
    else {
      fs.copyFileSync(from, to);
      copied++;
    }
  }
};

fs.rmSync(DEST, { recursive: true, force: true });
for (const item of ITEMS) {
  const from = path.join(ROOT, item);
  if (!fs.existsSync(from)) {
    console.error(`缺少资源：${item}`);
    process.exit(1);
  }
  const stat = fs.statSync(from);
  if (stat.isDirectory()) walk(from, path.join(DEST, item));
  else {
    fs.mkdirSync(DEST, { recursive: true });
    fs.copyFileSync(from, path.join(DEST, item));
    copied++;
  }
}
console.log(`已同步 ${copied} 个文件 → ${path.relative(ROOT, DEST)}`);
