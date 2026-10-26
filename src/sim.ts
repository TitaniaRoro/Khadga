/**
 * src/sim.ts — ঢেউ-যুদ্ধ আর দ্বন্দ্ব-পরিসর: লড়াই-নিয়ম ও ইতিহাস-সামগ্রীর সংযোগস্থল।
 *
 * দুটো নিয়ম এই ফাইলটাকে খেলার নৈতিক আকার দেয় (design §৩.১, §৫):
 *  ১. ঢেউ-যুদ্ধের লক্ষ্য "সবাইকে মারো" নয় — নৌকা/ধানের গাড়ি/পল্লী ৯০ সেকেন্ড রক্ষা।
 *     টিকে-থাকাই জয় (শেষ ঢেউ তাড়িয়ে দিলেও জয়, কিন্তু সেটা বাধ্যতামূলক পথ নয়)।
 *  ২. দ্বন্দ্ব শেষ হয় প্রাণ-শেষ করে নয় — বসের ঢাল ভেঙে, সেই ফাঁকে ৩টি সঠিক উত্তর বসালে।
 *     লড়াই থামে না, কিন্তু প্রশ্নের সময়টা মানুষের পড়ার মতো (QUESTION_FRAMES) —
 *     আগের ৪৬-ফ্রেমের (০.৭৬ সেকেন্ড!) জানালায় কোনো মানুষের পক্ষে উত্তর দেওয়া সম্ভব ছিল না,
 *     শুধু playtest-রোবট পারত। এখন বস স্তব্ধ থাকে, ঘড়ি প্রশ্ন-কার্ডে দেখা যায়,
 *     আর Game-স্তরে সময় ধীরে চলে — লড়াই চলমান, পড়া সম্ভব।
 *
 * আর্কেড-স্তর (স্কোর/টানা-আঘাত/পিকআপ) এই একই নির্ণয়যোগ্য সিমেই থাকে, যাতে
 * "একই বীজ + একই ইনপুট = একই ফল" টেস্ট স্কোরকেও আটকে রাখে।
 */
import { Fighter, type EnemyKind, type HitEvent } from './fighter.ts';
import { MAX_GUARD, MOVES, MAX_HP, type InputName } from './frames.ts';
import type { Chapter, Card, Meta, QuizItem } from './content-types.ts';
import { damageFactor } from './content-types.ts';

/** ধ্রুপদী মলবেরি-৩২ — সিড-দিলে পুরো লড়াই পুনরুৎপাদনযোগ্য (টেস্টের জন্য শর্ত)। */
export function rng(seed: number): () => number {
  let t = seed >>> 0;
  return () => {
    t = (t + 0x6d2b79f5) >>> 0;
    let r = Math.imul(t ^ (t >>> 15), 1 | t);
    r = (r + Math.imul(r ^ (r >>> 7), 61 | r)) ^ r;
    return ((r ^ (r >>> 14)) >>> 0) / 4294967296;
  };
}

/** প্রশ্ন পড়ে উত্তর দেওয়ার সময় (সিম-ফ্রেম)। Game এই সময়ে ঘড়ি ধীরে চালায়। */
export const QUESTION_FRAMES = 420;

export interface InputFrame {
  moveX: number;
  moveY: number;
  pressed: InputName | null;
  /** দ্বন্দ্বের প্রশ্নের উত্তর (০–৩), এই ফ্রেমে চাপা হলে। */
  answer: 0 | 1 | 2 | 3 | null;
  /** শিক্ষক-মোড: পারি-প্রশ্নের উত্তর (design §৩.১)। */
  parryAnswer: 0 | 1 | 2 | 3 | null;
}

export const emptyInput = (): InputFrame => ({ moveX: 0, moveY: 0, pressed: null, answer: null, parryAnswer: null });

export type SimEvent =
  | ({ t: 'hit' } & HitEvent)
  | { t: 'objective'; name_bn: string; hp: number }
  | { t: 'wave'; index: number; of: number }
  | { t: 'waveclear'; index: number }
  | { t: 'banner'; text: string; card: string }
  | { t: 'question'; q: QuizItem; lives: number }
  | { t: 'answered'; q: QuizItem; correct: boolean }
  | { t: 'qtimeout'; q: QuizItem }
  | { t: 'boon'; card: string; boon_bn: string }
  | { t: 'pickup'; card: Card }
  | { t: 'downed'; who: string; x: number; y: number }
  | { t: 'comboend'; combo: number; bonus: number }
  | { t: 'phase'; phase: number }
  | { t: 'swing'; who: string; kind: InputName; byPlayer: boolean; hostile: boolean; x: number }
  | { t: 'telegraph'; who: string; x: number }
  | { t: 'break'; text: string }
  | { t: 'win' } | { t: 'lose'; why_bn: string } | { t: 'pause' };

export type ObjectiveKind = 'boat' | 'grain' | 'village';
const OBJ_NAME: Record<ObjectiveKind, string> = { boat: 'নৌকা', grain: 'ধানের গাড়ি', village: 'পল্লী-গেট' };

/** মাঠে ভাসা জ্ঞান-স্ক্রল: ছুঁলেই কার্ড খোলে (ইতিহাসকে লড়াইয়ের ভেতরের লক্ষ্য বানানো)। */
export interface Pickup { x: number; y: number; card: Card; life: number; seed: number }

export interface SimOpts {
  /** অসীম ঢেউ: ঢেউ শেষ হয় না, কঠিনতা বাড়ে, হারলেই শেষ — স্কোর-তাড়ার মোড। */
  endless?: boolean;
  /** সহজ মোড: খেলোয়াড়ের ক্ষতি কম, লক্ষ্য শক্ত, শত্রু ধীরে চাপ দেয়। */
  gentle?: boolean;
}

