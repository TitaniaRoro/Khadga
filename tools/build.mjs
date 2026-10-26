#!/usr/bin/env node
/**
 * tools/build.mjs — এক-ধাপ বিল্ড: esbuild বান্ডেল + ফন্ট সাবসেটিং + কনটেন্ট কপি + SW।
 *
 * আউটপুট `docs/` — GitHub Pages ঠিক এই ফোল্ডারটিই পরিবেশন করে, কোনো সার্ভার নেই।
 * বাজেট: পুরো সাইট ≤ ৬MB (design §৬)। ছাড়ালে বিল্ড ফেল করে।
 */
import { build } from 'esbuild';
import { mkdirSync, copyFileSync, readFileSync, writeFileSync, statSync, rmSync, readdirSync, existsSync } from 'node:fs';
import { dirname, join, resolve, relative } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createHash } from 'node:crypto';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const out = join(root, 'docs');
const BUDGET = 6 * 1024 * 1024;

/* বডি-ফন্ট Hind Siliguri, কিন্তু ওর নিজের বাংলা-সাবসেট ৬৯KB (দুই ওয়েটে ১৪০KB) —
   তাই বাংলা গ্লিফ Noto Sans Bengali-র কাছ থেকে নিই (৪৪+৪৬KB),আর Hind-এর ল্যাটিন
   সাবসেট (১৪+১৪KB) শুধু J/K/L/১২০৪-র মতো ল্যাটিন-অংশের জন্য। মোট ~১২১KB,
   একই ফল Hind-এর বাংলা সাবসেট নিলে ২১৩KB। তাই ভাঙা-মিশ্রণটাই সস্তা। */
const BN_RANGE = 'U+0980-09FF,U+0964,U+0965,U+2013,U+2014,U+2018-U+201D,U+2026,U+00A0';
const LA_RANGE = 'U+0020-007E,U+00A0';
const fonts = [
  { name: 'Hind Siliguri', wght: 400, subset: 'latin', range: LA_RANGE, file: '@fontsource/hind-siliguri/files/hind-siliguri-latin-400-normal.woff2' },
  { name: 'Hind Siliguri', wght: 700, subset: 'latin', range: LA_RANGE, file: '@fontsource/hind-siliguri/files/hind-siliguri-latin-700-normal.woff2' },
  { name: 'Noto Sans Bengali', wght: 400, subset: 'bengali', range: BN_RANGE, file: '@fontsource/noto-sans-bengali/files/noto-sans-bengali-bengali-400-normal.woff2' },
  { name: 'Noto Sans Bengali', wght: 700, subset: 'bengali', range: BN_RANGE, file: '@fontsource/noto-sans-bengali/files/noto-sans-bengali-bengali-700-normal.woff2' },
];

// docs/ = বিল্ড-আউটপুট এবং পড়া-নথি দুটোরই জায়গা; তাই পুরো ফোল্ডার মুছবো না,
// শুধু যন্ত্র-বানানো ফাইলগুলো মুছবো। design-khadga.md / content-preview.html অক্ষত থাকবে।
const GENERATED = ['index.html', 'app.js', 'styles.css', 'fonts.css', 'sw.js', 'content', 'fonts', 'og.png'];
for (const g of GENERATED) rmSync(join(out, g), { recursive: true, force: true });
mkdirSync(join(out, 'content'), { recursive: true });
mkdirSync(join(out, 'fonts'), { recursive: true });

// সোশ্যাল-ছবি (og:image) খেলার আসল ফ্রেম থেকে তোলা হয় — `npm run hero`।
// না থাকলেও বিল্ড চলবে: তখন শুধু meta-তে ছবি-ঠিকানা ভাঙা লেগে থাকবে, সেটা
// build শেষে সতর্কতা হিসেবে বলা হয় (CI ভাঙানোর মতো ব্যাপার নয়)।
if (existsSync(join(root, 'assets/og.png'))) copyFileSync(join(root, 'assets/og.png'), join(out, 'og.png'));

// রিভিশন = ইনপুট-সোর্সের কনটেন্ট-হ্যাশ (আকার নয়) — অ্যাসেট-URL, বিল্ড-ছাপ আর
// SW-ক্যাশের নাম, তিন জায়গাতেই একই সংখ্যা বসে (define-এর আগেই হিসাব করতে হয়)।
const srcFiles = [];
const walk = (dir) => {
  for (const e of readdirSync(join(root, dir), { withFileTypes: true })) {
    const rel = join(dir, e.name);
    if (e.isDirectory()) walk(rel); else if (/\.(ts|css|json|html|js)$/.test(e.name)) srcFiles.push(rel);
  }
};
for (const d of ['src', 'web', 'content']) walk(d);
const REV = createHash('sha1').update(srcFiles.map((f) => f + readFileSync(join(root, f)).length).join('|')).digest('hex').slice(0, 10);
const REV_NUM = String(parseInt(REV.slice(0, 6), 16) % 1000000).padStart(6, '0');

