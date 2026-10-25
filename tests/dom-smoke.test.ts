/**
 * tests/dom-smoke.test.ts — বান্ডেল-স্মোক: আসল docs/app.js-একটি নকল DOM-এ চালানো হয়।
 *
 * কেন: সিম-টেস্ট লড়াইয়ের নিয়ম প্রমাণ করে, কিন্তু "element id মিলছে না", "boot-তে throw",
 * "প্রতি ফ্রেমে HUD painting ভাঙে" — এগুলো ধরে না। ব্রাউজার-বিহীন CI-তেও ধরতে
 * ন্যূনতম DOM/canvas stub বানিয়ে বিল্ড-আউটপুটটাই চালাই।
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, existsSync } from 'node:fs';

const APP = new URL('../docs/app.js', import.meta.url);
const HTML = new URL('../docs/index.html', import.meta.url);

/**
 * এই ফাইলের প্রতিটি টেস্ট বিল্ড-আউটপুট পড়ে। `npm run check` বিল্ড আগে চালায়, কিন্তু
 * কেউ সরাসরি `npm test` চালালে (বা নতুন ক্লোনে `docs/`-এ কিছুই না থাকলে) লাল হওয়া
 * ঠিক নয় — এড়িয়ে যাওয়াই ঠিক, কারণ দেখিয়ে। আর CI-তে (CI=true) এড়ায় না: ওখানে
 * বিল্ড-ধাপ বাদ পড়লে নীরবে সবুজ পাওয়াটা সবচেয়ে বিপজ্জনক ব্যর্থতা।
 */
const BUILT = existsSync(APP) && existsSync(new URL('../docs/content/chapters.json', import.meta.url));
const PRE = BUILT || process.env['CI'] === 'true' ? {} : { skip: 'বিল্ড নেই — আগে `npm run build` (বা `npm run check`)' };

