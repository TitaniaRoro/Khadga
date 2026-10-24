/**
 * src/sim.ts — ঢেউ-যুদ্ধ আর দ্বন্দ্ব-পরিসর: লড়াই-নিয়ম ও ইতিহাস-সামগ্রীর সংযোগস্থল।
 *
 * দুটো নিয়ম এই ফাইলটাকে খেলার নৈতিক আকার দেয় (design §৩.১, §৫):
 *  ১. ঢেউ-যুদ্ধের লক্ষ্য "সবাইকে মারো" নয় — নৌকা/ধানের গাড়ি/গ্রাম ৯০ সেকেন্ড রক্ষা।
 *     তাই এখানে কোনো "remaining-enemies = 0" জয়-শর্ত নেই; টিকে-থাকাই জয়।
 *  ২. দ্বন্দ্ব শেষ হয় প্রাণ-শেষ করে নয় — বসের ঢাল ভেঙে, সেই ফাঁকে ৩টি সঠিক উত্তর বসালে।
 *     লড়াই কখনও থামে না (কুইজ = 'মধ্যম' কড়াকড়ি): প্রশ্ন লড়াইয়ের ওপর ভাসে,
 *     ভুল উত্তরে প্রাণ কমে না, সঠিক উত্তরেই সংকল্প-মিটার পূর্ণ হয়।
 */
import { Fighter, type HitEvent } from './fighter.ts';
import { MOVES, MAX_HP, type InputName } from './frames.ts';
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
  | { t: 'banner'; text: string; card: string }
  | { t: 'question'; q: QuizItem; lives: number }
  | { t: 'answered'; q: QuizItem; correct: boolean }
  | { t: 'boon'; card: string; boon_bn: string }
  | { t: 'break'; text: string }
  | { t: 'win' } | { t: 'lose'; why_bn: string } | { t: 'pause' };

export type ObjectiveKind = 'boat' | 'grain' | 'village';
const OBJ_NAME: Record<ObjectiveKind, string> = { boat: 'নৌকা', grain: 'ধানের গাড়ি', village: 'পল্লী-গেট' };

/** কার্ডের ট্যাগ + বসের স্বভাব থেকে ঢেউ-শত্রুর সংখ্যা/সাজসজ্জা (ইতিহাস-প্রেরিত, র‍্যান্ডম নয়)। */
function enemyBudget(ch: Chapter): { perWave: number; hp: number; aggression: number } {
  const n = ch.cards.length;
  const warfare = ch.cards.filter((c) => c.tags.includes('warfare')).length;
  const navy = ch.cards.filter((c) => c.tags.includes('navy')).length;
  return {
    perWave: Math.min(6, 3 + Math.round(navy / 3) + (n > 10 ? 1 : 0)),
    hp: Math.round(MAX_HP * (0.22 + warfare * 0.012 + ch.id * 0.012)),
    aggression: Math.min(0.86, 0.42 + ch.id * 0.05 + warfare * 0.01),
  };
}

