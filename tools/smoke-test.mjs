/* 冒烟测试：不依赖浏览器，检查语法之外的资源引用与纯函数行为。
 * 用法：node tools/smoke-test.mjs
 */
import fs from 'node:fs';
import path from 'node:path';

const ROOT = path.resolve(import.meta.dirname, '..');
let fail = 0;
const ok = (cond, msg) => {
  console.log((cond ? '  PASS  ' : '  FAIL  ') + msg);
  if (!cond) fail++;
};
const read = (p) => fs.readFileSync(path.join(ROOT, p), 'utf8');
const exists = (p) => fs.existsSync(path.join(ROOT, p));

/* 1. manifest */
const mf = JSON.parse(read('manifest.webmanifest'));
ok(!!mf.name && mf.start_url === './' && mf.display === 'standalone', 'manifest 基本字段');
ok(Array.isArray(mf.icons) && mf.icons.length === 3, 'manifest 图标条目 = ' + mf.icons.length);
for (const i of mf.icons) ok(exists(i.src.replace('./', '')), '图标存在: ' + i.src);

/* 2. index.html 的本地引用都存在 */
const html = read('index.html');
const refs = [...html.matchAll(/(?:src|href)="\.\/([^"]+)"/g)].map((m) => m[1]);
ok(refs.length >= 5, 'index.html 本地引用数量 = ' + refs.length);
for (const r of refs) ok(exists(r), '引用存在: ' + r);

/* 3. sw.js 预缓存清单都存在 */
const sw = read('sw.js');
const assets = [...sw.matchAll(/'\.\/([^']*)'/g)].map((m) => m[1]).filter(Boolean);
ok(assets.length >= 6, 'sw.js 预缓存条目 = ' + assets.length);
for (const a of assets) ok(exists(a), '预缓存存在: ' + a);

/* 4. 抽出 app.js 里的纯函数做真实用例 */
const src = read('app.js');
const start = src.indexOf('function escapeHtml');
const end = src.indexOf('function renderAll');
ok(start > 0 && end > start, '成功切出纯函数区段');
const M = new Function(
  src.slice(start, end) + '; return { renderMarkdown, escapeHtml, fmtTokens };'
)();
const md = M.renderMarkdown;

ok(md('**粗** 与 `x`').includes('<strong>粗</strong>'), '粗体');
ok(md('`x`').includes('<code>x</code>'), '行内代码');
ok(md('```js\nconst a = 1;\n```').includes('class="codeblock"'), '围栏代码块');
ok(md('```js\nlet a = 1;').includes('class="codeblock"'), '流式未闭合围栏也能渲染');
ok(md('- a\n- b').includes('<li>a</li>'), '无序列表');
ok(md('1. a\n2. b').includes('<ol>'), '有序列表');
ok(md('# 标题').includes('<h2>'), '标题降级为 h2');
ok(md('> 引用').includes('<blockquote>'), '引用');
ok(md('---').includes('<hr>'), '分隔线');
ok(md('a\nb').includes('a<br>b'), '段落内换行');

ok(!md('<img src=x onerror=alert(1)>').includes('<img'), 'HTML 注入被转义');
ok(!/href="javascript/i.test(md('[点我](javascript:alert(1))')), 'javascript: 伪协议被挡');
ok(
  md('[ok](https://a.com/?x=1&y=2)').includes('href="https://a.com/?x=1&amp;y=2"'),
  '正常链接保留且 & 正确转义'
);
ok(M.escapeHtml('"\'&<>') === '&quot;&#39;&amp;&lt;&gt;', 'escapeHtml 覆盖全部危险字符');
ok(M.fmtTokens(1500) === '1.5k' && M.fmtTokens(999) === '999', 'token 数格式化');

/* 5. Key 不得出现在任何交付文件里 */
const FILES = ['index.html', 'app.js', 'styles.css', 'sw.js', 'manifest.webmanifest', 'README.md',
  'tools/make-icons.py'];
for (const f of FILES) ok(!/sk-[A-Za-z0-9]{16,}/.test(read(f)), '未硬编码 API Key: ' + f);

/* 6. 回归：设置对象带着 apiKey，落盘时必须先剥离 */
ok(!/writeJSON\(LS\.settings,\s*settings\)/.test(src), '设置落盘不包含 apiKey（回归）');
ok(/const \{ apiKey, \.\.\.rest \} = settings/.test(src), 'saveSettings 先剥离 apiKey');

console.log(fail === 0 ? '\n全部通过 ✅' : '\n失败 ' + fail + ' 项 ❌');
process.exitCode = fail ? 1 : 0;
