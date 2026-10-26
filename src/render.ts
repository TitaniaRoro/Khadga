/**
 * src/render.ts — ছায়া-পুতুল রেন্ডারার, আধুনিক আর্কেড-রূপে (Canvas2D)।
 *
 * শৈলী-সিদ্ধান্ত আগের মতোই (design §৭): কালো ছায়া-শরীর + রঙিন কিনারা-আলো,
 * কোনো ছবি-ফাইল নেই, রক্ত নেই। যা বদলেছে তা উপস্থাপন — অভিযোগ ছিল
 * "সব সমতল, কাঠি-মানুষের মতো, নিস্তেজ ধূসর"। তাই:
 *  · ডিফল্ট রূপ এখন পূর্ণ-রেজ্যোলিউশন HD (অর্ধ-রেজ পিক্সেল-রূপ টগলে অপশন);
 *  · চরিত্র মোটা-গড়া ভরা আকৃতি, হাঁটার চক্র, তলোয়ারের ঝাপটা-রেখা (swoosh),
 *    ধরনভেদে অস্ত্র/ঢাল/শরির (ঢালধারী, বর্শাধারী, দ্রুতগামী, বস);
 *  · ৪-তলা দৃশ্য: আকাশ (সূর্য, মেঘ, পাখি) → দিগন্তে দূরের বড় গাছ → খোলা
 *    সবুজ মাঠ → সামনের ছোট গাছপালা; নির্বাচিত জায়গায় সরু নদী, সঙ্গে ক্যামেরা-দোলন ও ঝাঁকুনি;
 *  · কণা-ব্যবস্থা: ধুলো, ঝিলিক, টুকরো, ভাসা ধুলিকণা; hit-flash, ড্যাশ-ভূতছায়া।
 *
 * ইমেজ-ভিত্তিক ফ্রেম দরকার হলে এই এক ইন্টারফেস বদলেই ৩D→স্প্রাইট বেক বসবে —
 * সিমুলেশন-স্তর অক্ষত থাকবে।
 */
import type { Fighter, EnemyKind } from './fighter.ts';
import { MOVES, isActive, totalFrames } from './frames.ts';
import type { Sim } from './sim.ts';

export interface ViewOpts {
  reduceMotion: boolean;
  colorblind: boolean;
  /** অধ্যায়-ভিত্তিক রঙ — খোলা মাঠের সবুজে মিশে থাকে, ছবি নয়। */
  palette: Palette;
  /** পিক্সেল-আর্কেড মোড (ঐচ্ছিক স্মৃতি-রূপ): ব্যাকিং-স্টোর অর্ধেক + CRT ছায়া। */
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
const BN_DIGIT = ['০', '১', '২', '৩', '৪', '৫', '৬', '৭', '৮', '৯'];
const bnNum = (n: number): string => String(n).replace(/\d/g, (d) => BN_DIGIT[Number(d)] ?? d);
/** নির্ণয়যোগ্য ছদ্ম-এলোমেলো (দৃশ্যের দানা/জানালা প্রতি ফ্রেমে নাচে না)। */
const hash = (i: number): number => { const s = Math.sin(i * 127.1 + 311.7) * 43758.5453; return s - Math.floor(s); };

export interface Palette {
  ground: string; sky: string; ink: string; accent: string; hero: string; enemy: string; ally: string;
}

/** অধ্যায়ের ধাঁচ থেকে প্যালেট — আগের চেয়ে সজীব (ধূসর-অভিযোগের উত্তরে স্যাচুরেশন)। */
export const PALETTES: Palette[] = [
  { ground: '#3f6b4a', sky: '#8fd0dd', ink: '#122019', accent: '#1f9d8f', hero: '#ffe9b8', enemy: '#5b5346', ally: '#8fd07a' },
  { ground: '#7a5a30', sky: '#f2b25c', ink: '#241708', accent: '#d96f2e', hero: '#ffeec2', enemy: '#4f4636', ally: '#c9a558' },
  { ground: '#46506e', sky: '#9fb6dd', ink: '#12182a', accent: '#4d7fd6', hero: '#e8f0ff', enemy: '#3d4250', ally: '#93a8cc' },
  { ground: '#8a6a34', sky: '#f7c76a', ink: '#2a1c06', accent: '#e0a422', hero: '#fff0bd', enemy: '#57472e', ally: '#c4a44f' },
  { ground: '#95573d', sky: '#ffb98a', ink: '#2b1409', accent: '#e0722f', hero: '#ffedcb', enemy: '#62493c', ally: '#d0a468' },
  { ground: '#5f7448', sky: '#d3d18d', ink: '#1a2112', accent: '#93b83e', hero: '#f4ecc2', enemy: '#4d5449', ally: '#a9b86e' },
  { ground: '#2e5f6e', sky: '#8fd3dd', ink: '#0b2129', accent: '#22a7b8', hero: '#e4f6f0', enemy: '#3a4f57', ally: '#79c2ae' },
  { ground: '#7c4650', sky: '#ffc4a3', ink: '#2a1116', accent: '#d65a6e', hero: '#fdeeda', enemy: '#5d4348', ally: '#cf9c7d' },
  { ground: '#55497a', sky: '#cdb1dd', ink: '#191231', accent: '#8a5fd0', hero: '#f2eaff', enemy: '#4a4458', ally: '#ac9ccf' },
];


/**
 * পোশাক-ব্যবস্থা: প্রতিটি ধরনের আলাদা পোশাক, মাথার ঢাকা, গড়ন ও অস্ত্র।
 * আগে সবাই ছিল একই কালো কুর্তা — শুধু স্যাশের রঙ বদলাত, তাই লড়াইয়ে "কে নায়ক,
 * কে শত্রু" পড়া যেত না। এখন রঙ + আকৃতি + প্রতীক তিনটেই আলাদা, ফলে রঙ-দৃষ্টি
 * কম হলেও মাথার ঢাকা/অস্ত্র/বুকের প্রতীক দেখে ধরন চেনা যায়।
 */
export interface Outfit {
  label_bn: string;
  garment: string; shade: string; trim: string; sash: string;
  lower: string; shin: string; head: string;
  badge: string; weapon_bn: string;
  shape: 'angrakha' | 'tunic' | 'armor' | 'coat' | 'vest' | 'robe' | 'farmer';
  build: number; scale: number; weaponLen: number;
}

export const OUTFITS: Record<EnemyKind, Outfit> = {
  hero:   { label_bn: 'তুমি — খড়্গধারী', garment: '#f0dcab', shade: '#caa653', trim: '#ffd777', sash: '#b8322a', lower: '#145c5b', shin: '#8a5a36', head: '#e8b93e', badge: '✦', weapon_bn: 'খড়্গ', shape: 'angrakha', build: 1, scale: 1.04, weaponLen: 42 },
  blade:  { label_bn: 'তলোয়ারধারী শত্রু', garment: '#a63b2a', shade: '#642016', trim: '#e6a15c', sash: '#3c2417', lower: '#4b3423', shin: '#36261a', head: '#8f2f21', badge: '▲', weapon_bn: 'তলোয়ার', shape: 'tunic', build: 1, scale: 1, weaponLen: 38 },
  shield: { label_bn: 'ঢালধারী শত্রু', garment: '#c78a2e', shade: '#74450f', trim: '#ffe1a0', sash: '#5c3510', lower: '#51402a', shin: '#3d2d1c', head: '#9aa3a8', badge: '■', weapon_bn: 'গদা ও বড় ঢাল', shape: 'armor', build: 1.28, scale: 1.08, weaponLen: 24 },
  spear:  { label_bn: 'বর্শাধারী শত্রু', garment: '#315f9e', shade: '#1b3560', trim: '#bcd9ff', sash: '#172c4d', lower: '#3f4e68', shin: '#2b3547', head: '#244a7d', badge: '◆', weapon_bn: 'লম্বা বর্শা', shape: 'coat', build: 0.9, scale: 1.03, weaponLen: 62 },
  swift:  { label_bn: 'দ্রুতগামী শত্রু', garment: '#8e3fa3', shade: '#4e1f63', trim: '#ff9d45', sash: '#ff7a2f', lower: '#47234f', shin: '#ff9d45', head: '#b657c9', badge: '≫', weapon_bn: 'জোড়া ছোরা', shape: 'vest', build: 0.82, scale: 0.94, weaponLen: 27 },
  boss:   { label_bn: 'মিথের প্রহরী (বস)', garment: '#47275e', shade: '#1c0f2b', trim: '#ffd777', sash: '#a61e2e', lower: '#5c1f2e', shin: '#2b1a33', head: '#d8a72e', badge: '♛', weapon_bn: 'বিরাট খাঁড়া', shape: 'robe', build: 1.22, scale: 1.18, weaponLen: 52 },
  ally:   { label_bn: 'মিত্র কৃষক', garment: '#efe3bd', shade: '#6f9448', trim: '#7db45a', sash: '#7a4a22', lower: '#f2ead0', shin: '#8a5a36', head: '#d9b45c', badge: '❦', weapon_bn: 'লাঠি', shape: 'farmer', build: 0.96, scale: 0.99, weaponLen: 50 },
};

export function outfitKeyOf(f: Fighter, role: 'hero' | 'foe' | 'ally' = 'foe'): EnemyKind {
  if (role === 'hero') return 'hero';
  if (role === 'ally') return 'ally';
  return f.kind;
}
export function outfitOf(f: Fighter, role: 'hero' | 'foe' | 'ally' = 'foe'): Outfit {
  return OUTFITS[outfitKeyOf(f, role)];
}

const SKIN = '#8a5a36';

const W = 760, H = 360, GROUND = 268;
export const STAGE = { W, H, GROUND } as const;

interface Pose {
  lean: number; crouch: number; sword: number; swordB: number;
  armF: number; armB: number; legF: number; legB: number; lunge: number; cloth: number;
}

function poseOf(f: Fighter, tick: number, walkPhase: number, moving: number): Pose {
  const p: Pose = { lean: 0, crouch: 0, sword: -0.5, swordB: -0.5, armF: -0.6, armB: 0.5, legF: 0.22, legB: -0.22, lunge: 0, cloth: 0 };
  // হাঁটার চক্র ও নিঃশ্বাসের দোলন — স্থির কাঠি-ভঙ্গির অবসান
  const breathe = Math.sin((tick + f.uid * 17) / 21) * 0.035;
  p.sword = -0.55 + breathe; p.cloth = breathe * 2.2; p.lean = 0.05; p.crouch = Math.sin((tick + f.uid * 17) / 21) * 0.9;
  if (moving > 0.25 && f.phase === 'idle') {
    const s = Math.sin(walkPhase);
    p.legF = s * 0.62; p.legB = -s * 0.62;
    p.crouch += Math.abs(Math.cos(walkPhase)) * 1.6;
    p.lean = 0.13; p.armB = 0.5 + s * 0.3;
  }
  if (f.telegraph > 0) {   // বড় আঘাতের আগে: অস্ত্র উঁচিয়ে কাঁপে — পড়া যায়
    p.sword = -2.5 + Math.sin(tick * 1.6) * 0.07; p.armF = -2.05; p.lean = -0.14; p.crouch = 3;
    return p;
  }
  const m = f.move;
  if (m !== null) {
    const fr = f.frame;
    const st = m.startup, ac = m.startup + m.active - 1;
    const raw = fr <= st ? fr / Math.max(1, m.startup)
      : fr <= ac ? 1
        : 1 - (fr - ac) / Math.max(1, totalFrames(m) - 1 - ac);
    const prog = Math.max(0, Math.min(1, raw));
    const ease = prog * prog * (3 - 2 * prog);
    switch (m.id) {
      case 'cut': p.sword = -1.5 + ease * 2.2; p.armF = -1.3 + ease * 1.8; p.lean = 0.13 * ease; p.lunge = ease * 6; break;
      case 'heavy': p.sword = -2.5 + ease * 3.5; p.armF = -2 + ease * 2.8; p.lean = 0.26 * ease; p.crouch = -3 * (1 - ease) + 3 * ease; p.lunge = ease * 10; break;
      case 'thrust': p.sword = -0.1; p.armF = -0.08; p.lunge = ease * 24; p.lean = 0.15 * ease; p.crouch = 5 * ease; break;
      case 'guard': p.swordB = -1.5; p.armB = -1.25; p.crouch = 6; p.lean = -0.06; break;
      case 'side': p.lean = 0.42; p.crouch = 9; p.cloth = 0.7; p.sword = -0.2; p.legF = 0.8; p.legB = -0.7; break;
      case 'resolve': p.sword = -2.8 + ease * 5; p.armF = -2.2 + ease * 3.6; p.lean = 0.34 * ease; p.cloth = ease; p.lunge = ease * 30; break;
    }
  }
  if (f.phase === 'hitstun') { p.lean = -0.45; p.crouch = 7; p.sword = 1; p.cloth = -0.5; }
  if (f.phase === 'blockstun') { p.lean = -0.22; p.crouch = 8; p.swordB = -1.65; }
  if (f.phase === 'stunned') { p.lean = -0.5 + Math.sin(tick / 7) * 0.08; p.crouch = 13; p.armF = 1; p.armB = 1.2; p.sword = 1.5; }
  if (f.phase === 'downed') { p.lean = -1.35; p.crouch = 30; p.cloth = 1; }
  return p;
}

const at = (t: [number, number], i: 0 | 1): number => t[i] ?? 0;

/** শীর্ষে-চাপা অঙ্গ: রেখার বদলে ভরা চতুর্ভুজ, তাই শরিলে ওজন দেখায়। */
function seg(ctx: CanvasRenderingContext2D, x: number, y: number, ang: number, len: number, w0: number, w1: number, color: string): [number, number] {
  const ex = x + Math.cos(ang) * len, ey = y + Math.sin(ang) * len;
  const px = Math.cos(ang + Math.PI / 2), py = Math.sin(ang + Math.PI / 2);
  ctx.fillStyle = color;
  ctx.beginPath();
  ctx.moveTo(x + px * w0 / 2, y + py * w0 / 2);
  ctx.lineTo(ex + px * w1 / 2, ey + py * w1 / 2);
  ctx.lineTo(ex - px * w1 / 2, ey - py * w1 / 2);
  ctx.lineTo(x - px * w0 / 2, y - py * w0 / 2);
  ctx.closePath(); ctx.fill();
  return [ex, ey];
}
function seg2(ctx: CanvasRenderingContext2D, x: number, y: number, ang: number, len: number, w: number, ink: string, rim: string): [number, number] {
  seg(ctx, x, y, ang, len, w + 3.4, w * 0.62 + 3.4, rim);
  return seg(ctx, x, y, ang, len, w, w * 0.62, ink);
}
function limb(ctx: CanvasRenderingContext2D, x: number, y: number, ang: number, len: number, thick: number, color: string): [number, number] {
  const ex = x + Math.cos(ang) * len, ey = y + Math.sin(ang) * len;
  ctx.strokeStyle = color; ctx.lineWidth = thick; ctx.lineCap = 'round';
  ctx.beginPath(); ctx.moveTo(x, y); ctx.lineTo(ex, ey); ctx.stroke();
  return [ex, ey];
}

interface Particle { x: number; y: number; vx: number; vy: number; life: number; max: number; r: number; col: string; kind: 'dot' | 'spark' | 'mote'; rot: number }
interface Track { lx: number; ly: number; phase: number; speed: number; maxHp: number; ghosts: { x: number; y: number; dir: number; life: number }[] }

export class Renderer {
  private ctx: CanvasRenderingContext2D;
  private shake = 0;
  private particles: Particle[] = [];
  private flash: { x: number; y: number; life: number; col: string }[] = [];
  private pops: { x: number; y: number; vy: number; life: number; max: number; txt: string; col: string; big: boolean }[] = [];
  private say: { text: string; life: number; max: number; sub: string } | null = null;
  private white = 0;
  private camX = 0;
  private zoomPunch = 0;
  private lastObjHp = -1;
  private objFlash = 0;
  private tracks = new Map<number, Track>();
  readonly canvas: HTMLCanvasElement;
  private opts: ViewOpts;
  private scale = 1;

