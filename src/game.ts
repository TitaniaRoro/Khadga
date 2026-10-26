/**
 * src/game.ts — ইঞ্জিন-কন্ট্রোলার: ফিক্সড-স্টেপ লুপ, সিন-গ্রাফ, আর্কেড-স্তর ও শব্দের বাঁধন।
 *
 * ৬০Hz ফিক্সড স্টেপ + accumulator; রেন্ডার প্রতি RAF-এ, সিম প্রতি ফ্রেমে।
 * লড়াই কখনও থামে না (design §৩.১ 'মধ্যম' কড়াকড়ি) — কিন্তু প্রশ্নের সময় ও কার্ড
 * তোলার মুহূর্তে ঘড়ি ধীরে চলে (timescale), আর প্রতি আঘাতে দু-চার ফ্রেম hit-stop:
 * আধুনিক আর্কেডের "ওজন" এই দুটোতেই আসে, আর পড়ার সময়টাও মানুষের মতো হয়।
 *
 * মোড তিনটি একই ইতিহাস-ভাণ্ডার থেকে চলে: গল্প (ঢেউ+দ্বন্দ্ব), অসীম ঢেউ (স্কোর-তাড়া),
 * সত্য-দৌড় (৬০-সেকেন্ডের প্রশ্ন-দৌড়, ভুলগুলো শেষে শেখানো হয়)।
 */
import { Sim, type InputFrame, type SimEvent, boonOf } from './sim.ts';
import { InputSource } from './input.ts';
import { Renderer, PALETTES, OUTFITS } from './render.ts';
import type { EnemyKind } from './fighter.ts';
import { L, bn, bnTime } from './hud.ts';
import type { ContentDoc, Chapter, QuizItem } from './content-types.ts';
import { cardStrength } from './content-types.ts';
import type { ViewOpts } from './render.ts';
import { loadProgress, writeProgress, encodeSave, decodeSave, type Progress } from './save.ts';
import { RESOLVE_COST } from './frames.ts';
import { SoundEngine } from './audio.ts';

export type Scene = 'title' | 'select' | 'read' | 'wave' | 'duel' | 'rush' | 'result';

interface RushState {
  pool: { q: QuizItem; chapter_bn: string; card_bn: string }[];
  order: number[];
  pos: number;
  current: { q: QuizItem; chapter_bn: string; card_bn: string; choices: string[]; answer: number } | null;
  time: number;      // বাকি ফ্রেম
  lock: number;      // উত্তরের পর ব্যাখ্যা দেখানোর বিরতি
  score: number; streak: number; bestStreak: number; right: number; wrong: number;
  missed: { q: QuizItem; card_bn: string }[];
  over: boolean;
}

const RANK_THRESHOLDS = [0, 1500, 4500, 9000, 16000, 26000];

export class Game {
  readonly doc: ContentDoc;
  progress: Progress;
  scene: Scene = 'title';
  ch: Chapter | null = null;
  sim: Sim | null = null;
  boons = new Map<string, ReturnType<typeof boonOf>>();
  private raf = 0;
  private acc = 0;
  private last = 0;
  private tick = 0;
  private input: InputSource;
  private view: Renderer;
  private sound = new SoundEngine();
  private demo: Sim | null = null;
  private lastEvents: SimEvent[] = [];
  private banner: { text: string; life: number } | null = null;
  private toast: { text: string; life: number } | null = null;
  private question: (QuizItem & { lives: number }) | null = null;
  private result: { win: boolean; why_bn: string } | null = null;
  private paused = false;
  private viewOpts: ViewOpts;
  private dom: Record<string, HTMLElement | null> = {};
  private slowmo = 0;
  private runEndless = false;
  private lastMode: 'wave' | 'duel' = 'wave';
  private runSeed = 0;
  private comboShown = 0;
  private coachStep = -1;
  private rush: RushState | null = null;
  private lastUnlockAt = 0; // শব্দ-তালা খোলার মুহূর্ত — একই চাপ যেন আবার বন্ধ না করে

  constructor(doc: ContentDoc, root: HTMLElement) {
    this.doc = doc;
    this.progress = loadProgress();
    const canvas = root.querySelector<HTMLCanvasElement>('#stage');
    if (!canvas) throw new Error('#stage ক্যানভাস নেই');
    this.viewOpts = {
      reduceMotion: this.progress.prefs.reduceMotion,
      colorblind: this.progress.prefs.colorblind,
      pixel: this.progress.prefs.pixel === true,
      palette: PALETTES[1] ?? PALETTES[0]!,
    };
    this.view = new Renderer(canvas, this.viewOpts);
    document.body.classList.toggle('pixel', this.progress.prefs.pixel === true);
    this.sound.setMusic(this.progress.prefs.music);
    this.sound.setSfx(this.progress.prefs.sound !== false);
    this.input = new InputSource(root, () => { /* প্রথম স্পর্শ */ });
    this.input.onAny = () => this.ensureAudio();
    // মঞ্চের বাইরে যেকোনো চাপ/কী-চাপেই শব্দ জাগবে — শুধু লড়াইয়ের বোতামে নয়
    document.addEventListener('pointerdown', () => this.ensureAudio());
    document.addEventListener('keydown', () => this.ensureAudio());
    this.input.onEscape = () => { if (this.scene === 'wave' || this.scene === 'duel' || this.scene === 'rush') this.togglePause(); };
    for (const id of ['hud', 'title', 'select', 'read', 'rush', 'result', 'pause', 'qbar', 'tbar', 'toast', 'banner', 'hint', 'coach', 'bossbar', 'objbox', 'pad']) {
      this.dom[id] = document.getElementById(id);
    }
    this.bind();
    this.refreshTitle();
    this.makeDemo();
    this.show('title');
    this.loop = this.loop.bind(this);
    this.raf = requestAnimationFrame(this.loop);
  }

  // ─── সাধারণ হিসাব ──────────────────────────────────────────────────────────
  private totalCards(): number { return this.doc.chapters.reduce((n, c) => n + c.cards.length, 0); }
  private totalStars(): number { return Object.values(this.progress.stars).reduce((a, b) => a + b, 0); }
  private rankIndex(): number {
    const pts = this.progress.totalScore + this.progress.read.length * 150 + this.totalStars() * 400;
    let i = 0;
    while (i + 1 < RANK_THRESHOLDS.length && pts >= RANK_THRESHOLDS[i + 1]!) i++;
    return i;
  }
  private unlocked(i: number): boolean { return i === 0 || this.progress.done.includes(i - 1); }
  private highestFought(): Chapter {
    let best = this.doc.chapters.find((c) => c.id === 1) ?? this.doc.chapters[0]!;
    this.doc.chapters.forEach((c, i) => { if (c.fight_bn && this.unlocked(i)) best = c; });
    return best;
  }

  private awardFeat(id: keyof typeof L.feats): void {
    if (this.progress.feats.includes(id)) return;
    this.progress.feats.push(id);
    writeProgress(this.progress);
    this.toastNow(`🏆 ${L.feat}: ${L.feats[id]}`);
    this.sound.pickup();
  }

  // ─── সিন নিয়ন্ত্রণ ───────────────────────────────────────────────────────
  private show(s: Scene): void {
    this.scene = s;
    const sections: Record<string, Scene> = { title: 'title', select: 'select', read: 'read', rush: 'rush', result: 'result' };
    for (const [k, el] of Object.entries(this.dom)) {
      if (!el) continue;
      const want = sections[k];
      if (want) el.classList.toggle('hide', want !== s);
    }
    const playLayer = s === 'wave' || s === 'duel';
    this.dom.hud?.classList.toggle('hide', !playLayer);
    this.dom.pad?.classList.toggle('hide', !playLayer);
    document.body.classList.toggle('playing', playLayer);
    this.sound.intensity = s === 'duel' ? 0.55 : playLayer ? 0.35 : 0.12;
  }

