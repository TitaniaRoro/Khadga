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
}

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

export class Renderer {
  private ctx: CanvasRenderingContext2D;
  private shake = 0;
  private dust: { x: number; y: number; vx: number; vy: number; life: number; r: number }[] = [];
  private flash: { x: number; y: number; life: number }[] = [];
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

  resize(): void {
    const dpr = Math.min(2, window.devicePixelRatio || 1);
    const box = this.canvas.getBoundingClientRect();
    const cssW = box.width || W;
    const scale = cssW / W;
    this.canvas.width = Math.round(cssW * dpr);
    this.canvas.height = Math.round(H * scale * dpr);
    this.ctx.setTransform(this.canvas.width / W, 0, 0, this.canvas.width / W, 0, 0);
    this.scale = scale * dpr;
  }
  private scale = 1;

  kick(power: number): void { if (!this.opts.reduceMotion) this.shake = Math.max(this.shake, power); }

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
    // আকাশ + মাটি
    const g = ctx.createLinearGradient(0, 0, 0, H);
    g.addColorStop(0, P.sky); g.addColorStop(0.62, P.sky); g.addColorStop(0.63, P.ground); g.addColorStop(1, P.ink);
    ctx.fillStyle = g; ctx.fillRect(-20, -20, W + 40, H + 40);
    this.backdrop(sim, P, tick);

    if (sim.objective) this.boat(ctx, sim.objective.x, GROUND + sim.objective.y * 0.5, sim.objective, P);

    const list = [...sim.enemies, ...(sim.ally ? [sim.ally] : []), sim.player]
      .filter((f) => f.phase !== 'downed' || f.alive || true)
      .sort((a, b) => a.y - b.y);
    for (const f of list) this.puppet(ctx, f, tick, P);

    // ধুলো
    for (const d of this.dust) {
      d.x += d.vx; d.y += d.vy; d.vy += 0.16; d.life -= 1;
      ctx.globalAlpha = Math.max(0, d.life / 34);
      ctx.fillStyle = '#e9dfc8';
      ctx.beginPath(); ctx.arc(d.x, d.y, d.r, 0, 6.283); ctx.fill();
    }
    ctx.globalAlpha = 1;
    this.dust = this.dust.filter((d) => d.life > 0);
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