  constructor(canvas: HTMLCanvasElement, opts: ViewOpts) {
    this.canvas = canvas;
    const c = canvas.getContext('2d', { alpha: false });
    if (!c) throw new Error('Canvas2D পাওয়া যায়নি');
    this.ctx = c;
    this.opts = opts;
    this.resize();
  }

  setOpts(o: ViewOpts): void { this.opts = o; }

  private get pixel(): boolean { return this.opts.pixel === true; }

  resize(): void {
    const dpr = Math.min(2, window.devicePixelRatio || 1);
    const box = this.canvas.getBoundingClientRect();
    const cssW = box.width || W;
    const scale = cssW / W;
    const q = this.pixel ? 0.5 : 1;
    this.canvas.width = Math.max(2, Math.round(cssW * dpr * q));
    this.canvas.height = Math.max(2, Math.round(H * scale * dpr * q));
    this.ctx.setTransform(this.canvas.width / W, 0, 0, this.canvas.width / W, 0, 0);
    this.ctx.imageSmoothingEnabled = !this.pixel;
    this.scale = scale * dpr * q;
  }

  pop(x: number, y: number, txt: string, col = '#f7f0dc', big = false): void {
    if (this.pops.length > 14) this.pops.shift();
    this.pops.push({ x, y: y - 52, vy: -1.25, life: big ? 52 : 40, max: big ? 52 : 40, txt, col, big });
  }
  announce(text: string, sub = '', frames = 96): void { this.say = { text, sub, life: frames, max: frames }; }

  kick(power: number): void {
    if (this.opts.reduceMotion) return;
    this.shake = Math.max(this.shake, power);
    if (power >= 7) this.white = Math.max(this.white, 3);
    if (power >= 9) this.zoomPunch = Math.max(this.zoomPunch, 0.035);
  }

  burst(x: number, y: number, n = 10, col = '#e9dfc8'): void {
    const cols = [col, '#ffe9a8', '#ffffff'];
    for (let i = 0; i < n; i++) {
      const a = Math.random() * Math.PI * 2, s = 1 + Math.random() * 3.8;
      this.particles.push({
        x, y: y - 34, vx: Math.cos(a) * s, vy: Math.sin(a) * s - 1.5,
        life: 20 + Math.random() * 16, max: 36, r: 1.4 + Math.random() * 2.6,
        col: cols[i % cols.length]!, kind: i % 3 === 0 ? 'spark' : 'dot', rot: a,
      });
    }
    this.flash.push({ x, y: y - 38, life: 9, col });
    if (this.particles.length > 260) this.particles.splice(0, this.particles.length - 260);
  }

  /** রেডিয়াল গ্রেডিয়েন্ট নিরাপদে (স্টাব-ক্যানভাসে না থাকলে সমতল রঙেই ফিরি)। */
  private radial(x: number, y: number, r: number, inner: string, outer: string): string | CanvasGradient {
    try {
      const g = this.ctx.createRadialGradient(x, y, 0, x, y, r);
      if (!g || typeof g.addColorStop !== 'function') return inner;
      g.addColorStop(0, inner); g.addColorStop(1, outer);
      return g;
    } catch { return inner; }
  }
  private linear(y0: number, y1: number, stops: [number, string][]): string | CanvasGradient {
    try {
      const g = this.ctx.createLinearGradient(0, y0, 0, y1);
      if (!g || typeof g.addColorStop !== 'function') return stops[0]![1];
      for (const [o, c] of stops) g.addColorStop(o, c);
      return g;
    } catch { return stops[0]![1]; }
  }

  draw(sim: Sim, tick: number): void {
    const { ctx } = this;
    const P = this.opts.palette;
    // ক্যামেরা: খেলোয়াড়ের দিকে আলতো টান + ভারী আঘাতে ঝাঁকুনি-জুম
    const focus = Math.max(-34, Math.min(34, (sim.player.x - 380) * 0.13));
    this.camX += (focus - this.camX) * (this.opts.reduceMotion ? 0.3 : 0.06);
    this.zoomPunch *= 0.9;

    this.sky(sim, P, tick);

    ctx.save();
    const z = 1 + (this.opts.reduceMotion ? 0 : this.zoomPunch);
    ctx.translate(W / 2, H / 2); ctx.scale(z, z); ctx.translate(-W / 2, -H / 2);
    if (this.shake > 0.4) {
      ctx.translate((Math.random() - 0.5) * this.shake, (Math.random() - 0.5) * this.shake * 0.6);
      this.shake *= 0.82;
    }
    ctx.translate(-this.camX * 0.35, 0);
    // কিছু অধ্যায়ে নদীটি দিগন্তের কাছাকাছি দেখা যায় — খেলার মাঠ খোলা থাকে।
    if ([0, 2, 6, 7, 8].includes(sim.ch.id)) this.water(sim.ch.id, tick);
    ctx.save(); ctx.globalAlpha = 0.44;
    this.backdrop(sim, tick, 0.45, mix('#789b62', P.sky, 0.2));
    ctx.restore();
    this.groundPlane(sim, P, tick);
    ctx.translate(-this.camX * 0.65, 0);
    this.backdrop(sim, tick, 1, mix('#315d38', P.ground, 0.16));

    if (sim.objective) this.objectiveDraw(sim, P, tick);
    for (const pk of sim.pickups) this.pickupDraw(pk.x, GROUND + pk.y * 0.5, pk.life, pk.seed, P, tick);

    const list = [...sim.enemies.map((f) => [f, 'foe'] as const),
      ...(sim.ally ? [[sim.ally, 'ally'] as const] : []),
      [sim.player, 'hero'] as const]
      .sort((a, b) => a[0].y - b[0].y);
    for (const [f, role] of list) this.puppet(ctx, f, tick, P, role, sim);
    ctx.restore();

    this.fxLayer(sim, P, tick);
    this.foreground(sim, P, tick);
    this.announceLayer(P);

    if (this.white > 0) { ctx.fillStyle = `rgba(255,250,235,${0.08 * this.white})`; ctx.fillRect(0, 0, W, H); this.white -= 1; }
    // প্রাণ কমলে কিনারায় সতর্ক-আভা
    const hpRatio = sim.player.hp / 240;
    if (sim.player.alive && hpRatio < 0.28) {
      const pulse = this.opts.reduceMotion ? 0.16 : 0.13 + Math.sin(tick / 6) * 0.05;
      ctx.fillStyle = this.radial(W / 2, H / 2, W * 0.62, 'rgba(160,40,25,0)', `rgba(160,40,25,${pulse + 0.14})`);
      ctx.fillRect(0, 0, W, H);
    }
    if (sim.player.meter >= 100 && sim.player.alive) {
      ctx.strokeStyle = `rgba(255,214,110,${this.opts.reduceMotion ? 0.35 : 0.3 + Math.sin(tick / 5) * 0.14})`;
      ctx.lineWidth = 3; ctx.strokeRect(2, 2, W - 4, H - 4);
    }
    if (this.pixel) this.scanlines();
  }