  private bind(): void {
    document.querySelectorAll<HTMLElement>('[data-act]').forEach((b) => {
      if (b.dataset.bound) return;   // আগের সংস্করণে প্রতিটি সিন-বদলে লিসেনার জমত
      b.dataset.bound = '1';
      b.addEventListener('click', () => {
        const a = b.dataset.act!;
        if (a === 'soundGate') { this.ensureAudio(true); return; }
        if (a === 'soundTest') { this.ensureAudio(true); this.sound.testSound(); this.toastNow(L.soundNowOn); return; }
        const wasUnlocked = this.sound.isUnlocked;
        this.ensureAudio();
        if (a === 'sound' || a === 'soundBtn') {
          // প্রথম চাপের কাজ শুধু শব্দ *খোলা* — আগে এটাই খুলে সঙ্গে সঙ্গে বন্ধ করে দিত, তাই 'শব্দ নেই' লাগত
          if (!wasUnlocked || Date.now() - this.lastUnlockAt < 900) {
            this.progress.prefs.sound = true; this.sound.setSfx(true); writeProgress(this.progress);
            this.refreshSoundUi(); this.toastNow(L.soundNowOn); this.sound.testSound(); return;
          }
          this.flip('sound', b);
          if (this.progress.prefs.sound !== false) this.sound.ui();
          return;
        }
        if (wasUnlocked) this.sound.ui();
        if (a === 'start') this.buildSelect();
        else if (a === 'back') { this.paused = false; this.buildSelect(); }
        else if (a === 'continue') this.openChapter(this.progress.lastChapter || this.highestFought().id);
        else if (a === 'endless') this.startChapter(this.highestFought(), 'wave', true);
        else if (a === 'rush') this.startRush();
        else if (a === 'daily') this.startDaily();
        else if (a === 'again') this.startChapter(this.ch ?? this.sim!.ch, this.lastMode, this.runEndless);
        else if (a === 'restart') { this.paused = false; if (this.scene === 'rush') this.startRush(); else this.startChapter(this.sim?.ch ?? this.ch!, this.sim?.mode ?? 'wave', this.runEndless); }
        else if (a === 'next') this.advance();
        else if (a === 'read' && this.ch) this.openChapter(this.ch.id, true);
        else if (a === 'pause') this.togglePause();
        else if (a === 'resume') this.togglePause();
        else if (a === 'fullscreen') void this.fullscreen();
        else if (a === 'copySave') void this.copySave(b);
        else if (a === 'pasteSave') this.pasteSave(b);
        else if (a === 'music') this.flip('music', b);
        else if (a === 'gentle') this.flip('gentle', b);
        else if (a === 'teacher') this.flip('teacher', b);
        else if (a === 'reduce') this.flip('reduceMotion', b);
        else if (a === 'cb') this.flip('colorblind', b);
        else if (a === 'pixel') this.flip('pixel', b);
        else if (a === 'fontUp') this.font(1);
        else if (a === 'fontDown') this.font(-1);
      });
    });
  }

  private async fullscreen(): Promise<void> {
    try {
      const box = document.getElementById('stagebox');
      if (document.fullscreenElement) await document.exitFullscreen();
      else await box?.requestFullscreen();
      setTimeout(() => this.view.resize(), 120);
    } catch { /* সমর্থন নেই — খেলা চলবে */ }
  }

  private refreshTitle(): void {
    const set = (id: string, v: string) => { const el = document.getElementById(id); if (el) el.textContent = v; };
    set('stat-cards', `${bn(this.progress.read.length)}/${bn(this.totalCards())}`);
    set('stat-chapters', `${bn(this.progress.done.filter((id) => id >= 1).length)}/${bn(this.doc.chapters.filter((c) => c.fight_bn).length)}`);
    set('stat-stars', bn(this.totalStars()));
    set('stat-rank', L.ranks[this.rankIndex()]!);
    set('endless-best', this.progress.endlessBest ? `${L.best} ${bn(this.progress.endlessBest)}` : '');
    set('rush-best', this.progress.rushBest ? `${L.best} ${bn(this.progress.rushBest)}` : '');
    set('dailyLabel', this.dailyChapter().title_bn);
    document.getElementById('continueBtn')?.classList.toggle('hide', !(this.progress.done.length || this.progress.read.length > 2));
    this.refreshSoundUi();
  }

  private dailyChapter(): Chapter {
    const fought = this.doc.chapters.filter((c) => c.fight_bn);
    const now = new Date();
    const daySeed = now.getFullYear() * 372 + (now.getMonth() + 1) * 31 + now.getDate();
    return fought[daySeed % fought.length] ?? fought[0]!;
  }
  private startDaily(): void {
    const ch = this.dailyChapter();
    this.ch = ch;
    this.startChapter(ch, 'wave');
    this.toastNow(`📅 ${L.daily}: ${ch.title_bn}`);
  }

  buildSelect(): void {
    this.refreshTitle();
    const list = this.dom.select!;
    const totalStars = this.totalStars();
    list.innerHTML = `<h2>${L.chapterSelect}</h2>
<p class="soft">১২০৪ থেকে ১৭৫৭ — সময়রেখা ধরে এগিয়ে যাও। ⭐ ${bn(totalStars)} · 📜 ${bn(this.progress.read.length)}/${bn(this.totalCards())} · ${L.rank}: <b>${L.ranks[this.rankIndex()]}</b></p>
<div class="timeline" aria-hidden="true">${this.doc.chapters.map((c, i) => `<span class="tnode ${this.unlocked(i) ? '' : 'off'} ${(this.progress.best[c.id] ?? 0) >= 2 ? 'done' : ''}" style="--acc:${PALETTES[c.id % PALETTES.length]!.accent}"><b>${bn(c.id)}</b><small>${c.years_bn}</small></span>`).join('<i class="tline"></i>')}</div>`;
    const ul = document.createElement('ul');
    ul.className = 'chapters';
    this.doc.chapters.forEach((ch, i) => {
      const unlocked = this.unlocked(i);
      const li = document.createElement('li');
      const status = this.progress.best[ch.id] ?? 0;
      const stars = this.progress.stars[ch.id] ?? 0;
      const score = this.progress.scores[ch.id] ?? 0;
      const readN = ch.cards.filter((c) => this.progress.read.includes(c.id)).length;
      const pal = PALETTES[ch.id % PALETTES.length]!;
      li.innerHTML = `<button class="chap ${unlocked ? '' : 'off'}" data-ch="${ch.id}" style="--acc:${pal.accent};--sky2:${pal.sky}">
        <span class="n">${bn(ch.id)}</span>
        <span class="t">${ch.title_bn}</span>
        <span class="y">${ch.years_bn} · ${ch.bearer_bn.name_bn} · 📜 ${bn(readN)}/${bn(ch.cards.length)}</span>
        <span class="s">${'★'.repeat(stars)}${'☆'.repeat(3 - stars)}<br>${score ? `${L.best} ${bn(score)}` : status === 2 ? '✓ ' + L.chapterDone : status === 1 ? L.wave + ' ✓' : unlocked ? '▶ ' + L.play : '🔒 ' + L.locked}</span>
        <span class="cprog"><i style="width:${ch.cards.length ? Math.round(readN / ch.cards.length * 100) : 0}%"></i></span>
      </button>`;
      ul.appendChild(li);
    });
    list.appendChild(ul);
    const foot = document.createElement('p');
    foot.className = 'foot';
    foot.innerHTML = `<button data-act="endless">🌊 ${L.endless}</button> <button data-act="rush">⚡ ${L.rush}</button> <span class="soft">${L.bloodless}</span>`;
    list.appendChild(foot);
    list.querySelectorAll<HTMLButtonElement>('button.chap:not(.off)').forEach((b) => {
      b.addEventListener('click', () => this.openChapter(Number(b.dataset.ch)));
    });
    this.bind();
    this.show('select');
  }