  /** স্থাপত্য-অনুপ্রেরণার পট: নদী/মসজিদ-মেহরাব/দুর্গ-দেওয়াল — রূপরেখা, ছবি নয়। */
  private backdrop(sim: Sim, P: Palette, tick: number): void {
    const { ctx } = this;
    const id = sim.ch.id;
    ctx.fillStyle = 'rgba(0,0,0,.16)';
    for (let i = 0; i < 7; i++) {
      const x = 40 + i * 108 - ((tick * 0.06 + sim.player.x * 0.05) % 108);
      if (id <= 1) { ctx.fillRect(x, 150, 30, 90); }
      else if (id <= 4) { this.arch(ctx, x + 20, 240, 54, 96); }
      else if (id <= 6) { this.dome(ctx, x + 30, 214, 40); }
      else { this.dome(ctx, x + 26, 210, 34); ctx.fillRect(x - 4, 196, 8, 44); }
    }
    if (id === 0 || id >= 6) {
      ctx.fillStyle = 'rgba(180,220,235,.16)';
      ctx.fillRect(0, GROUND + 26, W, 26);
    }
  }
  private arch(ctx: CanvasRenderingContext2D, x: number, y: number, w: number, h: number): void {
    ctx.beginPath();
    ctx.moveTo(x, y); ctx.lineTo(x, y - h + w / 2);
    ctx.quadraticCurveTo(x, y - h, x + w / 2, y - h);
    ctx.quadraticCurveTo(x + w, y - h, x + w, y - h + w / 2);
    ctx.lineTo(x + w, y); ctx.closePath(); ctx.fill();
  }
  private dome(ctx: CanvasRenderingContext2D, x: number, y: number, r: number): void {
    ctx.beginPath(); ctx.arc(x, y, r, Math.PI, 0); ctx.lineTo(x + r, y + 44); ctx.lineTo(x - r, y + 44); ctx.closePath(); ctx.fill();
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

  private puppet(ctx: CanvasRenderingContext2D, f: Fighter, tick: number, P: Palette): void {
    const dir = f.facing === 1 ? 1 : -1;
    const depth = 1 + f.y / 420;
    const baseY = GROUND + f.y * 0.5;
    const p = poseOf(f, tick);
    const isHero = f === (null as unknown as Fighter) || f.tone === P.hero;
    void isHero;
    const ink = this.opts.colorblind ? (f.tone === P.hero ? '#f5f1e4' : f.tone) : f.tone;
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
    const legF = limb(ctx, 0, hipY, 1.35 + p.legF, 20, 7, ink);
    limb(ctx, at(legF, 0), at(legF, 1), 1.5 - p.legF * 0.4, 18, 6, ink);
    const legB = limb(ctx, -2, hipY, 1.75 + p.legB, 20, 7, ink);
    limb(ctx, at(legB, 0), at(legB, 1), 1.5 - p.legB * 0.4, 18, 6, ink);
    // আসল (প্যাচ/চাদর)
    ctx.fillStyle = ink;
    ctx.beginPath();
    ctx.moveTo(-9, chestY + 4); ctx.lineTo(11, chestY + 4);
    ctx.lineTo(9 + p.cloth * 8, hipY + 16); ctx.lineTo(-11 - p.cloth * 10, hipY + 14);
    ctx.closePath(); ctx.fill();
    // বুক
    ctx.lineWidth = 13; ctx.strokeStyle = ink; ctx.lineCap = 'round';
    ctx.beginPath(); ctx.moveTo(0, hipY); ctx.lineTo(p.lean * 6, chestY); ctx.stroke();
    // পিছনের হাত + ঢাল
    const sh: [number, number] = [p.lean * 6, chestY];
    const back = limb(ctx, at(sh, 0) - 3, at(sh, 1), Math.PI - 0.7 + p.armB, 15, 6, ink);
    if (f.guarding || f.move?.id === 'guard') {
      ctx.fillStyle = P.accent;
      ctx.beginPath(); ctx.ellipse(at(back, 0) - 2, at(back, 1) + 6, 11, 15, -0.3 + p.swordB * 0.2, 0, 6.283); ctx.fill();
      ctx.strokeStyle = 'rgba(255,255,255,.25)'; ctx.lineWidth = 1.5; ctx.stroke();
    }
    // সামনের হাত + খড়্গ
    const front = limb(ctx, at(sh, 0) + 3, at(sh, 1), -0.5 + p.armF, 16, 6, ink);
    const bladeAng = p.sword;
    ctx.strokeStyle = this.opts.colorblind ? '#ffffff' : '#f3ead2';
    ctx.lineWidth = 3.2;
    const bl = limb(ctx, at(front, 0), at(front, 1), bladeAng, 34, 3.2, this.opts.colorblind ? '#ffffff' : '#f3ead2');
    ctx.strokeStyle = 'rgba(255,255,255,.35)'; ctx.lineWidth = 1;
    ctx.beginPath(); ctx.moveTo(at(front, 0), at(front, 1)); ctx.lineTo(at(bl, 0), at(bl, 1)); ctx.stroke();
    // হাতা
    ctx.strokeStyle = P.accent; ctx.lineWidth = 4;
    limb(ctx, at(front, 0), at(front, 1), bladeAng + Math.PI, 6, 4, P.accent);
    // মাথা + জুলফা/সিরপট্টি
    ctx.fillStyle = ink;
    ctx.beginPath(); ctx.arc(p.lean * 8, headY, 8.4, 0, 6.283); ctx.fill();
    ctx.beginPath();
    ctx.moveTo(p.lean * 8 - 9, headY - 2);
    ctx.quadraticCurveTo(p.lean * 8 - 1, headY - 15 - p.cloth * 3, p.lean * 8 + 9, headY - 1);
    ctx.closePath(); ctx.fill();
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