  // ─── দৃশ্যের তলাসমূহ ──────────────────────────────────────────────────────
  private sky(sim: Sim, P: Palette, tick: number): void {
    const { ctx } = this;
    ctx.fillStyle = this.linear(0, GROUND, [
      [0, mix(P.sky, '#16283f', 0.38)], [0.55, P.sky], [0.86, mix(P.sky, '#ffe3ae', 0.42)], [1, mix(P.sky, '#ffe3ae', 0.55)],
    ]);
    ctx.fillRect(0, 0, W, GROUND + 2);
    // সূর্য: আভা + থালা + ধীরে ঘোরা রশ্মি
    const sx = W * 0.78 - this.camX * 0.2, sy = 58;
    ctx.fillStyle = this.radial(sx, sy, 86, 'rgba(255,232,170,.75)', 'rgba(255,232,170,0)');
    ctx.fillRect(sx - 86, sy - 86, 172, 172);
    // (ঘূর্ণায়মান রশ্মি-আয়ত আগে ফুলের মতো দেখাত — শুধু আভাই যথেষ্ট)
    ctx.fillStyle = '#fff3cd';
    ctx.beginPath(); ctx.arc(sx, sy, 21, 0, 6.283); ctx.fill();
    // মেঘ
    ctx.fillStyle = 'rgba(255,255,255,.5)';
    for (let i = 0; i < 5; i++) {
      const cx = ((i * 191 + tick * (0.08 + (i % 3) * 0.05) * (this.opts.reduceMotion ? 0 : 1)) % (W + 220)) - 110;
      const cy = 26 + (i % 3) * 26 + hash(i * 7) * 12;
      const r = 13 + hash(i * 3) * 10;
      for (const [ox, oy, or2] of [[0, 0, 1], [r * 0.9, 3, 0.72], [-r * 0.9, 4, 0.64], [r * 0.35, -5, 0.8]] as const) {
        ctx.beginPath(); ctx.ellipse(cx + ox, cy + oy, r * or2 * 1.5, r * or2 * 0.62, 0, 0, 6.283); ctx.fill();
      }
    }
    // পাখির ঝাঁক
    if (!this.opts.reduceMotion) {
      ctx.strokeStyle = 'rgba(20,24,30,.55)'; ctx.lineWidth = 1.6;
      for (let i = 0; i < 3; i++) {
        const bx = ((tick * 0.55 + i * 46) % (W + 160)) - 80;
        const by = 44 + i * 13 + Math.sin((tick + i * 9) / 16) * 4;
        const flap = Math.sin(tick / 5 + i) * 3.4;
        ctx.beginPath();
        ctx.moveTo(bx - 7, by + flap); ctx.quadraticCurveTo(bx - 2, by - 3, bx, by);
        ctx.quadraticCurveTo(bx + 2, by - 3, bx + 7, by + flap); ctx.stroke();
      }
    }
    // আকাশ আর খেলার মাঠের মাঝে নরম, নিচু ঘাসের দিগন্ত — পাহাড় বা শহরের দেয়াল নয়।
    ctx.fillStyle = 'rgba(107,151,83,.22)';
    ctx.beginPath(); ctx.moveTo(0, GROUND - 15);
    for (let x = 0; x <= W; x += 48) {
      const ridge = GROUND - 17 - Math.sin(x * 0.006 + sim.ch.id * 1.7) * 4 - Math.sin(x * 0.0021 + 2) * 3;
      ctx.lineTo(x, ridge);
    }
    ctx.lineTo(W, GROUND); ctx.lineTo(0, GROUND); ctx.closePath(); ctx.fill();
    ctx.fillStyle = 'rgba(238,227,170,.12)';
    ctx.fillRect(0, GROUND - 24, W, 12);
  }

  private groundPlane(sim: Sim, P: Palette, tick: number): void {
    const { ctx } = this;
    ctx.fillStyle = this.linear(GROUND, H, [
      [0, mix('#9bad60', P.ground, 0.2)],
      [0.34, mix('#6f914d', P.ground, 0.16)],
      [1, mix('#315a36', P.ground, 0.2)],
    ]);
    ctx.fillRect(-60, GROUND, W + 160, H - GROUND + 10);

    // মাঠের নরম ঢেউ—মঞ্চের ডিম্বাকার দাগ বা শহরের পাথর-রেখা নয়।
    ctx.save(); ctx.lineWidth = 9; ctx.lineCap = 'round';
    for (const [offset, alpha] of [[15, 0.07], [39, 0.055], [67, 0.04]] as const) {
      ctx.strokeStyle = `rgba(210,218,137,${alpha})`;
      ctx.beginPath();
      for (let x = -60; x <= W + 80; x += 36) {
        const y = GROUND + offset + Math.sin(x * 0.008 + sim.ch.id) * 2.4 + Math.sin(x * 0.002 + offset) * 1.8;
        if (x === -60) ctx.moveTo(x, y); else ctx.lineTo(x, y);
      }
      ctx.stroke();
    }
    ctx.restore();

    // ঘাসের রঙে হালকা এলোমেলো ছোপ—একই বীজে একই জায়গায় থাকে।
    for (let i = 0; i < 15; i++) {
      const span = W + 150;
      const raw = hash(i * 19 + 5) * span - sim.player.x * 0.08;
      const x = ((raw % span) + span) % span - 70;
      const y = GROUND + 12 + hash(i * 31 + 9) * (H - GROUND - 20);
      ctx.fillStyle = i % 2 ? 'rgba(190,196,111,.07)' : 'rgba(36,83,45,.07)';
      ctx.beginPath(); ctx.ellipse(x, y, 14 + hash(i * 7) * 27, 2 + hash(i * 11) * 4, 0, 0, 6.283); ctx.fill();
    }

    // দূরত্ব অনুযায়ী ছোট হয়ে আসা বুনো ঘাস আর মাঠের গাছপালা।
    for (let i = 0; i < 30; i++) {
      const span = W + 120;
      const raw = hash(i * 3 + 1) * span - sim.player.x * 0.1;
      const x = ((raw % span) + span) % span - 60;
      const y = GROUND + 7 + hash(i * 5 + 2) * (H - GROUND - 12);
      const depth = (y - GROUND) / (H - GROUND);
      this.plant(ctx, x, y, 5 + depth * 8, i + sim.ch.id * 37, tick, P);
    }
  }

  private plant(ctx: CanvasRenderingContext2D, x: number, y: number, size: number, seed: number, tick: number, P: Palette): void {
    const sway = this.opts.reduceMotion ? 0 : Math.sin((tick + seed * 11) / 22) * size * 0.075;
    const stem = seed % 2 === 0 ? mix('#547b3e', P.ground, 0.12) : mix('#73934a', P.ground, 0.12);
    ctx.save(); ctx.lineCap = 'round';
    for (let i = -1; i <= 1; i++) {
      const height = size * (0.58 + hash(seed * 7 + i + 2) * 0.42);
      const tipX = x + i * size * 0.42 + sway;
      const tipY = y - height;
      ctx.strokeStyle = stem; ctx.lineWidth = Math.max(0.8, size * 0.1);
      ctx.beginPath(); ctx.moveTo(x + i * size * 0.08, y);
      ctx.quadraticCurveTo(x + i * size * 0.28 + sway * 0.45, y - height * 0.55, tipX, tipY); ctx.stroke();
      ctx.fillStyle = i === 0 ? 'rgba(175,197,105,.8)' : 'rgba(133,171,79,.78)';
      ctx.beginPath(); ctx.ellipse(tipX - i * size * 0.13, tipY + size * 0.11, size * 0.2, size * 0.075, i * 0.6, 0, 6.283); ctx.fill();
    }
    if (hash(seed * 13 + 3) > 0.72) {
      ctx.fillStyle = 'rgba(248,220,151,.82)'; ctx.beginPath(); ctx.arc(x + sway, y - size * 0.82, Math.max(0.8, size * 0.08), 0, 6.283); ctx.fill();
    }
    ctx.restore();
  }

  private water(chapterId: number, tick: number): void {
    const { ctx } = this;
    const flow = this.opts.reduceMotion ? 0 : tick * 0.42;
    const bend = chapterId * 0.73;
    const centerY = (x: number): number => GROUND - 25 + Math.sin(x * 0.006 + bend) * 4.5 + Math.sin(x * 0.014 - bend) * 1.8;
    const halfWidth = (x: number): number => 5.5 + Math.sin(x * 0.01 + bend) * 1.2;
    const start = -40, end = W + 40, step = 16;

    // সরু, আঁকাবাঁকা নদীটি দূরের জমির ফাঁকে দেখা যায়—যোদ্ধাদের পায়ের কাছে নয়।
    ctx.save(); ctx.lineJoin = 'round'; ctx.lineCap = 'round';
    ctx.beginPath();
    for (let x = start; x <= end; x += step) {
      const y = centerY(x) - halfWidth(x);
      if (x === start) ctx.moveTo(x, y); else ctx.lineTo(x, y);
    }
    for (let x = end; x >= start; x -= step) ctx.lineTo(x, centerY(x) + halfWidth(x));
    ctx.closePath(); ctx.fillStyle = 'rgba(65,147,162,.76)'; ctx.fill();

    ctx.strokeStyle = 'rgba(222,207,150,.62)'; ctx.lineWidth = 2.3;
    for (const edge of [-1, 1] as const) {
      ctx.beginPath();
      for (let x = start; x <= end; x += step) {
        const y = centerY(x) + edge * halfWidth(x);
        if (x === start) ctx.moveTo(x, y); else ctx.lineTo(x, y);
      }
      ctx.stroke();
    }
    ctx.strokeStyle = 'rgba(215,243,221,.58)'; ctx.lineWidth = 1.1;
    for (let i = 0; i < 6; i++) {
      const x = ((i * 137 + flow) % (W + 90)) - 40;
      const y = centerY(x);
      ctx.beginPath(); ctx.moveTo(x - 7, y); ctx.quadraticCurveTo(x, y - 1.2, x + 8, y + 0.4); ctx.stroke();
    }
    ctx.restore();
  }

  private backdrop(sim: Sim, tick: number, depth: number, color: string): void {
    const { ctx } = this;
    const far = depth < 1;
    const spacing = far ? 210 : 178;
    const drift = (tick * 0.025 * depth * (this.opts.reduceMotion ? 0 : 1) + sim.player.x * 0.025 * depth) % spacing;
    if (far) { ctx.translate(0, 20 * (1 - depth)); ctx.scale(1, 0.85); }

    for (let i = -2; i < 7; i++) {
      const x = 30 + i * spacing - drift;
      const seed = (i + 19) * 31 + sim.ch.id * 59 + (far ? 0 : 1000);
      if (far) {
        // ফাঁক-ফাঁক বড় গাছ—দূরের সবুজ দিগন্ত, ঘন জঙ্গল নয়।
        if (hash(seed) > 0.16) {
          const h = 116 + hash(seed + 1) * 34;
          const tx = x + (hash(seed + 2) - 0.5) * 18;
          this.tree(ctx, tx, GROUND - 4, h, seed, tick, color);
          if (hash(seed + 3) > 0.54) {
            const side = hash(seed + 4) > 0.5 ? 1 : -1;
            this.tree(ctx, tx + side * (42 + hash(seed + 5) * 18), GROUND - 7, h * (0.52 + hash(seed + 6) * 0.16), seed + 1, tick, color);
          }
        }
        if (hash(seed + 8) > 0.72) this.bush(ctx, x + 90, GROUND - 5, 48, 18, color, seed + 8);
      } else {
        // কাছের দিগন্তে কেবল নিচু ঝোপ—খোলা মাঠ ও নদীর ফাঁক যেন ঢাকা না পড়ে।
        if (hash(seed + 9) > 0.5) this.bush(ctx, x + 30, GROUND - 4, 38 + hash(seed + 10) * 24, 12 + hash(seed + 11) * 8, color, seed + 9);
        if (hash(seed + 12) > 0.91) this.tree(ctx, x + 112, GROUND - 5, 76 + hash(seed + 13) * 16, seed + 12, tick, color);
      }
    }
  }