  /**
   * অধ্যায় খোলা = মিশন-ব্রিফ, তারপরই খেলা। ইতিহাস ভাঁজে থাকে, তবে কার্ডগুলো এখন
   * সংগ্রহযোগ্য বস্তু হিসেবে সাজানো (সূত্রের মর্যাদা রঙে), আর লড়াইয়ের মাঝে স্ক্রল
   * তুললেও একই কার্ড খোলে — পড়া খেলার বাইরের কাজ নয়, ভেতরের জ্বালানি।
   */
  openChapter(id: number, keepBoons = false): void {
    const ch = this.doc.chapters.find((c) => c.id === id);
    if (!ch) return;
    this.ch = ch;
    this.progress.lastChapter = id;
    writeProgress(this.progress);
    if (!keepBoons) this.boons = new Map();
    const el = this.dom.read!;
    const hook = (ch.panels_bn[0] ?? '').split('।')[0] ?? '';
    const done = ch.cards.filter((c) => this.progress.read.includes(c.id)).length;
    const pal = PALETTES[ch.id % PALETTES.length]!;
    const best = this.progress.best[ch.id] ?? 0;
    const tierLabel = (c: Chapter['cards'][number]): string => {
      const t = cardStrength(c, this.doc.meta.sources_legend);
      return t === 'primary' ? L.tierPrimary : t === 'scholarly' ? L.tierScholarly : t === 'folk' ? L.tierFolk : L.tierEncy;
    };
    const rosterKinds: EnemyKind[] = ch.fight_bn
      ? ['hero', 'blade', 'shield', 'spear', 'swift', ...(ch.boss ? ['boss' as const] : []), ...([...this.boons.values()].some((b) => b.kind === 'ally') ? ['ally' as const] : [])]
      : [];
    const roster = rosterKinds.map((kind) => {
      const outfit = OUTFITS[kind];
      return `<span class="${kind === 'hero' ? 'me' : ''}" style="--c:${outfit.garment}"><i></i>${outfit.badge} ${outfit.label_bn} · ${outfit.weapon_bn}</span>`;
    }).join('');
    el.innerHTML = `<div class="brief" style="--acc:${pal.accent};--sky2:${pal.sky}">
<div class="brief-head"><span class="num">${bn(ch.id)}</span><div>
<h2>${ch.title_bn} <small>${ch.years_bn}</small></h2>
<p class="hook">${hook}${hook && !/[।.!?]$/.test(hook) ? '।' : ''}</p>
<p class="bearer">⚔ <b>${ch.bearer_bn.name_bn}</b> — ${ch.bearer_bn.role_bn}</p></div></div>
${ch.fight_bn ? `<div class="mission-chips">
<span>🎯 ${L.mission}: ${ch.fight_bn.duel_bn}</span><span>🌊 ${bn(ch.fight_bn.waves)} ${L.wave} · ${L.seconds90}</span><span>🛡 ${L.breakGuard}</span><span>📜 ${bn(ch.cards.length)} কার্ড মাঠেই মিলবে</span></div>` : `<div class="mission-chips"><span>📖 ${L.prologue} — কার্ড পড়ে ভিত তৈরি করো, লড়াই এর পরের অধ্যায়ে</span></div>`}
${roster ? `<div class="roster" aria-label="${L.rosterTitle}"><b>${L.rosterTitle}</b>${roster}</div>` : ''}
${ch.boss ? `<p class="bossline"><b>${L.vsBoss}:</b> ${ch.boss.name_bn} · <b>${L.mythLabel}:</b> ${ch.boss.myth_bn}</p>` : ''}
<div class="row">
<button class="go ready big" data-begin>${ch.fight_bn ? '⚔ ' + L.tapToFight : L.continue}</button>
${best >= 1 && ch.fight_bn ? `<button class="mini" data-duel>🛡 সরাসরি ${L.duelNow}</button>` : ''}
${ch.fight_bn ? `<button class="mini" data-endless>🌊 ${L.endless} (এই অধ্যায়ে)</button>` : ''}
<span class="fineprint">${L.loreProgress}: <b>${bn(done)}/${bn(ch.cards.length)}</b>${(this.progress.scores[ch.id] ?? 0) ? ` · ${L.best} ${bn(this.progress.scores[ch.id]!)}` : ''}</span>
</div></div>
<details class="lore"><summary>${L.loreFold}</summary>
<ol class="panels">${ch.panels_bn.map((p) => `<li>${p}</li>`).join('')}</ol>
<div class="cards">${ch.cards.map((c) => `
  <article class="card tier-${cardStrength(c, this.doc.meta.sources_legend)} ${c.disputed ? 'disputed' : ''} ${this.progress.read.includes(c.id) ? 'read' : ''}" data-card="${c.id}">
    <header><span class="chip">${c.year === null ? L.prologue : bn(c.year)}</span>${c.place ? `<span class="pl">📍 ${c.place}</span>` : ''}
    <span class="chip tierchip">${tierLabel(c)}</span>
    ${c.disputed ? `<span class="chip warn">${L.disputed}</span>` : ''}${this.progress.read.includes(c.id) ? '<span class="chip got">✓ সংগ্রহে</span>' : ''}</header>
    <p>${c.bn}</p>
    ${c.disputed && c.views ? `<div class="views">${c.views.map((v, j) => `<div class="view"><b>${j === 0 ? L.viewA : L.viewB}</b><p>${v}</p></div>`).join('')}</div>` : ''}
    <details><summary>${L.sources} (${bn(c.sources.length)})</summary><ul>${c.sources.map((s) => `<li>${s}</li>`).join('')}</ul></details>
    ${this.progress.read.includes(c.id) ? '' : `<button class="mini" data-read="${c.id}">${L.read}</button>`}
  </article>`).join('')}</div>
<p class="hintline">${L.readCardFirst}</p>
</details>`;
    el.querySelectorAll<HTMLButtonElement>('[data-read]').forEach((b) => {
      b.addEventListener('click', () => {
        this.markRead(b.dataset.read!);
        b.closest('.card')?.classList.add('read');
        b.remove();
        this.finishRead(el);
      });
    });
    el.querySelectorAll<HTMLElement>('.card').forEach((card) => {
      card.addEventListener('click', () => {
        const cid = card.dataset.card!;
        if (!card.classList.contains('read')) { this.markRead(cid); card.classList.add('read'); this.finishRead(el); }
      });
    });
    el.querySelector<HTMLButtonElement>('[data-begin]')?.addEventListener('click', () => {
      this.ensureAudio();
      if (!ch.fight_bn) { this.complete(id, 2); this.buildSelect(); return; }
      this.startChapter(ch, 'wave');
    });
    el.querySelector<HTMLButtonElement>('[data-duel]')?.addEventListener('click', () => this.startChapter(ch, 'duel'));
    el.querySelector<HTMLButtonElement>('[data-endless]')?.addEventListener('click', () => this.startChapter(ch, 'wave', true));
    this.viewOpts.palette = pal;
    this.view.setOpts(this.viewOpts);
    this.makeDemo(ch);
    this.show('read');
  }

  private finishRead(el: HTMLElement): void {
    const fp = el.querySelector<HTMLElement>('.fineprint b');
    if (fp && this.ch) fp.textContent = `${bn(this.ch.cards.filter((c) => this.progress.read.includes(c.id)).length)}/${bn(this.ch.cards.length)}`;
    if (this.ch && this.ch.cards.every((c) => this.progress.read.includes(c.id))) this.toastNow(L.readAll);
  }

