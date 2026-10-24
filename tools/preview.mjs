#!/usr/bin/env node
/**
 * tools/preview.mjs — কনটেন্ট-রিভিউ পাতা বানায় (এটি খেলা নয়; শুধু পড়ার-যন্ত্র)
 *
 * Usage:  node tools/preview.mjs            → docs/content-preview.html
 *         node tools/preview.mjs --out f.html
 *
 * কাজ: content/chapters.json পড়ে একটা self-contained HTML বানায় যাতে ব্রাউজারে
 * পুরো ইতিহাস-সামগ্রী বাংলায় পড়া, ছাঁটা আর যাচাই করা যায়। ইমেজ/ফন্ট/নেটওয়ার্ক
 * ছাড়াই চলে — ফাইলটা খুললেই হয়।
 */
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const args = process.argv.slice(2);
const outArg = args.indexOf('--out');
const OUT = resolve(root, outArg >= 0 ? args[outArg + 1] : 'docs/content-preview.html');
const SRC = resolve(root, args.find((a) => !a.startsWith('--') && a !== args[args.indexOf('--out') + 1]) || 'content/chapters.json');

const doc = JSON.parse(readFileSync(SRC, 'utf8'));
const esc = (s) => String(s ?? '').replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));

const TYPE_LABEL = {
  fact: 'তথ্য', event: 'ঘটনা', place: 'জায়গা', figure: 'ব্যক্তিত্ব', idea: 'ধারণা',
  legend: 'লোকশ্রুতি', myth: 'প্রচলিত-ভ্রম', quote: 'উদ্ধৃতি', disputed: 'মতভেদ',
};
const TAG_LABEL = {
  syncretism: 'সংমিশ্রণ', economy: 'অর্থনীতি', navy: 'নৌ/নদী', 'source-criticism': 'সূত্র-সমালোচনা',
  coexistence: 'সহাবস্থান', women: 'নারী', warfare: 'লড়াই', politics: 'রাজনীতি',
};
const bn = (n) => String(n).replace(/\d/g, (d) => '০১২৩৪৫৬৭৮৯'[d]);

const legendRows = Object.entries(doc.meta.sources_legend || {})
  .map(([k, v]) => `<li><code>${esc(k)}</code> — ${esc(v)}</li>`).join('');

