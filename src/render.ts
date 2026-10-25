/**
 * src/render.ts — ছায়া-পুতুল রেন্ডারার (Canvas2D)।
 *
 * শৈলী-সিদ্ধান্ত (design §৭, খ): ফ্ল্যাট সিলুয়েট + জোড়া-ঘূর্ণন অংশ, চামড়ার পুতুল/যাত্রার
 * পট-ভাব। কোনো ছবি-ফাইল নেই — পুরো শরিল ১৩টি টুকরোর (মাথা, বুক, কোমর, ২ বাহু,
 * ২ উরু, ২ পা, ঢাল, খড়্গ, পট-আঁচল) প্যারা-অ্যারে থেকে আঁকা।
 *
 * কেন এই পথ: ফাইল-আকার প্রায় শূন্য (৬MB বাজেটে শিল্পীর বোঝা নেই), মোবাইলে দ্রুত,
 * আর আঁকার অসম্পূর্ণতা শৈলীতেই ঢাকা পড়ে। ইমেজ-বেইল্ড ফ্রেম দরকার হলে এই এক ইন্টারফেস
 * বদলে ৩D→স্প্রাইট বেক বসবে — সিমুলেশন-স্তর অক্ষত থাকবে।
 *
 * রক্ত নেই: আঘাতে ধুলো/রেখা-ফোটকা, রঙ-পাল্টানো, কাঁপুনি — এই তিনটেই।
 */
import type { Fighter } from './fighter.ts';
import { MOVES, isActive, totalFrames } from './frames.ts';
import type { Sim } from './sim.ts';

export interface ViewOpts {
  reduceMotion: boolean;
  colorblind: boolean;
  /** অধ্যায়-ভিত্তিক রঙ (মাটি/নদী/ইট/সোনালি) — স্থাপত্য-অনুপ্রেরণা, ছবি নয়। */
  palette: Palette;
  /** আর্কেড-পিক্সেল মোড (ডিফল্ট চালু): ব্যাকিং-স্টোর অর্ধেক রেজ্যোলিউশন,
   *  ব্রাউজার nearest-neighbour-এ বড় করে → দানা-দানা পিক্সেল + CRT ছায়া। */
  pixel?: boolean;
}

