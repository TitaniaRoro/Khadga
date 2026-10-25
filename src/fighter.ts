/**
 * src/fighter.ts — একজনের লড়াই-অবস্থা (state machine)।
 *
 * খাঁটি হিসাব: এই ফাইলে কোনো DOM, কোনো Canvas, কোনো `Date.now()`, কোনো `Math.random()` নেই।
 * একই ইনপুট-ক্রম দিলে হুবহু একই ফল — তাই টেস্টে ৩০০ ফ্রেম চালিয়ে
 * "ঢাল ভাঙে / প্রতিউত্তর খোলে / সংকল্প চলে" প্রমাণ করা যায়।
 */
import {
  MOVES, type InputName, type MoveDef, MAX_HP, MAX_GUARD, PARRY_WINDOW,
  RESOLVE_COST, GUARD_BREAK_STUN, totalFrames, isActive, isRecovery, canCancelGuard,
} from './frames.ts';

export type Phase = 'idle' | 'attack' | 'guard' | 'side' | 'hitstun' | 'blockstun' | 'stunned' | 'downed';

export interface FighterInit {
  name_bn: string;
  /** ০ = বাঁ-দিকে মুখ, ১ = ডানদিকে। */
  facing: 0 | 1;
  x: number;
  y: number;
  /** ছায়া-পুতুলের রঙ (শত্রু/প্লেয়ার আলাদা করতে)। */
  tone: string;
  /** প্রতিপক্ষের আঘাতে ক্ষতির গুণক — বস-ভেদে পাল্টায় (design §3.১)। */
  defense: number;
}

export interface HitEvent {
  kind: 'hit' | 'block' | 'parry' | 'guardbreak' | 'whiff' | 'resolve';
  by: string;
  on: string;
  dmg: number;
  /** সংকল্প-আঘাতের সঙ্গে যে তথ্য-লাইন ভেসে ওঠে (কার্ডের `bn`-এর প্রথম বাক্য)। */
  banner?: string;
}

export class Fighter {
  readonly name_bn: string;
  readonly tone: string;
  facing: 0 | 1;
  x: number;
  y: number;
  vx = 0;
  vy = 0;
  hp = MAX_HP;
  /** HP-র নিচের সীমা: দ্বন্দের বস এখানে আটকে যায় (মারা যায় না)। ০ মানে স্বাভাবিক। */
  hpFloor = 0;
  guard = MAX_GUARD;
  meter = 0;
  phase: Phase = 'idle';
  move: MoveDef | null = null;
  frame = 0;
  stunLeft = 0;
  /** রোধ চালু ফ্রেম-গণনা — parry জানালা এখান থেকেই। */
  guardAge = 0;
  /** শেষ ঢাল-ঘাতের পর কত ফ্রেম কেটেছে — ঢাল-পুনর্দখল এখান থেকেই বিলম্বিত হয়। */
  chipAge = 999;
  /** ঢাল না তুলেও ঘাত ঢাল-ক্ষমতা কতটা খায় (০ = শুধু ব্লক করলেই ঢাল কমে)। */
  guardSoak = 0;
  /** নিখুঁত রোধের-between- বিরতি (ফ্রেম): বারবার ঢাল তুলে অসীম parry পাওয়া যায় না। */
  parryCooldown = 0;
  parried = 0;
  /** সংকল্প-আঘাতের তথ্য-লাইন; খেলোয়াড় পড়া কার্ড থেকে আসে। */
  private resolveBanner: string | null = null;
  private readonly defense: number;
  /** এই ফ্রেমে খেলোয়াড় যে ইনপুট চেপেছে (সিমুলেশন-ক্রমে একবারই পড়া হয়)। */
  buffered: InputName | null = null;
  /** ঢেউ-লড়াইয়ে শত্রুর বিকল্প লক্ষ্য: নৌকা/ধানের গাড়ি (player নয়)। */
  targetObjective = false;

  constructor(init: FighterInit) {
    this.name_bn = init.name_bn;
    this.tone = init.tone;
    this.facing = init.facing;
    this.x = init.x;
    this.y = init.y;
    this.defense = init.defense;
  }

