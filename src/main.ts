/**
 * src/main.ts — বুট: কনটেন্ট আনা → খেলা চালু → Service Worker (অফলাইনেও খেলা চলে)।
 */
import { Game } from './game.ts';
import { bn } from './hud.ts';
import type { ContentDoc } from './content-types.ts';

async function boot(): Promise<void> {
  const root = document.getElementById('app');
  if (!root) return;
  const fail = (msg: string): void => {
    document.getElementById('loadmsg')!.textContent = msg;
  };
  let doc: ContentDoc;
  try {
    const r = await fetch('content/chapters.json', { cache: 'force-cache' });
    if (!r.ok) throw new Error(String(r.status));
    doc = (await r.json()) as ContentDoc;
  } catch {
    fail('সামগ্রী পড়া যায়নি — বিল্ড ঠিক আছে কি না দেখো (npm run build)।');
    return;
  }
  document.getElementById('loadmsg')?.remove();
  document.getElementById('gtitle')!.textContent = doc.meta.title_bn;
  document.getElementById('gsub')!.textContent = doc.meta.subtitle_bn;
  document.documentElement.lang = doc.meta.language;
  // বিল্ড-ছাপ: 'উন্নতি দেখছি না' বললে এটা দেখেই বোঝা যাবে নতুন বিল্ড হাতে পড়েছে কি না
  const stamp = document.getElementById('buildstamp');
  if (stamp) {
    const rev = typeof __KHADGA_REV__ === 'undefined' ? null : __KHADGA_REV__;
    stamp.textContent = rev ? `সংস্করণ ${bn(rev)}` : 'সংস্করণ: বিকাশ-বিল্ড';
  }
  const game = new Game(doc, root);
  (window as unknown as { khadga: Game }).khadga = game;
  if ('serviceWorker' in navigator && location.protocol !== 'file:') {
    addEventListener('load', () => {
      // ?v= + updateViaCache:'none' — নাহলে sw.js নিজেই HTTP-ক্যাশে আটকে পুরোনো
      // সার্ভিস-ওয়ার্কারকেই ফিরািয়ে দেয়, মানে কোনো বিল্ড কখনো পৌঁছোয় না।
      const rev = typeof __KHADGA_REV__ === 'undefined' ? 'dev' : __KHADGA_REV__;
      void navigator.serviceWorker.register('sw.js?v=' + rev, { updateViaCache: 'none' })
        .then((reg) => { setInterval(() => { void reg.update(); }, 5 * 60_000); })
        .catch(() => undefined);
    });
  }
}

void boot();