// ১) বান্ডেল
const t0 = Date.now();
const res = await build({
  define: { __KHADGA_REV__: JSON.stringify(REV_NUM), __KHADGA_REV_HASH__: JSON.stringify(REV) },
  entryPoints: [join(root, 'src', 'main.ts')],
  outfile: join(out, 'app.js'),
  bundle: true, minify: true, format: 'esm', target: 'es2022',
  legalComments: 'none', sourcemap: false, metafile: true, logLevel: 'info',
});
const ms = Date.now() - t0;
const bundled = Object.entries(res.metafile?.inputs ?? {})
  .filter(([k]) => k.startsWith('src/'))
  .reduce((a, [, v]) => a + v.bytesInOutput, 0);
console.log(`বান্ডেল ${Math.round(bundled / 1024)}KB (${ms}ms)`);

// ২) কনটেন্ট + HTML/CSS
copyFileSync(join(root, 'content', 'chapters.json'), join(out, 'content', 'chapters.json'));
copyFileSync(join(root, 'web', 'index.html'), join(out, 'index.html'));
copyFileSync(join(root, 'web', 'styles.css'), join(out, 'styles.css'));

// ৩) ফন্ট: fontsource নিজেই unicode-range-অনুযায়ী সাবসেট করা woff2 দেয়
// (bengali/…-400-normal.woff2 আলাদা, latin/… আলাদা) — তাই এখানে আর pyftsubset চলে না।
// আগে চলাত, কিন্তু মাপ পরীক্ষায় ধরা পড়েছে ফল শূন্য: আউটপুট ইনপুটের বাইট-সমান
// (৪৫,২৮৪B → ৪৫,২৮৪B)। মানে পুরো Python/fontTools নির্ভরতাটা অর্থহীন ঝামেলা,
// আর CI-তে fontTools না-পেলে চুপচাপ অসাবসেটেড ফাইল কপি হতো। এখন সরাসরি কপি।
const faceLines = [];
for (const f of fonts) {
  const src = join(root, 'node_modules', f.file);
  if (!existsSync(src)) { console.error(`✗ ফন্ট নেই: ${f.file} — npm ci চালান`); process.exit(1); }
  const dest = join(out, 'fonts', `${f.name.toLowerCase().replace(/\s+/g, '-')}-${f.wght}.woff2`);
  copyFileSync(src, dest);
  const kb = Math.round(statSync(dest).size / 1024);
  console.log(`  ${f.name} ${f.wght} (${f.subset}) → ${kb}KB`);
  faceLines.push(`@font-face{font-family:'${f.name}';font-style:normal;font-weight:${f.wght};font-display:swap;\
  src:url('fonts/${dest.split('/').pop()}') format('woff2');\
  unicode-range:${f.range};}`);
}
writeFileSync(join(out, 'fonts.css'), faceLines.join('\n'), 'utf8');

// ৪) রিভিশন + Service Worker
//
// রিভিশন = ইনপুট-সোর্সের *কনটেন্ট*-হ্যাশ (আকার নয়!)। অ্যাসেট-URL-এ ?v=, সোশ্যাল-ছবিতে
// নয়, অ্যাপের বিল্ড-ছাপে, আর SW-ক্যাশের নামে — চার জায়গায় একই সংখ্যা।
//
// কেন লাগলো: আগের SW-এর fetch-হ্যান্ডলার cache-first ছিল, আর install-এর `addAll`
// সেই হ্যান্ডলার দিয়েই নেটওয়ার্কে যেত — মানে নতুন বিল্ড প্রিক্যাচ করতে গিয়ে **পুরোনো
// বাইটই নতুন ক্যাশে বসত**। Deploy সফল হওয়ার পরেও খেলোয়াড় চিরকাল আগের খেলা দেখত
// (ব্যবহারকারীর রিপোর্ট: "কোনো উন্নতি দেখছি না")। সমাধান: শেল-এ নেটওয়ার্ক-আগে,
// স্থায়ী অ্যাসেটে ক্যাশ-আগে, আর রিভিশন বদলালে পুরো ক্যাশ-নাম বদলায়।