/**
 * কার্ড → গেমপ্লে-লাভ। content-এর `boon_bn` পাঠ্য-ভিত্তিক, তাই এখানে শব্দ-মিল দিয়ে
 * প্রভাব বাছাই করা হয় — M0-র স্বেচ্ছা-মোটা দা; পরে JSON-তে structured `effect` যোগ করলে
 * এই ফাংশনটা শুধু ম্যাপিং-টেবিলে দাঁড়াবে।
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

export interface DuelState { question: QuizItem | null; truths: number; needs: number; asked: string[]; cooldown: number }

export class Sim {
  readonly ch: Chapter;
  readonly meta: Meta;
  readonly seed: number;
  readonly mode: 'wave' | 'duel';
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
  private readonly rand: () => number;
  private readonly budget: ReturnType<typeof enemyBudget>;
  private spawnCooldown = 0;
  private readonly boons: Map<string, ReturnType<typeof boonOf>> = new Map();
  private askedThisBreak = false;

  constructor(ch: Chapter, meta: Meta, mode: 'wave' | 'duel', seed = 1, boons: Map<string, ReturnType<typeof boonOf>> = new Map()) {
    this.ch = ch;
    this.meta = meta;
    this.mode = mode;
    this.seed = seed;
    this.rand = rng(seed);
    this.budget = enemyBudget(ch);
    this.boons = boons;
    this.waves = mode === 'wave' ? Math.max(1, ch.fight_bn?.waves ?? 2) : 1;
    this.timeLeft = mode === 'wave' ? 90 * 60 + this.bonusTime() : 999 * 60;
    this.player = new Fighter({ name_bn: ch.bearer_bn.name_bn, tone: '#e9dfc8', facing: 1, x: mode === 'wave' ? 150 : 200, y: 0, defense: this.defenseFactor() });
    this.cardQueue = [...ch.cards];
    this.duel = { question: null, truths: 0, needs: 3, asked: [], cooldown: 0 };
    if (mode === 'wave') {
      this.objective = { kind: this.objectiveKind(), name_bn: OBJ_NAME[this.objectiveKind()], hp: 120, maxHp: 120, x: 90, y: 0 };
      this.spawnWave();
    } else {
      const b = ch.boss;
      this.enemies = [new Fighter({ name_bn: b?.name_bn ?? 'প্রতিপক্ষ', tone: '#b4553d', facing: 0, x: 320, y: 0, defense: 1 })];
      this.enemies[0]!.hp = Math.round(MAX_HP * 1.35);
      this.enemies[0]!.guard = 160;
      if (b) this.events.push({ t: 'banner', text: b.myth_bn, card: 'boss' });
    }
    if (this.allyWanted()) {
      this.ally = new Fighter({ name_bn: 'পল্লীর কৃষক', tone: '#7f9c6b', facing: 1, x: 120, y: 40, defense: 1.6 });
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

  /** কার্ড পড়া হলো — মিটার-লাভ, প্রহারের জ্বালানি, আর tactic-লাভ সক্রিয়। */
  /** এই লড়াইয়ে সক্রিয় কার্ড-লাভের id (টেস্ট + ডিবাগ-প্যানেল এটিই পড়ে)। */
  boonCards(): string[] { return [...this.boons.keys()]; }

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

  private spawnWave(): void {
    const n = this.budget.perWave + Math.floor(this.waveIndex * 0.6);
    for (let i = 0; i < n; i++) {
      const e = new Fighter({
        name_bn: this.enemyName(),
        tone: i % 2 === 0 ? '#8c8577' : '#6f7684',
        facing: 0,
        x: 640 + i * 46,
        y: Math.round((this.rand() - 0.5) * 90),
        defense: 1,
      });
      e.hp = this.budget.hp;
      e.guard = 70;
      this.enemies.push(e);
    }
    this.events.push({ t: 'wave', index: this.waveIndex + 1, of: this.waves });
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
    if (this.timeLeft > 0) this.timeLeft -= 1;

    if (this.mode === 'duel') this.duelTick(input);
    else if (this.timeLeft <= 0) { this.over = 'win'; this.events.push({ t: 'win' }); return this.events; }

    if (input.pressed && this.player.actionable) {
      if (input.pressed === 'guard') this.player.start('guard');
      else this.player.start(input.pressed);
    }
    if (input.moveX !== 0 || input.moveY !== 0) {
      if (!this.player.busy && this.player.phase !== 'guard') {
        const sp = 2.6 * this.speedFactor();
        this.player.x += input.moveX * sp;
        if (this.mode === 'wave') this.player.y += input.moveY * sp * 0.55;
      }
    }
    this.player.x = clamp(this.player.x, 40, 720);
    this.player.y = clamp(this.player.y, -60, 60);

    for (const e of this.enemies) if (e.alive) this.aiTick(e);
    if (this.ally?.alive) this.allyTick(this.ally);

    for (const f of [this.player, ...this.enemies, ...(this.ally ? [this.ally] : [])]) f.step();
    this.resolveHits();
    this.guardRegen();

    if (this.mode === 'wave') {
      if (this.objective && this.objective.hp <= 0) {
        this.over = 'lose';
        this.loseWhy_bn = `${this.objective.name_bn} রক্ষা করা যায়নি — লড়াই জেতার চেয়ে এই কাজটাই বড় ছিল।`;
        this.events.push({ t: 'lose', why_bn: this.loseWhy_bn });
      } else if (this.waveIndex + 1 < this.waves && this.enemies.filter((e) => e.alive).length <= 1) {
        this.waveIndex += 1;
        this.spawnWave();
      }
      if (!this.player.alive) {
        this.over = 'lose';
        this.loseWhy_bn = 'তুমি মাঠ ছাড়তে বাধ্য হয়েছ — নৌকা/গাড়ি রক্ষার কাজটা অসমাপ্ত।';
        this.events.push({ t: 'lose', why_bn: this.loseWhy_bn });
      }
    } else {
      const boss = this.enemies[0]!;
      if (this.duel.truths >= this.duel.needs) {
        this.over = 'win';
        if (this.ch.boss) this.events.push({ t: 'break', text: this.ch.boss.breakline_bn });
        this.events.push({ t: 'win' });
      } else if (!this.player.alive) {
        this.over = 'lose';
        this.loseWhy_bn = 'ঢাল ভাঙার সুযোগ হাতছাড়া — প্রাণ ফুরিয়ে গেছে।';
        this.events.push({ t: 'lose', why_bn: this.loseWhy_bn });
      } else if (boss.phase === 'stunned' && !this.duel.question) {
        this.askQuestion();
      } else if (boss.phase !== 'stunned' && this.duel.question) {
        // সুযোগ বন্ধ হলে প্রশ্ন ফিরে যায়; লড়াই থামে না, উত্তর-দাবিও বাতিল নয়।
        this.duel.question = null;
        this.askedThisBreak = false;
      } else if (boss.phase !== 'stunned' && this.askedThisBreak && this.duel.cooldown <= 0) {
        this.askedThisBreak = false;
      }
    }
    return this.events;
  }

  /** ঢাল-ক্ষমতা ধীরে ফেরে — রোধ-চাপা খেলোয়াড়কে চিরকাল পাহারা দিতে দেয় না। */
  private guardRegen(): void {
    for (const f of [this.player, ...this.enemies]) {
      if (f.phase !== 'guard' && f.guard < 100) f.refillGuard(0.35);
    }
  }

  private duelTick(input: InputFrame): void {
    const boss = this.enemies[0]!;
    if (this.duel.cooldown > 0) this.duel.cooldown -= 1;
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
        this.player.awardMeter(34);
        boss.receive({ reach: 1, dmg: Math.round(10 * this.resolvePower()), guardDmg: 0, high: false, kind: 'resolve' }, this.player);
        boss.stun(26);
        this.events.push({ t: 'banner', text: firstClause(this.cardOf(q)?.bn ?? q.explain_bn), card: q.card });
      } else {
        // ভুল = শাস্তি নয়; মিটার ভাঙে, লড়াই চলতেই থাকে (medium strictness)।
        const keep = [...this.boons.values()].some((b) => b.kind === 'meterKeep');
        if (!keep) this.player.awardMeter(-14);
        this.duel.cooldown = 24;
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

  private parryCard: QuizItem | null = null;
  private queue: string[] = [];

  /** বস ঢাল ভাঙার মুখে প্রশ্ন তোলে — অধ্যায়ের জ্ঞানকোষ থেকে, পুরোনোটি এড়িয়ে। */
  private askQuestion(): void {
    if (this.askedThisBreak || this.duel.cooldown > 0) return;
    const pool = this.ch.quiz.filter((q) => !this.duel.asked.includes(q.id));
    const q = pool.length ? pool[Math.floor(this.rand() * pool.length)]! : this.ch.quiz[0]!;
    this.duel.question = q;
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

  private aiTick(e: Fighter): void {
    const dx = this.player.x - e.x;
    const dy = this.player.y - e.y;
    const dist = Math.abs(dx);
    const aggro = this.budget.aggression;
    if (e.phase === 'idle') {
      const wantY = Math.abs(dy) > 26;
      if (dist > MOVES.cut.reach - 8 || wantY) {
        const sp = 1.7 + aggro * 0.7;
        e.x += Math.sign(dx) * sp * (wantY ? 0.7 : 1);
        if (wantY) e.y += Math.sign(dy) * sp * 0.7;
      }
      if (dist < MOVES.thrust.reach && this.rand() < aggro * 0.06) {
        const pick: InputName = this.rand() < 0.2 ? 'heavy' : this.rand() < 0.5 ? 'thrust' : 'cut';
        e.start(pick);
      } else if (this.rand() < 0.012) e.start('guard');
      // ঢেউ-লক্ষ্য: অনেক শত্রুই প্রতিলক্ষ্যে (নৌকা/গাড়ি) দৌড় দেয় — সেটাই খেলার ধাঁচ।
      if (this.mode === 'wave' && this.objective && this.rand() < 0.05) {
        e.targetObjective = true;
      }
    } else if (e.phase === 'stunned' || e.phase === 'hitstun' || e.phase === 'blockstun') {
      /* স্টান-ফ্রেম গণনা Fighter.step() করে */
    }
    e.y = clamp(e.y, -60, 60);
    e.x = clamp(e.x, 40, 760);
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
      const struck = new Set<Fighter>();
      for (const def of all) {
        if (def === atk || !def.alive || struck.has(def)) continue;
        const same = def.phase === 'downed';
        if (same) continue;
        const dx = Math.abs(def.x - atk.x);
        const dy = Math.abs(def.y - atk.y);
        const front = atk.facing === 1 ? def.x >= atk.x : def.x <= atk.x;
        if (dx > hb.reach || dy > 34 || !front) continue;
        // বন্ধু-আঘাত নেই (bloodless + দল-সচেতন)
        const friendly = (atk === this.player || atk === this.ally) === (def === this.player || def === this.ally);
        if (friendly) continue;
        struck.add(def);
        const ev = def.receive(hb, atk);
        if (ev.kind !== 'whiff') {
          if (atk === this.player) this.player.awardMeter(MOVES[hb.kind].meter);
          this.events.push({ t: 'hit', ...ev });
          if (ev.kind === 'resolve') this.events.push({ t: 'banner', text: ev.banner ?? '', card: 'resolve' });
        } else atk.whiff();
        // শত্রুর লক্ষ্য বদল: যে মারলো সেই এগিয়ে
        if (def === this.player && atk !== this.player) atk.targetObjective = false;
        atk.move = null; atk.frame = 0; atk.phase = 'idle';
        break;
      }
      // নৌকা/ধানের গাড়িতে আঘাত
      if (this.objective && this.objective.hp > 0) {
        const dxE = Math.abs(this.objective.x - atk.x);
        if (atk !== this.player && atk !== this.ally && dxE < hb.reach && atk.targetObjective) {
          this.objective.hp = Math.max(0, this.objective.hp - Math.round(hb.dmg * 0.7));
          this.events.push({ t: 'objective', name_bn: this.objective.name_bn, hp: this.objective.hp });
          atk.move = null; atk.frame = 0; atk.phase = 'idle';
          atk.targetObjective = false;
        }
      }
    }
    this.enemies = this.enemies.filter((e) => e.alive || this.frame < 40);
  }
}

const clamp = (v: number, lo: number, hi: number): number => Math.max(lo, Math.min(hi, v));
const firstClause = (s: string): string => s.split(/[।!?]/)[0]!.trim().slice(0, 120);