  private bush(ctx: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, color: string, seed: number): void {
    ctx.save(); ctx.fillStyle = color;
    ctx.beginPath(); ctx.ellipse(x, y - h * 0.42, w * 0.34, h * 0.52, 0, 0, 6.283); ctx.fill();
    ctx.beginPath(); ctx.ellipse(x - w * 0.23, y - h * 0.31, w * 0.25, h * 0.43, 0, 0, 6.283); ctx.fill();
    ctx.beginPath(); ctx.ellipse(x + w * 0.22, y - h * 0.34, w * 0.27, h * 0.45, 0, 0, 6.283); ctx.fill();
    ctx.fillStyle = 'rgba(193,207,126,.18)';
    ctx.beginPath(); ctx.ellipse(x + (hash(seed) - 0.5) * w * 0.28, y - h * 0.68, w * 0.13, h * 0.16, 0, 0, 6.283); ctx.fill();
    ctx.restore();
  }
  private chala(ctx: CanvasRenderingContext2D, x: number, y: number, w: number, h: number): void {
    ctx.beginPath();
    ctx.moveTo(x, y);
    ctx.quadraticCurveTo(x + w * 0.14, y - h * 0.7, x + w / 2, y - h);
    ctx.quadraticCurveTo(x + w * 0.86, y - h * 0.7, x + w, y);
    ctx.lineTo(x + w * 0.86, y - h * 0.16); ctx.lineTo(x + w * 0.14, y - h * 0.16);
    ctx.closePath(); ctx.fill();
  }

  private tree(ctx: CanvasRenderingContext2D, x: number, y: number, h: number, seed: number, tick: number, color: string): void {
    ctx.save();
    const sway = this.opts.reduceMotion ? 0 : Math.sin((tick + seed * 7) / 31) * h * 0.008;
    const crownY = y - h * 0.7;

    // সরু বাদামি কাণ্ড আর ছড়ানো ডাল—দূরের বড় গাছের আকৃতি।
    ctx.strokeStyle = 'rgba(93,72,43,.72)'; ctx.lineCap = 'round';
    ctx.lineWidth = Math.max(2.4, h * 0.045);
    ctx.beginPath(); ctx.moveTo(x, y); ctx.quadraticCurveTo(x + sway * 0.2, y - h * 0.32, x + sway, crownY + h * 0.12); ctx.stroke();
    ctx.lineWidth = Math.max(1.6, h * 0.025);
    ctx.beginPath(); ctx.moveTo(x + sway * 0.4, crownY + h * 0.23); ctx.quadraticCurveTo(x - h * 0.15, crownY + h * 0.05, x - h * 0.3 + sway, crownY - h * 0.04); ctx.stroke();
    ctx.beginPath(); ctx.moveTo(x + sway * 0.7, crownY + h * 0.16); ctx.quadraticCurveTo(x + h * 0.16, crownY - h * 0.02, x + h * 0.31 + sway, crownY - h * 0.12); ctx.stroke();

    // গোল, ছড়ানো পাতার মুকুট; হালকা পাতার ছোপে সিলুয়েটটা একরঙা লাগে না।
    ctx.fillStyle = color;
    const leaves = [
      [0, 0, 0.46, 0.27], [-0.34, 0.08, 0.34, 0.22], [0.35, 0.08, 0.36, 0.22],
      [-0.17, -0.2, 0.33, 0.22], [0.17, -0.23, 0.34, 0.23], [0, -0.38, 0.25, 0.19],
    ] as const;
    for (const [ox, oy, rx, ry] of leaves) {
      ctx.beginPath(); ctx.ellipse(x + ox * h + sway, crownY + oy * h, rx * h, ry * h, 0, 0, 6.283); ctx.fill();
    }
    ctx.save(); ctx.globalAlpha *= 0.17; ctx.fillStyle = '#d8df9a';
    ctx.beginPath(); ctx.ellipse(x - h * 0.13 + sway, crownY - h * 0.2, h * 0.2, h * 0.08, -0.16, 0, 6.283); ctx.fill();
    ctx.beginPath(); ctx.ellipse(x + h * 0.18 + sway, crownY + h * 0.02, h * 0.16, h * 0.06, 0.12, 0, 6.283); ctx.fill();
    ctx.restore();
    ctx.restore();
  }

  // ─── লক্ষ্য ও পিকআপ ────────────────────────────────────────────────────────
  private objectiveDraw(sim: Sim, P: Palette, tick: number): void {
    const { ctx } = this;
    const o = sim.objective!;
    if (this.lastObjHp >= 0 && o.hp < this.lastObjHp) this.objFlash = 10;
    this.lastObjHp = o.hp;
    if (this.objFlash > 0) this.objFlash -= 1;
    const x = o.x, y = GROUND + o.y * 0.5 + 8;
    const hurt = 1 - o.hp / o.maxHp;
    ctx.save(); ctx.translate(x, y); ctx.scale(1.28, 1.28);
    if (this.objFlash > 0 && !this.opts.reduceMotion) ctx.translate((Math.random() - 0.5) * 3, 0);
    ctx.fillStyle = 'rgba(0,0,0,.3)';
    ctx.beginPath(); ctx.ellipse(0, 14, 52, 8, 0, 0, 6.283); ctx.fill();
    const ink = this.objFlash > 5 ? '#fff0d8' : P.ink;
    if (o.kind === 'boat') {
      ctx.fillStyle = ink;
      ctx.beginPath(); ctx.moveTo(-52, 0); ctx.quadraticCurveTo(-34, 22, 0, 22);
      ctx.quadraticCurveTo(38, 22, 56, -2); ctx.quadraticCurveTo(8, 11, -52, 0); ctx.fill();
      ctx.strokeStyle = ink; ctx.lineWidth = 3.4;
      ctx.beginPath(); ctx.moveTo(0, 5); ctx.lineTo(0, -46); ctx.stroke();
      const flutter = this.opts.reduceMotion ? 0 : Math.sin(tick / 8) * 3;
      ctx.fillStyle = hurt > 0.5 ? '#a4673a' : P.accent;
      ctx.beginPath(); ctx.moveTo(2, -46); ctx.quadraticCurveTo(26 + flutter, -34, 32 + flutter, -24); ctx.lineTo(2, -9); ctx.closePath(); ctx.fill();
      ctx.fillStyle = '#ffd777';
      ctx.beginPath(); ctx.arc(-30, -6, 3, 0, 6.283); ctx.fill();   // লণ্ঠন
    } else if (o.kind === 'grain') {
      ctx.fillStyle = ink;
      ctx.fillRect(-44, -16, 88, 18);
      ctx.beginPath(); ctx.arc(-28, 8, 11, 0, 6.283); ctx.arc(28, 8, 11, 0, 6.283); ctx.fill();
      ctx.fillStyle = mix(P.accent, '#ffffff', 0.15);
      for (const [sx, sy] of [[-24, -24], [0, -28], [24, -24], [-10, -36], [12, -36]] as const) {
        ctx.beginPath(); ctx.ellipse(sx, sy, 13, 8, -0.15, 0, 6.283); ctx.fill();
      }
      ctx.strokeStyle = 'rgba(255,255,255,.35)'; ctx.lineWidth = 1.4;
      ctx.beginPath(); ctx.arc(-28, 8, 6, 0, 6.283); ctx.arc(28, 8, 6, 0, 6.283); ctx.stroke();
    } else {
      ctx.fillStyle = ink;
      ctx.fillRect(-46, -44, 10, 58); ctx.fillRect(36, -44, 10, 58);
      this.chala(ctx, -56, -40, 112, 34);
      ctx.fillStyle = P.accent;
      const sway = this.opts.reduceMotion ? 0 : Math.sin(tick / 9) * 2.4;
      ctx.beginPath(); ctx.moveTo(-14, -40); ctx.lineTo(14, -40); ctx.lineTo(10 + sway, -18); ctx.lineTo(-10 + sway, -18); ctx.closePath(); ctx.fill();
      ctx.fillStyle = '#ffd777';
      ctx.beginPath(); ctx.arc(0, -29, 3.4, 0, 6.283); ctx.fill();
    }
    ctx.restore();
    // লক্ষ্যের অবস্থা-পটি
    const bw = 68;
    ctx.fillStyle = 'rgba(8,7,6,.72)'; ctx.fillRect(x - bw / 2, y - 86, bw, 8);
    ctx.fillStyle = hurt > 0.62 ? '#e05a45' : hurt > 0.32 ? '#e8a83e' : '#79c25f';
    ctx.fillRect(x - bw / 2 + 1.5, y - 84.5, (bw - 3) * Math.max(0, o.hp / o.maxHp), 5);
    ctx.font = '700 11px "Noto Sans Bengali", system-ui, sans-serif'; ctx.textAlign = 'center';
    ctx.fillStyle = 'rgba(255,246,224,.95)';
    ctx.fillText(o.name_bn, x, y - 92);
    ctx.textAlign = 'left';
  }

  private pickupDraw(x: number, y: number, life: number, seed: number, P: Palette, tick: number): void {
    const { ctx } = this;
    const bob = this.opts.reduceMotion ? 0 : Math.sin((tick + seed) / 11) * 4;
    const fade = life < 120 ? 0.45 + 0.55 * Math.abs(Math.sin(tick / 6)) : 1;
    ctx.save(); ctx.globalAlpha = fade;
    // আলোর স্তম্ভ — মাঠের যেকোনো জায়গা থেকে চোখে পড়ে
    ctx.fillStyle = this.linear(y - 96, y, [[0, 'rgba(255,214,110,0)'], [1, 'rgba(255,214,110,.28)']]);
    ctx.fillRect(x - 9, y - 96 + bob * 0.4, 18, 96);
    ctx.fillStyle = 'rgba(255,220,130,.3)';
    ctx.beginPath(); ctx.ellipse(x, y + 6, 20 + Math.sin(tick / 9) * 3, 5.4, 0, 0, 6.283); ctx.fill();
    ctx.translate(x, y - 26 + bob);
    ctx.rotate(this.opts.reduceMotion ? 0.2 : Math.sin((tick + seed) / 16) * 0.18);
    ctx.fillStyle = this.radial(0, 0, 30, 'rgba(255,226,150,.9)', 'rgba(255,226,150,0)');
    ctx.fillRect(-30, -30, 60, 60);
    // স্ক্রল: সোনালি চোখা কাগজ + সীল
    ctx.fillStyle = '#f6df9e';
    ctx.beginPath();
    ctx.moveTo(-14, -9); ctx.lineTo(14, -9); ctx.lineTo(17, 0); ctx.lineTo(14, 9); ctx.lineTo(-14, 9); ctx.lineTo(-17, 0);
    ctx.closePath(); ctx.fill();
    ctx.strokeStyle = '#9a7420'; ctx.lineWidth = 1.6; ctx.stroke();
    ctx.strokeStyle = 'rgba(122,88,20,.75)'; ctx.lineWidth = 1.4;
    for (const ly of [-4, 0, 4]) { ctx.beginPath(); ctx.moveTo(-9, ly); ctx.lineTo(9 - (ly === 0 ? 3 : 0), ly); ctx.stroke(); }
    ctx.fillStyle = P.accent;
    ctx.beginPath(); ctx.arc(8, 5, 3.6, 0, 6.283); ctx.fill();
    ctx.restore();
    ctx.font = '700 11px "Noto Sans Bengali", system-ui, sans-serif'; ctx.textAlign = 'center';
    ctx.fillStyle = 'rgba(8,7,6,.65)'; ctx.fillText('কার্ড!', x + 1, y - 57 + bob);
    ctx.fillStyle = '#ffe9a8'; ctx.fillText('কার্ড!', x, y - 58 + bob);
    ctx.textAlign = 'left';
  }

