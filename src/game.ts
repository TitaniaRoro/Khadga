/**
 * src/game.ts — ইঞ্জিন-কন্ট্রোলার: ফিক্সড-স্টেপ লুপ, সিন-গ্রাফ, কনটেন্ট-বাঁধন।
 *
 * ৬০Hz ফিক্সড স্টেপ + accumulator; রেন্ডার প্রতি RAF-এ, সিম প্রতি ফ্রেমে।
 * লড়াই কখনও থামে না: প্রশ্ন এলেও `sim.step()` চলতেই থাকে (design §৩.১, 'মধ্যম' কড়াকড়ি)।
 */
import { Sim, type InputFrame, type SimEvent, boonOf } from './sim.ts';
import { InputSource } from './input.ts';
import { Renderer, PALETTES } from './render.ts';
import { L, bn, bnTime } from './hud.ts';
import type { ContentDoc, Chapter, QuizItem } from './content-types.ts';
import type { ViewOpts } from './render.ts';
import { loadProgress, writeProgress, encodeSave, decodeSave, type Progress } from './save.ts';
import { RESOLVE_COST } from './frames.ts';

export type Scene = 'title' | 'select' | 'read' | 'wave' | 'duel' | 'result';

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
  private lastEvents: SimEvent[] = [];
  private banner: { text: string; life: number } | null = null;
  private toast: { text: string; life: number } | null = null;
  private question: (QuizItem & { lives: number }) | null = null;
  private result: { win: boolean; why_bn: string } | null = null;
  private paused = false;
  private viewOpts: ViewOpts;
  private dom: Record<string, HTMLElement | null> = {};

  constructor(doc: ContentDoc, root: HTMLElement) {
    this.doc = doc;
    this.progress = loadProgress();
    const canvas = root.querySelector<HTMLCanvasElement>('#stage');
    if (!canvas) throw new Error('#stage ক্যানভাস নেই');
    this.viewOpts = {
      reduceMotion: this.progress.prefs.reduceMotion,
      colorblind: this.progress.prefs.colorblind,
      palette: PALETTES[0]!,
    };
    this.view = new Renderer(canvas, this.viewOpts);
    this.input = new InputSource(root, () => { /* প্রথম স্পর্শ: অডিও/ফোকাস জাগরণ */ });
    for (const id of ['hud', 'title', 'select', 'read', 'result', 'pause', 'qbar', 'tbar', 'toast', 'banner', 'hint']) {
      this.dom[id] = document.getElementById(id);
    }
    this.bind();
    this.show('title');
    this.loop = this.loop.bind(this);
    this.raf = requestAnimationFrame(this.loop);
  }

  // ─── সিন নিয়ন্ত্রণ ───────────────────────────────────────────────────────
  private show(s: Scene): void {
    this.scene = s;
    for (const [k, el] of Object.entries(this.dom)) {
      if (!el) continue;
      const want = { title: 'title', select: 'select', read: 'read', result: 'result' }[k];
      if (want) el.classList.toggle('hide', want !== s);
    }
    const playLayer = s === 'wave' || s === 'duel';
    this.dom.hud?.classList.toggle('hide', !playLayer);
    document.body.classList.toggle('playing', playLayer);
  }

  private bind(): void {
    document.querySelectorAll<HTMLElement>('[data-act]').forEach((b) => {
      b.addEventListener('click', () => {
        const a = b.dataset.act!;
        if (a === 'start') this.buildSelect();
        else if (a === 'back') this.buildSelect();
        else if (a === 'again') this.startChapter(this.ch!, 'wave');
        else if (a === 'next') this.advance();
        else if (a === 'pause') this.togglePause();
        else if (a === 'resume') this.togglePause();
        else if (a === 'copySave') void this.copySave(b);
        else if (a === 'pasteSave') this.pasteSave(b);
        else if (a === 'music') this.flip('music', b);
        else if (a === 'gentle') this.flip('gentle', b);
        else if (a === 'teacher') this.flip('teacher', b);
        else if (a === 'reduce') this.flip('reduceMotion', b);
        else if (a === 'cb') this.flip('colorblind', b);
        else if (a === 'fontUp') this.font(1);
        else if (a === 'fontDown') this.font(-1);
      });
    });
  }

  buildSelect(): void {
    const list = this.dom.select!;
    list.innerHTML = `<h2>${L.chapterSelect}</h2>`;
    const ul = document.createElement('ul');
    ul.className = 'chapters';
    this.doc.chapters.forEach((ch, i) => {
      const unlocked = i === 0 || this.progress.done.includes(i - 1);
      const li = document.createElement('li');
      const status = this.progress.best[ch.id] ?? 0;
      li.innerHTML = `<button class="chap ${unlocked ? '' : 'off'}" data-ch="${ch.id}">
        <span class="n">${bn(ch.id)}</span>
        <span class="t">${ch.title_bn}</span>
        <span class="y">${ch.years_bn}</span>
        <span class="s">${status === 2 ? '✓ ' + L.chapterDone : status === 1 ? L.wave + ' ✓' : unlocked ? L.play : L.locked}</span>
      </button>`;
      ul.appendChild(li);
    });
    list.appendChild(ul);
    const foot = document.createElement('p');
    foot.className = 'foot';
    foot.innerHTML = `<button data-act="start">${L.resume}</button> <span>${L.bloodless}</span>`;
    list.appendChild(foot);
    list.querySelectorAll<HTMLButtonElement>('button.chap:not(.off)').forEach((b) => {
      b.addEventListener('click', () => this.openChapter(Number(b.dataset.ch)));
    });
    this.bind();
    this.show('select');
  }

  /** অধ্যায় খোলা: প্যানেল → কার্ড-পাঠ → ঢেউ → দ্বন্দ্ব। */
  openChapter(id: number): void {
    const ch = this.doc.chapters.find((c) => c.id === id);
    if (!ch) return;
    this.ch = ch;
    this.boons = new Map();
    const el = this.dom.read!;
    el.innerHTML = `<h2><span class="num">${bn(ch.id)}</span> ${ch.title_bn} <small>${ch.years_bn}</small></h2>
<p class="bearer"><b>${ch.bearer_bn.name_bn}</b> — ${ch.bearer_bn.role_bn}</p>
<ol class="panels">${ch.panels_bn.map((p) => `<li>${p}</li>`).join('')}</ol>
<div class="cards">${ch.cards.map((c) => `
  <article class="card ${c.disputed ? 'disputed' : ''}" data-card="${c.id}">
    <header><span class="chip">${c.year === null ? L.prologue : bn(c.year)}</span>${c.place ? `<span class="pl">${c.place}</span>` : ''}
    ${c.disputed ? `<span class="chip warn">${L.disputed}</span>` : ''}</header>
    <p>${c.bn}</p>
    ${c.disputed && c.views ? `<div class="views">${c.views.map((v, j) => `<div class="view"><b>${j === 0 ? L.viewA : L.viewB}</b><p>${v}</p></div>`).join('')}</div>` : ''}
    <details><summary>${L.sources} (${bn(c.sources.length)})</summary><ul>${c.sources.map((s) => `<li>${s}</li>`).join('')}</ul></details>
    <button class="mini" data-read="${c.id}">${L.read}</button>
  </article>`).join('')}</div>
<p class="hintline">${L.readCardFirst}</p>
<button class="go" data-begin>${ch.fight_bn ? L.play : L.continue}</button>`;
    el.querySelectorAll<HTMLButtonElement>('[data-read]').forEach((b) => {
      b.addEventListener('click', () => {
        const id2 = b.dataset.read!;
        this.markRead(id2);
        b.closest('.card')?.classList.add('read');
        b.remove();
        const left = el.querySelectorAll('.card:not(.read)').length;
        if (!left) this.finishRead(el);
      });
    });
    el.querySelectorAll<HTMLButtonElement>('.card').forEach((card) => {
      card.addEventListener('click', () => {
        const cid = card.dataset.card!;
        if (!card.classList.contains('read')) { this.markRead(cid); card.classList.add('read'); }
        const left = el.querySelectorAll('.card:not(.read)').length;
        if (!left) this.finishRead(el);
      });
    });
    const begin = el.querySelector<HTMLButtonElement>('[data-begin]');
    begin?.addEventListener('click', () => {
      if (!ch.fight_bn) { this.complete(id, 2); this.buildSelect(); return; }
      this.startChapter(ch, 'wave');
    });
    if (!ch.cards.some((c) => this.progress.read.includes(c.id))) this.finishRead(el, true);
    this.show('read');
  }

  private finishRead(el: HTMLElement, auto = false): void {
    const begin = el.querySelector<HTMLButtonElement>('[data-begin]');
    if (!begin) return;
    begin.textContent = this.ch?.fight_bn ? (auto ? L.play : L.readAll + ' → ' + L.play) : L.continue;
    begin.classList.add('ready');
  }

  private markRead(id: string): void {
    if (this.progress.read.includes(id)) return;
    this.progress.read.push(id);
    writeProgress(this.progress);
    this.sim?.readCard(id);
  }

  startChapter(ch: Chapter, mode: 'wave' | 'duel'): void {
    const sim = new Sim(ch, this.doc.meta, mode, ch.id * 977 + 13, this.boons);
    if (this.progress.prefs.gentle) sim.player.heal(60);
    if (this.progress.prefs.teacher) sim.duel.needs = 2;
    for (const id of this.progress.read) sim.readCard(id);
    sim.readCard(ch.cards[0]!.id);
    this.sim = sim;
    this.question = null;
    this.result = null;
    this.viewOpts.palette = PALETTES[ch.id % PALETTES.length]!;
    this.view.setOpts(this.viewOpts);
    this.dom.qbar?.classList.add('hide');
    this.show(mode);
    this.dom.tbar!.innerHTML = mode === 'wave'
      ? `${L.wave} <b>${bn(sim.waveIndex + 1)}/${bn(sim.waves)}</b> · ${L.defense}: <b class="obj">${sim.objective?.name_bn ?? ''}</b>`
      : `${L.duelHint}`;
    this.dom.hint!.textContent = mode === 'wave' ? L.waveHint : (ch.boss?.tactic_bn ?? '');
  }

  private advance(): void {
    const ch = this.ch!;
    if (this.scene === 'wave' || this.lastPhase === 'wave') {
      if (ch.fight_bn) { this.startChapter(ch, 'duel'); this.lastPhase = 'duel'; return; }
    }
    this.complete(ch.id, 2);
    this.buildSelect();
  }
  private lastPhase: 'wave' | 'duel' = 'wave';

  private complete(id: number, score: number): void {
    if (!this.progress.done.includes(id)) this.progress.done.push(id);
    this.progress.best[id] = Math.max(this.progress.best[id] ?? 0, score);
    writeProgress(this.progress);
  }

  private togglePause(): void {
    this.paused = !this.paused;
    this.dom.pause?.classList.toggle('hide', !this.paused);
  }

  private flip(key: 'music' | 'gentle' | 'teacher' | 'reduceMotion' | 'colorblind', b: HTMLElement): void {
    const p = this.progress.prefs;
    if (key === 'music') p.music = !p.music;
    if (key === 'gentle') p.gentle = !p.gentle;
    if (key === 'teacher') p.teacher = !p.teacher;
    if (key === 'reduceMotion') p.reduceMotion = !p.reduceMotion;
    if (key === 'colorblind') p.colorblind = !p.colorblind;
    this.viewOpts.reduceMotion = p.reduceMotion;
    this.viewOpts.colorblind = p.colorblind;
    this.view.setOpts(this.viewOpts);
    b.classList.toggle('on', Boolean((p as unknown as Record<string, boolean>)[key]));
    writeProgress(this.progress);
  }

  private font(dir: number): void {
    const p = this.progress.prefs;
    p.fontScale = Math.max(0, Math.min(3, p.fontScale + dir)) as 0 | 1 | 2 | 3;
    document.documentElement.dataset.fs = String(p.fontScale);
    writeProgress(this.progress);
  }

  private async copySave(b: HTMLElement): Promise<void> {
    const code = encodeSave(this.progress);
    b.textContent = code;
    try { await navigator.clipboard.writeText(code); b.classList.add('ok'); } catch { /* ক্লিপবোর্ড না-পেলে টেক্সট বক্সেই আছে */ }
    setTimeout(() => b.classList.remove('ok'), 1200);
  }

  private pasteSave(b: HTMLElement): void {
    const code = prompt(L.savePaste) ?? '';
    const p = decodeSave(code.trim(), this.doc);
    if (!p) { this.toastNow(L.loadFail); return; }
    this.progress = p;
    writeProgress(p);
    b.textContent = L.saveDone;
    this.buildSelect();
  }

  private toastNow(t: string): void {
    this.toast = { text: t, life: 150 };
    if (this.dom.toast) this.dom.toast.textContent = t;
  }

  // ─── লুপ ────────────────────────────────────────────────────────────────
  private loop(now: number): void {
    this.raf = requestAnimationFrame(this.loop);
    if (this.last === 0) this.last = now;
    const dt = Math.min(100, now - this.last);
    this.last = now;
    if (this.paused) { this.render(); return; }
    this.acc += dt;
    const STEP = 1000 / 60;
    let steps = 0;
    while (this.acc >= STEP && steps < 5) {
      this.acc -= STEP;
      this.tick += 1;
      steps += 1;
      this.simulate();
    }
    this.render();
  }

  private simulate(): void {
    const sim = this.sim;
    if (!sim || this.result) { if (this.banner) this.banner.life -= 1; if (this.toast) this.toast.life -= 1; return; }
    const raw: InputFrame = this.input.read();
    // লড়াই কখনও থামে না: প্রশ্ন-এলেও চলা/আঘাত চালু থাকে; উত্তর শুধু প্রশ্ন-থাকা ফ্রেমেই গণ্য
    // হয় (design §৩.১ — 'মধ্যম' কড়াকড়ি: ভুলে প্রাণ কমে না, সঠিকে সংকল্প-মিটার বাড়ে)।
    const inp: InputFrame = { ...raw, answer: this.question ? raw.answer : null };
    const events = sim.step(inp);
    this.lastEvents = events;
    for (const e of events) this.onEvent(e);
    if (sim.over && !this.result) this.finish(sim.over, sim.loseWhy_bn);
    if (this.banner && --this.banner.life <= 0) this.banner = null;
    if (this.toast && --this.toast.life <= 0) this.toast = null;
  }

  private onEvent(e: SimEvent): void {
    const sim = this.sim!;
    switch (e.t) {
      case 'hit': {
        if (e.kind === 'resolve') { this.view.kick(sim.player.name_bn === e.by ? 12 : 6); this.banner = { text: `${L.banner}: ${e.banner ?? ''}`, life: 190 }; }
        if (e.kind === 'guardbreak') { this.toastNow(L.guardBreak); this.view.kick(9); }
        if (e.kind === 'parry') { this.toastNow(L.correct + ' — ' + L.meterUp); this.view.kick(5); }
        if (e.kind !== 'whiff') this.view.burst(e.kind === 'block' || e.kind === 'parry' ? sim.player.x : sim.enemies.find((x) => x.name_bn === e.on)?.x ?? 400, 300, e.kind === 'resolve' ? 22 : 8);
        break;
      }
      case 'wave': this.dom.tbar && (this.dom.tbar.innerHTML = `${L.wave} <b>${bn(e.index)}/${bn(e.of)}</b> · ${L.defense}: <b class="obj">${sim.objective?.name_bn ?? ''}</b>`); break;
      case 'objective': if (sim.objective) { const r = sim.objective.hp / sim.objective.maxHp; this.dom.tbar?.classList.toggle('danger', r < 0.35); } break;
      case 'banner': this.banner = { text: e.text, life: 200 }; break;
      case 'boon': this.toastNow(`${L.tactic}: ${e.boon_bn}`); this.boons.set(e.card, boonOf(e.boon_bn)); break;
      case 'break': this.banner = { text: e.text, life: 320 }; break;
      case 'question': this.question = { ...e.q, lives: e.lives }; this.input.answerMode = true; this.paintQuestion(); break;
      case 'answered': {
        this.question = null; this.input.answerMode = false;
        this.dom.qbar?.classList.add('hide');
        this.toastNow((e.correct ? L.correct : L.wrong) + ' — ' + e.q.explain_bn);
        if (!e.correct) this.toast = { text: L.meterDown, life: 130 };
        break;
      }
      case 'win': this.view.kick(10); break;
      default: break;
    }
  }

  private paintQuestion(): void {
    const q = this.question;
    const el = this.dom.qbar;
    if (!el) return;
    if (!q) { el.classList.add('hide'); return; }
    el.classList.remove('hide');
    el.innerHTML = `<p class="qq">${q.q_bn}</p><div class="opts">` +
      q.choices_bn.map((c, i) => `<button data-answer="${i}"><span class="lt">${'কখগঘ'[i]}</span>${c}</button>`).join('') +
      `</div><p class="need">${L.truths}: <b>${bn(3 - q.lives + 1)}/${bn(3)}</b> · ${L.answer}</p>`;
    el.querySelectorAll<HTMLButtonElement>('[data-answer]').forEach((b) => {
      b.addEventListener('click', () => this.input.inject(null, 0, 0, Number(b.dataset.answer) as 0 | 1 | 2 | 3));
    });
  }

  private finish(win: 'win' | 'lose', why_bn: string): void {
    this.result = { win: win === 'win', why_bn };
    const sim = this.sim!;
    if (win === 'win' && this.scene === 'duel') this.complete(sim.ch.id, 2);
    else if (win === 'win') this.complete(sim.ch.id, 1);
    const el = this.dom.result!;
    el.innerHTML = `<h2>${win === 'win' ? L.win : L.lose}</h2>
<p>${win ? sim.ch.title_bn : why_bn}</p>
${win && this.scene === 'duel' && sim.ch.boss ? `<p class="brk"><b>${L.bossBreak}:</b> ${sim.ch.boss.breakline_bn}</p>` : ''}
<div class="row">
<button data-act="again">${L.again}</button>
<button class="pri" data-act="${win ? 'next' : 'back'}">${win ? L.continue : L.back}</button>
</div>`;
    this.bind();
    this.show('result');
  }

  private render(): void {
    const sim = this.sim;
    if (sim && (this.scene === 'wave' || this.scene === 'duel')) {
      this.view.draw(sim, this.tick);
      this.paintHud();
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
    const t = document.getElementById('clock');
    if (t) t.textContent = this.scene === 'wave' ? bnTime(sim.timeLeft) : `${L.truths} ${bn(sim.duel.truths)}/${bn(sim.duel.needs)}`;
    const rd = document.getElementById('readcount');
    if (rd) rd.textContent = `${bn(sim.readCards.size)}/${bn(sim.ch.cards.length)}`;
    const st = document.getElementById('state');
    if (st) st.textContent = sim.player.move ? L[sim.player.move.id as 'cut'] : '';
  }

  destroy(): void { cancelAnimationFrame(this.raf); }
}
