// Sdílený ghost odkazem #g=... v prohlížeči:
// 1) jméno v odkazu s HTML se nesmí v časovce provést (dřív šlo přes HUD do innerHTML),
// 2) odkaz bez času kola se odmítne (dřív se uložil ghost s časem NaN, v menu „kolo –“),
// 3) platný odkaz na obrácenou trať vybere časovku obráceně.
// Spuštění: node test/systems-ghostshare.mjs
import { openGame, checker, skipUnderNodeTest } from './systems-harness.mjs';

skipUnderNodeTest();
const t = checker('ghostshare');

const frames = [];
for (let i = 0; i < 200; i++) frames.push(i * 2, 0.5, 0, 0);
const enc = async (head) => {
  const { encodeGhost } = await import('../js/ghostshare.js');
  const code = await encodeGhost('sumava', 'car', 'x', { time: 40, rate: 20, frames });
  return `${Buffer.from(JSON.stringify(head)).toString('base64url')}.${code.split('.')[1]}`;
};

// 1) HTML ve jméně
{
  const code = await enc({ t: 'sumava', k: 'car', n: '<img src=x onerror="window.__xss=1">', ms: 30000, r: 20 });
  const { page, close } = await openGame({ hash: `#g=${code}` });
  const note = await page.textContent('#menu-note');
  await page.evaluate(() => window.__game.start({ mode: 'time' }));
  await page.waitForTimeout(1500);
  const r = await page.evaluate(() => ({ xss: window.__xss === 1, sub: document.querySelector('.sub-msg')?.textContent, img: !!document.querySelector('#hud img') }));
  t.ok(!r.xss && !r.img, `jméno z odkazu se v HUD neprovede jako HTML (HUD: „${r.sub}“, menu: „${note}“)`);
  await close();
}

// 2) odkaz bez času kola
{
  const code = await enc({ t: 'sumava', k: 'car', n: 'Bez času', r: 20 });
  const { page, close } = await openGame({ hash: `#g=${code}` });
  const note = await page.textContent('#menu-note');
  const stored = await page.evaluate(() => !!localStorage.getItem('turbo-okruh-sghost-sumava'));
  t.ok(/nepodařilo přečíst/.test(note) && !stored, `odkaz bez času kola se odmítne: „${note}“`);
  await close();
}

// 3) obrácený směr
{
  const { encodeGhost } = await import('../js/ghostshare.js');
  const code = await encodeGhost('kanon~r', 'car', 'Obráceně', { time: 50, rate: 20, frames });
  const { page, close } = await openGame({ hash: `#g=${code}` });
  const r = await page.evaluate(() => {
    const S = window.__game.store.settings;
    return { track: S.track, reverse: S.reverse, mode: S.mode, stored: !!localStorage.getItem('turbo-okruh-sghost-kanon~r') };
  });
  t.ok(r.track === 'kanon' && r.reverse === true && r.mode === 'time' && r.stored, `ghost pro obrácenou trať: ${JSON.stringify(r)}`);
  await close();
}
t.done();