class El {
  id = ''; children: El[] = []; style: Record<string, string> = {}; dataset: Record<string, string> = {};
  // canvas গুণাবলি — রেন্ডারার এগুলো লেখে, তাই getter নয়, খাঁটা ফিল্ড
  width = 760; height = 360;
  textContent = ''; innerHTML = ''; lang = '';
  classList = {
    set: new Set<string>(),
    add(c: string) { this.set.add(c); }, remove(c: string) { this.set.delete(c); },
    toggle(c: string, on?: boolean) { const want = on ?? !this.set.has(c); want ? this.set.add(c) : this.set.delete(c); },
    contains(c: string) { return this.set.has(c); },
  };
  private handlers: Record<string, ((e?: unknown) => void)[]> = {};
  constructor(tag = 'div') { this.tag = tag; }
  tag: string;
  addEventListener(t: string, f: (e?: unknown) => void): void { (this.handlers[t] ||= []).push(f); }
  fire(t: string, e: unknown = {}): void { for (const f of this.handlers[t] ?? []) f(e); }
  getBoundingClientRect() { return { width: 760, height: 360, top: 0, left: 0 }; }
  getContext(): unknown { return ctxStub(); }
  setPointerCapture(): void {}
  querySelector(sel: string): El | null { return this.querySelectorAll(sel)[0] ?? null; }
  /** নির্বাচক-মিল: '#id', '.class', 'tag', '[data-x]' — যথেষ্ট, সম্পূর্ণ CSS নয়। */
  querySelectorAll(sel: string): El[] {
    const s = sel.trim();
    const attr = s.match(/^\[data-([\w-]+)/);
    const cls = s.match(/^\.([\w-]+)/);
    const idm = s.match(/^#([\w-]+)/);
    const tag = /^[a-zA-Z][\w-]*$/.test(s) ? s : null;
    const hit = (c: El): boolean => {
      if (attr) return c.dataset[attr[1]!] !== undefined;
      if (cls) return c.classList.contains(cls[1]!);
      if (idm) return c.id === idm[1];
      if (tag) return c.tag === tag;
      return false;
    };
    const out: El[] = [];
    const walk = (e: El): void => {
      for (const c of e.children) { if (hit(c)) out.push(c); walk(c); }
    };
    walk(this);
    return out;
  }
  appendChild(c: El): El { this.children.push(c); return c; }
  closest(): El | null { return null; }
  remove(): void {}
}

let drawCalls = 0;
function ctxStub(): Record<string, (...a: unknown[]) => void> {
  const base = {
    canvas: { width: 760, height: 360 },
    save() {}, restore() {}, beginPath() {}, closePath() {},
    fill() { drawCalls++; }, stroke() { drawCalls++; },
    moveTo() {}, lineTo() {}, quadraticCurveTo() {}, arc() {}, ellipse() {}, rect() {},
    fillRect() {}, strokeRect() {}, clearRect() {}, translate() {}, rotate() {}, scale() {},
    setTransform() {}, fillText() {}, setLineDash() {},
    createLinearGradient: () => ({ addColorStop() {} }),
    measureText: () => ({ width: 10 }),
  } as unknown as Record<string, (...a: unknown[]) => void>;
  return new Proxy(base, {
    get(t, k: string) { if (k in t) return t[k]; return () => undefined; },
    set(t, k: string, v: unknown) { t[k] = v as never; return true; },
  });
}

function installDom(): { body: El; byId: Map<string, El>; frameCbs: ((t: number) => void)[] } {
  drawCalls = 0;
  const byId = new Map<string, El>();
  const html = readFileSync(HTML, 'utf8');
  const ids = [...html.matchAll(/id="([\w-]+)"/g)].map((m) => m[1]!);
  const body = new El('body');
  for (const id of ids) { const e = new El(id === 'stage' ? 'canvas' : 'div'); e.id = id; byId.set(id, e); body.appendChild(e); }
  const app = byId.get('app') ?? body;
  // #app-এর ভেতরেই সব উপাদান — আসল DOM-এও তাই, নাহলে root.querySelector কিছু পায় না
  for (const [id, e] of byId) if (id !== 'app' && !app.children.includes(e)) app.appendChild(e);
  const hud = byId.get('hud')!;
  for (const id of ['bar-hp', 'bar-guard', 'bar-meter', 'clock', 'readcount', 'state']) {
    const e = new El('span'); e.id = id; (hud ?? body).appendChild(e);
  }
  const btns = byId.get('btns')!;
  for (const name of ['cut', 'heavy', 'thrust', 'guard', 'side', 'resolve']) {
    const b = new El('button'); b.dataset.input = name; btns?.appendChild(b);
  }
  const stick = byId.get('stick') ?? new El('div');
  const knob = new El('span'); knob.classList.add('knob'); stick.appendChild(knob);
  for (const act of ['start', 'back', 'again', 'next', 'pause', 'resume', 'copySave', 'pasteSave', 'music', 'gentle', 'teacher', 'reduce', 'cb', 'fontUp', 'fontDown']) {
    const b = new El('button'); b.dataset.act = act; body.appendChild(b); app.appendChild(b);
  }
  const frameCbs: ((t: number) => void)[] = [];
  const g = globalThis as unknown as Record<string, unknown>;
  const doc = {
    documentElement: new El('html'), body, lang: 'bn',
    getElementById: (id: string) => byId.get(id) ?? null,
    querySelector: (s: string) => body.querySelector(s),
    querySelectorAll: (s: string) => body.querySelectorAll(s),
    createElement: (t: string) => new El(t),
    addEventListener: () => undefined,
  };
  // Node 22-এ navigator/document ইত্যাদি getter-only — defineProperty ছাড়া লেখা যায় না
  const put = (k: string, v: unknown): void => { Object.defineProperty(g, k, { value: v, writable: true, configurable: true }); };
  const win = {
    devicePixelRatio: 1, addEventListener: () => undefined,
    requestAnimationFrame: (f: (t: number) => void) => { frameCbs.push(f); return frameCbs.length; },
    document: doc,
  };
  put('document', doc);
  put('window', win);
  put('requestAnimationFrame', win.requestAnimationFrame);
  put('cancelAnimationFrame', () => undefined);
  put('addEventListener', () => undefined);
  put('navigator', { serviceWorker: undefined, clipboard: { writeText: async () => undefined } });
  put('location', { protocol: 'https:', origin: 'https://x.invalid', href: 'https://x.invalid/' });
  const store = new Map<string, string>();
  put('localStorage', { getItem: (k: string) => store.get(k) ?? null, setItem: (k: string, v: string) => { store.set(k, v); }, removeItem: (k: string) => { store.delete(k); } });
  put('fetch', async (u: string) => {
    const p = u.includes('chapters.json') ? new URL('../docs/content/chapters.json', import.meta.url) : null;
    if (!p) return { ok: false, status: 404, json: async () => ({}) };
    return { ok: true, status: 200, json: async () => JSON.parse(readFileSync(p, 'utf8')) };
  });
  g.TextEncoder = TextEncoder; g.TextDecoder = TextDecoder;
  return { body, byId, frameCbs };
}

test('বিল্ড-আউটপুট বিদ্যমান', { ...PRE }, () => {
  assert.ok(existsSync(APP), 'docs/app.js নেই — আগে npm run build');
  assert.ok(existsSync(new URL('../docs/content/chapters.json', import.meta.url)), 'docs/content/chapters.json নেই');
});

test('boot → title → অধ্যায় ১-এর ঢেউ: ৩০০ ফ্রেম, কোনো throw নয়, ক্যানভাস আঁকা হয়', { ...PRE }, async () => {
  const dom = installDom();
  drawCalls = 0;
  await import(APP.href);
  await new Promise((r) => setTimeout(r, 30));
  const game = (globalThis as unknown as { window: { khadga?: { scene: string } } }).window.khadga
    ?? (globalThis as unknown as { khadga?: never }).khadga;
  const g = (globalThis as never as { window: Record<string, unknown> }).window['khadga'] as {
    scene: string; sim: unknown; startChapter(ch: unknown, mode: 'wave'): void;
    doc: { chapters: { id: number }[] }; progress: { read: string[] };
    input: { inject(p: null | 'cut' | 'guard', mx?: number, my?: number, a?: null | 0 | 1 | 2 | 3): void };
  } | undefined;
  assert.ok(g, 'window.khadga সেট হয়নি — boot ভেঙে গেছে');
  assert.equal(g!.scene, 'title');
  const ch1 = (g!.doc.chapters as { id: number }[]).find((c) => c.id === 1)!;
  g!.startChapter(ch1 as never, 'wave');
  assert.ok(g!.sim, 'সিম তৈরি হয়নি');
  for (let f = 0; f < 300; f++) {
    g!.input.inject(f % 7 === 0 ? 'cut' : f % 23 === 0 ? 'guard' : null, f % 11 === 0 ? 1 : 0);
    for (const cb of dom.frameCbs.splice(0)) cb(f * 16.7);
  }
  assert.ok(drawCalls > 300 * 5, `ক্যানভাসে আঁকা হয়নি মনে হচ্ছে (draw-calls ${drawCalls})`);
  assert.ok(['wave', 'result'].includes(g!.scene), `সিন আটকে গেছে: ${g!.scene}`);
  const clock = dom.byId.get('clock');
  assert.ok(clock && /[:০-৯]/.test(clock.textContent), 'HUD-ঘড়ি লেখেনি');
  const tbar = dom.byId.get('tbar');
  assert.ok(tbar && tbar.innerHTML.includes('ঢেউ'), 'ঢেউ-ফলক ভরাট হয়নি');
});

test('কোনো id দ্বন্দ্ব নেই: index.html-এর id-গুলো অদ্বিতীয়', { ...PRE }, () => {
  const html = readFileSync(HTML, 'utf8');
  const ids = [...html.matchAll(/id="([\w-]+)"/g)].map((m) => m[1]!);
  assert.equal(new Set(ids).size, ids.length, `ডুপ্লিকেট id: ${ids.filter((x, i) => ids.indexOf(x) !== i).join(',')}`);
});

test('HTML-এ বাইরে-ডাকা কিছু নেই (সার্ভারলেস + অফলাইন শর্ত)', { ...PRE }, () => {
  const html = readFileSync(HTML, 'utf8');
  // আসল নিয়মটা 'বাইরের কিছুর ওপর নির্ভরতা নেই' — সেটা src/href-এ ধরা উচিত,
  // <meta content="">-এ নয়। og:url/og:image ক্রলারের জন্য লেখা অ্যাবসলিউট ঠিকানা;
  // ব্রাউজার সেটা লোড করে না, তাই offline-চলার নিশা ভাঙে না।
  assert.equal(/(?:src|href)\s*=\s*["']https?:\/\//.test(html), false, 'index.html-এ src/href external URL আছে (CDN-নির্ভরতা)');
  const css = readFileSync(new URL('../docs/fonts.css', import.meta.url), 'utf8');
  assert.equal(/https?:\/\//.test(css), false, 'fonts.css-য়ে CDN আছে');
});

test('UI-তে English শব্দ নেই — দেখা-লেখা শুধু বাংলা (কী-নাম বাদে)', { ...PRE }, () => {
  const html = readFileSync(HTML, 'utf8');
  const visible = html
    .replace(/<script[\s\S]*?<\/script>/g, '').replace(/<style[\s\S]*?<\/style>/g, '')
    .replace(/<[^>]+>/g, ' ');
  const words = (visible.match(/[A-Za-z]{3,}/g) ?? []).filter((w) => !['ADWQ', 'J', 'K', 'L'].includes(w));
  const allowed = new Set(['Shift', 'Space']); // কীবোর্ড-কী-এর নাম — পদার্থেই ল্যাটিন
  assert.deepEqual(words.filter((w) => !allowed.has(w)), [], `লেখা-মাঝে English: ${words.join(', ')}`);
});