  /** লড়াই শুরুর ইতিহাস-ফোঁটা: পরের না-পড়া কার্ডের এক লাইন টোস্টে। */
  private dripCard(): void {
    const ch = this.sim?.ch ?? this.ch;
    if (!ch || !ch.cards.length) return;
    const next = ch.cards.find((c) => !this.progress.read.includes(c.id));
    if (!next) return;
    this.markRead(next.id);
    const one = next.bn.split('।')[0]!.trim();
    this.toastNow(`${L.drip} ${next.year === null ? L.prologue : bn(next.year)} · ${one.length > 104 ? one.slice(0, 104) + '…' : one}।`);
  }

  private markRead(id: string): void {
    if (this.progress.read.includes(id)) return;
    this.progress.read.push(id);
    writeProgress(this.progress);
    this.sim?.readCard(id);
    if (this.progress.read.length >= 25) this.awardFeat('cards25');
    if (this.progress.read.length >= 60) this.awardFeat('cards60');
  }

  startChapter(ch: Chapter, mode: 'wave' | 'duel', endless = false): void {
    this.ch = ch;
    this.runEndless = endless;
    this.lastMode = mode;
    this.runSeed += 1;
    const sim = new Sim(ch, this.doc.meta, mode, ch.id * 977 + 13 + this.runSeed * 131, this.boons, {
      endless, gentle: this.progress.prefs.gentle,
    });
    if (this.progress.prefs.gentle) sim.player.heal(60);
    if (this.progress.prefs.teacher) sim.duel.needs = 2;
    for (const id of this.progress.read) sim.readCard(id);
    if (ch.cards[0]) sim.readCard(ch.cards[0]!.id);
    this.sim = sim;
    this.question = null;
    this.result = null;
    this.paused = false;
    this.slowmo = 0;
    this.comboShown = 0;
    this.coachStep = !this.progress.coached && ch.id === 1 && mode === 'wave' ? 0 : -1;
    this.viewOpts.palette = PALETTES[ch.id % PALETTES.length]!;
    this.view.setOpts(this.viewOpts);
    this.dom.qbar?.classList.add('hide');
    this.dom.bossbar?.classList.toggle('hide', mode !== 'duel');
    this.dom.objbox?.classList.toggle('hide', mode !== 'wave');
    this.show(mode);
    this.ensureAudio();
    this.sound.announce();
    this.dripCard();
    this.view.announce(endless ? L.endless : mode === 'duel' ? L.duelNow : L.fightNow, `${ch.title_bn} · ${ch.years_bn}`, 108);
    if (this.dom.tbar) {
      this.dom.tbar.innerHTML = mode === 'wave'
        ? `${L.wave} <b>${bn(sim.waveIndex + 1)}${endless ? '' : '/' + bn(sim.waves)}</b> · ${L.defense}: <b class="obj">${sim.objective?.name_bn ?? ''}</b>`
        : `${L.duelHint}`;
    }
    const objName = document.getElementById('objname');
    if (objName) objName.textContent = sim.objective ? `${L.protect}: ${sim.objective.name_bn}` : '';
    const bossName = document.getElementById('bossname');
    if (bossName) bossName.textContent = mode === 'duel' ? `${sim.enemies[0]?.name_bn ?? ''} · ${L.bossGuard}` : '';
    if (this.dom.hint) this.dom.hint.textContent = mode === 'wave' ? L.waveHint : (ch.boss?.tactic_bn ?? '');
    this.paintCoach();
  }

  private advance(): void {
    const ch = this.ch ?? this.sim?.ch;
    if (!ch) { this.buildSelect(); return; }
    if (this.runEndless) { this.buildSelect(); return; }
    if (this.lastMode === 'wave' && ch.fight_bn) { this.startChapter(ch, 'duel'); return; }
    const next = this.doc.chapters.find((c) => c.id === ch.id + 1);
    if (next) this.openChapter(next.id);
    else this.buildSelect();
  }

  private complete(id: number, score: number): void {
    if (!this.progress.done.includes(id)) this.progress.done.push(id);
    this.progress.best[id] = Math.max(this.progress.best[id] ?? 0, score);
    writeProgress(this.progress);
    const fought = this.doc.chapters.filter((c) => c.fight_bn);
    if (fought.every((c) => (this.progress.best[c.id] ?? 0) >= 2)) this.awardFeat('allChapters');
  }

  private togglePause(): void {
    if (!(this.scene === 'wave' || this.scene === 'duel' || this.scene === 'rush')) return;
    this.paused = !this.paused;
    this.dom.pause?.classList.toggle('hide', !this.paused);
    this.sound.intensity = this.paused ? 0.05 : this.scene === 'duel' ? 0.55 : 0.35;
  }

  private flip(key: 'music' | 'gentle' | 'teacher' | 'reduceMotion' | 'colorblind' | 'pixel' | 'sound', b: HTMLElement): void {
    const p = this.progress.prefs;
    if (key === 'music') { p.music = !p.music; this.sound.setMusic(p.music); }
    if (key === 'sound') { p.sound = !(p.sound !== false); this.sound.setSfx(p.sound); }
    if (key === 'gentle') p.gentle = !p.gentle;
    if (key === 'teacher') p.teacher = !p.teacher;
    if (key === 'reduceMotion') p.reduceMotion = !p.reduceMotion;
    if (key === 'colorblind') p.colorblind = !p.colorblind;
    if (key === 'pixel') p.pixel = !(p.pixel === true);
    this.viewOpts.pixel = p.pixel === true;
    document.body.classList.toggle('pixel', this.viewOpts.pixel);
    this.viewOpts.reduceMotion = p.reduceMotion;
    this.viewOpts.colorblind = p.colorblind;
    this.view.setOpts(this.viewOpts);
    this.view.resize();
    b.classList.toggle('on', Boolean((p as unknown as Record<string, boolean>)[key]));
    writeProgress(this.progress);
    if (key === 'sound' || key === 'music') this.refreshSoundUi();
  }

  private font(dir: number): void {
    const p = this.progress.prefs;
    p.fontScale = Math.max(0, Math.min(3, p.fontScale + dir)) as 0 | 1 | 2 | 3;
    document.documentElement.dataset.fs = String(p.fontScale);
    writeProgress(this.progress);
  }

  private async copySave(b: HTMLElement): Promise<void> {
    const code = encodeSave(this.progress);
    const old = b.textContent;
    b.textContent = code;
    try { await navigator.clipboard.writeText(code); b.classList.add('ok'); } catch { /* টেক্সটেই আছে */ }
    setTimeout(() => { b.classList.remove('ok'); b.textContent = old; }, 2400);
  }

  private pasteSave(b: HTMLElement): void {
    const code = prompt(L.savePaste) ?? '';
    const p = decodeSave(code.trim(), this.doc);
    if (!p) { this.toastNow(L.loadFail); return; }
    this.progress = p;
    writeProgress(p);
    b.textContent = L.saveDone;
    this.refreshTitle();
    this.buildSelect();
  }

  /** শব্দ-তালা খোলার একমাত্র পথ: context জাগানো + সব শব্দ-বোতামের রূপ একসাথে মেলানো। */
  private ensureAudio(forceOn = false): void {
    const p = this.progress.prefs;
    if (forceOn) { p.music = true; p.sound = true; this.sound.setMusic(true); this.sound.setSfx(true); writeProgress(this.progress); }
    const was = this.sound.isUnlocked;
    this.sound.unlock();
    if (!was && this.sound.isUnlocked) {
      this.lastUnlockAt = Date.now();
      if (this.scene === 'title') this.toastNow(L.soundNowOn);
    }
    this.refreshSoundUi();
  }