  // ─── এফেক্স স্তর ────────────────────────────────────────────────────────────
  private fxLayer(sim: Sim, P: Palette, tick: number): void {
    const { ctx } = this;
    // ভাসা ধুলিকণা (ambient)
    if (!this.opts.reduceMotion && tick % 16 === 0 && this.particles.length < 240) {
      this.particles.push({
        x: Math.random() * W, y: 60 + Math.random() * 200, vx: 0.24 + Math.random() * 0.3, vy: 0.08,
        life: 190, max: 190, r: 1 + Math.random(), col: 'rgba(255,240,200,.7)', kind: 'mote', rot: 0,
      });
    }
    for (const d of this.particles) {
      d.x += d.vx; d.y += d.vy;
      if (d.kind !== 'mote') d.vy += 0.15;
      d.life -= 1;
      ctx.globalAlpha = Math.max(0, Math.min(1, d.life / (d.kind === 'mote' ? 90 : 26)));
      if (d.kind === 'spark') {
        ctx.strokeStyle = d.col; ctx.lineWidth = 1.8;
        ctx.beginPath(); ctx.moveTo(d.x, d.y); ctx.lineTo(d.x - d.vx * 2.6, d.y - d.vy * 2.6); ctx.stroke();
      } else {
        ctx.fillStyle = d.col;
        ctx.beginPath(); ctx.arc(d.x, d.y, d.r, 0, 6.283); ctx.fill();
      }
    }
    ctx.globalAlpha = 1;
    this.particles = this.particles.filter((d) => d.life > 0 && d.x < W + 30);

    for (const fl of this.flash) {
      fl.life -= 1;
      const k = Math.max(0, fl.life / 9);
      ctx.strokeStyle = `rgba(255,240,205,${0.1 + k * 0.8})`;
      ctx.lineWidth = 2 + k * 3;
      ctx.beginPath(); ctx.arc(fl.x, fl.y, 12 + (1 - k) * 28, 0, 6.283); ctx.stroke();
      ctx.save(); ctx.translate(fl.x, fl.y); ctx.rotate(0.7);
      ctx.strokeStyle = `rgba(255,255,255,${k * 0.9})`; ctx.lineWidth = 2.4;
      const r = 10 + (1 - k) * 16;
      ctx.beginPath(); ctx.moveTo(-r, 0); ctx.lineTo(r, 0); ctx.moveTo(0, -r); ctx.lineTo(0, r); ctx.stroke();
      ctx.restore();
      void fl;
    }
    this.flash = this.flash.filter((f) => f.life > 0);

    for (const q of this.pops) {
      q.y += q.vy; q.vy += 0.045; q.life -= 1;
      const age = q.max - q.life;
      const popScale = age < 6 ? 0.6 + (age / 6) * 0.55 : 1.15 - Math.min(0.15, (age - 6) * 0.01);
      ctx.save();
      ctx.globalAlpha = Math.min(1, q.life / 14);
      ctx.translate(q.x, q.y); ctx.scale(popScale, popScale);
      ctx.font = `700 ${q.big ? 27 : 19}px "Noto Sans Bengali", "Hind Siliguri", system-ui, sans-serif`;
      ctx.textAlign = 'center';
      ctx.fillStyle = 'rgba(8,7,6,.88)'; ctx.fillText(q.txt, 2, 2);
      ctx.fillStyle = q.col; ctx.fillText(q.txt, 0, 0);
      ctx.restore();
    }
    this.pops = this.pops.filter((q) => q.life > 0);

    // টানা-আঘাত প্রদর্শনী (সিমেই হিসাব থাকে)
    if (sim.combo >= 2) {
      const heat = Math.min(1, sim.combo / 14);
      const scale = 1 + heat * 0.35 + (this.opts.reduceMotion ? 0 : Math.sin(tick / 4) * 0.03 * heat);
      ctx.save(); ctx.translate(W - 64, 64); ctx.scale(scale, scale); ctx.textAlign = 'center';
      ctx.font = '800 30px "Noto Sans Bengali", system-ui, sans-serif';
      ctx.fillStyle = 'rgba(8,7,6,.85)'; ctx.fillText(`×${bnNum(sim.combo)}`, 2, 2);
      ctx.fillStyle = heat > 0.6 ? '#ffb347' : '#fff2cf'; ctx.fillText(`×${bnNum(sim.combo)}`, 0, 0);
      ctx.font = '700 12px "Noto Sans Bengali", system-ui, sans-serif';
      ctx.fillStyle = 'rgba(255,242,207,.9)'; ctx.fillText('টানা আঘাত', 0, 17);
      // কম্বো-ঘড়ি
      ctx.fillStyle = 'rgba(8,7,6,.6)'; ctx.fillRect(-30, 23, 60, 4);
      ctx.fillStyle = '#ffb347'; ctx.fillRect(-30, 23, 60 * Math.max(0, sim.comboTimer / 110), 4);
      ctx.restore();
    }
    void P;
  }

  private announceLayer(P: Palette): void {
    if (!this.say) return;
    const { ctx } = this;
    this.say.life -= 1;
    const age = this.say.max - this.say.life;
    const fade = Math.min(1, this.say.life / 18);
    const t = Math.min(1, age / 11);
    const back = 1 + 2.2 * Math.pow(t - 1, 3) + 1.2 * Math.pow(t - 1, 2);   // easeOutBack-ish
    const barH = 26 * Math.min(1, age / 8) * fade;
    ctx.fillStyle = 'rgba(6,5,4,.82)';
    ctx.fillRect(0, 0, W, barH); ctx.fillRect(0, H - barH, W, barH);
    ctx.save();
    ctx.globalAlpha = fade; ctx.textAlign = 'center';
    ctx.translate(W / 2, 132); ctx.scale(0.55 + back * 0.45, 0.55 + back * 0.45);
    ctx.font = '800 64px "Noto Sans Bengali", "Hind Siliguri", system-ui, sans-serif';
    ctx.lineWidth = 10; ctx.strokeStyle = 'rgba(10,8,6,.92)'; ctx.strokeText(this.say.text, 0, 0);
    ctx.fillStyle = this.linear(-46, 8, [[0, '#fff7dc'], [0.55, '#ffd777'], [1, mix(P.accent, '#ffd777', 0.4)]]);
    ctx.fillText(this.say.text, 0, 0);
    if (this.say.sub) {
      ctx.font = '600 20px "Noto Sans Bengali", "Hind Siliguri", system-ui, sans-serif';
      ctx.lineWidth = 5; ctx.strokeStyle = 'rgba(10,8,6,.9)'; ctx.strokeText(this.say.sub, 0, 34);
      ctx.fillStyle = '#f6ecd4'; ctx.fillText(this.say.sub, 0, 34);
    }
    ctx.restore(); ctx.textAlign = 'left';
    if (this.say.life <= 0) this.say = null;
  }

  private foreground(sim: Sim, P: Palette, tick: number): void {
    const { ctx } = this;
    const drift = (sim.player.x * 0.18 + tick * 0.03 * (this.opts.reduceMotion ? 0 : 1)) % 108;
    ctx.save();
    ctx.fillStyle = this.linear(GROUND + 30, H, [[0, 'rgba(0,0,0,0)'], [1, 'rgba(4,3,2,.4)']]);
    ctx.fillRect(0, GROUND + 30, W, H - GROUND);
    ctx.beginPath(); ctx.rect(0, GROUND + 34, W, H); ctx.clip();
    for (let i = -1; i < 9; i++) {
      const x = i * 108 - drift;
      for (let k = 0; k < 4; k++) {
        const bx = x + k * 12;
        const hh = 12 + hash(i * 17 + k * 9 + 3) * 22;
        const sway = this.opts.reduceMotion ? 0 : Math.sin((tick + bx) / 17) * 2.2;
        ctx.fillStyle = (i + k) % 2 === 0 ? 'rgba(39,78,39,.92)' : 'rgba(79,112,48,.88)';
        ctx.beginPath(); ctx.moveTo(bx - 1.5, H);
        ctx.quadraticCurveTo(bx + 2 + sway * 0.35, H - hh * 0.62, bx + 5 + sway, H - hh);
        ctx.quadraticCurveTo(bx + 7 + sway * 0.35, H - hh * 0.44, bx + 4.5, H);
        ctx.closePath(); ctx.fill();
        if ((i * 4 + k) % 17 === 0) {
          ctx.fillStyle = mix('#c7bb73', P.ground, 0.12);
          ctx.beginPath(); ctx.arc(bx + 5 + sway, H - hh, 1.5, 0, 6.283); ctx.fill();
        }
      }
    }
    ctx.restore();
  }

  private scanlines(): void {
    const { ctx } = this;
    ctx.save();
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.fillStyle = 'rgba(6,5,4,.17)';
    for (let y = 1; y < this.canvas.height; y += 2) ctx.fillRect(0, y, this.canvas.width, 1);
    ctx.fillStyle = 'rgba(6,5,4,.2)';
    ctx.fillRect(0, 0, this.canvas.width, 2); ctx.fillRect(0, this.canvas.height - 2, this.canvas.width, 2);
    ctx.restore();
  }

  // ─── পুতুল ──────────────────────────────────────────────────────────────────
  private trackOf(f: Fighter): Track {
    let t = this.tracks.get(f.uid);
    if (!t) { t = { lx: f.x, ly: f.y, phase: 0, speed: 0, maxHp: f.hp, ghosts: [] }; this.tracks.set(f.uid, t); }
    const dist = Math.abs(f.x - t.lx) + Math.abs(f.y - t.ly) * 0.6;
    t.phase += dist * 0.5;
    t.speed = t.speed * 0.6 + dist * 0.4;
    t.lx = f.x; t.ly = f.y;
    return t;
  }