/** কার্ডের ট্যাগ + বসের স্বভাব থেকে ঢেউ-শত্রুর সংখ্যা/সাজসজ্জা (ইতিহাস-প্রেরিত, র‍্যান্ডম নয়)। */
function enemyBudget(ch: Chapter): { perWave: number; hp: number; aggression: number } {
  const n = ch.cards.length;
  const warfare = ch.cards.filter((c) => c.tags.includes('warfare')).length;
  const navy = ch.cards.filter((c) => c.tags.includes('navy')).length;
  return {
    perWave: Math.min(7, 4 + Math.round(navy / 3) + (n > 10 ? 1 : 0)),
    hp: Math.round(MAX_HP * (0.27 + warfare * 0.012 + ch.id * 0.014)),
    aggression: Math.min(0.86, 0.42 + ch.id * 0.05 + warfare * 0.01),
  };
}

const KIND_ORDER: EnemyKind[] = ['blade', 'blade', 'spear', 'shield', 'swift', 'blade', 'spear', 'shield'];
const KIND_TONE: Record<string, string> = { blade: '#9a8f7a', shield: '#d8a75a', spear: '#8fc3e8', swift: '#e08a63' };
const KIND_NAME: Record<string, string> = { blade: 'তলোয়ারধারী', shield: 'ঢালধারী', spear: 'বর্শাধারী', swift: 'দ্রুতগামী' };
/** ধরনভেদে থামার দূরত্ব — বর্শাধারী দূর থেকে খোঁচায়, ঢালধারী গা ঘেঁষে চাপ দেয়। */
const KIND_RANGE: Record<string, number> = { blade: 46, shield: 42, spear: 84, swift: 40, boss: 48 };

/**
 * কার্ড → গেমপ্লে-লাভ। content-এর `boon_bn` পাঠ্য-ভিত্তিক, তাই এখানে শব্দ-মিল দিয়ে
 * প্রভাব বাছাই করা হয় — পরে JSON-তে structured `effect` যোগ করলে এই ফাংশনটা শুধু ম্যাপিং-টেবিলে দাঁড়াবে।
 */
export function boonOf(boon_bn: string): { kind: 'time' | 'meterKeep' | 'speed' | 'defense' | 'ally' | 'chip' | 'guard'; amount: number } {
  const num = (re: RegExp): number => {
    const m = boon_bn.match(re);
    return m ? Number(m[1]) : 0;
  };
  const pct = num(/(\d+)\s*%/);
  if (/সময়/.test(boon_bn)) return { kind: 'time', amount: 10 + Math.min(30, num(/(\d+)\s*সেকেন্ড/) || 12) };
  if (/মিটার/.test(boon_bn)) return { kind: 'meterKeep', amount: 1 };
  if (/হাঁটা|গতি|বেগ|দৌড়/.test(boon_bn)) return { kind: 'speed', amount: 1.18 };
  if (/ক্ষতি/.test(boon_bn)) return { kind: 'defense', amount: 1 - Math.min(0.5, pct / 100) };
  if (/মিত্র|সৈনিক|সঙ্গী/.test(boon_bn)) return { kind: 'ally', amount: 1 };
  if (/ঢাল|রোধ/.test(boon_bn)) return { kind: 'guard', amount: 34 };
  return { kind: 'chip', amount: 1.2 };
}

export interface DuelState {
  question: QuizItem | null; truths: number; needs: number; asked: string[]; cooldown: number;
  /** চলতি প্রশ্নের বাকি ফ্রেম ও মোট সময় (HUD-র ঘড়ি-পটি এখান থেকে)। */
  qTime: number; qTotal: number;
}

export class Sim {
  readonly ch: Chapter;
  readonly meta: Meta;
  readonly seed: number;
  readonly mode: 'wave' | 'duel';
  readonly endless: boolean;
  readonly gentle: boolean;
  readonly player: Fighter;
  enemies: Fighter[] = [];
  ally: Fighter | null = null;
  objective: { kind: ObjectiveKind; name_bn: string; hp: number; maxHp: number; x: number; y: number } | null = null;
  frame = 0;
  timeLeft: number;
  waveIndex = 0;
  waves: number;
  events: SimEvent[] = [];
  over: 'win' | 'lose' | null = null;
  loseWhy_bn = '';
  /** পড়া কার্ড — সংকল্প-আঘাত এখান থেকেই তথ্য-লাইন আর ক্ষতি-গুণক পায়। */
  readCards = new Set<string>();
  cardQueue: Card[];
  duel: DuelState;
  /** ── আর্কেড-স্তর ── */
  score = 0;
  combo = 0;
  comboTimer = 0;
  comboBest = 0;
  streak = 0;
  qRight = 0;
  qWrong = 0;
  hitsLanded = 0;
  enemiesDowned = 0;
  /** Game এই কাউন্টার থাকলে সিম থামিয়ে রাখে (hit-stop) — আঘাতের 'ওজন'। */
  hitstop = 0;
  pickups: Pickup[] = [];
  /** এই রানে পিকআপে তোলা কার্ড (ফলাফল-পর্দার 'আজ যা শিখলে')। */
  collectedRun: string[] = [];
  /** ঢেউয়ের মাঝের শ্বাস-নেওয়ার বিরতি (ফ্রেম)। */
  intermission = 0;
  bossPhase = 1;
  private readonly rand: () => number;
  private readonly budget: ReturnType<typeof enemyBudget>;
  private readonly boons: Map<string, ReturnType<typeof boonOf>>;
  private askedThisBreak = false;
  private spawnQueue = 0;
  private spawnTimer = 0;
  private spawnSerial = 0;
  private pickupTimer = 360;
  private buffered: { move: InputName; left: number } | null = null;
  private parryCard: QuizItem | null = null;
  private queue: string[] = [];

