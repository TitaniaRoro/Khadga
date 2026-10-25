/**
 * tools/hero.mjs — README-র হেরো আর og.png **খেলাটা চালািয়ে** তোলা হয়।
 *
 * কেন এই পথ: আগের হেরোটা AI-বানানো সাজানো ব্যানার ছিল — খেলার আসল চেহারার
 * সঙ্গে তার কোনো মিল ছিল না (পুতুলের ভঙ্গি, স্থাপত্য, HUD কিছুই না)। এখানে বরং
 * আসল `src/sim.ts` + `src/render.ts` নোডে চালানো হয় (@napi-rs/canvas-এর আসল
 * Canvas2D-এ), পর্দার যে-ফ্রেমে লড়াই চলছে ঠিক সেটাই ধরা হয়, তার ওপর বাংলা টাইপ
 * বসানো হয় (ফন্টসোর্সের আসল woff2, হারফবাজ-শেপিংসহ)। তাই ছবিটা মিথ্যা হতে পারে না।
 *
 * বিল্ডের অংশ নয়, CI-তে চলে না: `npm run hero` (লাগে `npm i --no-save @napi-rs/canvas`)।
 */
import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';

const { createCanvas, GlobalFonts } = await import('@napi-rs/canvas').then((m) => m.default ?? m);
const root = new URL('../', import.meta.url);
const P = (p) => fileURLToPathSafe(new URL(p, root));
function fileURLToPathSafe(u) { return decodeURIComponent(new URL(u).pathname); }

const F = {
  bn700: 'node_modules/@fontsource/noto-sans-bengali/files/noto-sans-bengali-bengali-700-normal.woff2',
  bn400: 'node_modules/@fontsource/noto-sans-bengali/files/noto-sans-bengali-bengali-400-normal.woff2',
};
for (const f of Object.values(F)) {
  if (!existsSync(P(f))) { console.error(`✗ ফন্ট নেই: ${f} — আগে npm ci চালান`); process.exit(1); }
}
GlobalFonts.registerFromPath(P(F.bn700), 'NotoBn700');
GlobalFonts.registerFromPath(P(F.bn400), 'NotoBn400');

const { Sim, emptyInput } = await import('../src/sim.ts');
const { Renderer, PALETTES } = await import('../src/render.ts');

const BN = { 0: '০', 1: '১', 2: '২', 3: '৩', 4: '৪', 5: '৫', 6: '৬', 7: '৭', 8: '৮', 9: '৯' };
const bn = (s) => String(s).replace(/[0-9]/g, (d) => BN[Number(d)] ?? d);

/** @napi-rs/canvas-কে ব্রাউজার-ভাস-এর মতো সাজানো (Renderer এগুলোই ছুঁয়)। */
globalThis.window = { devicePixelRatio: 2 };
function gameCanvas(sim, chapterId, ticks, policy) {
  const cv = createCanvas(380, 180);   // পিক্সেল মোড: ব্যাকিং-স্টোর অর্ধেক, তাই এখানেও ৩৮০×১৮
  cv.getBoundingClientRect = () => ({ width: 760, height: 360, top: 0, left: 0 });
  cv.imageSmoothingEnabled = false;
  const r = new Renderer(cv, { reduceMotion: false, colorblind: false, palette: PALETTES[chapterId], pixel: true });
  let best = null, bestScore = -1;
  for (let t = 0; t < ticks; t++) {
    policy(sim, t);
    sim.step(takeInput(sim));
    r.draw(sim, t);
    // সেরা ফ্রেম = যে-ফ্রেমে সত্যিই কাজ চলছে (আঘাত চলছে / প্রতিপক্ষ স্তব্ধ / ঢাল ভাঙছে)
    const act = sim.enemies.filter((e) => e.phase === 'attack' || e.phase === 'stunned' || e.phase === 'hitstun').length;
    const swing = sim.player.move && sim.player.move.id ? 1 : 0;
    const brk = sim.enemies.some((e) => e.guard < 62 || e.phase === 'stunned') ? 1 : 0;
    const near = sim.player.x > 210 && sim.player.x < 550 ? 3 : 0;   // মাঝির দিকে থাকলে কম্পোজিশন ভালো
    const score = act * 3 + swing * 2 + brk * 4 + near + (sim.over ? 1 : 0) + t / 4000;
    if (score > bestScore) { bestScore = score; best = cv.toBuffer('image/png'); }
  }
  return { buf: best, sim };
}

// ---- পলিসি: একটি সাধারণ খেলোয়াড় — কাছে গিয়ে আঘাত, ঢাল নামানো, প্রশ্নের উত্তর ----
let pending = emptyInput();
function takeInput() { const i = pending; pending = emptyInput(); return i; }
function makePolicy(sim) {
  return (_s, t) => {
    pending = emptyInput();
    const foe = sim.enemies.find((e) => e.phase !== 'downed');
    if (foe) {
      const dx = foe.x - sim.player.x;
      if (Math.abs(dx) > 54) pending.moveX = dx > 0 ? 1 : -1;
      else if (t % 9 < 2) pending.pressed = t % 63 < 3 ? 'heavy' : 'cut';
      else if (foe.phase === 'attack' && t % 5 === 0) pending.pressed = 'guard';
    }
    const q = sim.duel?.question;
    if (q && (sim.duel.cooldown ?? 0) <= 0) pending.answer = q.answer;
  };
}

const doc = JSON.parse(readFileSync(P('content/chapters.json'), 'utf8'));
const pick = (id) => doc.chapters.find((c) => c.id === id);