  private puppet(ctx: CanvasRenderingContext2D, f: Fighter, tick: number, P: Palette, role: 'hero' | 'foe' | 'ally' = 'foe', sim?: Sim): void {
    const dir = f.facing === 1 ? 1 : -1;
    const depth = 1 + f.y / 420;
    const baseY = GROUND + f.y * 0.5;
    const tr = this.trackOf(f);
    // আসল চলা সিমে x/y-বদলে ধরা পড়ে — হাঁটার চক্র সেই বদল থেকেই চলে
    const moving = f.phase === 'idle' ? Math.min(1, tr.speed / 1.1) : 0;
    const p = poseOf(f, tick, tr.phase, moving);
    const outfitKey = outfitKeyOf(f, role);
    const outfit = OUTFITS[outfitKey];
    const hurtFlash = f.hurtAge < 5;
    const garment = hurtFlash ? '#fff3d6' : outfit.garment;
    const garmentShade = hurtFlash ? '#f4ead2' : outfit.shade;
    const lowerCol = hurtFlash ? '#fff3d6' : outfit.lower;
    const shinCol = hurtFlash ? '#fff3d6' : outfit.shin;
    const outline = hurtFlash ? '#ffffff' : mix(outfit.shade, '#000000', 0.42);
    const rimBase = this.opts.colorblind ? (role === 'hero' ? '#ffffff' : role === 'ally' ? '#7ef0c1' : '#9fd6ff') : outfit.trim;
    const rim = f.telegraph > 0 ? '#ff5a3c' : rimBase;
    const bossScale = outfit.scale;
    const fade = f.phase === 'downed' ? Math.max(0, 1 - f.deadAge / 55) : 1;

    // ড্যাশ-ভূতছায়া
    if (f.phase === 'side' && tick % 3 === 0 && !this.opts.reduceMotion) tr.ghosts.push({ x: f.x, y: baseY, dir, life: 14 });
    for (const g of tr.ghosts) {
      g.life -= 1;
      ctx.save(); ctx.globalAlpha = (g.life / 14) * 0.4;
      ctx.translate(g.x, g.y); ctx.scale(g.dir, 1);
      ctx.fillStyle = rimBase;
      ctx.beginPath();
      ctx.moveTo(-10, -72); ctx.lineTo(12, -70); ctx.lineTo(14, -30); ctx.lineTo(10, -4); ctx.lineTo(-8, -4); ctx.lineTo(-12, -32);
      ctx.closePath(); ctx.fill();
      ctx.restore();
    }
    tr.ghosts = tr.ghosts.filter((g) => g.life > 0);

    ctx.save();
    ctx.globalAlpha = fade * (f.invulnerable && f.phase === 'side' ? 0.75 : 1);
    ctx.translate(f.x + p.lunge * dir, baseY);
    // মাটির ছায়া
    ctx.fillStyle = 'rgba(0,0,0,.34)';
    ctx.beginPath(); ctx.ellipse(0, 3, 36 * bossScale, 8, 0, 0, 6.283); ctx.fill();
    // পায়ের নিচের ধরন-বলয়: ভিড়েও এক নজরে "আমি কোথায়, শত্রু কোন ধরনের" পড়া যায়
    ctx.strokeStyle = outfit.trim; ctx.lineWidth = role === 'hero' ? 3 : 1.7; ctx.globalAlpha *= role === 'hero' ? 0.95 : 0.62;
    ctx.beginPath(); ctx.ellipse(0, 3, 38 * bossScale, 8.6, 0, 0, 6.283); ctx.stroke();
    if (role === 'hero') { ctx.strokeStyle = outfit.sash; ctx.beginPath(); ctx.ellipse(0, 3, 31 * bossScale, 6.4, 0, 0, 6.283); ctx.stroke(); }
    ctx.globalAlpha = fade * (f.invulnerable && f.phase === 'side' ? 0.75 : 1);
    ctx.scale(depth * dir * 1.34 * bossScale, depth * 1.34 * bossScale);
    // সংকল্প-প্রস্তুত আভা (নায়ক)
    if (role === 'hero' && f.meter >= 100) {
      ctx.fillStyle = this.radial(0, -46, 52, 'rgba(255,214,110,.34)', 'rgba(255,214,110,0)');
      ctx.fillRect(-52, -98, 104, 104);
    }
    ctx.rotate(p.lean * 0.5);
    const hipY = -42 + p.crouch;
    const chestY = hipY - 30;
    const headY = chestY - 17;

    // পেছনের ওড়া কাপড়: বসের আলখাল্লা, নায়কের লাল উত্তরীয়, দ্রুতগামীর স্কার্ফ, বর্শাধারীর কোটের লেজ
    const flutter = this.opts.reduceMotion ? 0 : p.cloth * 7 + moving * 5;
    if (outfitKey === 'boss') {
      ctx.fillStyle = '#6e1830';
      ctx.beginPath();
      ctx.moveTo(-7, chestY - 2);
      ctx.quadraticCurveTo(-34 - flutter, hipY + 2, -27 - flutter * 1.2, 0);
      ctx.lineTo(-14, hipY + 12); ctx.lineTo(-5, hipY + 4); ctx.closePath(); ctx.fill();
      ctx.strokeStyle = outfit.trim; ctx.lineWidth = 1.6; ctx.stroke();
    } else if (outfitKey === 'hero') {
      ctx.fillStyle = outfit.sash;
      ctx.beginPath();
      ctx.moveTo(-8, hipY + 1);
      ctx.quadraticCurveTo(-24 - flutter, hipY + 8, -29 - flutter, hipY + 22);
      ctx.lineTo(-13, hipY + 20); ctx.lineTo(-5, hipY + 7); ctx.closePath(); ctx.fill();
    } else if (outfitKey === 'swift') {
      ctx.strokeStyle = outfit.trim; ctx.lineWidth = 4.4; ctx.lineCap = 'round';
      for (const dy of [0, 6]) {
        ctx.beginPath(); ctx.moveTo(-5, chestY + 2 + dy);
        ctx.quadraticCurveTo(-19 - flutter, chestY + 8 + dy, -27 - flutter * 1.3, chestY + 3 + dy); ctx.stroke();
      }
    } else if (outfitKey === 'spear') {
      ctx.fillStyle = garmentShade;
      ctx.beginPath();
      ctx.moveTo(-8, hipY + 2); ctx.lineTo(-17 - flutter * 0.5, hipY + 25); ctx.lineTo(-4, hipY + 24); ctx.closePath(); ctx.fill();
    }
    // পা (ভরা আকৃতি, মোজা-ধাঁচের মুখ)
    const shoe = outfitKey === 'hero' || outfitKey === 'ally' ? SKIN : '#21160e';
    const legB = seg2(ctx, -2, hipY, 1.72 + p.legB, 23, 13 * outfit.build, lowerCol, outline);
    const footB = seg2(ctx, at(legB, 0), at(legB, 1), 1.5 - p.legB * 0.45, 20, 10.6 * outfit.build, shinCol, outline);
    seg(ctx, at(footB, 0), at(footB, 1), 0.15, 10, 7.4, 3.6, shoe);
    const legF = seg2(ctx, 1, hipY, 1.34 + p.legF, 23, 13.4 * outfit.build, lowerCol, outline);
    const footF = seg2(ctx, at(legF, 0), at(legF, 1), 1.5 - p.legF * 0.45, 20, 10.8 * outfit.build, shinCol, outline);
    seg(ctx, at(footF, 0), at(footF, 1), 0.15, 10, 7.4, 3.6, shoe);

    // ধড়: পোশাকের আকৃতি ধরনভেদে — আঙ্গরাখা, খাটো টিউনিক, সেলাই-করা বর্ম, লম্বা কোট, খাটো ফতুয়া, আলখাল্লা, কৃষকের জামা
    const leanX = p.lean * 6;
    const half = 14 * outfit.build, waist = 12 * outfit.build;
    const skirt = outfit.shape === 'robe' ? 27 : outfit.shape === 'coat' ? 24 : outfit.shape === 'angrakha' ? 16 : outfit.shape === 'armor' ? 14 : outfit.shape === 'tunic' ? 11 : outfit.shape === 'farmer' ? 9 : 6;
    const flare = (outfit.shape === 'robe' ? 22 : outfit.shape === 'armor' ? 18 : outfit.shape === 'angrakha' ? 17 : outfit.shape === 'coat' ? 13 : 15) * outfit.build;
    const bodyPath = (): void => {
      ctx.beginPath();
      ctx.moveTo(leanX - half, chestY - 3); ctx.lineTo(leanX + half, chestY - 3);
      ctx.lineTo(waist, hipY - 2); ctx.lineTo(flare + p.cloth * 5, hipY + skirt); ctx.lineTo(-flare - p.cloth * 7, hipY + skirt - 1); ctx.lineTo(-waist, hipY - 2);
      ctx.closePath();
    };
    ctx.lineWidth = 4.2; ctx.lineJoin = 'round'; ctx.strokeStyle = outline; bodyPath(); ctx.stroke();
    ctx.fillStyle = garment; bodyPath(); ctx.fill();
    ctx.fillStyle = garmentShade;
    ctx.beginPath(); ctx.moveTo(leanX + 2, chestY); ctx.lineTo(waist - 2, hipY - 2); ctx.lineTo(waist - 1, hipY + Math.min(11, skirt)); ctx.lineTo(1, hipY + Math.min(11, skirt)); ctx.closePath(); ctx.fill();
    ctx.strokeStyle = outfit.trim; ctx.lineWidth = 1.8;
    ctx.beginPath(); ctx.moveTo(leanX - half + 4, chestY - 2); ctx.lineTo(leanX + half - 4, chestY - 2); ctx.stroke();
    this.outfitDetails(ctx, outfitKey, outfit, leanX, chestY, hipY, skirt);
    // স্যাশ ও কোমরবন্ধ
    if (outfitKey === 'hero' || outfitKey === 'boss' || outfitKey === 'swift') {
      ctx.strokeStyle = outfit.sash; ctx.lineWidth = outfitKey === 'boss' ? 6 : 5; ctx.lineCap = 'round';
      ctx.beginPath(); ctx.moveTo(leanX - half + 4, chestY + 3); ctx.lineTo(waist - 3, hipY + 2); ctx.stroke();
    }
    ctx.fillStyle = outfit.sash;
    ctx.fillRect(-waist - 1, hipY + 2, waist * 2 + 3, outfit.shape === 'armor' || outfit.shape === 'robe' ? 6.4 : 5);
    ctx.fillStyle = outfit.trim; ctx.fillRect(-2.6, hipY + 3.2, 5.2, 3.6);   // বেল্টের বকলেস

    const sh: [number, number] = [p.lean * 6, chestY + 1];
    // পেছনের হাত + ঢাল
    const back = seg2(ctx, at(sh, 0) - 3, at(sh, 1), Math.PI - 0.7 + p.armB, 17, 10.8 * outfit.build, garment, outline);
    const showShield = f.guarding || f.move?.id === 'guard' || f.kind === 'shield' || f.kind === 'boss';
    if (showShield) {
      const sx = f.kind === 'shield' || f.kind === 'boss' ? 8 : at(back, 0) - 2;
      const sy = f.kind === 'shield' || f.kind === 'boss' ? chestY + 14 : at(back, 1) + 7;
      const r = f.kind === 'shield' ? 17 : f.kind === 'boss' ? 15 : 12.5;
      if (outfitKey === 'shield') {
        // ঢালধারীর পরিচয়ই এই বিরাট ঢাল — দূর থেকেই পড়া যায়
        ctx.fillStyle = outfit.garment;
        ctx.beginPath();
        ctx.moveTo(sx - 17, sy - 21); ctx.lineTo(sx + 17, sy - 21); ctx.lineTo(sx + 17, sy + 7);
        ctx.quadraticCurveTo(sx + 15, sy + 19, sx, sy + 26);
        ctx.quadraticCurveTo(sx - 15, sy + 19, sx - 17, sy + 7); ctx.closePath(); ctx.fill();
        ctx.strokeStyle = outfit.trim; ctx.lineWidth = 2.4; ctx.stroke();
        ctx.strokeStyle = outfit.shade; ctx.lineWidth = 2;
        for (const dy of [-11, -1, 9]) { ctx.beginPath(); ctx.moveTo(sx - 15, sy + dy); ctx.lineTo(sx + 15, sy + dy); ctx.stroke(); }
        ctx.fillStyle = outfit.trim; ctx.font = '800 13px system-ui, sans-serif'; ctx.textAlign = 'center'; ctx.fillText('■', sx, sy + 3); ctx.textAlign = 'left';
      } else if (outfitKey === 'boss') {
        ctx.fillStyle = outfit.garment;
        ctx.beginPath();
        ctx.moveTo(sx, sy - 23); ctx.lineTo(sx + 16, sy - 9); ctx.lineTo(sx, sy + 26); ctx.lineTo(sx - 16, sy - 9); ctx.closePath(); ctx.fill();
        ctx.strokeStyle = outfit.trim; ctx.lineWidth = 2.4; ctx.stroke();
        ctx.fillStyle = outfit.sash; ctx.beginPath(); ctx.arc(sx, sy - 2, 4.4, 0, 6.283); ctx.fill();
        ctx.strokeStyle = outfit.trim; ctx.lineWidth = 1.4; ctx.stroke();
      } else {
        ctx.fillStyle = outfit.garment;
        ctx.beginPath(); ctx.arc(sx, sy, r, 0, 6.283); ctx.fill();
        ctx.strokeStyle = outfit.trim; ctx.lineWidth = 2; ctx.stroke();
        ctx.strokeStyle = outfit.shade; ctx.lineWidth = 1.5;
        ctx.beginPath(); ctx.arc(sx, sy, r * 0.66, 0, 6.283); ctx.stroke();
        ctx.fillStyle = outfit.trim;
        ctx.beginPath(); ctx.arc(sx, sy, 3.2, 0, 6.283); ctx.fill();
      }
      if (f.guard < 34 && f.kind !== 'hero') {   // ফাটল: ঢাল ভাঙার কাছাকাছি
        ctx.strokeStyle = 'rgba(10,8,6,.8)'; ctx.lineWidth = 1.5;
        ctx.beginPath(); ctx.moveTo(sx - 4, sy - r + 3); ctx.lineTo(sx + 1, sy - 2); ctx.lineTo(sx - 3, sy + 6); ctx.stroke();
      }
    }
    // সামনের হাত + অস্ত্র
    ctx.fillStyle = SKIN; ctx.beginPath(); ctx.arc(at(back, 0), at(back, 1), 3.6, 0, 6.283); ctx.fill();
    if (outfitKey === 'swift') limb(ctx, at(back, 0), at(back, 1), 2.65 + p.armB * 0.4, 17, 2.8, '#f6eeda');   // জোড়া ছোরার দ্বিতীয়টা
    const front = seg2(ctx, at(sh, 0) + 3, at(sh, 1), -0.5 + p.armF, 18, 10.8 * outfit.build, garment, outline);
    ctx.fillStyle = SKIN; ctx.beginPath(); ctx.arc(at(front, 0), at(front, 1), 3.8, 0, 6.283); ctx.fill();
    this.swoosh(ctx, f, at(front, 0), at(front, 1), p);
    this.weapon(ctx, f, at(front, 0), at(front, 1), p, P, tick);

    // মাথা: ত্বক + ধরনভেদে একেবারে আলাদা মাথার ঢাকা
    ctx.fillStyle = hurtFlash ? '#fff3d6' : SKIN;
    ctx.beginPath(); ctx.arc(p.lean * 8, headY, 10.4, 0, 6.283); ctx.fill();
    ctx.strokeStyle = outline; ctx.lineWidth = 1.7; ctx.stroke();
    const hx = p.lean * 8;
    ctx.fillStyle = '#1c120a'; ctx.beginPath(); ctx.arc(hx + 4.2, headY - 0.5, 1.25, 0, 6.283); ctx.fill();   // চোখ
    this.headgear(ctx, outfitKey, outfit, hx, headY, p);
    if (isActive(MOVES.guard, f.frame) && f.phase === 'guard') {
      ctx.globalAlpha = 0.55 * fade;
      ctx.strokeStyle = '#cfe6ef'; ctx.lineWidth = 2.4;
      ctx.beginPath(); ctx.arc(8, chestY + 8, 27, -1.15, 1.15); ctx.stroke();
    }
    ctx.restore();
    ctx.globalAlpha = 1;

    // মাথার ওপরের সূচকসমূহ (ক্যামেরা-স্থিরাংকে)
    const topY = baseY - 124 * depth * bossScale;
    if (role === 'hero' && f.alive) {
      const bob = this.opts.reduceMotion ? 0 : Math.sin(tick / 9) * 2.2;
      ctx.font = '800 16px system-ui, sans-serif'; ctx.textAlign = 'center';
      ctx.fillStyle = 'rgba(8,7,6,.88)'; ctx.fillText('▼', f.x + 1.4, topY - 8 + bob + 1.4);
      ctx.fillStyle = '#ffd777'; ctx.fillText('▼', f.x, topY - 8 + bob);
      ctx.textAlign = 'left';
    }
    if (f.telegraph > 0) {
      const bounce = this.opts.reduceMotion ? 0 : Math.abs(Math.sin(tick / 4)) * 3;
      ctx.font = '800 21px system-ui, sans-serif'; ctx.textAlign = 'center';
      ctx.fillStyle = 'rgba(8,7,6,.85)'; ctx.fillText('!', f.x + 1.5, topY - 4 - bounce + 1.5);
      ctx.fillStyle = '#ff6a4a'; ctx.fillText('!', f.x, topY - 4 - bounce);
      ctx.textAlign = 'left';
    }
    if (f.phase === 'stunned') {
      ctx.font = '700 13px system-ui, sans-serif'; ctx.textAlign = 'center';
      ctx.fillStyle = 'rgba(255,235,180,.95)';
      const tw = this.opts.reduceMotion ? 0 : Math.sin(tick / 5) * 4;
      ctx.fillText('✦ ✦', f.x + tw, topY - 2);
      ctx.textAlign = 'left';
    }
    if (role !== 'hero' && f.alive && f.hp < tr.maxHp && f.hp > 0) {
      const bw = f.kind === 'boss' ? 84 : 46;
      ctx.fillStyle = 'rgba(8,7,6,.66)'; ctx.fillRect(f.x - bw / 2, topY - 12, bw, 5.4);
      ctx.fillStyle = '#e05a45'; ctx.fillRect(f.x - bw / 2 + 1, topY - 11, (bw - 2) * Math.max(0, f.hp / tr.maxHp), 3.4);
      if (f.kind === 'boss' || sim?.mode === 'duel') {
        ctx.fillStyle = 'rgba(8,7,6,.66)'; ctx.fillRect(f.x - bw / 2, topY - 5.4, bw, 4.6);
        ctx.fillStyle = '#7ec3e8'; ctx.fillRect(f.x - bw / 2 + 1, topY - 4.6, (bw - 2) * Math.max(0, f.guard / 100), 3);
      }
    }
  }