  constructor(ch: Chapter, meta: Meta, mode: 'wave' | 'duel', seed = 1, boons: Map<string, ReturnType<typeof boonOf>> = new Map(), opts: SimOpts = {}) {
    this.ch = ch;
    this.meta = meta;
    this.mode = mode;
    this.seed = seed;
    this.endless = !!opts.endless && mode === 'wave';
    this.gentle = !!opts.gentle;
    this.rand = rng(seed);
    this.budget = enemyBudget(ch);
    this.boons = boons;
    this.waves = this.endless ? 999 : mode === 'wave' ? Math.max(1, ch.fight_bn?.waves ?? 2) : 1;
    this.timeLeft = mode === 'wave' && !this.endless ? 90 * 60 + this.bonusTime() : 999 * 60;
    this.player = new Fighter({
      name_bn: ch.bearer_bn.name_bn, tone: '#f2e3b6', facing: 1,
      x: mode === 'wave' ? 170 : 200, y: 0,
      defense: this.defenseFactor() * (this.gentle ? 0.72 : 1), kind: 'hero',
    });
    this.player.graceMax = 16;   // দলবদ্ধ আঘাতে stun-lock নয় — প্রতি আঘাতের পর ছোট্ট অবকাশ
    this.cardQueue = [...ch.cards];
    this.duel = { question: null, truths: 0, needs: 3, asked: [], cooldown: 0, qTime: 0, qTotal: QUESTION_FRAMES };
    if (mode === 'wave') {
      const kind = this.objectiveKind();
      const hp = this.gentle ? 170 : 130;
      this.objective = { kind, name_bn: OBJ_NAME[kind], hp, maxHp: hp, x: 92, y: 0 };
      this.spawnWave();
    } else {
      const b = ch.boss;
      const boss = new Fighter({ name_bn: b?.name_bn ?? 'প্রতিপক্ষ', tone: '#e07a52', facing: 0, x: 330, y: 0, defense: 1, kind: 'boss' });
      boss.hp = Math.round(MAX_HP * 1.35);
      boss.guard = MAX_GUARD;
      // দ্বন্দের জয়-শর্ত = ঢাল ভেঙে তিন সত্যি, বসকে রক্তপাতে মারা নয় (design §৩)।
      boss.hpFloor = Math.round(MAX_HP * 0.25);
      boss.guardSoak = 0.55;
      boss.speedMul = 1.05;
      this.enemies = [boss];
      if (b) this.events.push({ t: 'banner', text: b.myth_bn, card: 'boss' });
    }
    if (this.allyWanted()) {
      this.ally = new Fighter({ name_bn: 'পল্লীর কৃষক', tone: '#8fc97e', facing: 1, x: 120, y: 40, defense: 1.6, kind: 'ally' });
      this.ally.hp = Math.round(MAX_HP * 0.5);
    }
  }

  private objectiveKind(): ObjectiveKind {
    const d = (this.ch.fight_bn?.duel_bn ?? '') + this.ch.cards.map((c) => c.bn).join(' ');
    if (/নৌকা|জাহাজ|নদী/.test(d)) return 'boat';
    if (/ধান|গাড়ি|শস্য|পোড়া/.test(d)) return 'grain';
    return 'village';
  }
  private bonusTime(): number {
    let t = 0;
    for (const b of this.boons.values()) if (b.kind === 'time') t += b.amount * 60;
    return t;
  }
  private defenseFactor(): number {
    let f = 1;
    for (const b of this.boons.values()) if (b.kind === 'defense') f *= b.amount;
    return f;
  }
  private speedFactor(): number {
    let f = 1;
    for (const b of this.boons.values()) if (b.kind === 'speed') f *= b.amount;
    return f;
  }
  private allyWanted(): boolean {
    for (const b of this.boons.values()) if (b.kind === 'ally') return true;
    return false;
  }

  /** এই লড়াইয়ে সক্রিয় কার্ড-লাভের id (টেস্ট + ডিবাগ-প্যানেল এটিই পড়ে)। */
  boonCards(): string[] { return [...this.boons.keys()]; }

  /** কার্ড পড়া হলো — মিটার-লাভ, প্রহারের জ্বালানি, আর tactic-লাভ সক্রিয়। */
  readCard(id: string): void {
    if (this.readCards.has(id)) return;
    this.readCards.add(id);
    const card = this.ch.cards.find((c) => c.id === id);
    if (!card) return;
    this.player.awardMeter(this.mode === 'duel' ? 18 : 12);
    this.player.setResolveBanner(firstClause(card.bn));
    const tac = this.ch.tactics.find((t) => t.card === id);
    if (tac) {
      this.boons.set(id, boonOf(tac.boon_bn));
      this.events.push({ t: 'boon', card: id, boon_bn: tac.boon_bn });
    }
  }

  /** মাঠে জ্ঞান-স্ক্রল ফেলা — না-পড়া কার্ডই আগে, সব পড়া হয়ে গেলে যেকোনো কার্ড (মিটার-বোনাস)। */
  dropCard(x: number, y: number): void {
    if (!this.ch.cards.length || this.pickups.length >= 2) return;
    const busy = new Set(this.pickups.map((p) => p.card.id));
    const fresh = this.ch.cards.find((c) => !this.readCards.has(c.id) && !busy.has(c.id));
    const card = fresh ?? this.ch.cards[Math.floor(this.rand() * this.ch.cards.length)]!;
    this.pickups.push({
      x: clamp(x, 70, 700), y: clamp(y, -48, 48), card,
      life: 60 * 14, seed: Math.floor(this.rand() * 1000),
    });
  }

  private spawnWave(): void {
    const scale = this.endless ? Math.min(4, Math.floor(this.waveIndex / 2)) : 0;
    const total = this.budget.perWave + Math.floor(this.waveIndex * 0.6) + scale;
    const now = Math.min(3, total);
    for (let i = 0; i < now; i++) this.spawnOne(i);
    this.spawnQueue = Math.max(0, total - now);
    this.spawnTimer = 150;
    this.events.push({ t: 'wave', index: this.waveIndex + 1, of: this.endless ? 0 : this.waves });
  }