  get alive(): boolean { return this.hp > 0; }
  get busy(): boolean { return this.phase === 'attack' || this.phase === 'side' || this.phase === 'stunned'; }
  get actionable(): boolean {
    return this.phase === 'idle' || (this.phase === 'guard' && this.move !== null && canCancelGuard(this.move, this.frame));
  }
  get guarding(): boolean { return this.phase === 'guard'; }
  get invulnerable(): boolean {
    if (this.move === null) return false;
    if (this.phase === 'side') return this.frame < this.move.iframes + this.move.startup;
    if (this.phase === 'attack' && this.move.id === 'resolve') return this.frame <= this.move.iframes;
    return false;
  }
  get canResolve(): boolean { return this.meter >= RESOLVE_COST && this.actionable; }

  setResolveBanner(text: string | null): void { this.resolveBanner = text; }
  takeResolveBanner(): string | null { const b = this.resolveBanner; this.resolveBanner = null; return b; }

  /** মুভ শুরু। বাইরে থেকে (AI/ইনপুট) ডাকা হয়; ভেতরের সিদ্ধান্ত কখনও নিজের নয়। */
  start(input: InputName): boolean {
    if (!this.actionable) return false;
    const m = MOVES[input];
    if (input === 'resolve') {
      if (this.meter < RESOLVE_COST) return false;
      this.meter = 0;
    }
    this.phase = input === 'guard' ? 'guard' : input === 'side' ? 'side' : 'attack';
    this.move = m;
    this.frame = 0;
    this.guardAge = 0;
    this.vx = m.lunge * (this.facing === 1 ? 1 : -1);
    return true;
  }

  /** প্রতি-ফ্রেম অগ্রগতি; শুধু নিজের হিসাব। আঘাত-মিলানো sim.ts-এর কাজ। */
  step(): void {
    this.x += this.vx;
    this.vx *= 0.86;
    if (Math.abs(this.vx) < 0.05) this.vx = 0;
    this.x += this.vx * 0;

    if (this.phase === 'hitstun' || this.phase === 'blockstun' || this.phase === 'stunned') {
      this.stunLeft -= 1;
      if (this.stunLeft <= 0) { this.phase = 'idle'; this.move = null; this.frame = 0; }
      return;
    }
    if (this.phase === 'downed') return;

    const m = this.move;
    this.chipAge += 1;
    if (this.parryCooldown > 0) this.parryCooldown -= 1;
    if (m === null) { this.guardAge = 0; return; }
    this.frame += 1;
    if (this.phase === 'guard') {
      this.guardAge += 1;
      if (this.frame > totalFrames(m)) { this.phase = 'idle'; this.move = null; this.frame = 0; this.guardAge = 0; }
      return;
    }
    if (this.frame >= totalFrames(m)) {
      this.phase = 'idle'; this.move = null; this.frame = 0; this.guardAge = 0;
    }
  }

  /** এই ফ্রেমে আঘাতের রেখা সক্রিয় কি না, আর কত দূর পোঁছে। */
  activeHitbox(): { reach: number; dmg: number; guardDmg: number; high: boolean; kind: InputName } | null {
    const m = this.move;
    if (m === null) return null;
    if (this.phase !== 'attack') return null;
    if (!isActive(m, this.frame)) return null;
    return { reach: m.reach, dmg: m.dmg, guardDmg: m.guardDmg, high: m.high, kind: m.id };
  }