  /** বুকের নকশা: সেলাই, পট্টি, বোতাম, পদক — রঙ না বুঝলেও আকৃতি দেখে ধরন চেনা যায়। */
  private outfitDetails(ctx: CanvasRenderingContext2D, key: EnemyKind, outfit: Outfit, leanX: number, chestY: number, hipY: number, skirt: number): void {
    const mid = leanX + 1;
    ctx.save(); ctx.lineCap = 'round'; ctx.lineJoin = 'round';
    // গলার খোলা অংশ
    ctx.fillStyle = SKIN;
    ctx.beginPath(); ctx.moveTo(mid - 4, chestY - 2); ctx.lineTo(mid + 4, chestY - 2); ctx.lineTo(mid, chestY + 6); ctx.closePath(); ctx.fill();
    ctx.strokeStyle = outfit.trim; ctx.lineWidth = 1.5;
    if (key === 'hero') {
      ctx.strokeStyle = outfit.sash; ctx.lineWidth = 2;
      ctx.beginPath(); ctx.moveTo(mid - 9, chestY + 2); ctx.lineTo(mid + 7, hipY); ctx.stroke();
      ctx.fillStyle = outfit.head;
      for (let i = 0; i < 3; i++) { ctx.beginPath(); ctx.arc(mid - 4 + i * 4.4, chestY + 9 + i * 7.5, 1.5, 0, 6.283); ctx.fill(); }
    } else if (key === 'blade') {
      ctx.fillStyle = outfit.shade; ctx.fillRect(mid - 12, chestY + 10, 24, 4.4); ctx.fillRect(mid - 12, chestY + 20, 24, 3.6);
      ctx.strokeStyle = outfit.trim; ctx.lineWidth = 2.4;
      ctx.beginPath(); ctx.moveTo(mid - 11, hipY); ctx.lineTo(mid + 10, chestY + 4); ctx.stroke();
    } else if (key === 'shield') {
      ctx.strokeStyle = outfit.shade; ctx.lineWidth = 1.7;
      for (let x = -10; x <= 10; x += 5) { ctx.beginPath(); ctx.moveTo(mid + x, chestY + 3); ctx.lineTo(mid + x, hipY + Math.min(10, skirt)); ctx.stroke(); }
      ctx.strokeStyle = outfit.trim; ctx.beginPath(); ctx.moveTo(mid - 13, chestY + 16); ctx.lineTo(mid + 13, chestY + 16); ctx.stroke();
      ctx.fillStyle = outfit.head;
      for (const dx of [-13, 13]) { ctx.beginPath(); ctx.ellipse(mid + dx, chestY + 1, 6.4, 4.6, 0, 0, 6.283); ctx.fill(); }
    } else if (key === 'spear') {
      ctx.strokeStyle = outfit.trim; ctx.lineWidth = 2;
      ctx.beginPath(); ctx.moveTo(mid, chestY + 4); ctx.lineTo(mid, hipY + skirt - 4); ctx.stroke();
      ctx.fillStyle = outfit.trim;
      for (let i = 0; i < 4; i++) { ctx.beginPath(); ctx.arc(mid, chestY + 10 + i * 7, 1.4, 0, 6.283); ctx.fill(); }
      ctx.strokeStyle = outfit.shade; ctx.beginPath(); ctx.moveTo(mid - 7, hipY + 3); ctx.lineTo(mid - 9, hipY + skirt - 3); ctx.stroke();
    } else if (key === 'swift') {
      ctx.fillStyle = '#f2c14e';
      ctx.beginPath(); ctx.moveTo(mid - 8, chestY + 2); ctx.lineTo(mid + 8, chestY + 2); ctx.lineTo(mid + 3, hipY); ctx.lineTo(mid - 3, hipY); ctx.closePath(); ctx.fill();   // খোলা ফতুয়ার ভেতরের জামা
      ctx.strokeStyle = outfit.trim; ctx.lineWidth = 2;
      ctx.beginPath(); ctx.moveTo(mid - 8, chestY + 2); ctx.lineTo(mid - 3, hipY); ctx.moveTo(mid + 8, chestY + 2); ctx.lineTo(mid + 3, hipY); ctx.stroke();
    } else if (key === 'boss') {
      ctx.strokeStyle = outfit.trim; ctx.lineWidth = 2.2;
      ctx.beginPath(); ctx.moveTo(mid, chestY + 5); ctx.lineTo(mid - 11, hipY + 1); ctx.moveTo(mid, chestY + 5); ctx.lineTo(mid + 11, hipY + 1); ctx.stroke();
      ctx.fillStyle = outfit.sash; ctx.beginPath(); ctx.arc(mid, chestY + 13, 4.4, 0, 6.283); ctx.fill();
      ctx.strokeStyle = outfit.trim; ctx.lineWidth = 1.6; ctx.stroke();
      ctx.fillStyle = outfit.head;
      for (const dx of [-14, 14]) { ctx.beginPath(); ctx.ellipse(mid + dx, chestY + 1, 7.2, 5.2, 0, 0, 6.283); ctx.fill(); }
    } else {
      ctx.fillStyle = outfit.shade;
      ctx.beginPath(); ctx.moveTo(mid - 13, chestY); ctx.lineTo(mid - 3, chestY + 4); ctx.lineTo(mid - 4, hipY + 2); ctx.lineTo(mid - 12, hipY + 2); ctx.closePath(); ctx.fill();
      ctx.beginPath(); ctx.moveTo(mid + 13, chestY); ctx.lineTo(mid + 3, chestY + 4); ctx.lineTo(mid + 4, hipY + 2); ctx.lineTo(mid + 12, hipY + 2); ctx.closePath(); ctx.fill();
      ctx.strokeStyle = outfit.trim; ctx.lineWidth = 2.6;
      ctx.beginPath(); ctx.moveTo(mid - 11, chestY + 4); ctx.lineTo(mid + 5, chestY + 20); ctx.stroke();   // কাঁধের গামছা
    }
    // বুকের প্রতীক-পদক
    const by = chestY + (key === 'boss' ? 24 : 15);
    ctx.fillStyle = mix(outfit.shade, '#000000', 0.2);
    ctx.beginPath(); ctx.arc(mid, by, 6.2, 0, 6.283); ctx.fill();
    ctx.strokeStyle = outfit.trim; ctx.lineWidth = 1.4; ctx.stroke();
    ctx.fillStyle = outfit.trim; ctx.font = '800 8px system-ui, sans-serif'; ctx.textAlign = 'center';
    ctx.fillText(outfit.badge, mid, by + 2.8);
    ctx.textAlign = 'left'; ctx.restore();
  }