  private spawnOne(slot = 0): void {
    const s = this.spawnSerial++;
    const kind = KIND_ORDER[(s + this.ch.id) % KIND_ORDER.length]!;
    const fromLeft = this.waveIndex >= 1 && s % 5 === 4;   // পরের ঢেউয়ে মাঝে মাঝে পেছন থেকেও চাপ
    const e = new Fighter({
      name_bn: `${KIND_NAME[kind]} ${this.enemyName()}`,
      tone: KIND_TONE[kind]!,
      facing: fromLeft ? 1 : 0,
      x: fromLeft ? 46 : 660 + slot * 34,
      y: Math.round((this.rand() - 0.5) * 86),
      defense: 1,
      kind,
    });
    const hpScale = (this.endless ? 1 + this.waveIndex * 0.07 : 1) * (this.gentle ? 0.85 : 1);
    if (kind === 'shield') { e.hp = Math.round(this.budget.hp * 1.55 * hpScale); e.guard = 100; e.speedMul = 0.78; }
    else if (kind === 'spear') { e.hp = Math.round(this.budget.hp * 0.92 * hpScale); e.guard = 60; e.reachMul = 1.45; e.speedMul = 0.95; }
    else if (kind === 'swift') { e.hp = Math.round(this.budget.hp * 0.62 * hpScale); e.guard = 42; e.speedMul = 1.5; }
    else { e.hp = Math.round(this.budget.hp * hpScale); e.guard = 70; }
    // লক্ষ্যের দিকে দৌড়নো শত্রু একসঙ্গে সর্বোচ্চ দুজন — নাহলে নৌকা বাঁচানো অসম্ভব হয়ে পড়ে
    const objChasers = this.enemies.filter((f) => f.alive && f.targetObjective).length;
    e.targetObjective = !!this.objective && objChasers < 2 && this.rand() < 0.42;
    e.attackCooldown = 30 + Math.floor(this.rand() * 40);
    this.enemies.push(e);
  }

  private enemyName(): string {
    const pool = this.ch.id <= 1
      ? ['পথ-লুণ্ঠক', 'সীমান্ত-ঘোড়সওয়ার', 'ভাড়া-সৈনিক']
      : this.ch.id <= 3
        ? ['কর-রক্ষী', 'দিল্লি-সিপাহি', 'অশ্বারোহী']
        : this.ch.id <= 5
          ? ['সুলতানি পদাতিক', 'তোপাল-সৈনিক', 'অশ্বারোহী']
          : this.ch.id <= 6
            ? ['মুঘল সিপাহি', 'নৌ-সৈনিক', 'ফিরিঙ্গি তোপধারী']
            : ['কোম্পানির সিপাহি', 'ফরাসি নৌ-সৈনিক', 'ভাড়া-তোপাল'];
    return pool[Math.floor(this.rand() * pool.length) % pool.length]!;
  }

  /** এক ফ্রেম এগোয়। ইনপুট এখানেই পড়া হয়, রেন্ডারিং কখনও এখানে আসে না। */
  step(input: InputFrame): SimEvent[] {
    this.events = [];
    if (this.over) return this.events;
    this.frame += 1;
    if (this.timeLeft > 0 && !this.endless) this.timeLeft -= 1;   // অসীম মোডে ঘড়ি শেষ হয় না

    if (this.timeLeft <= 0) {
      if (this.mode === 'wave' && !this.endless) {
        this.score += this.objective ? Math.round(this.objective.hp * 4) : 0;
        this.over = 'win'; this.events.push({ t: 'win' }); return this.events;
      }
      this.over = 'lose';
      this.loseWhy_bn = 'দ্বন্দ্বের সময় ফুরিয়ে গেছে — ঢাল ভাঙার সুযোগগুলো যেতে দিয়েছ। তিন সত্যি আগে, তারপর তীক্ষ্ণতা।';
      this.events.push({ t: 'lose', why_bn: this.loseWhy_bn });
      return this.events;
    }

    // টানা-আঘাতের ঘড়ি: ফুরোলে জমা কম্বো স্কোরে বোনাস হয়ে জমা পড়ে
    if (this.comboTimer > 0) {
      this.comboTimer -= 1;
      if (this.comboTimer === 0 && this.combo > 0) this.endCombo();
    }

    if (this.mode === 'duel') this.duelTick(input);

    this.faceTargets();
    // ইনপুট-বাফার: ব্যস্ত থাকা অবস্থায় চাপা বোতাম হারায় না (৯ ফ্রেম ধরে রাখা হয়)
    if (input.pressed) this.buffered = { move: input.pressed, left: 12 };
    if (this.buffered) {
      if (this.player.actionable) {
        const started = this.player.start(this.buffered.move);
        if (started || this.buffered.move === 'resolve') this.buffered = null;
      }
      if (this.buffered) { this.buffered.left -= 1; if (this.buffered.left <= 0) this.buffered = null; }
    }
    if ((input.moveX !== 0 || input.moveY !== 0) && !this.player.busy && this.player.phase !== 'guard') {
      const sp = 2.9 * this.speedFactor();
      this.player.x += input.moveX * sp;
      if (this.mode === 'wave') this.player.y += input.moveY * sp * 0.55;
      // ড্যাশের দিক: চলার ইনপুট থাকলে সবে সেই দিকেই যায়
      if (this.player.phase === 'side' && input.moveX !== 0) this.player.vx = 7.5 * Math.sign(input.moveX);
    }
    this.player.x = clamp(this.player.x, 40, 720);
    this.player.y = clamp(this.player.y, -60, 60);

    this.pickupTick();

    for (const e of this.enemies) if (e.alive) this.aiTick(e);
    if (this.ally?.alive) this.allyTick(this.ally);
    this.separate();

    // প্রতিটি আক্রমণের শুরু একবারই ঘোষণা হয় — শত্রুর সুইংও এখন শোনা যায় (শুধু নিজের বোতাম-চাপ নয়)
    for (const f of [this.player, ...this.enemies, ...(this.ally ? [this.ally] : [])]) {
      if (f.phase === 'attack' && f.move && f.frame === 0) {
        this.events.push({ t: 'swing', who: f.name_bn, kind: f.move.id, byPlayer: f === this.player, hostile: f !== this.player && f !== this.ally, x: f.x });
      }
    }
    for (const f of [this.player, ...this.enemies, ...(this.ally ? [this.ally] : [])]) f.step();
    this.resolveHits();
    this.guardRegen();
    this.spawnTick();

    if (this.mode === 'wave') this.waveEndTick();
    else this.duelEndTick();
    return this.events;
  }