  /** প্রতিপক্ষের আঘাত লাগলো — ঢাল/parry/প্রহারের ভাগ এখানেই। */
  receive(att: { reach: number; dmg: number; guardDmg: number; high: boolean; kind: InputName }, attacker: Fighter): HitEvent {
    const raw = att.dmg * this.defense;
    if (this.invulnerable) {
      return { kind: 'whiff', by: attacker.name_bn, on: this.name_bn, dmg: 0 };
    }
    if (this.guarding && this.move !== null) {
      // নিখুঁত রোধ: রোধ শুরুর PARRY_WINDOW ফ্রেমের ভেতর এলে প্রতিউত্তর-সুযোগ।
      if (this.guardAge < PARRY_WINDOW && this.parryCooldown <= 0) {
        this.parried += 1;
        this.parryCooldown = 36;   // ~০.৬ সেকেন্ড: parry-র পরপর জানালা ফের খোলে না
        attacker.stun(GUARD_BREAK_STUN - 12);
        this.guard = Math.min(MAX_GUARD, this.guard + 6);
        this.meter = Math.min(100, this.meter + 12);
        return { kind: 'parry', by: attacker.name_bn, on: this.name_bn, dmg: 0 };
      }
      this.guard -= att.guardDmg;
      this.phase = 'blockstun';
      this.stunLeft = MOVES[att.kind].blockstun;
      this.move = null; this.frame = 0;
      if (this.guard <= 0) {
        this.guard = 0;
        this.phase = 'stunned';
        this.stunLeft = GUARD_BREAK_STUN;
        return { kind: 'guardbreak', by: attacker.name_bn, on: this.name_bn, dmg: 0 };
      }
      this.chipAge = 0;   // চাপ চলতে থাকলে ঢাল ফেরে না — নাহলে ঢাল ভাঙা অসম্ভব
      return { kind: 'block', by: attacker.name_bn, on: this.name_bn, dmg: Math.round(raw * 0.12) };
    }
    this.hp = Math.max(this.hpFloor, this.hp - Math.round(raw));
    // ঢাল-শোষণ: 'ঢাল ভাঙো' যেন প্রতিপক্ষের এলোমেলো ব্লক-ভাগ্যের জালে না পড়ে।
    // দ্বন্দ্বের বসে ০.৪৫ বসানো — তাই টানা চাপে ঢাল ভাঙে, ব্লক না করলেও।
    if (this.guardSoak > 0 && this.guard > 0) {
      this.guard = Math.max(0, this.guard - Math.round(MOVES[att.kind].guardDmg * this.guardSoak));
      if (this.guard <= 0) {
        this.phase = 'stunned'; this.stunLeft = GUARD_BREAK_STUN; this.move = null; this.frame = 0;
        return { kind: 'guardbreak', by: attacker.name_bn, on: this.name_bn, dmg: 0 };
      }
    }
    this.phase = 'hitstun';
    this.stunLeft = MOVES[att.kind].hitstun;
    this.move = null; this.frame = 0; this.guardAge = 0;
    this.vx = MOVES[att.kind].knockback * (att.reach > 0 ? (attacker.facing === 1 ? 0.5 : -0.5) : 0);
    if (att.kind === 'resolve') {
      const banner = attacker.takeResolveBanner();
      return { kind: 'resolve', by: attacker.name_bn, on: this.name_bn, dmg: Math.round(raw), banner: banner ?? undefined };
    }
    if (this.hp <= 0) { this.phase = 'downed'; this.stunLeft = 9999; }
    return { kind: 'hit', by: attacker.name_bn, on: this.name_bn, dmg: Math.round(raw) };
  }

  stun(frames: number): void {
    this.phase = 'stunned';
    this.stunLeft = frames;
    this.move = null; this.frame = 0;
  }

  /** আঘাত মেলেনি — খালি-কোপের খরচ (মিটার বাড়ে না)। */
  whiff(): void { this.meter = Math.max(0, this.meter - 1); }

  awardMeter(n: number): void { this.meter = Math.min(100, this.meter + n); }
  heal(n: number): void { this.hp = Math.min(MAX_HP, this.hp + n); }
  refillGuard(n: number): void { this.guard = Math.min(MAX_GUARD, this.guard + n); }
  /** সংকল্প-আঘাতের ক্ষতি-গুণক কার্ডের সূত্র-নির্ভরযোগ্যতা থেকে (sim.ts বসায়)। */
  isRecovering(m: MoveDef): boolean { return isRecovery(m, this.frame); }
}