const hex = (c: string): [number, number, number] => {
  const n = parseInt(c.slice(1), 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
};
const mix = (a: string, b: string, t: number): string => {
  const x = hex(a), y = hex(b);
  const r = Math.round(x[0] + (y[0] - x[0]) * t), g = Math.round(x[1] + (y[1] - x[1]) * t), bl = Math.round(x[2] + (y[2] - x[2]) * t);
  return `rgb(${r},${g},${bl})`;
};
/** বায়ার ৪×৪ থ্রেশহোল্ড — দুই টোনের মাঝের জায়গা দানা-মিশিয়ে ফাঁক করা হয়,
 *  তাই গ্রেডিয়েন্ট সমতল লাগে না আর প্যালেট সীমিত-মনে পড়ে (আর্কেডের ভাব)। */
const BAYER = [0, 8, 2, 10, 12, 4, 14, 6, 3, 11, 1, 9, 15, 7, 13, 5];
const bayer = (x: number, y: number, n: number): number => (BAYER[((y & 3) << 2) | (x & 3)]! + 0.5) / 16 * n;
const BN_DIGIT = ['০', '১', '২', '৩', '৪', '৫', '৬', '৭', '৮', '৯'];
const bnNum = (n: number): string => String(n).replace(/\d/g, (d) => BN_DIGIT[Number(d)] ?? d);

export interface Palette {
  ground: string; sky: string; ink: string; accent: string; hero: string; enemy: string; ally: string;
}

/** অধ্যায়ের ধাঁচ থেকে প্যালেট — ০…৮। */
export const PALETTES: Palette[] = [
  { ground: '#3a4a3c', sky: '#7e94a0', ink: '#171410', accent: '#2c6f6a', hero: '#e9dfc8', enemy: '#5b5346', ally: '#7f9c6b' },
  { ground: '#4a3f2c', sky: '#c39a5a', ink: '#191410', accent: '#8a4a22', hero: '#efe3c6', enemy: '#4f4636', ally: '#8f8358' },
  { ground: '#41414d', sky: '#94a3b8', ink: '#14161c', accent: '#3f5f8a', hero: '#e6e3d6', enemy: '#3d4250', ally: '#7d8698' },
  { ground: '#5b4a2f', sky: '#d8b06a', ink: '#1d1608', accent: '#a8761f', hero: '#f2e6c2', enemy: '#57472e', ally: '#93803f' },
  { ground: '#6a4a3a', sky: '#e0b48a', ink: '#20140d', accent: '#b4763c', hero: '#f6e9cd', enemy: '#62493c', ally: '#a89360' },
  { ground: '#4d5545', sky: '#b6b48c', ink: '#171a14', accent: '#7c8f4a', hero: '#eee6c8', enemy: '#4d5449', ally: '#8b9464' },
  { ground: '#2f4a52', sky: '#8fb0b8', ink: '#101c20', accent: '#2e7d8c', hero: '#e7eee6', enemy: '#3a4f57', ally: '#6f9488' },
  { ground: '#5a3f46', sky: '#dcae9f', ink: '#1e1215', accent: '#9c4b52', hero: '#f5e7d4', enemy: '#5d4348', ally: '#a08571' },
  { ground: '#443f52', sky: '#b9a7b5', ink: '#15131c', accent: '#6a4f8a', hero: '#ece6f0', enemy: '#4a4458', ally: '#8a8398' },
];

const W = 760, H = 360, GROUND = 268;

/** ১৩ টুকরোর কঙ্কাল: প্রতিটি অংশের অ্যাঙ্গেল এখানেই ঠিক হয় (মুভের ফ্রেম থেকে)। */
interface Pose {
  lean: number; crouch: number; sword: number; swordB: number;
  armF: number; armB: number; legF: number; legB: number; lunge: number; cloth: number;
}

function poseOf(f: Fighter, tick: number): Pose {
  const p: Pose = { lean: 0, crouch: 0, sword: -0.5, swordB: -0.5, armF: -0.6, armB: 0.5, legF: 0.2, legB: -0.2, lunge: 0, cloth: 0 };
  const m = f.move;
  if (m === null) {
    const b = Math.sin((tick + f.x) / 22) * 0.03;
    p.sword = -0.55 + b; p.cloth = b * 2; p.lean = 0.04;
    return p;
  }
  const fr = f.frame;
  const st = m.startup, ac = m.startup + m.active - 1;
  const prog = fr <= st ? fr / Math.max(1, m.startup)
    : fr <= ac ? 1
      : 1 - (fr - ac) / Math.max(1, totalFrames(m) - 1 - ac);
  switch (m.id) {
    case 'cut': p.sword = -1.35 + prog * 1.9; p.armF = -1.2 + prog * 1.6; p.lean = 0.1 * prog; p.lunge = prog * 5; break;
    case 'heavy': p.sword = -2.25 + prog * 3.1; p.armF = -1.85 + prog * 2.5; p.lean = 0.22 * prog; p.crouch = -3 * prog; p.lunge = prog * 9; break;
    case 'thrust': p.sword = -0.12; p.armF = -0.1; p.lunge = prog * 20; p.lean = 0.12 * prog; p.crouch = 4 * prog; break;
    case 'guard': p.swordB = -1.5; p.armB = -1.15; p.crouch = 5; p.lean = -0.06; break;
    case 'side': p.lean = -0.34; p.crouch = 8; p.cloth = 0.5; p.sword = -0.1; break;
    case 'resolve': p.sword = -2.6 + prog * 4.4; p.armF = -2 + prog * 3.2; p.lean = 0.3 * prog; p.cloth = 0.8 * prog; p.lunge = prog * 26; break;
  }
  if (f.phase === 'hitstun') { p.lean = -0.42; p.crouch = 6; p.sword = 0.9; p.cloth = -0.4; }
  if (f.phase === 'blockstun') { p.lean = -0.2; p.crouch = 7; p.swordB = -1.6; }
  if (f.phase === 'stunned') { p.lean = -0.55; p.crouch = 12; p.armF = 0.9; p.armB = 1.1; p.sword = 1.4; }
  if (f.phase === 'downed') { p.lean = -1.3; p.crouch = 26; p.cloth = 1; }
  return p;
}

const at = (t: [number, number], i: 0 | 1): number => t[i] ?? 0;

function limb(ctx: CanvasRenderingContext2D, x: number, y: number, ang: number, len: number, thick: number, color: string): [number, number] {
  const ex = x + Math.cos(ang) * len, ey = y + Math.sin(ang) * len;
  ctx.strokeStyle = color; ctx.lineWidth = thick; ctx.lineCap = 'round';
  ctx.beginPath(); ctx.moveTo(x, y); ctx.lineTo(ex, ey); ctx.stroke();
  return [ex, ey];
}
/** ছায়ার দেহ + কিনারা-আলো: দুই পাস, তাই পুতুলটা পর্দা থেকে আলাদা দেখায়। */
function limb2(ctx: CanvasRenderingContext2D, x: number, y: number, ang: number, len: number, thick: number, ink: string, rim: string): [number, number] {
  limb(ctx, x, y, ang, len, thick + 3, rim);
  return limb(ctx, x, y, ang, len, thick, ink);
}

export class Renderer {
  private ctx: CanvasRenderingContext2D;
  private shake = 0;
  private dust: { x: number; y: number; vx: number; vy: number; life: number; r: number }[] = [];
  private flash: { x: number; y: number; life: number }[] = [];
  /** ভাসমান ক্ষতি-সংখ্যা আর আর্কেড-ঘোষণা ('লড়াই!', 'কো!')। */
  private pops: { x: number; y: number; vy: number; life: number; txt: string; col: string }[] = [];
  private say: { text: string; life: number; sub: string } | null = null;
  private white = 0;
  private tex: { key: string; img: ImageData } | null = null;
  readonly canvas: HTMLCanvasElement;
  private opts: ViewOpts;

  constructor(canvas: HTMLCanvasElement, opts: ViewOpts) {
    this.canvas = canvas;
    const c = canvas.getContext('2d', { alpha: false });
    if (!c) throw new Error('Canvas2D পাওয়া যায়নি');
    this.ctx = c;
    this.opts = opts;
    this.resize();
  }

  setOpts(o: ViewOpts): void { this.opts = o; }

  private get pixel(): boolean { return this.opts.pixel !== false; }

  resize(): void {
    const dpr = Math.min(2, window.devicePixelRatio || 1);
    const box = this.canvas.getBoundingClientRect();
    const cssW = box.width || W;
    const scale = cssW / W;
    // পিক্সেল মোড: ব্যাকিং-স্টোর ১/২ (৩৮০×১৮০), CSS-এ nearest-neighbour-এ প্রসারিত।
    const q = this.pixel ? 0.5 : 1;
    this.canvas.width = Math.max(2, Math.round(cssW * dpr * q));
    this.canvas.height = Math.max(2, Math.round(H * scale * dpr * q));
    this.ctx.setTransform(this.canvas.width / W, 0, 0, this.canvas.width / W, 0, 0);
    this.ctx.imageSmoothingEnabled = false;
    this.scale = scale * dpr * q;
    this.tex = null;   // রেজ্যোলিউশন বদলালে টেক্সচার আবার বানাতে হবে
  }
  private scale = 1;

  /** আঘাতের সংখ্যা/শব্দ-বাঁধন: ক্ষতি-পপ, বড় হলে পর্দা-ঝলক। */
  pop(x: number, y: number, txt: string, col = '#f7f0dc'): void {
    this.pops.push({ x, y: y - 44, vy: -1.15, life: 40, txt, col });
  }
  announce(text: string, sub = '', frames = 96): void { this.say = { text, sub, life: frames }; }

  /** পিক্সেল-গ্রিডে থিতু করা: ০.৫-স্কেলে আধা-পিক্সেল রেখা ঝাপসা হতো। */
  private sn(v: number): number { return this.pixel ? Math.round(v * 2) / 2 : Math.round(v); }

  kick(power: number): void {
    if (this.opts.reduceMotion) return;
    this.shake = Math.max(this.shake, power);
    if (power >= 7) this.white = Math.max(this.white, 3);   // ভারী ঘায়ে সাদা ঝলক
  }

  burst(x: number, y: number, n = 10, col = '#e9dfc8'): void {
    for (let i = 0; i < n; i++) {
      const a = Math.random() * Math.PI * 2, s = 1 + Math.random() * 3.4;
      this.dust.push({ x, y: y - 30, vx: Math.cos(a) * s, vy: Math.sin(a) * s - 1.4, life: 22 + Math.random() * 14, r: 1.5 + Math.random() * 2.6 });
    }
    void col;
    this.flash.push({ x, y: y - 34, life: 9 });
  }

  draw(sim: Sim, tick: number): void {
    const { ctx } = this;
    const P = this.opts.palette;
    ctx.save();
    if (this.shake > 0.4) {
      ctx.translate((Math.random() - 0.5) * this.shake, (Math.random() - 0.5) * this.shake * 0.6);
      this.shake *= 0.82;
    }
    // আকাশ + মাটি: দিদার-করা টেক্সচার (একবার বানিয়ে প্রতি ফ্রেমে বসানো হয়)
    if (!this.paintGround(P)) {
      const g = ctx.createLinearGradient(0, 0, 0, H);
      g.addColorStop(0, P.sky); g.addColorStop(0.62, P.sky); g.addColorStop(0.63, P.ground); g.addColorStop(1, P.ink);
      ctx.fillStyle = g; ctx.fillRect(-20, -20, W + 40, H + 40);
    }
    // দুই তলার প্যারালাক্স: দূরের সারি ধীরে-ছোট, কাছের সারি দ্রুত-বড় → সমতল ভাব কাটে
    ctx.save(); ctx.globalAlpha = 0.42;
    this.backdrop(sim, P, tick, 0.45, 0.72);
    ctx.restore();
    this.backdrop(sim, P, tick, 1, 1);

    if (sim.objective) this.boat(ctx, sim.objective.x, GROUND + sim.objective.y * 0.5, sim.objective, P);

    const list = [...sim.enemies.map((f) => [f, 'foe'] as const),
      ...(sim.ally ? [[sim.ally, 'ally'] as const] : []),
      [sim.player, 'hero'] as const]
      .sort((a, b) => a[0].y - b[0].y);
    for (const [f, role] of list) this.puppet(ctx, f, tick, P, role);

    // ধুলো
    for (const d of this.dust) {
      d.x += d.vx; d.y += d.vy; d.vy += 0.16; d.life -= 1;
      ctx.globalAlpha = Math.max(0, d.life / 34);
      ctx.fillStyle = '#e9dfc8';
      ctx.beginPath(); ctx.arc(d.x, d.y, d.r, 0, 6.283); ctx.fill();
    }
    ctx.globalAlpha = 1;
    this.dust = this.dust.filter((d) => d.life > 0);
    // ক্ষতি-পপ (আর্কেডের সংখ্যা-উড়ে-থাকা)
    for (const q of this.pops) {
      q.y += q.vy; q.vy += 0.045; q.life -= 1;
      ctx.globalAlpha = Math.min(1, q.life / 16);
      ctx.font = '700 19px "Noto Sans Bengali", "Hind Siliguri", system-ui, sans-serif';
      ctx.textAlign = 'center';
      ctx.fillStyle = 'rgba(8,7,6,.85)'; ctx.fillText(q.txt, this.sn(q.x) + 2, this.sn(q.y) + 2);
      ctx.fillStyle = q.col; ctx.fillText(q.txt, this.sn(q.x), this.sn(q.y));
    }
    ctx.textAlign = 'left'; ctx.globalAlpha = 1;
    this.pops = this.pops.filter((q) => q.life > 0);
    // একসাথে কটি প্রতিপক্ষ ধরা-পড়ে → কম্বো-গণনা (সিম-এ নতুন ফিল্ড লাগেনি)
    const cn = sim.enemies.filter((e) => e.phase === 'hitstun' || e.phase === 'blockstun').length;
    if (cn > 1) {
      ctx.font = '700 22px "Noto Sans Bengali", "Hind Siliguri", system-ui, sans-serif'; ctx.textAlign = 'right';
      ctx.fillStyle = 'rgba(8,7,6,.8)'; ctx.fillText(`×${bnNum(cn)}`, W - 26, 60);
      ctx.fillStyle = P.accent === '#2c6f6a' ? '#ffe9a8' : '#fff2cf'; ctx.fillText(`×${bnNum(cn)}`, W - 28, 58);
      ctx.textAlign = 'left';
    }
    // আর্কেড ঘোষণা: 'লড়াই!' / 'কো!'
    if (this.say) {
      this.say.life -= 1;
      const k = Math.min(1, (96 - this.say.life) / 8), fade = Math.min(1, this.say.life / 18);
      ctx.save();
      ctx.globalAlpha = fade; ctx.textAlign = 'center';
      const sc = 0.9 + k * 0.1, cy = 128;
      ctx.translate(W / 2, cy); ctx.scale(sc, sc);
      ctx.font = '700 62px "Noto Sans Bengali", "Hind Siliguri", system-ui, sans-serif';
      ctx.lineWidth = 8; ctx.strokeStyle = 'rgba(10,8,6,.9)'; ctx.strokeText(this.say.text, 0, 0);
      ctx.fillStyle = '#fdf3d8'; ctx.fillText(this.say.text, 0, 0);
      if (this.say.sub) {
        ctx.font = '400 21px "Noto Sans Bengali", "Hind Siliguri", system-ui, sans-serif';
        ctx.lineWidth = 5; ctx.strokeStyle = 'rgba(10,8,6,.9)'; ctx.strokeText(this.say.sub, 0, 32);
        ctx.fillStyle = '#f0e6cf'; ctx.fillText(this.say.sub, 0, 32);
      }
      ctx.restore(); ctx.textAlign = 'left';
      if (this.say.life <= 0) this.say = null;
    }
    this.foreground(sim, P, tick);
    if (this.white > 0) { ctx.fillStyle = `rgba(255,250,235,${0.09 * this.white})`; ctx.fillRect(0, 0, W, H); this.white -= 1; }
    if (this.pixel) this.scanlines();
    for (const fl of this.flash) {
      fl.life -= 1;
      const k = Math.max(0, fl.life / 9);
      ctx.strokeStyle = `rgba(255,240,205,${0.1 + k * 0.8})`;
      ctx.lineWidth = 2 + k * 3;
      ctx.beginPath(); ctx.arc(fl.x, fl.y, 12 + (1 - k) * 26, 0, 6.283); ctx.stroke();
    }
    this.flash = this.flash.filter((f) => f.life > 0);
    ctx.restore();
  }

  /**
   * অধ্যায়ভিত্তিক আকাশরেখা — স্থাপত্যের *রূপ*, কোনো তারিখ-দাবি নয়।
   *
   * বাংলার দুটো নিজস্ব রেখা এখানেই বসানো: (ক) ঠাং/ছাউনির ছাদ থেকে নামা **বক্র
   * কর্নিশ** (দো-ছলা), যা সুলতানি ইটের মসজিদেও ঢুকে গেছে — তাই এখানে গোল ছাদ নয়,
   * বাঁকানো ছাদ; (খ) **কীলকমে** (নোকচওয়ালা মেहरাব-খিলান), দেশি ইটের দেয়ালের ছন্দ।
   * ঢাল-ছাদ/কীলকমে/ছোট-গম্বুজের সারি — পান্ডুয়া-গৌড়-সোনারগাঁও-বাগেরহাটের ছায়ায়
   * যা বারবার দেখা যায়, সেটাই রেকর্ড-অনুগত রূপ; ভেতরের কারুকার্য (টেরাকোটা প্যানেল)
   * রেখার পুরুত্বের তারতম্য দিয়েই বোঝানো, ছবি আঁকা নয়।
   */
  /**
   * আকাশ+মাটি একবারই পিক্সেল-ধরে ধরে বানানো হয় (ImageData), তারপর প্রতি ফ্রেমে
   * putImageData। ফল: স্তর-বাঁধা (quantized) আকাশ, বায়ার দিদার, পোড়া-রোদের দাগ,
   * গায়ে-পোড়া মাটির দানা — মানে 'সব সমতল' অভিযোগের সরাসরি জবাব, আর খরচ এক কল।
   * ব্রাউজার/স্টাব DOM-এ createImageData না চললে ফিরে যায় গ্রেডিয়েন্টে (ক্র্যাশ নয়)।
   */
  private paintGround(P: Palette): boolean {
    const { ctx } = this;
    const bw = this.canvas.width, bh = this.canvas.height;
    if (!this.pixel || bw < 8 || bh < 8) return false;
    const key = `${P.sky}${P.ground}${P.ink}${P.accent}${bw}x${bh}${this.opts.colorblind}`;
    if (!this.tex || this.tex.key !== key) {
      let img: ImageData | undefined;
      try { img = ctx.createImageData(bw, bh); } catch { img = undefined; }
      if (!img || !(img.data instanceof Uint8ClampedArray)) return false;
      const d = img.data;
      const sky = hex(P.sky), gnd = hex(P.ground), ink = hex(P.ink), acc = hex(P.accent);
      const horizon = Math.round((GROUND / H) * bh);
      const STEPS = 7;
      for (let y = 0; y < bh; y++) {
        const t = y / bh;
        for (let x = 0; x < bw; x++) {
          let c: [number, number, number];
          if (y < horizon) {
            // আকাশ: উপরে গাঢ়, ক্ষিতিজে ফ্যাকাসে — ধাপে ধাপে, দিদারে গাথা
            const up = 1 - y / Math.max(1, horizon);
            const lvl = Math.min(STEPS - 1, Math.floor(up * STEPS));
            const f = up * STEPS - lvl;
            const pick = f > bayer(x, y, 1) ? Math.min(STEPS - 1, lvl + 1) : lvl;
            const k = pick / (STEPS - 1);
            c = [
              sky[0] + (ink[0] - sky[0]) * (1 - k) * 0.55,
              sky[1] + (ink[1] - sky[1]) * (1 - k) * 0.55,
              sky[2] + (ink[2] - sky[2]) * (1 - k) * 0.55,
            ];
            // ক্ষিতিজের কাছে রোদের উজ্জ্বল পটি
            if (y > horizon - 9) {
              const w = (y - (horizon - 9)) / 9;
              c = [c[0] + acc[0] * 0.16 * w, c[1] + acc[1] * 0.16 * w, c[2] + acc[2] * 0.12 * w];
            }
            // রোদের থালা (উঁচু-ডানে) + আলোর দানা
            const dx = x - bw * 0.78, dy = y - bh * 0.16;
            const rr = dx * dx + dy * dy * 1.5;
            if (rr < 150) c = [Math.min(255, c[0] + 74), Math.min(255, c[1] + 66), Math.min(255, c[2] + 40)];
            else if (rr < 380 && bayer(x, y, 1) > 0.5) c = [c[0] + 26, c[1] + 24, c[2] + 14];
          } else {
            // মাটি: উপরে উজ্জ্বল, নিচে কালো — দানা-দিদার আর চাকা-রেখা
            const k = Math.min(1, (y - horizon) / Math.max(1, bh - horizon));
            const base: [number, number, number] = [
              gnd[0] + (ink[0] - gnd[0]) * k,
              gnd[1] + (ink[1] - gnd[1]) * k,
              gnd[2] + (ink[2] - gnd[2]) * k,
            ];
            const n = bayer(x, y, 1);
            const speck = ((x * 7 + y * 13) % 29) < 3 ? 16 : 0;
            c = [base[0] + (n > 0.72 ? 12 : n < 0.2 ? -14 : 0) + speck,
                 base[1] + (n > 0.72 ? 11 : n < 0.2 ? -15 : 0) + speck * 0.8,
                 base[2] + (n > 0.72 ? 9 : n < 0.2 ? -13 : 0) + speck * 0.6];
            if (y === horizon) { c = [sky[0] * 0.72 + acc[0] * 0.1, sky[1] * 0.72 + acc[1] * 0.1, sky[2] * 0.7]; }
          }
          const i = (y * bw + x) << 2;
          d[i] = c[0]; d[i + 1] = c[1]; d[i + 2] = c[2]; d[i + 3] = 255;
        }
      }
      this.tex = { key, img };
    }
    ctx.save();
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.putImageData(this.tex.img, 0, 0);
    ctx.restore();
    return true;
  }

  /** সামনের তলা: নদীপাড়ের ঘাস/বাশের ডগা — খেলোয়ারটা মাঝের তলায় বসে, এই এক লাইনে
   *  পর্দায় গভীরতা দেখায় (আগে সব কিছু একই তলায়, সমতল লাগত)। */
  private foreground(sim: Sim, P: Palette, tick: number): void {
    const { ctx } = this;
    const drift = (sim.player.x * 0.16 + tick * 0.02) % 96;
    ctx.save();
    ctx.fillStyle = mix(P.ink, '#000000', 0.45);
    ctx.beginPath(); ctx.rect(0, GROUND + 34, W, H); ctx.clip();
    for (let i = -1; i < 9; i++) {
      const x = i * 96 - drift;
      for (let k = 0; k < 3; k++) {
        const bx = x + k * 13, hh = 16 + ((i * 7 + k * 5) % 4) * 7;
        ctx.beginPath(); ctx.moveTo(bx, H);
        ctx.quadraticCurveTo(bx + 3, H - hh * 0.6, bx + 8 + k, H - hh);
        ctx.lineTo(bx + 5, H); ctx.closePath(); ctx.fill();
      }
    }
    ctx.restore();
  }

  /** CRT-ছায়া: পিক্সেল-লাইনের ফাঁকে কালো পটি — আর্কেড ক্যাবিনেটের ভাব। */
  private scanlines(): void {
    const { ctx } = this;
    ctx.save();
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.fillStyle = 'rgba(6,5,4,.19)';
    for (let y = 1; y < this.canvas.height; y += 2) ctx.fillRect(0, y, this.canvas.width, 1);
    ctx.fillStyle = 'rgba(6,5,4,.22)';
    ctx.fillRect(0, 0, this.canvas.width, 2); ctx.fillRect(0, this.canvas.height - 2, this.canvas.width, 2);
    ctx.restore();
  }

  private backdrop(sim: Sim, P: Palette, tick: number, depth = 1, alpha = 1): void {
    const { ctx } = this;
    const id = sim.ch.id;
    // প্যারালাক্স: দূরের সারি খেলোয়াড়ের চলার সঙ্গে ধীরে সরে, কাছে-েরটা বেশি
    const drift = (tick * 0.06 * depth + sim.player.x * 0.05 * depth) % 108;
    if (alpha !== 1) ctx.globalAlpha = alpha;
    if (depth < 1) { ctx.translate(0, 18 * (1 - depth)); ctx.scale(1, 0.86); }
    ctx.fillStyle = 'rgba(0,0,0,.16)';
    for (let i = 0; i < 7; i++) {
      const x = 40 + i * 108 - drift;
      switch (true) {
        case id === 0: this.chala(ctx, x, 240, 74, 44); break;                 // বন্দর-পল্লী: ছাউনির ছায়া
        case id <= 2: this.arch(ctx, x + 12, 240, 50, 92); this.bar(ctx, x, 236, 78, 6); break;  // পুরনো দেওয়াল + কীলকমে
        case id === 3: this.domeRow(ctx, x, 214, 3, 20, 62); break;             // সোনারগাঁও: ছোট-গম্বুজের সারি
        case id === 4: this.domeRow(ctx, x - 6, 206, 5, 15, 92); this.bands(ctx, x - 6, 250, 92, 3); break; // পান্ডুয়া-গৌড়: ইট ও ঢাল-কর্নিশ
        case id === 5: this.battlement(ctx, x, 196, 86, 46); this.arch(ctx, x + 20, 242, 40, 46); break;     // দুর্গ-প্রান্তর
        case id === 6: this.battlement(ctx, x + 4, 202, 70, 40); break;         // ভূঁইয়ার গড়
        case id === 7: this.dome(ctx, x + 30, 208, 26); this.bar(ctx, x + 4, 176, 7, 74); this.battlement(ctx, x + 44, 214, 40, 28); break; // ঢাকা: গম্বুজ-মিনার-প্রাচীর
        default: this.tree(ctx, x + 22, 236, 52); this.tree(ctx, x + 76, 238, 34); break;                    // আম্রকানন: আমগাছের সারি
      }
    }
    if (id === 0 || id >= 6) {
      ctx.fillStyle = 'rgba(180,220,235,.16)';
      ctx.fillRect(0, GROUND + 26, W, 26);
    }
  }
  /** কীলকমে: দুই বাঁকা বাহু উঠে গিয়ে নোক — বাংলার ইটের দেওয়ালের নিজস্ব খিলান। */
  private arch(ctx: CanvasRenderingContext2D, x: number, y: number, w: number, h: number): void {
    ctx.beginPath();
    ctx.moveTo(x, y); ctx.lineTo(x, y - h * 0.55);
    ctx.quadraticCurveTo(x + w * 0.06, y - h, x + w / 2, y - h - h * 0.1);
    ctx.quadraticCurveTo(x + w * 0.94, y - h, x + w, y - h * 0.55);
    ctx.lineTo(x + w, y); ctx.closePath(); ctx.fill();
  }
  /** দো-ছলা: দুই পাশে ঢাল-ছাদ, মাঝে নוקচওয়ালা শিখর — ছাউনির ঘর আর মন্দির দুটোরই রেখা। */
  private chala(ctx: CanvasRenderingContext2D, x: number, y: number, w: number, h: number): void {
    ctx.beginPath();
    ctx.moveTo(x, y);
    ctx.quadraticCurveTo(x + w * 0.14, y - h * 0.7, x + w / 2, y - h);
    ctx.quadraticCurveTo(x + w * 0.86, y - h * 0.7, x + w, y);
    ctx.lineTo(x + w * 0.86, y - h * 0.16); ctx.lineTo(x + w * 0.14, y - h * 0.16);
    ctx.closePath(); ctx.fill();
  }
  /** ছোট গম্বুজের সারি + কোণের টাওয়েট (বাগেরহাট-পান্ডুয়া ছায়া)। */
  private domeRow(ctx: CanvasRenderingContext2D, x: number, y: number, n: number, r: number, w: number): void {
    ctx.fillRect(x, y, w, 42);
    const step = w / (n + 1);
    for (let i = 0; i < n; i++) this.dome(ctx, x + step * (i + 1), y, r);
    ctx.fillRect(x - 5, y - 14, 6, 56); ctx.fillRect(x + w - 1, y - 14, 6, 56);
  }
  private dome(ctx: CanvasRenderingContext2D, x: number, y: number, r: number): void {
    ctx.beginPath();
    ctx.moveTo(x - r, y);
    ctx.quadraticCurveTo(x - r, y - r * 1.15, x, y - r * 1.45);   // গোল নয় — একটু নোকচা ছাদ
    ctx.quadraticCurveTo(x + r, y - r * 1.15, x + r, y);
    ctx.closePath(); ctx.fill();
    ctx.fillRect(x - 1, y - r * 1.45 - 5, 2, 5);                  // শিখর-ডাটা
  }
  private battlement(ctx: CanvasRenderingContext2D, x: number, y: number, w: number, h: number): void {
    ctx.fillRect(x, y, w, h);
    for (let i = 0; i < 5; i++) ctx.fillRect(x + i * (w / 5), y - 8, w / 10, 8);
  }
  /** দেওয়ালের টুকরো: স্তম্াব-বেধ/কর্নিশের মতো সরু ভরপেল। */
  private bar(ctx: CanvasRenderingContext2D, x: number, y: number, w: number, h: number): void {
    ctx.fillRect(x, y, w, h);
  }
  /** ইটের দেওয়ালে টেরাকোটার প্যানেল-ছন্দ: পুরু রেখা নয়, ফাঁক-রেখাই যথেষ্ট। */
  private bands(ctx: CanvasRenderingContext2D, x: number, y: number, w: number, n: number): void {
    ctx.save(); ctx.globalAlpha = 0.5; ctx.fillStyle = 'rgba(255,235,200,.5)';
    for (let i = 0; i < n; i++) ctx.fillRect(x + 3, y + 4 + i * 7, w - 6, 2);
    ctx.restore();
  }
  /** আমগাছের ছায়া: মোটা ঠার + তিন-চৌকা গুচ্ছছায়া — পলাশীর আম্রকাননের চেনা রেখা। */
  private tree(ctx: CanvasRenderingContext2D, x: number, y: number, h: number): void {
    ctx.save();
    ctx.strokeStyle = ctx.fillStyle as unknown as string; ctx.lineWidth = Math.max(4, h * 0.16);
    ctx.beginPath(); ctx.moveTo(x, y); ctx.lineTo(x, y - h * 0.42); ctx.stroke();
    const r = h * 0.5;
    ctx.beginPath(); ctx.moveTo(x - r * 1.5, y - h * 0.34);
    for (let i = 0; i <= 4; i++) {
      const px = x - r * 1.5 + (i / 4) * r * 3;
      ctx.quadraticCurveTo(px + r * 0.375, y - h * 0.34 - r * (i % 2 ? 1.15 : 1.55), px + r * 0.75, y - h * 0.34);
    }
    ctx.closePath(); ctx.fill();
    ctx.restore();
  }
  /** খেজুর/বাশের পালক — নদীপাড়ার অধ্যায়ে (০, ৬) মাটির ধারে। */
  private reed(ctx: CanvasRenderingContext2D, x: number, y: number, h: number): void {
    ctx.save(); ctx.lineWidth = 2;
    for (let i = 0; i < 4; i++) {
      const a = -1.35 + i * 0.28;
      ctx.beginPath(); ctx.moveTo(x, y);
      ctx.quadraticCurveTo(x + Math.cos(a) * h * 0.4, y - h * 0.7, x + Math.cos(a) * h * 0.8, y - h);
      ctx.stroke();
    }
    ctx.restore();
  }

  private boat(ctx: CanvasRenderingContext2D, x: number, y: number, o: { hp: number; maxHp: number }, P: Palette): void {
    const hurt = 1 - o.hp / o.maxHp;
    ctx.save(); ctx.translate(x, y + 6);
    ctx.fillStyle = P.ink; ctx.globalAlpha = 0.8;
    ctx.beginPath(); ctx.moveTo(-44, 0); ctx.quadraticCurveTo(-30, 20, 0, 20);
    ctx.quadraticCurveTo(34, 20, 48, 0); ctx.quadraticCurveTo(6, 10, -44, 0); ctx.fill();
    ctx.strokeStyle = P.ink; ctx.lineWidth = 3;
    ctx.beginPath(); ctx.moveTo(0, 4); ctx.lineTo(0, -40); ctx.stroke();
    ctx.globalAlpha = 0.7 + hurt * 0.2;
    ctx.fillStyle = hurt > 0.5 ? '#7a5a3a' : P.accent;
    ctx.beginPath(); ctx.moveTo(2, -40); ctx.lineTo(30, -22); ctx.lineTo(2, -8); ctx.closePath(); ctx.fill();
    ctx.restore();
    ctx.globalAlpha = 1;
  }

  private puppet(ctx: CanvasRenderingContext2D, f: Fighter, tick: number, P: Palette, role: 'hero' | 'foe' | 'ally' = 'foe'): void {
    const dir = f.facing === 1 ? 1 : -1;
    const depth = 1 + f.y / 420;
    const baseY = GROUND + f.y * 0.5;
    const p = poseOf(f, tick);
    const isHero = f === (null as unknown as Fighter) || f.tone === P.hero;
    void isHero;
    // শৈলী-নিয়ম (design §৭, খ): পুতুল = আলোর পর্দায় **কালো ছায়া**। আগে শরিলেই
    // দলের রঙ বসত, ফলে সেটা 'ছায়া-পুতুল' নয়, ফ্যাকাসে কাঠি-মানুষ হয়ে যাচ্ছিল
    // (হেরো-ফ্রেম কেটে দেখে ধরা পড়েছে)। এখন শরিল কালো, দলের চেনা-রঙ শুধু
    // কিনারা-আলো — মোবাইলের ছোট পর্দায়ও বন্ধু/শত্রু আলাদা দেখায়।
    const ink = '#141109';
    const rim = this.opts.colorblind ? (f.tone === P.hero ? '#f5f1e4' : '#9fd6ff') : f.tone;
    const shadowCol = 'rgba(0,0,0,.3)';
    ctx.save();
    ctx.translate(f.x + p.lunge * dir, baseY);
    ctx.scale(depth * dir, depth);
    // ছায়া-মেঝে
    ctx.fillStyle = shadowCol;
    ctx.beginPath(); ctx.ellipse(0, 2, 26, 6, 0, 0, 6.283); ctx.fill();
    if (f.invulnerable) ctx.globalAlpha = 0.72;
    ctx.rotate(p.lean * 0.5);
    const hipY = -34 + p.crouch;
    const chestY = hipY - 26;
    const headY = chestY - 16;
    // উরু-পা
    const legF = limb2(ctx, 0, hipY, 1.35 + p.legF, 20, 9, ink, rim);
    limb2(ctx, at(legF, 0), at(legF, 1), 1.5 - p.legF * 0.4, 18, 8, ink, rim);
    const legB = limb2(ctx, -2, hipY, 1.75 + p.legB, 20, 9, ink, rim);
    limb2(ctx, at(legB, 0), at(legB, 1), 1.5 - p.legB * 0.4, 18, 8, ink, rim);
    // আসল (প্যাচ/চাদর)
    ctx.fillStyle = ink;
    ctx.beginPath();
    ctx.moveTo(-9, chestY + 4); ctx.lineTo(11, chestY + 4);
    ctx.lineTo(9 + p.cloth * 8, hipY + 16); ctx.lineTo(-11 - p.cloth * 10, hipY + 14);
    ctx.closePath(); ctx.fill();
    ctx.strokeStyle = rim; ctx.lineWidth = 1.6; ctx.stroke();
    // বুক
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';
    const bodyPath = (): void => {
      ctx.beginPath();
      ctx.moveTo(p.lean * 6 - 9, chestY - 3); ctx.lineTo(p.lean * 6 + 9, chestY - 3);
      ctx.lineTo(10, hipY - 2); ctx.lineTo(12, hipY + 13); ctx.lineTo(-11, hipY + 13); ctx.lineTo(-9, hipY - 2);
      ctx.closePath();
    };
    ctx.lineWidth = 5; ctx.strokeStyle = rim; bodyPath(); ctx.stroke();
    ctx.fillStyle = ink; bodyPath(); ctx.fill();
    // পিঠে-ওপরের আলো: একটি উজ্জ্বল রেখা + বুকে ছায়া-ঢাল — নিকষি কালোটা জমে ওঠে
    ctx.strokeStyle = mix(ink, rim, 0.6); ctx.lineWidth = 2;
    ctx.beginPath(); ctx.moveTo(p.lean * 6 - 6, chestY - 2); ctx.lineTo(p.lean * 6 + 6, chestY - 2); ctx.stroke();
    ctx.fillStyle = mix(ink, '#000000', 0.55);
    ctx.beginPath(); ctx.moveTo(p.lean * 6 + 3, chestY); ctx.lineTo(9, hipY - 2); ctx.lineTo(10, hipY + 9); ctx.lineTo(2, hipY + 9); ctx.closePath(); ctx.fill();
    ctx.lineWidth = 16; ctx.strokeStyle = rim;
    ctx.beginPath(); ctx.moveTo(0, hipY); ctx.lineTo(p.lean * 6, chestY); ctx.stroke();
    ctx.lineWidth = 13; ctx.strokeStyle = ink;
    ctx.beginPath(); ctx.moveTo(0, hipY); ctx.lineTo(p.lean * 6, chestY); ctx.stroke();
    // পিছনের হাত + ঢাল
    const sh: [number, number] = [p.lean * 6, chestY];
    const back = limb2(ctx, at(sh, 0) - 3, at(sh, 1), Math.PI - 0.7 + p.armB, 15, 8, ink, rim);
    if (f.guarding || f.move?.id === 'guard') {
      ctx.fillStyle = P.accent;
      ctx.beginPath(); ctx.ellipse(at(back, 0) - 2, at(back, 1) + 6, 11, 15, -0.3 + p.swordB * 0.2, 0, 6.283); ctx.fill();
      ctx.strokeStyle = 'rgba(255,255,255,.25)'; ctx.lineWidth = 1.5; ctx.stroke();
    }
    // সামনের হাত + খড়্গ
    const front = limb2(ctx, at(sh, 0) + 3, at(sh, 1), -0.5 + p.armF, 16, 8, ink, rim);
    const bladeAng = p.sword;
    ctx.strokeStyle = this.opts.colorblind ? '#ffffff' : '#f3ead2';
    ctx.lineWidth = 3.2;
    const steel = this.opts.colorblind ? '#ffffff' : '#f3ead2';
    const bl = limb(ctx, at(front, 0), at(front, 1), bladeAng, 34, 3.2, steel);
    // বাঁকালো ধার = তলোয়ার (কাটা/কোপ/সংকল্প); সোজা ধার = রূপা/ধপ (পোঁতা, রোধ)।
    const curved = f.move === null || (f.move.id !== 'thrust' && f.move.id !== 'guard');
    const nx = Math.cos(bladeAng + Math.PI / 2), ny = Math.sin(bladeAng + Math.PI / 2);
    ctx.strokeStyle = 'rgba(255,255,255,.35)'; ctx.lineWidth = 1;
    const mx = (at(front, 0) + at(bl, 0)) / 2 + nx * 7, my = (at(front, 1) + at(bl, 1)) / 2 + ny * 7;
    ctx.beginPath(); ctx.moveTo(at(front, 0), at(front, 1));
    if (curved) ctx.quadraticCurveTo(mx, my, at(bl, 0), at(bl, 1));
    else ctx.lineTo(at(bl, 0), at(bl, 1));
    ctx.stroke();
    if (curved) {   // তলোয়ারের ধার: বাঁকানো ফলক ভরে দিলে সিলুয়েটটা পুতুলের মতো হয়
      ctx.fillStyle = steel; ctx.beginPath();
      ctx.moveTo(at(front, 0), at(front, 1));
      ctx.quadraticCurveTo(mx, my, at(bl, 0), at(bl, 1));
      ctx.quadraticCurveTo(mx - nx * 4, my - ny * 4, at(front, 0), at(front, 1));
      ctx.closePath(); ctx.fill();
    }
    // হাতা
    ctx.strokeStyle = P.accent; ctx.lineWidth = 4;
    limb(ctx, at(front, 0), at(front, 1), bladeAng + Math.PI, 6, 4, P.accent);
    // মাথা + জুলফা/সিরপট্টি
    ctx.fillStyle = ink;
    ctx.beginPath(); ctx.arc(p.lean * 8, headY, 8.4, 0, 6.283); ctx.fill();
    ctx.strokeStyle = rim; ctx.lineWidth = 1.6; ctx.stroke();
    const hx = p.lean * 8;
    ctx.fillStyle = ink;
    if (role === 'hero') {
      // খড়্গধরের নিজের চিহ্ন: গোল টোপর — মুসলিম বাংলার পদাতিকের সাধারণ মাথার ঢাকা
      ctx.beginPath(); ctx.ellipse(hx, headY - 8, 7.4, 4.2, 0, Math.PI, 0); ctx.fill();
      ctx.fillRect(hx - 7.4, headY - 8, 14.8, 2.4);
    } else if (role === 'ally') {
      ctx.beginPath(); ctx.moveTo(hx - 8, headY - 4);
      ctx.quadraticCurveTo(hx, headY - 12, hx + 8, headY - 4);
      ctx.lineTo(hx + 11, headY + 4); ctx.closePath(); ctx.fill();   // পল্লীর দস্তর
    } else {
      ctx.beginPath(); ctx.moveTo(hx - 9, headY - 2);
      ctx.quadraticCurveTo(hx - 1, headY - 15 - p.cloth * 3, hx + 9, headY - 1);
      ctx.closePath(); ctx.fill();                                     // প্রতিপক্ষের জুটি
    }
    if (f.guarding || f.move?.id === 'guard') {   // ঢালের বস্টন: চামড়ার গোল ঢালের নিজের চিহ্ন
      ctx.fillStyle = 'rgba(255,255,255,.3)';
      ctx.beginPath(); ctx.arc(at(back, 0) - 2, at(back, 1) + 6, 2.6, 0, 6.283); ctx.fill();
    }
    if (isActive(MOVES.guard, f.frame) && f.phase === 'guard') {
      ctx.globalAlpha = 0.5;
      ctx.strokeStyle = '#cfe6ef'; ctx.lineWidth = 2;
      ctx.beginPath(); ctx.arc(6, chestY + 6, 24, -1.1, 1.1); ctx.stroke();
    }
    ctx.restore();
    ctx.globalAlpha = 1;
    if (f.phase === 'stunned' && f !== undefined) {
      ctx.fillStyle = 'rgba(255,235,180,.9)';
      ctx.font = '700 12px system-ui';
      ctx.textAlign = 'center';
      ctx.fillText('!', f.x, baseY - 84);
      ctx.textAlign = 'start';
    }
  }

  /** ইনপুট-হিন্ট ফুটেজ: কোন মুভ চলছে সেটা ১-লাইনে (মোবাইলে বোতাম-লেবেলের সঙ্গে মিলিয়ে)। */
  currentMoveLabel(f: Fighter): string {
    return f.move ? MOVES[f.move.id].bn : '';
  }
}
