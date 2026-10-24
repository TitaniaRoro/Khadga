/**
 * src/content-types.ts — content/chapters.json-এর টাইপ-প্রতিচ্ছবি।
 *
 * নীতি: গেম এখানকার রূপ ছাড়া কিছুই জানে না। ইতিহাস-দাবি কোনো .ts ফাইলে লেখা নয় —
 * সব `content/chapters.json`-এ, যা tools/validate.mjs ছাড়া প্রকাশ পায় না।
 */

export type CardType =
  | 'fact' | 'event' | 'place' | 'figure' | 'idea'
  | 'legend' | 'myth' | 'quote' | 'disputed';

export type CardTag =
  | 'syncretism' | 'economy' | 'navy' | 'source-criticism'
  | 'coexistence' | 'women' | 'warfare' | 'politics';

/** নির্ভরযোগ্যতার ক্রম — `ইতিহাস-প্রহার`-এর ক্ষতি এই টিয়ার-বিভাজন থেকেই আসে (design §3.১)। */
export type SourceTier = 'primary' | 'scholarly' | 'encyclopedia' | 'folk';

export interface Card {
  id: string;
  type: CardType;
  year: number | null;
  place: string | null;
  bn: string;
  tags: CardTag[];
  sources: string[];
  context?: boolean;
  aftermath?: boolean;
  disputed?: boolean;
  views?: string[];
  gameplay?: string;
}

export interface QuizItem {
  id: string;
  q_bn: string;
  choices_bn: [string, string, string, string];
  answer: 0 | 1 | 2 | 3;
  explain_bn: string;
  card: string;
}

export interface Tactic {
  card: string;
  boon_bn: string;
}

export interface Boss {
  name_bn: string;
  allegiance_bn: string;
  myth_bn: string;
  breakline_bn: string;
  tactic_bn: string;
}

export interface FightSpec {
  waves: number;
  duel_bn: string;
}

export interface Chapter {
  id: number;
  slug: string;
  title_bn: string;
  years_bn: string;
  fight_bn: FightSpec | null;
  bearer_bn: { name_bn: string; role_bn: string };
  panels_bn: [string, string, string, string];
  cards: Card[];
  quiz: QuizItem[];
  boss?: Boss;
  tactics: Tactic[];
}

export interface Meta {
  title_bn: string;
  subtitle_bn: string;
  version: string;
  language: 'bn';
  span: [number, number];
  bearer_lineage_bn: string;
  sources_legend: Record<string, string>;
}

export interface ContentDoc {
  meta: Meta;
  chapters: Chapter[];
}

/** উৎসের ধরন → টিয়ার। `folk` সবচেয়ে কম ক্ষতি করে, কারণ সেটা প্রমাণ নয় (design §5)। */
export function sourceTierOf(src: string, legend: Meta['sources_legend']): SourceTier {
  const key = Object.keys(legend).find((k) => src.startsWith(k)) ?? src.split(/[:\s]/)[0];
  if (key === 'folk') return 'folk';
  if (key === 'rihla' || key === 'holwell' || key === 'baharistan' || key === 'tarapada') return 'primary';
  if (key === 'Eaton 1993' || key === 'kanungo' || key === 'marshall') return 'scholarly';
  return 'encyclopedia';
}

/** কার্ডের সবচেয়ে শক্তিশালী সূত্র — প্রহারের গুণক এখান থেকে। */
export function cardStrength(card: Card, legend: Meta['sources_legend']): SourceTier {
  const order: SourceTier[] = ['primary', 'scholarly', 'encyclopedia', 'folk'];
  let best: SourceTier = 'folk';
  for (const s of card.sources) {
    const t = sourceTierOf(s, legend);
    if (order.indexOf(t) < order.indexOf(best)) best = t;
  }
  return best;
}

/** বিতর্কিত কার্ড কম শক্তিশালী — দুটো মতই থাকলে খেলা দাবি কানে ধরে না। */
export function damageFactor(card: Card, legend: Meta['sources_legend']): number {
  const base: Record<SourceTier, number> = { primary: 1.5, scholarly: 1.25, encyclopedia: 1.0, folk: 0.6 };
  const f = base[cardStrength(card, legend)];
  return card.disputed ? Math.min(f, 1.0) * 0.85 : f;
}