// index.html-এর অ্যাসেট-ঠিকানায় ?v= (Pages অ্যাসেটে max-age=600 পাঠায় → ছাড়া হলে ১০ মিনিট ধরে থাকে)
{
  const p = join(out, 'index.html');
  let html = readFileSync(p, 'utf8');
  for (const a of ['app.js', 'styles.css', 'fonts.css']) {
    const re = new RegExp(`((?:src|href)=")${a}(")`, 'g');
    html = html.replace(re, `$1${a}?v=${REV}$2`);
  }
  writeFileSync(p, html.replace('<meta name="viewport"', `<meta name="build" content="${REV_NUM}">\n<meta name="viewport"`), 'utf8');
}

const shell = ['index.html', `app.js?v=${REV}`, `styles.css?v=${REV}`, `fonts.css?v=${REV}`];
const immutable = ['content/chapters.json', ...readFileSync(join(out, 'fonts.css'), 'utf8').match(/fonts\/[\w.-]+/g)];
const manifest = [...new Set([...shell, ...immutable])];
writeFileSync(join(out, 'sw.js'), `/* খড়্গ — Service Worker (বিল্ড-উৎপন্ন, হাতে বদলো না) · রিভিশন ${REV} */
const C = 'khadga-${REV}';
const SHELL = ${JSON.stringify(shell)};
const P = ${JSON.stringify(manifest)};

addEventListener('install', (e) => {
  // নেটওয়ার্ক থেকেই নিই — ক্যাশ-পড়া ফেচ-হ্যান্ডলার নিজেই এখানে পুরোনো বাইট ঢুকিয়ে দিত
  e.waitUntil(caches.open(C).then((c) => Promise.all(P.map((u) => fetch(u, { cache: 'reload' }).then((r) => c.put(u, r))))).then(() => self.skipWaiting()));
});
addEventListener('activate', (e) => {
  e.waitUntil(caches.keys().then((k) => Promise.all(k.filter((x) => x !== C).map((x) => caches.delete(x)))).then(() => self.clients.claim()));
});
addEventListener('fetch', (e) => {
  const u = new URL(e.request.url);
  if (u.origin !== location.origin || e.request.method !== 'GET') return;
  // '…/Khadga/' → '' আসে, সেটাই আসল index.html — ভুলে গেলে নেভিগেশন ক্যাশ-আগে পুরোনো
  // বিল্ড ফেরত দিত (যে সমস্যার সমাধান করছি, ঠিক সেটাই)।
  const base = location.pathname.replace(/[^/]*$/, '');
  let key = u.pathname.replace(base, '') + u.search;
  if (key === '' || key === '.' || key === './' || key === '/') key = 'index.html';
  const isShell = SHELL.indexOf(key) >= 0 || key === 'index.html' || key === 'sw.js';
  if (isShell) {
    // শেল: নেটওয়ার্ক-আগে — নতুন বিল্ড দেখা যাবে, নেটওয়ার্ক না থাকলে তবেই ক্যাশ
    e.respondWith(
      fetch(e.request, { cache: 'no-store' })
        .then((n) => { const cl = n.clone(); caches.open(C).then((c) => c.put(key, cl)); return n; })
        .catch(() => caches.match(key).then((r) => r || caches.match('index.html')))
    );
    return;
  }
  // স্থায়ী অ্যাসেট (ফন্ট, কনটেন্ট): ক্যাশ-আগে — ক্যাশ-নাম-ই রিভিশন-বদলে পাল্টায়
  e.respondWith(caches.match(e.request).then((r) => r || fetch(e.request).then((n) => { if (n.ok) { const cl = n.clone(); caches.open(C).then((c) => c.put(e.request, cl)); } return n; })));
});
`, 'utf8');

// ৫) আকার-হিসাব
let total = 0;
const rows = [];
(function walk(d) {
  for (const name of readdirSync(d, { withFileTypes: true })) {
    const p = join(d, name.name);
    if (name.isDirectory()) walk(p);
    else { const s = statSync(p).size; total += s; rows.push([relative(out, p), s]); }
  }
})(out);
rows.sort((a, b) => b[1] - a[1]);
console.log('\ndocs/ মাপ:');
for (const [f, s] of rows) console.log(`  ${String(Math.round(s / 1024)).padStart(6)}KB  ${f}`);
console.log(`  মোট ${(total / 1024 / 1024).toFixed(2)}MB / বাজেট ${(BUDGET / 1024 / 1024).toFixed(0)}MB`);
if (total > BUDGET) { console.error('✗ সাইজ-বাজেট ছাড়িয়ে গেছে'); process.exit(1); }
console.log('✓ বিল্ড তৈরি');