  private endCombo(): void {
    if (this.combo >= 5) {
      const bonus = this.combo * 15;
      this.score += bonus;
      this.events.push({ t: 'comboend', combo: this.combo, bonus });
    }
    this.combo = 0;
  }

  private pickupTick(): void {
    // পর্যায়ক্রমিক স্ক্রল: লড়াইয়ের মাঝেও ইতিহাস নিজে এসে দাঁড়ায়
    if (this.pickupTimer > 0) this.pickupTimer -= 1;
    else {
      this.pickupTimer = 620 + Math.floor(this.rand() * 240);
      if (!this.pickups.length && !this.over) this.dropCard(240 + this.rand() * 380, (this.rand() - 0.5) * 70);
    }
    for (const p of this.pickups) {
      p.life -= 1;
      if (Math.abs(p.x - this.player.x) < 38 && Math.abs(p.y - this.player.y) < 36 && this.player.alive) {
        p.life = 0;
        const fresh = !this.readCards.has(p.card.id);
        this.readCard(p.card.id);
        if (!fresh) this.player.awardMeter(8);
        if (fresh && !this.collectedRun.includes(p.card.id)) this.collectedRun.push(p.card.id);
        this.score += fresh ? 200 : 80;
        if (this.objective && this.mode === 'wave') this.objective.hp = Math.min(this.objective.maxHp, this.objective.hp + 5);
        this.events.push({ t: 'pickup', card: p.card });
      }
    }
    this.pickups = this.pickups.filter((p) => p.life > 0);
  }

  private spawnTick(): void {
    if (this.mode !== 'wave') return;
    if (this.intermission > 0) {
      this.intermission -= 1;
      if (this.intermission === 0 && !this.over) { this.waveIndex += 1; this.spawnWave(); }
      return;
    }
    if (this.spawnQueue > 0) {
      this.spawnTimer -= 1;
      const alive = this.enemies.filter((e) => e.alive).length;
      const cap = 5 + Math.min(2, this.waveIndex) + (this.endless ? Math.min(2, Math.floor(this.waveIndex / 3)) : 0);
      if (this.spawnTimer <= 0 && alive < cap) {
        this.spawnOne(0);
        this.spawnQueue -= 1;
        this.spawnTimer = 130;
      }
    }
  }

  private waveEndTick(): void {
    if (this.objective && this.objective.hp <= 0) {
      this.over = 'lose';
      this.loseWhy_bn = `${this.objective.name_bn} রক্ষা করা যায়নি — লড়াই জেতার চেয়ে এই কাজটাই বড় ছিল।`;
      this.events.push({ t: 'lose', why_bn: this.loseWhy_bn });
      return;
    }
    if (!this.player.alive) {
      this.over = 'lose';
      this.loseWhy_bn = 'তুমি মাঠ ছাড়তে বাধ্য হয়েছ — নৌকা/গাড়ি রক্ষার কাজটা অসমাপ্ত।';
      this.events.push({ t: 'lose', why_bn: this.loseWhy_bn });
      return;
    }
    const alive = this.enemies.filter((e) => e.alive).length;
    if (this.intermission === 0 && this.spawnQueue === 0 && alive === 0 && this.frame > 50) {
      this.score += 500;
      this.events.push({ t: 'waveclear', index: this.waveIndex + 1 });
      if (!this.endless && this.waveIndex + 1 >= this.waves) {
        // শেষ ঢেউ তাড়িয়ে দেওয়া = সময়ের আগেই রক্ষা সম্পূর্ণ (বোনাসসহ জয়)
        this.score += Math.round(this.timeLeft / 60) * 12 + (this.objective ? Math.round(this.objective.hp * 4) : 0);
        this.over = 'win';
        this.events.push({ t: 'win' });
        return;
      }
      // বিরতি: শ্বাস নাও, স্ক্রল তোলো, পরের ঢেউ আসছে
      this.intermission = 300;
      this.player.heal(20);
      if (this.objective) this.objective.hp = Math.min(this.objective.maxHp, this.objective.hp + 10);
      this.dropCard(clamp(this.player.x + 130, 120, 660), this.player.y);
    }
  }

  private duelEndTick(): void {
    const boss = this.enemies[0];
    if (this.duel.truths >= this.duel.needs) {
      this.over = 'win';
      if (this.ch.boss) this.events.push({ t: 'break', text: this.ch.boss.breakline_bn });
      this.score += 800 + Math.round(this.player.hp * 2);
      this.events.push({ t: 'win' });
    } else if (!this.player.alive) {
      this.over = 'lose';
      this.loseWhy_bn = 'ঢাল ভাঙার সুযোগ হাতছাড়া — প্রাণ ফুরিয়ে গেছে।';
      this.events.push({ t: 'lose', why_bn: this.loseWhy_bn });
    } else if (boss && boss.phase === 'stunned' && !this.duel.question) {
      this.askQuestion();
    }
  }

  /** ঢাল-ক্ষমতা ধীরে ফেরে — রোধ-চাপা খেলোয়াড়কে চিরকাল পাহারা দিতে দেয় না। */
  private guardRegen(): void {
    for (const f of [this.player, ...this.enemies]) {
      if (f.phase !== 'guard' && f.guard < MAX_GUARD && f.chipAge > 40) f.refillGuard(0.22);
    }
  }