  private refreshSoundUi(): void {
    const unlocked = this.sound.isUnlocked;
    const p = this.progress.prefs;
    const top = document.getElementById('soundTop');
    if (top) { top.textContent = !unlocked ? '🔇 শব্দ' : p.sound === false ? '🔇' : '🔊'; top.classList.toggle('needs-sound', !unlocked); }
    const gate = document.getElementById('soundGate');
    if (gate) {
      gate.innerHTML = unlocked
        ? '✓ শব্দ চালু আছে<small>সংগীত · তলোয়ার · ঢোল — এখন লড়াই শুরু করো</small>'
        : '🔊 শব্দ চালু করো<small>সংগীত, তলোয়ারের সুইং, ঢোল — শুনতে একবার চাপো</small>';
      gate.classList.toggle('on', unlocked);
    }
    document.querySelectorAll<HTMLElement>('[data-act]').forEach((el) => {
      if (el.dataset.act === 'music') el.classList.toggle('on', p.music !== false);
      if (el.dataset.act === 'soundBtn') el.classList.toggle('on', p.sound !== false);
    });
  }

  private toastNow(t: string): void {
    this.toast = { text: t, life: 190 };
    if (this.dom.toast) this.dom.toast.textContent = t;
  }

  // ─── ডেমো (টাইটেলের পেছনে জীবন্ত লড়াই) ──────────────────────────────────
  private makeDemo(ch?: Chapter): void {
    const c = ch?.fight_bn ? ch : this.doc.chapters.find((x) => x.id === 1) ?? this.doc.chapters[0]!;
    this.demo = new Sim(c, this.doc.meta, 'wave', 4242, new Map());
    for (const card of c.cards.slice(0, 3)) this.demo.readCard(card.id);
  }
  private demoInput(sim: Sim): InputFrame {
    const inp: InputFrame = { moveX: 0, moveY: 0, pressed: null, answer: null, parryAnswer: null };
    const foe = sim.enemies.filter((e) => e.alive).sort((a, b) => Math.abs(a.x - sim.player.x) - Math.abs(b.x - sim.player.x))[0];
    const pk = sim.pickups[0];
    const target = pk && sim.frame % 500 < 260 ? { x: pk.x, y: pk.y } : foe;
    if (target) {
      const dx = target.x - sim.player.x, dy = target.y - sim.player.y;
      if (Math.abs(dx) > 48) inp.moveX = Math.sign(dx);
      if (Math.abs(dy) > 10) inp.moveY = Math.sign(dy);
      if (foe && Math.abs(dx) <= 56 && sim.player.actionable && sim.frame % 17 === 0) {
        inp.pressed = sim.player.meter >= 100 ? 'resolve' : sim.frame % 51 === 0 ? 'heavy' : 'cut';
      }
    }
    sim.player.hp = Math.max(sim.player.hp, 150);
    if (sim.objective) sim.objective.hp = Math.max(sim.objective.hp, 80);
    return inp;
  }

  // ─── লুপ ────────────────────────────────────────────────────────────────
  private loop(now: number): void {
    this.raf = requestAnimationFrame(this.loop);
    if (this.last === 0) this.last = now;
    const dt = Math.min(100, now - this.last);
    this.last = now;
    if (this.paused) { this.render(); return; }
    // ধীর-ঘড়ি: প্রশ্ন চললে বা কার্ড-তোলার পরের মুহূর্তে সময় আস্তে — পড়া যায়, লড়াই থামে না
    let ts = 1;
    if (this.sim && (this.scene === 'wave' || this.scene === 'duel')) {
      if (this.question) ts = this.viewOpts.reduceMotion ? 0.6 : 0.45;
      else if (this.slowmo > 0) { ts = this.viewOpts.reduceMotion ? 0.75 : 0.38; this.slowmo -= 1; }
    }
    this.acc += dt * ts;
    const STEP = 1000 / 60;
    let steps = 0;
    while (this.acc >= STEP && steps < 5) {
      this.acc -= STEP;
      this.tick += 1;
      steps += 1;
      this.simulate();
    }
    if (this.acc > STEP * 5) this.acc = 0;
    this.render();
  }

  private simulate(): void {
    if (this.banner && --this.banner.life <= 0) this.banner = null;
    if (this.toast && --this.toast.life <= 0) this.toast = null;
    if (this.scene === 'rush') { this.rushTick(); return; }
    if (this.scene !== 'wave' && this.scene !== 'duel') {
      if (this.demo) {
        this.demo.step(this.demoInput(this.demo));
        if (this.demo.over) this.makeDemo();
      }
      return;
    }
    const sim = this.sim;
    if (!sim || this.result) return;
    if (sim.hitstop > 0) { sim.hitstop -= 1; return; }   // আঘাতের ওজন: ২–৬ ফ্রেম থমকে থাকা
    const raw: InputFrame = this.input.read();
    const inp: InputFrame = { ...raw, answer: this.question ? raw.answer : null };
    if (raw.pressed === 'side') this.sound.dash();
    if ((raw.moveX || raw.moveY) && sim.player.phase === 'idle' && sim.frame % 13 === 0) this.sound.footstep();
    this.coachObserve(raw);
    const events = sim.step(inp);
    this.lastEvents = events;
    for (const e of events) this.onEvent(e);
    // টানা-আঘাতের মাইলফলক
    if (sim.combo >= 5 && sim.combo % 5 === 0 && sim.combo !== this.comboShown) {
      this.comboShown = sim.combo;
      this.view.pop(sim.player.x, 240 + sim.player.y, `${bn(sim.combo)} টানা!`, '#ffb347', true);
      this.sound.pickup();
      if (sim.combo >= 10) this.awardFeat('combo10');
    }
    if (sim.combo === 0) this.comboShown = 0;
    this.sound.intensity = Math.min(1, (this.scene === 'duel' ? 0.5 : 0.3) + sim.combo * 0.04 + (sim.mode === 'duel' ? (sim.bossPhase - 1) * 0.15 : 0));
    if (sim.over && !this.result) this.finish(sim.over, sim.loseWhy_bn);
  }

  // ─── কোচ (প্রথম লড়াইয়ের হাতে-কলমে শিক্ষা) ──────────────────────────────
  private coachTexts = [L.coachMove, L.coachCut, L.coachHeavy, L.coachGuard, L.coachScroll, L.coachResolve];
  private coachObserve(raw: InputFrame): void {
    if (this.coachStep < 0 || !this.sim) return;
    const s = this.coachStep;
    const done =
      (s === 0 && (raw.moveX !== 0 || raw.moveY !== 0)) ||
      (s === 1 && raw.pressed === 'cut') ||
      (s === 2 && raw.pressed === 'heavy') ||
      (s === 3 && raw.pressed === 'guard') ||
      (s === 4 && this.sim.collectedRun.length > 0) ||
      (s === 5 && raw.pressed === 'resolve');
    if (done) {
      this.coachStep += 1;
      if (this.coachStep >= this.coachTexts.length) {
        this.coachStep = -1;
        this.progress.coached = true;
        writeProgress(this.progress);
      }
      this.paintCoach();
    }
  }
  private paintCoach(): void {
    const el = this.dom.coach;
    if (!el) return;
    if (this.coachStep < 0) { el.classList.add('hide'); return; }
    el.classList.remove('hide');
    el.textContent = `🎓 ${this.coachTexts[this.coachStep]!}`;
  }