const chaptersHtml = doc.chapters.map((ch) => {
  const cards = ch.cards.map((c) => {
    const tags = (c.tags || []).map((t) => `<i class="tag" data-tag="${esc(t)}">${esc(TAG_LABEL[t] || t)}</i>`).join('');
    const views = c.views ? `<div class="views">${c.views.map((v, i) =>
      `<div class="view"><b>${i === 0 ? 'পক্ষ ক' : i === 1 ? 'পক্ষ খ' : 'তৃতীয় মত'}</b><p>${esc(v)}</p></div>`).join('')}</div>` : '';
    const src = (c.sources || []).map((s) => `<li>${esc(s)}</li>`).join('');
    return `<article class="card ${c.disputed ? 'disputed' : ''}" data-type="${esc(c.type)}" data-tags="${esc((c.tags || []).join(' '))}">
  <header><span class="chip t-${esc(c.type)}">${esc(TYPE_LABEL[c.type] || c.type)}</span>
    <span class="yr">${c.year === null ? 'তারিখবিহীন' : bn(c.year)}</span>
    ${c.place ? `<span class="pl">${esc(c.place)}</span>` : ''}
    ${c.disputed ? '<span class="chip warn">মতভেদ</span>' : ''}
    ${c.context ? '<span class="chip soft">প্রেক্ষাপট</span>' : ''}
    ${c.aftermath ? '<span class="chip soft">ফল</span>' : ''}</header>
  <p>${esc(c.bn)}</p>
  ${views}
  <div class="meta"><span class="id">${esc(c.id)}</span>${tags}</div>
  <details><summary>উৎস (${bn((c.sources || []).length)})</summary><ul>${src}</ul></details>
</article>`;
  }).join('');

  const quiz = (ch.quiz || []).map((q) => `
<li class="quiz"><p class="qn">${esc(q.q_bn)}</p>
<ul class="choices">${q.choices_bn.map((c, i) =>
  `<li class="${i === q.answer ? 'right' : ''}"><span class="lt">${'কখগঘ'[i]}</span> ${esc(c)}</li>`).join('')}</ul>
<details><summary>উত্তর ও ব্যাখ্যা</summary><p class="ans">সঠিক: <b>${'কখগঘ'[q.answer]}</b> — ${esc(q.explain_bn)}</p>
<p class="ref">কার্ড: <a href="#${esc(q.card)}">${esc(q.card)}</a></p></details></li>`).join('');

  const tac = (ch.tactics || []).map((t) => `<li><a href="#${esc(t.card)}">${esc(t.card)}</a> → ${esc(t.boon_bn)}</li>`).join('');
  const panels = (ch.panels_bn || []).map((p, i) => `<li><span class="pn">${bn(i + 1)}</span><p>${esc(p)}</p></li>`).join('');
  const boss = ch.boss ? `<div class="boss"><h4>বস: ${esc(ch.boss.name_bn)}</h4>
${ch.boss.allegiance_bn ? `<p class="soft-l">পক্ষ: ${esc(ch.boss.allegiance_bn)}</p>` : ''}
<p class="myth"><b>প্রচলিত ভাবনা:</b> ${esc(ch.boss.myth_bn)}</p>
<p class="brk"><b>যা খেলা ভাঙে:</b> ${esc(ch.boss.breakline_bn)}</p>
${ch.boss.tactic_bn ? `<p class="tac"><b>লড়াই-পরামর্শ:</b> ${esc(ch.boss.tactic_bn)}</p>` : ''}</div>`
    : '<div class="boss none"><h4>লড়াই নেই</h4><p>অধ্যায় ০ প্রাক-কথন — শুধু প্যানেল আর কার্ড।</p></div>';
  const fight = ch.fight_bn ? `<p class="fight">ঢেউ ${bn(ch.fight_bn.waves)}টি · ${esc(ch.fight_bn.duel_bn)}</p>` : '';

  return `<section class="chapter" id="ch${ch.id}">
<h2><span class="num">${bn(ch.id)}</span> ${esc(ch.title_bn)} <small>${esc(ch.years_bn)}</small></h2>
<p class="bearer"><b>খড়্গধর:</b> ${esc(ch.bearer_bn.name_bn)} — ${esc(ch.bearer_bn.role_bn)}</p>
${fight}
<h3 class="sec">অধ্যায়-শুরুর প্যানেল</h3><ol class="panels">${panels}</ol>
<h3 class="sec">ইতিহাসের কার্ড (${bn(ch.cards.length)})</h3><div class="grid">${cards}</div>
<h3 class="sec">জ্ঞানকোষ (${bn((ch.quiz || []).length)})</h3><ol class="quizlist">${quiz}</ol>
<h3 class="sec">কার্ড → গেমপ্লে-লাভ</h3><ul class="tactics">${tac}</ul>
<h3 class="sec">বস-ব্লক</h3>${boss}
</section>`;
}).join('');

const nav = doc.chapters.map((ch) => `<a href="#ch${ch.id}"><b>${bn(ch.id)}</b> ${esc(ch.title_bn)}</a>`).join('');
const stats = [
  ['অধ্যায়', bn(doc.chapters.length)],
  ['কার্ড', bn(doc.chapters.reduce((a, c) => a + c.cards.length, 0))],
  ['প্রশ্ন', bn(doc.chapters.reduce((a, c) => a + (c.quiz?.length || 0), 0))],
  ['মতভেদ-কার্ড', bn(doc.chapters.reduce((a, c) => a + c.cards.filter((x) => x.disputed).length, 0))],
  ['সংমিশ্রণ-কার্ড', bn(doc.chapters.reduce((a, c) => a + c.cards.filter((x) => (x.tags || []).includes('syncretism')).length, 0))],
  ['কালসীমা', `${bn(doc.meta.span[0])}–${bn(doc.meta.span[1])}`],
].map(([k, v]) => `<div class="stat"><b>${v}</b><span>${k}</span></div>`).join('');