  private duelTick(input: InputFrame): void {
    const boss = this.enemies[0];
    if (!boss) return;
    if (this.duel.cooldown > 0) this.duel.cooldown -= 1;

    if (this.duel.question) {
      // প্রশ্ন চলার সময় বস স্তব্ধই থাকে — পড়ার সময়টা ঘড়িতে বাঁধা, স্টান-ফ্রেমে নয়
      this.duel.qTime -= 1;
      if (this.duel.qTime <= 0) {
        const q = this.duel.question;
        this.duel.question = null;
        this.askedThisBreak = false;
        this.duel.cooldown = 30;
        this.streak = 0;
        boss.guard = Math.max(boss.guard, 45);
        boss.stunLeft = Math.min(boss.stunLeft, 8);
        this.events.push({ t: 'qtimeout', q });
      } else if (boss.phase !== 'downed') {
        boss.phase = 'stunned';
        boss.stunLeft = Math.max(boss.stunLeft, 24);
        boss.move = null;
      }
    }

    if (input.answer !== null && this.duel.question) {
      const q = this.duel.question;
      const correct = input.answer === q.answer;
      this.events.push({ t: 'answered', q, correct });
      this.duel.question = null;
      this.askedThisBreak = false;
      if (correct) {
        this.duel.truths += 1;
        this.duel.asked.push(q.id);
        this.duel.cooldown = 24;
        this.qRight += 1;
        this.score += 400 + this.streak * 100;
        this.streak += 1;
        this.player.awardMeter(34);
        boss.receive({ reach: 1, dmg: Math.round(10 * this.resolvePower()), guardDmg: 0, high: false, kind: 'resolve' }, this.player);
        // স্টান কুলডাউনের আগেই শেষ হয় — নাহলে এক ঢাল-ভাঙাতেই পরপর তিন প্রশ্ন এসে যেত,
        // মাঝখানে লড়াইটা ঘটতই না। পরের সত্যির জন্য আবার ঢাল ভাঙতে হবে।
        boss.stun(12);
        this.duel.cooldown = 30;
        if (this.duel.truths < this.duel.needs) {
          // পরের পর্ব: ঢাল কিছুটা ফিরে আসে, বস রাগী ও দ্রুত হয়
          boss.guard = 62 + this.duel.truths * 10;
          this.bossPhase = this.duel.truths + 1;
          this.events.push({ t: 'phase', phase: this.bossPhase });
        }
        this.events.push({ t: 'banner', text: firstClause(this.cardOf(q)?.bn ?? q.explain_bn), card: q.card });
      } else {
        // ভুল = শাস্তি নয়; মিটার ভাঙে, বসের ঢাল কিছুটা ফেরে, লড়াই চলতেই থাকে।
        this.qWrong += 1;
        this.streak = 0;
        const keep = [...this.boons.values()].some((b) => b.kind === 'meterKeep');
        if (!keep) this.player.awardMeter(-14);
        this.duel.cooldown = 24;
        boss.guard = Math.max(boss.guard, 32);
        boss.stunLeft = Math.min(boss.stunLeft, 14);
        this.queue.push(q.id);
      }
    }
    if (input.parryAnswer !== null && boss.phase === 'attack' && boss.move !== null && boss.move.high && this.parryCard) {
      const ok = input.parryAnswer === this.parryCard.answer;
      if (ok) this.player.awardMeter(20);
      else this.player.awardMeter(4);
      this.events.push({ t: 'answered', q: this.parryCard, correct: ok });
      this.parryCard = null;
    }
  }

  /** বস ঢাল ভাঙার মুখে প্রশ্ন তোলে — অধ্যায়ের জ্ঞানকোষ থেকে, পুরোনোটি এড়িয়ে। */
  private askQuestion(): void {
    if (this.askedThisBreak || this.duel.cooldown > 0) return;
    const pool = this.ch.quiz.filter((q) => !this.duel.asked.includes(q.id));
    const q = pool.length ? pool[Math.floor(this.rand() * pool.length)]! : this.ch.quiz[0]!;
    this.duel.question = q;
    this.duel.qTime = QUESTION_FRAMES;
    this.duel.qTotal = QUESTION_FRAMES;
    this.askedThisBreak = true;
    this.parryCard = q;
    this.events.push({ t: 'question', q, lives: this.duel.needs - this.duel.truths });
  }

  private cardOf(q: QuizItem): Card | undefined {
    return this.ch.cards.find((c) => c.id === q.card);
  }

  /** সংকল্প/সত্য-আঘাতের গুণক: পড়া কার্ডের সূত্র যত নির্ভরযোগ্য, তত বেশি। */
  private resolvePower(): number {
    let best = 0.85;
    for (const id of this.readCards) {
      const c = this.ch.cards.find((x) => x.id === id);
      if (c) best = Math.max(best, damageFactor(c, this.meta.sources_legend));
    }
    return best;
  }

  /**
   * মোকাবিলা-নিয়ম: নিজের আঘাতে ব্যস্ত না থাকলে প্রত্যেকে লক্ষ্যের দিকে ফেরে।
   * এর আগে facing জন্মের পর স্থির ছিল — শত্রু চিরকাল ফাঁকা বাতাস কাটত।
   */
  private faceTargets(): void {
    if (this.player.alive) {
      for (const e of this.enemies) {
        if (e.busy || e.telegraph > 0) continue;
        const tx = e.targetObjective && this.objective ? this.objective.x : this.player.x;
        e.facing = tx >= e.x ? 1 : 0;
      }
    }
    const foe = this.enemies.filter((e) => e.alive).sort((a, b) => Math.abs(a.x - this.player.x) - Math.abs(b.x - this.player.x))[0];
    if (foe && !this.player.busy) this.player.facing = foe.x >= this.player.x ? 1 : 0;
  }

  /** শত্রুরা একজন আরেকজনের গায়ে গাদাগাদি করে না — প্রত্যেকের সিলুয়েট আলাদা পড়ে। */
  private separate(): void {
    const all = this.enemies.filter((e) => e.alive);
    for (let i = 0; i < all.length; i++) {
      for (let j = i + 1; j < all.length; j++) {
        const a = all[i]!, b = all[j]!;
        const dx = b.x - a.x, dy = b.y - a.y;
        if (Math.abs(dx) < 34 && Math.abs(dy) < 18 && a.phase === 'idle' && b.phase === 'idle') {
          const push = (34 - Math.abs(dx)) / 2 * (dx >= 0 ? 1 : -1);
          a.x -= push * 0.6; b.x += push * 0.6;
          b.y += dy >= 0 ? 1.2 : -1.2;
        }
      }
    }
    // শরীরের সংঘর্ষ: নায়ক/মিত্র শত্রুর ভেতর দিয়ে হেঁটে যেতে পারে না।
    // এর আগে দ্বন্দ্বে দুজন একই জায়গায় দাঁড়িয়ে একটাই মূর্তি হয়ে যেতেন।
    const friendlies = [this.player, ...(this.ally ? [this.ally] : [])];
    for (const f of friendlies) for (const e of all) this.bodyPush(f, e);
    if (this.ally) this.bodyPush(this.player, this.ally);
  }