  private onEvent(e: SimEvent): void {
    const sim = this.sim!;
    switch (e.t) {
      case 'hit': {
        const byPlayer = e.by === sim.player.name_bn;
        const y = 268 + e.y * 0.5;
        if (e.kind === 'resolve') {
          this.view.kick(byPlayer ? 12 : 6);
          this.banner = { text: `${L.banner}: ${e.banner ?? ''}`, life: 220 };
          this.slowmo = Math.max(this.slowmo, 26);
          this.view.burst(e.x, y + 20, 30, '#ffd777');
        } else if (e.kind === 'guardbreak') {
          this.toastNow(L.guardBreak); this.view.kick(10); this.sound.guardBreak();
          this.sound.vibrate(45); this.slowmo = Math.max(this.slowmo, 34);
          this.view.burst(e.x, y + 20, 26, '#7ec3e8');
          this.view.pop(e.x, y, L.guardBroken, '#ffd98a', true);
        } else if (e.kind === 'parry') {
          this.sound.parry(); this.view.kick(5);
          this.view.pop(e.x, y, L.parried, '#bfe8ff', true);
          if (e.on === sim.player.name_bn) this.awardFeat('parry1');
        } else if (e.kind === 'block') {
          this.sound.block((e.x - 380) / 380);
          this.view.burst(e.x, y + 20, 5, '#cfe6ef');
        } else if (e.kind === 'hit') {
          if (byPlayer) { this.sound.hit(e.dmg >= 13, (e.x - 380) / 380); this.sound.grunt(true, (e.x - 380) / 380); this.view.burst(e.x, y + 20, e.dmg >= 13 ? 14 : 8, '#ffe9a8'); this.view.kick(e.dmg >= 13 ? 6 : 3); }
          else if (e.on === sim.player.name_bn) { this.sound.hurt(); this.sound.vibrate(28); this.view.kick(4); }
          else this.sound.hit(false, (e.x - 380) / 380);
          this.view.pop(e.x, y, bn(e.dmg), byPlayer ? '#ffe9a8' : '#ffb4a2', e.dmg >= 20);
        }
        break;
      }
      case 'downed': this.sound.down(); this.view.burst(e.x, 268 + e.y * 0.5 + 16, 12, '#d8c9a3'); break;
      case 'pickup': {
        this.sound.pickup();
        this.markRead(e.card.id);
        this.slowmo = Math.max(this.slowmo, 46);
        const tac = sim.ch.tactics.find((t) => t.card === e.card.id);
        const one = e.card.bn.split('।')[0]!.trim();
        this.banner = { text: `📜 ${e.card.year === null ? L.prologue : bn(e.card.year)} · ${one}।${tac ? ` ⚡ ${tac.boon_bn}` : ''}`, life: 270 };
        this.view.pop(sim.player.x, 240 + sim.player.y, '+কার্ড', '#ffe9a8', true);
        break;
      }
      case 'wave':
        if (this.dom.tbar) this.dom.tbar.innerHTML = `${L.wave} <b>${bn(e.index)}${e.of ? '/' + bn(e.of) : ''}</b> · ${L.defense}: <b class="obj">${sim.objective?.name_bn ?? ''}</b>`;
        if (this.dom.hint) this.dom.hint.textContent = L.waveHint;
        if (e.index > 1) { this.view.announce(`${L.wave} ${bn(e.index)}`, '', 72); this.sound.announce(); }
        this.dripCard();
        break;
      case 'waveclear':
        this.toastNow(`🌊 ${L.waveClear} ${L.nextWave}`);
        this.sound.correct();
        if (this.runEndless && e.index >= 5) this.awardFeat('endless5');
        break;
      case 'objective': {
        this.sound.hurt();
        if (sim.objective) this.dom.tbar?.classList.toggle('danger', sim.objective.hp / sim.objective.maxHp < 0.35);
        break;
      }
      case 'banner': if (e.text) this.banner = { text: e.text, life: 210 }; break;
      case 'boon': this.toastNow(`${L.tactic}: ${e.boon_bn}`); this.boons.set(e.card, boonOf(e.boon_bn)); break;
      case 'break': this.banner = { text: e.text, life: 330 }; this.view.announce(L.guardBroken, '', 130); break;
      case 'phase': this.toastNow(`🔥 ${L.phaseUp} (${L.bossGuard} ফিরেছে)`); this.sound.announce(); break;
      case 'swing': {
        const pan = (e.x - 380) / 380;
        if (e.kind === 'resolve') this.sound.resolve();
        this.sound.swing(e.kind === 'heavy' || e.kind === 'resolve', pan);
        if (e.kind !== 'cut' || Math.random() < 0.3) this.sound.grunt(e.hostile, pan);   // শত্রুর গর্জন এখন সত্যিই শোনা যায়
        break;
      }
      case 'telegraph': this.sound.warning((e.x - 380) / 380); break;
      case 'comboend': this.view.pop(sim.player.x, 240 + sim.player.y, `+${bn(e.bonus)}`, '#ffb347'); break;
      case 'question': this.question = { ...e.q, lives: e.lives }; this.input.answerMode = true; this.sound.announce(); this.paintQuestion(); break;
      case 'qtimeout':
        this.question = null; this.input.answerMode = false;
        this.dom.qbar?.classList.add('hide');
        this.toastNow(`⌛ ${L.timeUpQ} — ${e.q.explain_bn}`);
        this.sound.wrong();
        break;
      case 'answered': {
        this.question = null; this.input.answerMode = false;
        this.dom.qbar?.classList.add('hide');
        if (e.correct) {
          this.sound.correct(); this.sound.vibrate(18);
          this.progress.truthsTotal += 1;
          if (this.progress.truthsTotal >= 9) this.awardFeat('truth9');
          writeProgress(this.progress);
          this.view.pop(sim.player.x, 230 + sim.player.y, `${L.correct}! +${bn(400)}`, '#a5ec9a', true);
          this.toastNow(`${L.correct} — ${e.q.explain_bn}`);
        } else {
          this.sound.wrong();
          this.toastNow(`${L.wrong} — ${e.q.explain_bn} (${L.meterDown})`);
        }
        break;
      }
      case 'win': this.view.kick(10); this.view.announce(L.ko, '', 120); this.sound.win(); break;
      default: break;
    }
  }

  private paintQuestion(): void {
    const q = this.question;
    const el = this.dom.qbar;
    if (!el) return;
    if (!q) { el.classList.add('hide'); return; }
    const sim = this.sim!;
    el.classList.remove('hide');
    el.innerHTML = `<div class="qhead"><span>🛡 ঢাল ভাঙা — সত্যি দাও!</span><span>${L.truths} ${bn(sim.duel.truths)}/${bn(sim.duel.needs)}</span></div>
<div class="qtime"><i></i></div>
<p class="qq">${q.q_bn}</p><div class="opts">` +
      q.choices_bn.map((c, i) => `<button data-answer="${i}"><span class="lt">${'কখগঘ'[i]}</span>${c}</button>`).join('') +
      `</div><p class="need">${L.answer} — সময় ধীরে চলছে, তাড়া নেই; ভুলে প্রাণ কমে না</p>`;
    el.querySelectorAll<HTMLButtonElement>('[data-answer]').forEach((b) => {
      b.addEventListener('click', () => this.input.inject(null, 0, 0, Number(b.dataset.answer) as 0 | 1 | 2 | 3));
    });
  }