  /** মাথার ঢাকা: পাগড়ি / মাথাবাঁধা / শিরস্ত্রাণ / উঁচু টুপি / স্কার্ফ / মুকুট / খড়ের টুপি। */
  private headgear(ctx: CanvasRenderingContext2D, key: EnemyKind, outfit: Outfit, hx: number, headY: number, p: Pose): void {
    ctx.save(); ctx.lineJoin = 'round'; ctx.lineCap = 'round';
    const dark = mix(outfit.shade, '#000000', 0.4);
    if (key === 'hero') {
      ctx.fillStyle = outfit.head;
      ctx.beginPath(); ctx.ellipse(hx, headY - 7.6, 9.4, 5.4, -0.08, Math.PI, 0); ctx.fill();
      ctx.fillRect(hx - 9.4, headY - 8.2, 18.8, 3.4);
      ctx.strokeStyle = '#fff3c4'; ctx.lineWidth = 1.7;
      ctx.beginPath(); ctx.moveTo(hx - 8, headY - 8); ctx.quadraticCurveTo(hx, headY - 13.4, hx + 8, headY - 8); ctx.stroke();
      ctx.strokeStyle = outfit.sash; ctx.lineWidth = 3;
      ctx.beginPath(); ctx.moveTo(hx + 2, headY - 12); ctx.quadraticCurveTo(hx - 2, headY - 19, hx - 8 - p.cloth * 3, headY - 21); ctx.stroke();   // লাল পালক
      ctx.fillStyle = outfit.sash; ctx.beginPath(); ctx.arc(hx + 6.4, headY - 7, 2.2, 0, 6.283); ctx.fill();
    } else if (key === 'blade') {
      ctx.fillStyle = outfit.head;
      ctx.beginPath(); ctx.ellipse(hx, headY - 6.6, 9.6, 5, 0, Math.PI, 0); ctx.fill();
      ctx.fillRect(hx - 9.8, headY - 7.2, 19.6, 3.2);
      ctx.strokeStyle = outfit.trim; ctx.lineWidth = 1.6; ctx.beginPath(); ctx.moveTo(hx - 9.8, headY - 5.6); ctx.lineTo(hx + 9.8, headY - 5.6); ctx.stroke();
      ctx.fillStyle = outfit.head;
      ctx.beginPath(); ctx.moveTo(hx - 9, headY - 6); ctx.lineTo(hx - 15 - p.cloth * 4, headY + 4); ctx.lineTo(hx - 7, headY + 3); ctx.closePath(); ctx.fill();   // গিঁটের ঝুল
    } else if (key === 'shield') {
      ctx.fillStyle = outfit.head;
      ctx.beginPath(); ctx.ellipse(hx, headY - 5.8, 10.2, 7.4, 0, Math.PI, 0); ctx.fill();
      ctx.strokeStyle = dark; ctx.lineWidth = 1.5; ctx.stroke();
      ctx.fillRect(hx - 11.4, headY - 6.4, 22.8, 3);
      ctx.beginPath(); ctx.moveTo(hx, headY - 19); ctx.lineTo(hx + 2.6, headY - 11); ctx.lineTo(hx - 2.6, headY - 11); ctx.closePath(); ctx.fill();
      ctx.strokeStyle = '#eef3f5'; ctx.lineWidth = 1.6; ctx.beginPath(); ctx.moveTo(hx - 6, headY - 10); ctx.lineTo(hx + 5, headY - 10.6); ctx.stroke();
    } else if (key === 'spear') {
      ctx.fillStyle = outfit.head;
      ctx.beginPath(); ctx.moveTo(hx - 8.6, headY - 5); ctx.lineTo(hx + 1, headY - 24); ctx.lineTo(hx + 8.8, headY - 5); ctx.closePath(); ctx.fill();
      ctx.strokeStyle = dark; ctx.lineWidth = 1.4; ctx.stroke();
      ctx.fillStyle = outfit.trim; ctx.fillRect(hx - 9.2, headY - 7.4, 18.4, 3);
      ctx.beginPath(); ctx.arc(hx + 1, headY - 24, 2, 0, 6.283); ctx.fill();
    } else if (key === 'swift') {
      ctx.fillStyle = outfit.head;
      for (const [dx, dy, w] of [[-8, -13, 5], [-2, -17, 6], [5, -14, 5]] as const) {
        ctx.beginPath(); ctx.moveTo(hx + dx - w / 2, headY - 6); ctx.lineTo(hx + dx - 2 - p.cloth * 2, headY + dy); ctx.lineTo(hx + dx + w / 2, headY - 6); ctx.closePath(); ctx.fill();
      }
      ctx.fillRect(hx - 9, headY - 7.2, 18, 3);
      ctx.strokeStyle = outfit.trim; ctx.lineWidth = 4;
      ctx.beginPath(); ctx.moveTo(hx - 7, headY + 8.6); ctx.lineTo(hx + 7, headY + 8.6); ctx.stroke();   // গলার স্কার্ফ
    } else if (key === 'boss') {
      ctx.fillStyle = '#241335'; ctx.beginPath(); ctx.ellipse(hx, headY - 6.8, 10.4, 5.8, 0, Math.PI, 0); ctx.fill();
      ctx.fillStyle = outfit.head; ctx.fillRect(hx - 10.2, headY - 11.6, 20.4, 4.2);
      for (const dx of [-7.4, 0, 7.4]) { ctx.beginPath(); ctx.moveTo(hx + dx, headY - (dx === 0 ? 22 : 18)); ctx.lineTo(hx + dx + 3, headY - 11); ctx.lineTo(hx + dx - 3, headY - 11); ctx.closePath(); ctx.fill(); }
      ctx.strokeStyle = outfit.sash; ctx.lineWidth = 3.2;
      ctx.beginPath(); ctx.moveTo(hx, headY - 21); ctx.quadraticCurveTo(hx - 5, headY - 27, hx - 11 - p.cloth * 3, headY - 26); ctx.stroke();
      ctx.fillStyle = outfit.sash; ctx.beginPath(); ctx.arc(hx, headY - 9.4, 2.4, 0, 6.283); ctx.fill();
    } else {
      ctx.fillStyle = outfit.head;
      ctx.beginPath(); ctx.ellipse(hx, headY - 5.4, 16.4, 4.2, -0.04, 0, 6.283); ctx.fill();   // খড়ের টুপির চওড়া কানা
      ctx.strokeStyle = '#a57f2f'; ctx.lineWidth = 1.4; ctx.stroke();
      ctx.beginPath(); ctx.ellipse(hx, headY - 7.8, 8, 5.4, 0, Math.PI, 0); ctx.fill(); ctx.stroke();
    }
    ctx.restore();
  }

  /** তলোয়ারের ঝাপটা: সক্রিয় ফ্রেমে চাপ-আকৃতির আলোক-রেখা। */
  private swoosh(ctx: CanvasRenderingContext2D, f: Fighter, hx: number, hy: number, p: Pose): void {
    const m = f.move;
    if (!m || f.phase !== 'attack') return;
    const total = totalFrames(m);
    const t = Math.max(0, Math.min(1, f.frame / Math.max(1, total)));
    if (f.frame < m.startup - 1 || t > 0.92) return;
    const alpha = Math.sin(Math.min(1, Math.max(0, (f.frame - m.startup + 2) / Math.max(2, m.active + 3))) * Math.PI) * 0.5;
    if (alpha <= 0.02) return;
    ctx.save();
    ctx.globalAlpha *= alpha;
    if (m.id === 'thrust') {
      ctx.fillStyle = '#fff6dc';
      ctx.beginPath();
      ctx.moveTo(hx, hy - 4); ctx.lineTo(hx + 62, hy); ctx.lineTo(hx, hy + 4);
      ctx.closePath(); ctx.fill();
    } else {
      const r = m.id === 'resolve' ? 58 : m.id === 'heavy' ? 52 : 46;
      const a0 = p.sword - 0.85, a1 = p.sword + 0.35;
      ctx.fillStyle = m.id === 'resolve' ? '#ffd777' : '#fff6dc';
      ctx.beginPath();
      ctx.moveTo(hx + Math.cos(a0) * 12, hy + Math.sin(a0) * 12);
      ctx.arc(hx, hy, r, a0, a1);
      ctx.arc(hx, hy, r * 0.55, a1, a0, true);
      ctx.closePath(); ctx.fill();
    }
    ctx.restore();
  }

  private weapon(ctx: CanvasRenderingContext2D, f: Fighter, hx: number, hy: number, p: Pose, P: Palette, tick: number): void {
    const steel = this.opts.colorblind ? '#ffffff' : '#f6eeda';
    const glow = f.telegraph > 0 ? '#ff8a5c' : steel;
    const outfit = OUTFITS[f.kind];
    if (f.kind === 'ally') {
      // মিত্র কৃষকের লাঠি — তলোয়ার নয়, তাই দলও গুলিয়ে যায় না
      const ang = p.sword * 0.65;
      const tip = limb(ctx, hx, hy, ang, outfit.weaponLen, 4.2, '#8a613c');
      limb(ctx, hx, hy, ang + Math.PI, 24, 4.2, '#74512f');
      ctx.fillStyle = '#a87c48'; ctx.beginPath(); ctx.arc(at(tip, 0), at(tip, 1), 3.4, 0, 6.283); ctx.fill();
      return;
    }
    if (f.kind === 'shield') {
      // ঢালধারীর হাতে খাটো গদা
      const tip = limb(ctx, hx, hy, p.sword, outfit.weaponLen, 4, '#5d4632');
      ctx.fillStyle = glow; ctx.beginPath(); ctx.arc(at(tip, 0), at(tip, 1), 7, 0, 6.283); ctx.fill();
      ctx.strokeStyle = '#6f7478'; ctx.lineWidth = 1.6; ctx.stroke();
      for (let i = 0; i < 6; i++) {
        const a = i * 1.047;
        limb(ctx, at(tip, 0), at(tip, 1), a, 10, 1.7, glow);
      }
      return;
    }
    if (f.kind === 'spear') {
      const ang = f.move?.id === 'thrust' ? -0.06 : p.sword * 0.55;
      const tip = limb(ctx, hx, hy, ang, 62, 3, '#5d4632');
      ctx.fillStyle = glow;
      ctx.save(); ctx.translate(at(tip, 0), at(tip, 1)); ctx.rotate(ang);
      ctx.beginPath(); ctx.moveTo(0, -3.4); ctx.lineTo(13, 0); ctx.lineTo(0, 3.4); ctx.closePath(); ctx.fill();
      ctx.restore();
      limb(ctx, hx, hy, ang + Math.PI, 14, 3, '#5d4632');
      return;
    }
    const bladeAng = p.sword;
    const bl = limb(ctx, hx, hy, bladeAng, outfit.weaponLen, f.kind === 'boss' ? 4.8 : f.kind === 'swift' ? 2.8 : 3.4, glow);
    const curved = f.move === null || (f.move.id !== 'thrust' && f.move.id !== 'guard');
    const nx = Math.cos(bladeAng + Math.PI / 2), ny = Math.sin(bladeAng + Math.PI / 2);
    const mx = (hx + at(bl, 0)) / 2 + nx * 8, my = (hy + at(bl, 1)) / 2 + ny * 8;
    if (curved) {
      ctx.fillStyle = glow; ctx.beginPath();
      ctx.moveTo(hx, hy);
      ctx.quadraticCurveTo(mx, my, at(bl, 0), at(bl, 1));
      ctx.quadraticCurveTo(mx - nx * (f.kind === 'boss' ? 6.8 : 4.4), my - ny * (f.kind === 'boss' ? 6.8 : 4.4), hx, hy);
      ctx.closePath(); ctx.fill();
    }
    // সংকল্পে ফলকে আগুন-আভা
    if (f.move?.id === 'resolve') {
      ctx.strokeStyle = `rgba(255,183,71,${0.55 + Math.sin(tick / 3) * 0.2})`; ctx.lineWidth = 6;
      ctx.beginPath(); ctx.moveTo(hx, hy); ctx.lineTo(at(bl, 0), at(bl, 1)); ctx.stroke();
    }
    if (f.kind === 'hero') {
      ctx.strokeStyle = '#e8b93e'; ctx.lineWidth = 1.5;
      ctx.beginPath(); ctx.moveTo(hx + Math.cos(bladeAng) * 5, hy + Math.sin(bladeAng) * 5);
      ctx.quadraticCurveTo(mx - nx * 1.5, my - ny * 1.5, at(bl, 0) - Math.cos(bladeAng) * 6, at(bl, 1) - Math.sin(bladeAng) * 6); ctx.stroke();
    }
    limb(ctx, hx, hy, bladeAng + Math.PI, 7, 4.4, outfit.sash);
    ctx.fillStyle = '#ffd777';
    ctx.beginPath(); ctx.arc(hx - Math.cos(bladeAng) * 7, hy - Math.sin(bladeAng) * 7, 2.6, 0, 6.283); ctx.fill();
  }

  /** ইনপুট-হিন্ট ফুটেজ: কোন মুভ চলছে সেটা ১-লাইনে (মোবাইলে বোতাম-লেবেলের সঙ্গে মিলিয়ে)। */
  currentMoveLabel(f: Fighter): string {
    return f.move ? MOVES[f.move.id].bn : '';
  }
}