  private bodyPush(a: Fighter, b: Fighter): void {
    if (!a.alive || !b.alive || a.phase === 'downed' || b.phase === 'downed') return;
    if (a.phase === 'side' || b.phase === 'side') return; // সবে/ড্যাশে পাশ কাটানো যায়
    if (Math.abs(a.y - b.y) >= 20) return;
    const radius = (f: Fighter): number => f.kind === 'boss' ? 24 : f.kind === 'shield' ? 22 : f.kind === 'hero' ? 20 : f.kind === 'swift' ? 17 : 19;
    const mass = (f: Fighter): number => f.kind === 'boss' ? 4.4 : f.kind === 'shield' ? 2.2 : f.kind === 'hero' ? 2.4 : f.kind === 'swift' ? 0.8 : 1;
    const min = radius(a) + radius(b);
    const dx = b.x - a.x;
    if (Math.abs(dx) >= min) return;
    const dir = dx >= 0 ? 1 : -1;
    const overlap = min - Math.abs(dx);
    const aShare = (1 / mass(a)) / ((1 / mass(a)) + (1 / mass(b)));
    a.x = clamp(a.x - dir * overlap * aShare, 40, 720);
    b.x = clamp(b.x + dir * overlap * (1 - aShare), 40, 720);
  }

  private aiTick(e: Fighter): void {
    // সতর্ক-ঝলকের পরের আঘাত
    if (e.telegraph > 0) {
      e.telegraph -= 1;
      if (e.telegraph === 0 && e.pendingMove && e.phase === 'idle') e.start(e.pendingMove);
      e.pendingMove = e.telegraph === 0 ? null : e.pendingMove;
      return;
    }
    if (e.phase !== 'idle') return;

    const aggroBase = this.budget.aggression * (this.gentle ? 0.82 : 1) * (this.mode === 'duel' ? 1 + (this.bossPhase - 1) * 0.16 : 1);
    const objTarget = e.targetObjective && this.objective && this.objective.hp > 0;
    const tx = objTarget ? this.objective!.x : this.player.x;
    const ty = objTarget ? 0 : this.player.y;
    const dx = tx - e.x, dy = ty - e.y;
    const dist = Math.abs(dx);
    const range = KIND_RANGE[e.kind] ?? 46;
    const sp = (1.55 + aggroBase * 0.85) * e.speedMul;

    if (dist > range) e.x += Math.sign(dx) * sp;
    if (Math.abs(dy) > 10) e.y += Math.sign(dy) * sp * (dist > range ? 0.55 : 0.8);

    // লক্ষ্যচ্যুত শত্রুর বদলি: নৌকার দিকে যাওয়া কেউ পড়লে আরেকজন এগিয়ে যায় (সর্বোচ্চ দুজন)
    if (this.mode === 'wave' && this.objective && !e.targetObjective && this.rand() < 0.002) {
      const chasers = this.enemies.filter((f) => f.alive && f.targetObjective).length;
      if (chasers < 2) e.targetObjective = true;
    }

    if (e.attackCooldown > 0 || dist > range + 30 || Math.abs(dy) > 26) { this.clampEnemy(e); return; }

    // দ্বন্দের চক্রটা 'ঢাল ভাঙো → সত্যি দাও': বসকে মাঝে মাঝে ঢাল তুলতেই হবে,
    // নাহলে ঢাল-ভাঙার সুযোগটাই তৈরি হয় না।
    if (this.mode === 'duel' && dist < MOVES.cut.reach + 34 && e.guard > 24 && this.rand() < 0.3) {
      e.start('guard');
      e.attackCooldown = 46;
      this.clampEnemy(e);
      return;
    }
    // দলবদ্ধ আক্রমণের টোকেন: একসঙ্গে দুজনের বেশি চাপ নয় (ন্যায্য লড়াই)
    const attacking = this.enemies.filter((f) => f.phase === 'attack' || f.telegraph > 0).length;
    if (attacking >= (this.mode === 'duel' ? 1 : 2)) { e.attackCooldown = 14; this.clampEnemy(e); return; }
    if (this.rand() > 0.12 + aggroBase * 0.3) { this.clampEnemy(e); return; }

    let pick: InputName = 'cut';
    const r = this.rand();
    if (e.kind === 'spear') pick = r < 0.72 ? 'thrust' : 'cut';
    else if (e.kind === 'shield') pick = r < 0.22 ? 'guard' : r < 0.55 ? 'heavy' : 'cut';
    else if (e.kind === 'swift') pick = r < 0.12 ? 'side' : r < 0.3 ? 'thrust' : 'cut';
    else if (e.kind === 'boss') pick = r < 0.24 + (this.bossPhase - 1) * 0.06 ? 'heavy' : r < 0.52 ? 'thrust' : 'cut';
    else pick = r < 0.2 ? 'heavy' : r < 0.48 ? 'thrust' : 'cut';

    const big = pick === 'heavy' || (pick === 'thrust' && (e.kind === 'spear' || e.kind === 'boss'));
    e.attackCooldown = Math.round((54 + this.rand() * 44) * (1.25 - aggroBase * 0.5));
    if (big) {
      // বড় আঘাতের আগে ঝলক — খেলোয়াড় দেখে রোধ/সরে যাওয়ার সুযোগ পায়
      e.telegraph = e.kind === 'boss' ? Math.max(11, 17 - this.bossPhase * 2) : 15;
      e.pendingMove = pick;
      this.events.push({ t: 'telegraph', who: e.name_bn, x: e.x });
    } else e.start(pick);
    this.clampEnemy(e);
  }