const html = `<!DOCTYPE html>
<html lang="bn"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>${esc(doc.meta.title_bn)} — কনটেন্ট পর্যালোচনা</title>
<style>
:root{--bg:#12100e;--panel:#1b1815;--ink:#ece5d8;--dim:#9c9282;--gold:#c9a44c;--rust:#a4553c;--line:#2c2823;--good:#5f8d5a}
*{box-sizing:border-box}
body{margin:0;background:var(--bg);color:var(--ink);
 font-family:"Noto Sans Bengali","Hind Siliguri","SolaimanLipi","Kalpurush","Shonar Bangla","Vrinda",system-ui,sans-serif;
 font-size:17px;line-height:1.72}
header.top{position:sticky;top:0;z-index:5;background:#0e0c0aee;border-bottom:1px solid var(--line);padding:14px 18px;backdrop-filter:blur(6px)}
header.top h1{margin:0;font-size:21px;letter-spacing:.3px}
header.top p{margin:3px 0 0;color:var(--dim);font-size:13.5px}
.wrap{display:grid;grid-template-columns:238px 1fr;gap:26px;max-width:1280px;margin:0 auto;padding:20px 18px 90px}
nav.side{position:sticky;top:74px;align-self:start;max-height:calc(100vh - 96px);overflow:auto}
nav.side a{display:block;color:var(--dim);text-decoration:none;padding:6px 9px;border-left:2px solid transparent;font-size:14.5px}
nav.side a:hover{color:var(--ink);border-left-color:var(--gold);background:#ffffff08}
nav.side a b{color:var(--gold);font-variant-numeric:tabular-nums;margin-inline-end:6px}
.stats{display:flex;flex-wrap:wrap;gap:7px;margin:12px 0 0}
.stat{background:var(--panel);border:1px solid var(--line);border-radius:9px;padding:7px 11px;font-size:13px;color:var(--dim)}
.stat b{display:block;color:var(--gold);font-size:17px}
.filters{margin-top:14px;display:flex;flex-wrap:wrap;gap:5px}
.filters button{background:var(--panel);color:var(--dim);border:1px solid var(--line);border-radius:20px;padding:4px 10px;font:inherit;font-size:12.5px;cursor:pointer}
.filters button[aria-pressed=true]{background:var(--gold);color:#191510;border-color:var(--gold);font-weight:700}
.chapter{background:var(--panel);border:1px solid var(--line);border-radius:14px;padding:18px 18px 22px;margin:0 0 26px;scroll-margin-top:80px}
.chapter h2{margin:0 0 4px;font-size:22px;display:flex;align-items:baseline;gap:9px;flex-wrap:wrap}
.chapter h2 .num{color:var(--rust);font-size:30px;line-height:1;font-weight:800}
.chapter h2 small{color:var(--dim);font-size:14px;font-weight:400}
.bearer{margin:0 0 3px;font-size:14.5px;color:var(--gold)}
.fight{margin:0 0 6px;font-size:13.5px;color:var(--dim)}
h3.sec{margin:20px 0 9px;font-size:13px;text-transform:uppercase;letter-spacing:.11em;color:var(--dim);font-weight:600;border-top:1px solid var(--line);padding-top:13px}
.panels{margin:0;padding:0;list-style:none;display:grid;gap:7px}
.panels li{display:flex;gap:10px;align-items:flex-start;background:#ffffff05;border-radius:8px;padding:8px 11px}
.panels .pn{color:var(--rust);font-weight:800;font-size:15px;min-width:1.4em}
.panels p{margin:0;font-size:15.5px}
.grid{display:grid;grid-template-columns:repeat(auto-fill,minmax(330px,1fr));gap:12px}
.card{background:#ffffff06;border:1px solid var(--line);border-radius:11px;padding:11px 13px;scroll-margin-top:88px}
.card.disputed{border-color:#7a5a2f;background:#3a2c1415}
.card:target{outline:2px solid var(--gold);outline-offset:2px}
.card header{display:flex;flex-wrap:wrap;gap:6px;align-items:center;margin-bottom:6px}
.card p{margin:0 0 8px;font-size:15.8px}
.chip{font-size:11.5px;padding:1.5px 8px;border-radius:20px;background:#ffffff10;color:var(--dim);border:1px solid var(--line)}
.chip.warn{background:#6b4a15;color:#ffe6b0;border-color:#8a6420}
.chip.soft{background:#20343a;color:#a9cfd6}
.chip.t-myth,.chip.t-disputed{color:#ffd9a3}.chip.t-quote{color:#c9e3c6}
.yr{color:var(--gold);font-weight:700;font-size:14px}
.pl{color:var(--dim);font-size:13px}
.meta{display:flex;flex-wrap:wrap;gap:5px;align-items:center;margin-bottom:6px}
.meta .id{font-size:11.5px;color:#6f665a;font-family:ui-monospace,monospace}
.tag{font-style:normal;font-size:11.5px;color:#b9c8a6;background:#2b3527;padding:1px 7px;border-radius:20px}
.views{display:grid;gap:6px;margin:0 0 8px}
.view{border-inline-start:2px solid var(--gold);padding:2px 0 2px 10px}
.view b{display:block;font-size:12px;color:var(--gold);letter-spacing:.04em}
.view p{margin:1px 0 0;font-size:14.8px;color:#e2d9c6}
details{font-size:13.5px;color:var(--dim)}
details summary{cursor:pointer;color:#b7ac99;font-size:12.5px}
details ul{margin:5px 0 0;padding-inline-start:19px}
details li{margin:1px 0}
.quizlist{margin:0;padding:0;list-style:none;display:grid;gap:9px}
.quiz{background:#ffffff06;border:1px solid var(--line);border-radius:10px;padding:9px 12px}
.qn{margin:0 0 5px;font-weight:600}
.choices{margin:0 0 5px;padding:0;list-style:none;font-size:15px;display:grid;gap:2px}
.choices li{margin:0;color:var(--dim);display:flex;gap:7px;align-items:baseline}
.choices .lt{color:var(--gold);font-weight:700;min-width:1.1em}
.choices li.right{color:var(--ink);font-weight:600}
.quiz:not(:hover) .choices li.right{color:var(--dim);font-weight:400}
.quiz:not(:hover) .choices li.right .lt{color:var(--dim)}
.ans{margin:4px 0 0}.ans b{color:var(--good)}
.ref{margin:2px 0 0;font-size:12.5px}.ref a{color:var(--gold)}
.boss{background:#241a1415;border:1px solid #4a3320;border-radius:10px;padding:10px 13px}
.boss.none{background:#ffffff05;border-color:var(--line)}
.boss h4{margin:0 0 5px;font-size:16.5px;color:var(--gold)}
.boss p{margin:3px 0;font-size:15px}
.boss .myth b{color:#e0a15e}.boss .brk b{color:#9fd08a}.soft-l{color:var(--dim);font-size:13.5px}
.tactics{margin:0;padding-inline-start:20px;font-size:15px}
.tactics li{margin:2px 0}.tactics a{color:var(--gold);text-decoration:none}
footer{color:var(--dim);font-size:13px;max-width:1280px;margin:0 auto;padding:0 18px 60px}
footer ul{padding-inline-start:19px}footer code{color:#c8bda6;font-size:12.5px}
body.narrow .wrap{grid-template-columns:1fr}nav.side{position:static;max-height:none}
@media(max-width:900px){.wrap{grid-template-columns:1fr}nav.side{position:static;max-height:none}}
</style></head><body>
<header class="top"><h1>${esc(doc.meta.title_bn)} <span style="color:var(--dim);font-weight:400;font-size:15px">· কনটেন্ট পর্যালোচনা v${esc(doc.meta.version)}</span></h1>
<p>${esc(doc.meta.subtitle_bn)} · ${esc(doc.meta.bearer_lineage_bn)} · <span style="color:var(--gold)">খেলা নয় — শুধু পাঠ</span></p></header>
<div class="wrap">
<nav class="side">${nav}
  <div class="stats">${stats}</div>
  <div class="filters" id="filters">
    <button data-f="" aria-pressed="true">সব কার্ড</button>
    <button data-f="disputed">মতভেদ</button>
    <button data-f="syncretism">সংমিশ্রণ</button>
    <button data-f="economy">অর্থনীতি</button>
    <button data-f="navy">নদী/নৌ</button>
    <button data-f="warfare">লড়াই</button>
    <button data-f="source-criticism">সূত্র-সমালোচনা</button>
  </div>
</nav>
<main>${chaptersHtml}</main>
</div>
<footer>
<h3 style="font-size:13px;letter-spacing:.1em;text-transform:uppercase;color:var(--dim)">উৎস-তালিকা</h3>
<ul>${legendRows}</ul>
<p>এই পাতাটি <code>tools/preview.mjs</code> দিয়ে তৈরি — <code>content/chapters.json</code> বদলালে আবার চালান।
সঠিক উত্তর দেখানো আছে, কারণ এটি পর্যালোচনার পাতা; খেলায় উত্তর লুকানো থাকবে।</p>
</footer>
<script>
const F=document.getElementById('filters');
F.addEventListener('click',e=>{
  const b=e.target.closest('button'); if(!b)return;
  [...F.querySelectorAll('button')].forEach(x=>x.setAttribute('aria-pressed',String(x===b)));
  const f=b.dataset.f;
  document.querySelectorAll('.card').forEach(c=>{
    const hit=!f||c.dataset.tags.split(' ').includes(f)||c.dataset.type===f;
    c.style.display=hit?'':'none';
  });
});
</script></body></html>`;

mkdirSync(dirname(OUT), { recursive: true });
writeFileSync(OUT, html, 'utf8');
console.log(`✓ ${html.length.toLocaleString()} বাইট → ${OUT.replace(root + '/', '')}`);