  private finish(win: 'win' | 'lose', why_bn: string): void {
    this.result = { win: win === 'win', why_bn };
    const sim = this.sim!;
    this.lastMode = sim.mode;
    const won = win === 'win';
    this.progress.totalScore += sim.score;
    let stars = 0;
    let newBest = false;
    if (this.runEndless) {
      if (sim.score > this.progress.endlessBest) { this.progress.endlessBest = sim.score; newBest = true; }
    } else {
      if (won) this.complete(sim.ch.id, sim.mode === 'duel' ? 2 : 1);
      const prev = this.progress.scores[sim.ch.id] ?? 0;
      if (sim.score > prev) { this.progress.scores[sim.ch.id] = sim.score; newBest = true; }
      if (won) {
        stars = 1
          + ((sim.objective ? sim.objective.hp / sim.objective.maxHp >= 0.5 : sim.player.hp / 240 >= 0.45) ? 1 : 0)
          + ((sim.collectedRun.length >= 3 || sim.comboBest >= 10 || (sim.mode === 'duel' && sim.qWrong === 0)) ? 1 : 0);
        this.progress.stars[sim.ch.id] = Math.max(this.progress.stars[sim.ch.id] ?? 0, stars);
        this.awardFeat('firstWin');
      }
    }
    if (won && this.coachStep >= 0) { this.progress.coached = true; this.coachStep = -1; }
    writeProgress(this.progress);
    this.refreshTitle();
    if (!won) this.sound.lose();

    const learned = sim.collectedRun
      .map((id) => sim.ch.cards.find((c) => c.id === id))
      .filter((c) => !!c)
      .slice(0, 3);
    const teaser = sim.ch.cards.find((c) => !this.progress.read.includes(c.id));
    const accTotal = sim.qRight + sim.qWrong;
    const el = this.dom.result!;
    el.innerHTML = `<div class="result-head ${won ? 'win' : 'lose'}">
<h2>${won ? '🏆 ' + L.win : '💨 ' + L.lose}</h2>
<p>${won ? sim.ch.title_bn + (this.runEndless ? ` — ${bn(sim.waveIndex + 1)} ${L.wave}` : sim.mode === 'duel' ? ' — দ্বন্দ্ব শেষ' : ' — ঢেউ ঠেকেছে') : why_bn}</p>
${won && !this.runEndless ? `<div class="stars" aria-label="${L.stars}">${'★'.repeat(stars)}<span class="dimstar">${'★'.repeat(3 - stars)}</span></div>` : ''}
<div class="bigscore">${bn(sim.score)}<small> ${L.score}${newBest ? ` · 🎉 ${L.newBest}` : ''}</small></div></div>
<div class="statgrid">
<div><b>${bn(sim.comboBest)}</b><small>${L.comboBest}</small></div>
<div><b>${bn(sim.hitsLanded)}</b><small>সফল আঘাত</small></div>
<div><b>${bn(sim.enemiesDowned)}</b><small>${L.enemiesBack}</small></div>
<div><b>${accTotal ? `${bn(sim.qRight)}/${bn(accTotal)}` : '—'}</b><small>${L.accuracy}</small></div>
<div><b>${bn(sim.collectedRun.length)}</b><small>তোলা কার্ড</small></div>
<div><b>${bn(Math.max(0, Math.round(sim.player.hp)))}</b><small>বাকি ${L.hp}</small></div>
</div>
${won && sim.mode === 'duel' && sim.ch.boss ? `<p class="brk"><b>${L.bossBreak}:</b> ${sim.ch.boss.breakline_bn}</p>` : ''}
${learned.length ? `<div class="learned"><h3>📜 ${L.learned}</h3>${learned.map((c) => `<p><b>${c!.year === null ? L.prologue : bn(c!.year)}</b> · ${c!.bn.split('।')[0]}।</p>`).join('')}</div>`
  : teaser ? `<div class="learned"><h3>📜 পরের কার্ডটা মাঠেই আছে…</h3><p><b>${teaser.year === null ? L.prologue : bn(teaser.year)}</b> · ${teaser.bn.split('।')[0]}।</p></div>` : ''}
<div class="row">
<button class="pri" data-act="${won ? 'next' : 'again'}">${won ? (this.runEndless ? L.back : sim.mode === 'wave' && sim.ch.fight_bn ? '🛡 এবার দ্বন্দ্ব!' : L.continue) : L.again}</button>
${won ? `<button data-act="again">${L.again}</button>` : `<button data-act="back">${L.back}</button>`}
<button class="mini" data-act="read">${L.readBrief} (${bn(sim.ch.cards.length)} কার্ড)</button>
<button class="mini" data-act="back">${L.chapterSelect}</button>
</div>`;
    this.ch = sim.ch;
    this.bind();
    this.show('result');
  }

  // ─── সত্য-দৌড় (Quiz Rush) ────────────────────────────────────────────────
  startRush(): void {
    this.ensureAudio();
    const upto = Math.max(1, ...this.doc.chapters.map((c, i) => (this.unlocked(i) ? c.id : 0)));
    const pool = this.doc.chapters
      .filter((c) => c.id <= upto)
      .flatMap((c) => c.quiz.map((q) => ({
        q, chapter_bn: c.title_bn,
        card_bn: c.cards.find((x) => x.id === q.card)?.bn ?? q.explain_bn,
      })));
    const order = pool.map((_, i) => i);
    for (let i = order.length - 1; i > 0; i--) { const j = Math.floor(Math.random() * (i + 1));[order[i], order[j]] = [order[j]!, order[i]!]; }
    this.rush = {
      pool, order, pos: 0, current: null,
      time: 60 * 60, lock: 0, score: 0, streak: 0, bestStreak: 0, right: 0, wrong: 0, missed: [], over: false,
    };
    this.result = null;
    this.paused = false;
    this.nextRushQuestion();
    this.show('rush');
    this.sound.announce();
    this.view.announce(L.rush, L.rushSub, 90);
  }

  private nextRushQuestion(): void {
    const r = this.rush!;
    if (r.pos >= r.order.length) {
      // পুল শেষ: আবার গুলিয়ে নতুন চক্র (পুনরাবৃত্তি = মনে গেঁথে যাওয়া)
      for (let i = r.order.length - 1; i > 0; i--) { const j = Math.floor(Math.random() * (i + 1));[r.order[i], r.order[j]] = [r.order[j]!, r.order[i]!]; }
      r.pos = 0;
    }
    const item = r.pool[r.order[r.pos]!]!;
    r.pos += 1;
    const choices = item.q.choices_bn.map((c, i) => ({ c, ok: i === item.q.answer }));
    for (let i = choices.length - 1; i > 0; i--) { const j = Math.floor(Math.random() * (i + 1));[choices[i], choices[j]] = [choices[j]!, choices[i]!]; }
    r.current = { q: item.q, chapter_bn: item.chapter_bn, card_bn: item.card_bn, choices: choices.map((x) => x.c), answer: choices.findIndex((x) => x.ok) };
    this.paintRush();
  }