function shot(id, mode, frames) {
  const sim = new Sim(pick(id), doc.meta, mode, 7, new Map());
  const g = gameCanvas(sim, id, frames, makePolicy(sim));
  return { ...g, ch: pick(id) };
}
const wave = shot(1, 'wave', 420);
const duel = shot(8, 'duel', 520);
console.log(`ফ্রেম তোলা হল — ঢেউ ch.1 (over=${wave.sim.over}), দ্বন্দ্ব ch.8 (over=${duel.sim.over}, সত্য=${duel.sim.duel?.truths})`);

// ---- কম্পোজিট ----
const load = async (buf) => { const { loadImage } = await import('@napi-rs/canvas'); return loadImage(buf); };
const waveImg = await load(wave.buf), duelImg = await load(duel.buf);

async function compose(W, H, file, label) {
  const cv = createCanvas(W, H), x = cv.getContext('2d');
  x.fillStyle = '#12100e'; x.fillRect(0, 0, W, H);
  const cellW = Math.floor((W - 48) / 2), cellH = Math.round(cellW * (360 / 760));
  // ক্যাপশন ফ্রেমের *উপরে* — আগে নিচে ছিল, বড় শিরোনলের সঙ্গে ধকাতকি (ছবি কেটে দেখা)।
  const capBase = Math.round(H * 0.062), fy = capBase + Math.round(H * 0.026);
  const imgs = [waveImg, duelImg], caps = [wave.ch, duel.ch];
  for (let i = 0; i < 2; i++) {
    const ox = 24 + i * (cellW + 24);
    // cover-ফসল: মাটির রেখা (GROUND ২৬৮/৩৬০) যেন কাটা না পড়ে
    const s = Math.max(cellW / 760, cellH / 360);
    const dw = 760 * s, dh = 360 * s, dy = -(dh - cellH) * 0.42;
    x.fillStyle = '#f0e6cf'; x.font = `700 ${Math.round(H * 0.038)}px NotoBn700`; x.textBaseline = 'alphabetic';
    x.fillText(`অধ্যায় ${bn(caps[i].id)} · ${caps[i].title_bn}`, ox + 2, capBase);
    const cap = i === 0 ? 'ঢেউ — নৌকার যাত্রী-রক্ষা' : 'দ্বন্দ্ব — ঢাল ভাঙো, সত্যি দাও';
    x.fillStyle = 'rgba(240,230,207,.55)'; x.font = `400 ${Math.round(H * 0.028)}px NotoBn400`;
    x.textAlign = 'right'; x.fillText(cap, ox + cellW - 2, capBase); x.textAlign = 'left';  // fillText-এর ৩য় আর্গুমেন্ট maxWidth, options নয়
    x.save(); x.beginPath(); x.rect(ox, fy, cellW, cellH); x.clip();
    x.imageSmoothingEnabled = false;   // পিক্সেল-আর্কেড: বড় করা nearest, রেশমি নয়
    x.drawImage(imgs[i], ox - (dw - cellW) / 2, fy + dy, dw, dh);
    x.restore();
    x.strokeStyle = 'rgba(240,230,207,.18)'; x.lineWidth = 1;
    x.strokeRect(ox + .5, fy + .5, cellW - 1, cellH - 1);
  }
  // টাইটেল
  x.fillStyle = '#f0e6cf'; x.font = `700 ${Math.round(H * 0.15)}px NotoBn700`;
  const ty = H - Math.round(H * 0.115);
  x.fillText(doc.meta.title_bn, 24, ty);
  const tw = x.measureText(doc.meta.title_bn).width;
  x.fillStyle = 'rgba(184,134,11,.95)'; x.fillRect(24 + tw + 18, ty - Math.round(H * 0.085), 3, Math.round(H * 0.095));
  x.fillStyle = 'rgba(240,230,207,.72)'; x.font = `400 ${Math.round(H * 0.046)}px NotoBn400`;
  x.fillText(doc.meta.subtitle_bn, 24 + tw + 36, ty - Math.round(H * 0.03));
  x.fillStyle = 'rgba(240,230,207,.5)'; x.font = `400 ${Math.round(H * 0.034)}px NotoBn400`;
  const counts = doc.chapters.reduce((a, c) => ({ cards: a.cards + c.cards.length, quiz: a.quiz + c.quiz.length }), { cards: 0, quiz: 0 });
  x.fillText(`${bn(doc.chapters.length)} অধ্যায় · ${bn(counts.cards)} কার্ড · ${bn(counts.quiz)} প্রশ্ন · সার্ভার নেই`, 24 + tw + 36, ty + Math.round(H * 0.005));
  x.fillStyle = 'rgba(240,230,207,.34)'; x.font = `400 ${Math.round(H * 0.028)}px NotoBn400`;
  x.textAlign = 'right'; x.fillText(label, W - 24, H - 18); x.textAlign = 'left';
  writeFileSync(P(file), cv.toBuffer(file.endsWith('.jpg') ? 'image/jpeg' : 'image/png', file.endsWith('.jpg') ? { quality: 88 } : undefined));
  const kb = Math.round(readFileSync(P(file)).length / 1024);
  console.log(`  ${file} ${W}×${H} → ${kb}KB`);
}
await compose(1600, 560, 'assets/hero.jpg', 'এই দুই ফ্রেম খেলার আসল রেন্ডারার থেকে নেওয়া');
await compose(1200, 630, 'assets/og.png', 'খড়্গ · GitHub Pages');
