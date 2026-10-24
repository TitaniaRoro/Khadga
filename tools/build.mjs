#!/usr/bin/env node
/**
 * tools/build.mjs — এক-ধাপ বিল্ড: esbuild বান্ডেল + ফন্ট সাবসেটিং + কনটেন্ট কপি + SW।
 *
 * আউটপুট `docs/` — GitHub Pages ঠিক এই ফোল্ডারটিই পরিবেশন করে, কোনো সার্ভার নেই।
 * বাজেট: পুরো সাইট ≤ ৬MB (design §৬)। ছাড়ালে বিল্ড ফেল করে।
 */
import { build } from 'esbuild';
import { mkdirSync, copyFileSync, readFileSync, writeFileSync, statSync, rmSync, readdirSync } from 'node:fs';
import { dirname, join, resolve, relative } from 'node:path';
import { fileURLToPath } from 'node:url';
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const out = join(root, 'docs');
const PY = join(root, '.venv', 'bin', 'python');
const BUDGET = 6 * 1024 * 1024;

const fonts = [
  { name: 'Hind Siliguri', wght: 400, style: 'normal', file: '@fontsource/hind-siliguri/files/hind-siliguri-latin-400-normal.woff2' },
  { name: 'Hind Siliguri', wght: 700, style: 'normal', file: '@fontsource/hind-siliguri/files/hind-siliguri-latin-700-normal.woff2' },
  { name: 'Noto Sans Bengali', wght: 400, style: 'normal', file: '@fontsource/noto-sans-bengali/files/noto-sans-bengali-bengali-400-normal.woff2' },
  { name: 'Noto Sans Bengali', wght: 700, style: 'normal', file: '@fontsource/noto-sans-bengali/files/noto-sans-bengali-bengali-700-normal.woff2' },
];

// docs/ = বিল্ড-আউটপুট এবং পড়া-নথি দুটোরই জায়গা; তাই পুরো ফোল্ডার মুছবো না,
// শুধু যন্ত্র-বানানো ফাইলগুলো মুছবো। design-khadga.md / content-preview.html অক্ষত থাকবে।
const GENERATED = ['index.html', 'app.js', 'styles.css', 'fonts.css', 'sw.js', 'content', 'fonts'];
for (const g of GENERATED) rmSync(join(out, g), { recursive: true, force: true });
mkdirSync(join(out, 'content'), { recursive: true });
mkdirSync(join(out, 'fonts'), { recursive: true });

// ১) বান্ডেল
const t0 = Date.now();
const res = await build({
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

// ৩) ফন্ট সাবসেটিং — পুরো বাংলা ব্লক + ল্যাটিন + বিরাম-চিহ্ন, যাতে ভবিষ্যতের কার্ডও ছাটে
const unicodes = ['U+0980-09FF', 'U+0020-007E', 'U+00A0', 'U+0964', 'U+0965', 'U+2013', 'U+2014', 'U+2018-U+201D', 'U+2026', 'U+00B7', 'U+25CF', 'U+2713'].join(',');
const faceLines = [];
for (const f of fonts) {
  const src = join(root, 'node_modules', f.file);
  const dest = join(out, 'fonts', `${f.name.toLowerCase().replace(/\s+/g, '-')}-${f.wght}.woff2`);
  const args = [src, `--flavor=woff2`, `--output-file=${dest}`, `--unicodes=${unicodes}`,
    '--layout-features=kern,liga,ccmp,rlig,akhn,haln,pref,blwf,abvs,psts,half,ss01',
    '--ignore-missing-unicodes', '--desubroutinize'];
  try {
    execFileSync(PY, ['-m', 'fontTools.subset', ...args], { stdio: 'pipe' });
  } catch (e) {
    console.warn(`  ফন্ট সাবসেট ব্যর্থ (${f.name} ${f.wght}): ${String(e.stderr ?? e).slice(0, 160)} — মূল ফাইল কপি করা হলো`);
    copyFileSync(src, dest);
  }
  const kb = Math.round(statSync(dest).size / 1024);
  console.log(`  ${f.name} ${f.wght} → ${kb}KB`);
  faceLines.push(`@font-face{font-family:'${f.name}';font-style:${f.style};font-weight:${f.wght};font-display:swap;
  src:url('fonts/${dest.split('/').pop()}') format('woff2');
  unicode-range:${f.name === 'Noto Sans Bengali' ? 'U+0980-09FF,U+00A0,U+2013,U+2014,U+2018-U+201D,U+2026,U+0964,U+0965' : 'U+0020-007E,U+00A0'};}`);
}
writeFileSync(join(out, 'fonts.css'), faceLines.join('\n'), 'utf8');

// ৪) Service Worker — নিজে থেকেই লেখা (cozy-cache = none), প্রিক্যাচ-লিস্ট বিল্ড থেকেই আসে
const files = ['index.html', 'app.js', 'styles.css', 'fonts.css', 'content/chapters.json',
  ...readFileSync(join(out, 'fonts.css'), 'utf8').match(/fonts\/[\w.-]+/g)];
const manifest = [...new Set(files)];
const hash = createHash('sha1').update(manifest.map((f) => f + statSync(join(out, f)).size).join('|')).digest('hex').slice(0, 10);
writeFileSync(join(out, 'sw.js'), `/* খড়্গ — হাতে-লেখা Service Worker (বিল্ড-উৎপন্ন, হাতে বদলো না) */
const C='khadga-${hash}';
const P=${JSON.stringify(manifest)};
addEventListener('install',(e)=>{e.waitUntil(caches.open(C).then((c)=>c.addAll(P)).then(()=>self.skipWaiting()))});
addEventListener('activate',(e)=>{e.waitUntil(caches.keys().then((k)=>Promise.all(k.filter((x)=>x!==C).map((x)=>caches.delete(x)))).then(()=>self.clients.claim()))});
addEventListener('fetch',(e)=>{const u=new URL(e.request.url);if(u.origin!==location.origin||e.request.method!=='GET')return;
e.respondWith(caches.match(e.request).then((r)=>r||fetch(e.request).then((n)=>{if(n.ok&&u.pathname.endsWith('/index.html')||n.ok){const c=n.clone();caches.open(C).then((x)=>x.put(e.request,c));}return n;}).catch(()=>caches.match('index.html'))));});
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