  private paintRush(feedback?: { correct: boolean; picked: number }): void {
    const el = this.dom.rush;
    const r = this.rush;
    if (!el || !r) return;
    if (r.over) {
      el.innerHTML = `<div class="result-head win"><h2>⚡ ${L.rushOver}</h2>
<div class="bigscore">${bn(r.score)}<small> ${L.score}${r.score >= this.progress.rushBest && r.score > 0 ? ` · 🎉 ${L.newBest}` : ''}</small></div></div>
<div class="statgrid">
<div><b>${bn(r.right)}</b><small>${L.correct}</small></div>
<div><b>${bn(r.wrong)}</b><small>${L.wrong}</small></div>
<div><b>${bn(r.bestStreak)}</b><small>${L.rushStreak}</small></div>
<div><b>${bn(this.progress.rushBest)}</b><small>${L.best}</small></div>
</div>
${r.missed.length ? `<div class="learned"><h3>📚 ${L.rushMissed}</h3>${r.missed.slice(0, 4).map((m) => `<p><b>${m.q.q_bn}</b><br>✓ ${m.q.choices_bn[m.q.answer]} — ${m.q.explain_bn}</p>`).join('')}</div>` : `<p class="soft">একটাও ভুল নেই — ইতিহাস তোমার হাতের মুঠোয়!</p>`}
<div class="row"><button class="pri" data-act="rush">${L.rushAgain}</button><button data-act="start">${L.chapterSelect}</button></div>`;
      this.bind();
      return;
    }
    const cur = r.current!;
    el.innerHTML = `<div class="rush-head">
<span class="rush-title">⚡ ${L.rush}</span>
<span id="rush-score">${L.score} <b>${bn(r.score)}</b></span>
<span id="rush-streak" class="${r.streak >= 3 ? 'hot' : ''}">🔥 ${L.rushStreak} <b>${bn(r.streak)}</b></span>
</div>
<div class="rush-timebar"><i id="rush-timefill"></i><span id="rush-time"></span></div>
<p class="rush-chap">📖 ${cur.chapter_bn}</p>
<p class="rush-q">${cur.q.q_bn}</p>
<div class="rush-opts">${cur.choices.map((c, i) => {
      let cls = '';
      if (feedback) cls = i === cur.answer ? 'ok' : i === feedback.picked ? 'bad' : 'dim';
      return `<button data-rush="${i}" class="${cls}" ${feedback ? 'disabled' : ''}><span class="lt">${'কখগঘ'[i]}</span>${c}</button>`;
    }).join('')}</div>
${feedback ? `<p class="rush-why ${feedback.correct ? 'ok' : 'bad'}">${feedback.correct ? '✓ ' + L.correct : '✗ ' + L.wrong} — ${cur.q.explain_bn}</p>` : `<p class="soft">ঠিক উত্তর = +৩ সেকেন্ড ও টানা-বোনাস · ভুল = −৩ সেকেন্ড (প্রাণ নয়!)</p>`}`;
    el.querySelectorAll<HTMLButtonElement>('[data-rush]').forEach((b) => {
      b.addEventListener('click', () => this.answerRush(Number(b.dataset.rush)));
    });
    this.paintRushTimer();
  }

  private paintRushTimer(): void {
    const r = this.rush;
    if (!r || r.over) return;
    const fill = document.getElementById('rush-timefill');
    const label = document.getElementById('rush-time');
    const frac = Math.max(0, r.time / (60 * 60));
    if (fill) fill.style.width = `${Math.round(frac * 100)}%`;
    if (fill) fill.classList.toggle('low', r.time < 10 * 60);
    if (label) label.textContent = `${bn(Math.ceil(r.time / 60))} সেকেন্ড`;
  }

  private answerRush(i: number): void {
    const r = this.rush;
    if (!r || r.over || r.lock > 0 || !r.current) return;
    const correct = i === r.current.answer;
    if (correct) {
      r.right += 1; r.streak += 1; r.bestStreak = Math.max(r.bestStreak, r.streak);
      r.score += 100 + r.streak * 25;
      r.time = Math.min(75 * 60, r.time + 3 * 60);
      this.sound.correct();
      this.progress.truthsTotal += 1;
      if (r.streak >= 10) this.awardFeat('rush10');
      if (this.progress.truthsTotal >= 9) this.awardFeat('truth9');
    } else {
      r.wrong += 1; r.streak = 0;
      r.time = Math.max(0, r.time - 3 * 60);
      r.missed.push({ q: r.current.q, card_bn: r.current.card_bn });
      this.sound.wrong();
    }
    writeProgress(this.progress);
    r.lock = 78;
    this.paintRush({ correct, picked: i });
    // পেছনের ডেমো-লড়াইতেও প্রতিক্রিয়া: ঠিক হলে নায়ক ঝলক দেয়
    if (this.demo && correct) this.view.burst(this.demo.player.x, 300, 18, '#ffd777');
  }

  private rushTick(): void {
    const r = this.rush;
    if (!r || r.over) return;
    if (this.demo) { this.demo.step(this.demoInput(this.demo)); if (this.demo.over) this.makeDemo(); }
    if (r.lock > 0) {
      r.lock -= 1;
      if (r.lock === 0 && r.time > 0) this.nextRushQuestion();
    }
    if (r.time > 0) r.time -= 1;
    if (r.time <= 0) {
      r.over = true;
      if (r.score > this.progress.rushBest) this.progress.rushBest = r.score;
      this.progress.totalScore += r.score;
      writeProgress(this.progress);
      this.refreshTitle();
      this.sound.win();
      this.paintRush();
      return;
    }
    this.paintRushTimer();
  }

  // ─── রেন্ডার ও HUD ──────────────────────────────────────────────────────────
  private render(): void {
    const playing = this.scene === 'wave' || this.scene === 'duel';
    const sim = playing ? this.sim : this.demo;
    if (sim && this.scene !== 'result') {
      this.view.draw(sim, this.tick);
      if (playing) this.paintHud();
    } else if (sim && this.scene === 'result') {
      this.view.draw(sim, this.tick);
    }
    if (this.dom.banner) {
      this.dom.banner.textContent = this.banner?.text ?? '';
      this.dom.banner.classList.toggle('show', !!this.banner);
    }
    if (this.dom.toast) this.dom.toast.classList.toggle('show', !!this.toast);
    if (this.dom.pause) this.dom.pause.classList.toggle('hide', !this.paused);
  }

  private paintHud(): void {
    const sim = this.sim!;
    const set = (id: string, v: number) => {
      const el = document.getElementById(id);
      if (el) el.style.width = `${Math.max(0, Math.min(100, v * 100))}%`;
    };
    set('bar-hp', sim.player.hp / 240);
    set('bar-guard', sim.player.guard / 100);
    set('bar-meter', sim.player.meter / RESOLVE_COST);
    const meterEl = document.getElementById('bar-meter');
    meterEl?.classList.toggle('full', sim.player.meter >= RESOLVE_COST);
    document.querySelector('[data-input="resolve"]')?.classList.toggle('ready', sim.player.meter >= RESOLVE_COST);
    const scoreEl = document.getElementById('score');
    if (scoreEl) scoreEl.textContent = bn(sim.score);
    if (sim.mode === 'duel' && sim.enemies[0]) {
      set('bar-bossguard', sim.enemies[0]!.guard / 100);
      const pips = document.getElementById('truthpips');
      if (pips) pips.textContent = '◆'.repeat(sim.duel.truths) + '◇'.repeat(Math.max(0, sim.duel.needs - sim.duel.truths));
    }
    if (sim.objective) set('bar-obj', sim.objective.hp / sim.objective.maxHp);
    const t = document.getElementById('clock');
    if (t) {
      t.textContent = this.runEndless
        ? `${bnTime(sim.frame)} · ${L.wave} ${bn(sim.waveIndex + 1)}`
        : this.scene === 'wave' ? bnTime(sim.timeLeft) : `${L.truths} ${bn(sim.duel.truths)}/${bn(sim.duel.needs)}`;
    }
    const rd = document.getElementById('readcount');
    if (rd) rd.textContent = `${bn(sim.readCards.size)}/${bn(sim.ch.cards.length)}`;
    if (this.question) {
      const fill = this.dom.qbar?.querySelector<HTMLElement>('.qtime i');
      if (fill) fill.style.width = `${Math.round(Math.max(0, sim.duel.qTime / Math.max(1, sim.duel.qTotal)) * 100)}%`;
    }
    if (sim.intermission > 0 && this.dom.hint) {
      this.dom.hint.textContent = `${L.waveClear} ${L.scrollHint} — ${bn(Math.ceil(sim.intermission / 60))}`;
    }
  }

  destroy(): void { cancelAnimationFrame(this.raf); }
}