  private clampEnemy(e: Fighter): void {
    e.y = clamp(e.y, -60, 60);
    e.x = clamp(e.x, 36, 766);
  }

  private allyTick(a: Fighter): void {
    const nearest = this.enemies.filter((e) => e.alive).sort((p, q) => Math.abs(p.x - a.x) - Math.abs(q.x - a.x))[0];
    if (!nearest) return;
    const d = nearest.x - a.x;
    if (Math.abs(d) > 50) a.x += Math.sign(d) * 1.4;
    else if (a.phase === 'idle' && this.rand() < 0.04) a.start('cut');
    a.facing = d > 0 ? 1 : 0;
  }

  private resolveHits(): void {
    const all = [this.player, ...this.enemies, ...(this.ally ? [this.ally] : [])];
    for (const atk of all) {
      const hb = atk.activeHitbox();
      if (!hb) continue;
      const byPlayer = atk === this.player;
      const maxTargets = byPlayer
        ? (hb.kind === 'resolve' ? 4 : hb.kind === 'heavy' ? 3 : 2)
        : 1;
      const candidates = all
        .filter((def) => def !== atk && def.alive && def.phase !== 'downed' && !atk.swingHits.has(def.uid))
        .sort((a, b) => Math.abs(a.x - atk.x) - Math.abs(b.x - atk.x));
      let landed = 0;
      for (const def of candidates) {
        if (landed >= maxTargets) break;
        const dx = Math.abs(def.x - atk.x);
        const dy = Math.abs(def.y - atk.y);
        const front = atk.facing === 1 ? def.x >= atk.x - 6 : def.x <= atk.x + 6;
        if (dx > hb.reach || dy > 34 || !front) continue;
        // বন্ধু-আঘাত নেই (bloodless + দল-সচেতন)
        const friendly = (atk === this.player || atk === this.ally) === (def === this.player || def === this.ally);
        if (friendly) continue;
        atk.swingHits.add(def.uid);
        const wasAlive = def.hp > 0;
        // কাটা-শৃঙ্খল: তৃতীয় পরপর কাটা ফিনিশার (বেশি ক্ষতি + ধাক্কা)
        let att = hb;
        let finisher = false;
        if (byPlayer && hb.kind === 'cut') {
          atk.chain = Math.min(3, atk.chain + 1);
          atk.chainTimer = 85;
          if (atk.chain >= 3) { att = { ...hb, dmg: Math.round(hb.dmg * 1.7) }; finisher = true; atk.chain = 0; }
        }
        const ev = def.receive(att, atk);
        if (ev.kind === 'whiff') { atk.whiff(); continue; }
        landed += 1;
        if (finisher) def.vx += (atk.facing === 1 ? 6 : -6);
        if (byPlayer) {
          this.player.awardMeter(MOVES[hb.kind].meter);
          if (ev.kind === 'hit' || ev.kind === 'resolve' || ev.kind === 'guardbreak') {
            this.hitsLanded += 1;
            this.combo += 1;
            this.comboTimer = 110;
            this.comboBest = Math.max(this.comboBest, this.combo);
            this.score += Math.round(ev.dmg * 10 * (1 + this.combo * 0.06)) + (ev.kind === 'guardbreak' ? 250 : 0) + (finisher ? 60 : 0);
            this.hitstop = Math.max(this.hitstop, ev.kind === 'resolve' || ev.kind === 'guardbreak' ? 6 : hb.kind === 'heavy' ? 4 : 2);
          } else if (ev.kind === 'block') this.score += 12;
        }
        if (def === this.player && (ev.kind === 'hit' || ev.kind === 'resolve')) {
          if (this.combo >= 5) this.endCombo(); else this.combo = 0;
          this.hitstop = Math.max(this.hitstop, 2);
        }
        if (ev.kind === 'parry' && def === this.player) { this.score += 150; this.hitstop = Math.max(this.hitstop, 4); }
        this.events.push({ t: 'hit', ...ev });
        if (ev.kind === 'resolve') this.events.push({ t: 'banner', text: ev.banner ?? '', card: 'resolve' });
        if (wasAlive && def.hp <= 0 && def.phase === 'downed') {
          this.enemiesDowned += 1;
          if (byPlayer || atk === this.ally) this.score += 200;
          this.events.push({ t: 'downed', who: def.name_bn, x: def.x, y: def.y });
          if (this.rand() < 0.42) this.dropCard(def.x, def.y);
        }
        if (def === this.player && atk !== this.player) atk.targetObjective = false;
      }
      // নৌকা/ধানের গাড়িতে আঘাত (সুইংয়ে একবারই)
      if (this.objective && this.objective.hp > 0 && !atk.swingHitObjective) {
        const dxE = Math.abs(this.objective.x - atk.x);
        const dyE = Math.abs(this.objective.y - atk.y);
        if (atk !== this.player && atk !== this.ally && atk.targetObjective && dxE < hb.reach + 16 && dyE < 42) {
          atk.swingHitObjective = true;
          this.objective.hp = Math.max(0, this.objective.hp - Math.round(hb.dmg * 0.7));
          this.events.push({ t: 'objective', name_bn: this.objective.name_bn, hp: this.objective.hp });
          atk.targetObjective = false;
          atk.attackCooldown = Math.max(atk.attackCooldown, 40);
        }
      }
    }
    // পড়ে যাওয়া শত্রু কিছুক্ষণ ধুলোয় থাকে, তারপর মাঠ ছাড়ে (মৃতদেহ-জমানো নয়)
    this.enemies = this.enemies.filter((e) => e.phase !== 'downed' || e.deadAge < 55);
  }
}

const clamp = (v: number, lo: number, hi: number): number => Math.max(lo, Math.min(hi, v));
const firstClause = (s: string): string => s.split(/[।!?]/)[0]!.trim().slice(0, 120);
