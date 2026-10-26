// Výsledky závodu: uložení rekordů a medailí, tabulka, odznaky a body do šampionátu.
import { formatTime } from './hud.js';
import { medalFor, nextMedal } from './medals.js';
import { $, G, store, audio } from './state.js';
import { trackDef, baseId, currentTrackId, cupTracks, currentCup, cupRecord, CUP_POINTS } from './trackdefs.js';

export function saveResults() {
  const race = G.race;
  const out = {};
  // medaile hráče 1: limity podle trati po směru, lepší medaile než dosud = odznak
  const def = trackDef(baseId(currentTrackId()));
  const p = race.player;
  const prevLap = store.record(G.world.def.id, p.kind).lap;
  for (const car of race.players) {
    const res = store.submit(G.world.def.id, {
      lap: car.bestLap, race: car.finished ? car.finishTime : null, laps: race.laps, mode: race.mode,
    }, car.kind);
    if (res.lap) out.lap = true;
    if (res.race) out.race = true;
  }
  const lap = store.record(G.world.def.id, p.kind).lap;
  // náhodné tratě se mění, medaile mají jen pevné tratě a denní výzva
  if (lap && (!def.random || def.daily)) {
    const before = medalFor(def, p.kind, prevLap);
    const now = medalFor(def, p.kind, lap);
    if (now && now !== before) out.medal = now;
    out.next = nextMedal(def, p.kind, lap);
  }
  return out;
}

export function showResults() {
  const race = G.race;
  const w = G.world;
  const p = race.player;
  const humans = race.players;
  const lapsTxt = `${race.laps} ${race.laps === 1 ? 'kolo' : race.laps < 5 ? 'kola' : 'kol'}`;
  const cup = G.cup;
  $('res-track').textContent = cup
    ? `Šampionát · závod ${cup.round + 1}/${cupTracks().length} · ${w.def.name}`
    : `${w.def.name} · ${lapsTxt}`;
  const rows = race.cars
    .map((c) => ({ c, t: race.estimateFinish(c) }))
    .sort((a, b) => a.t - b.t);
  const placeOf = (car) => rows.findIndex((r) => r.c === car) + 1;
  const badges = [];
  if (race.mode !== 'race') $('res-title').textContent = formatTime(p.finishTime);
  else if (humans.length === 1) {
    $('res-title').textContent = `${placeOf(p)}. místo`;
    if (placeOf(p) === 1) badges.push('Vítězství');
  } else {
    const [a, b] = humans;
    const winner = placeOf(a) < placeOf(b) ? a : b;
    $('res-title').textContent = `${winner.name} vyhrál souboj`;
    for (const c of humans) badges.push(`${c.name}: ${placeOf(c)}. místo`);
  }
  if (G.results?.lap) badges.push('Nový rekord kola');
  if (G.results?.race) badges.push('Nový rekord závodu');
  if (G.results?.medal) {
    badges.push(`<span class="medal ${G.results.medal.id}">Medaile: ${G.results.medal.name}</span>`);
    audio.say({ gold: 'Zlatá medaile', silver: 'Stříbrná medaile', bronze: 'Bronzová medaile' }[G.results.medal.id]);
  }
  if (G.results?.next) badges.push(`Na ${G.results.next.name.toLowerCase()} chybí ${G.results.next.gap.toFixed(2).replace('.', ',')} s`);
  renderCup(rows, badges);
  $('res-badges').innerHTML = badges.map((b) => `<span class="badge">${b}</span>`).join('');
  $('res-body').innerHTML = rows
    .map(({ c, t }, i) => {
      const est = !c.finished;
      const color = '#' + c.color.toString(16).padStart(6, '0');
      return `<tr class="${c.isPlayer ? 'me' : ''}"><td class="pos">${i + 1}</td>` +
        `<td><span class="chip" style="background:${color}"></span>${c.name}</td>` +
        `<td class="num ${est ? 'est' : ''}">${est ? '~' : ''}${formatTime(t)}</td>` +
        `<td class="num">${formatTime(c.bestLap)}</td></tr>`;
    })
    .join('');
  G.recording = false;
  $('replay-btn').hidden = !G.replayRec || G.replayRec.duration < 3;
  $('results').hidden = false;
  $('again-btn').focus();
}

// body do šampionátu a tabulka průběžného pořadí
function renderCup(rows, badges) {
  const cup = G.cup;
  $('cup-wrap').hidden = !cup;
  $('race-caption').hidden = !cup;
  $('res-dialog').classList.toggle('cup', !!cup);
  const again = $('again-btn');
  if (!cup) {
    again.textContent = 'Jet znovu';
    return;
  }
  const gained = {};
  rows.forEach(({ c }, i) => (gained[c.name] = CUP_POINTS[i] ?? 0));
  if (!cup.awarded) {
    for (const [name, pts] of Object.entries(gained)) cup.points[name] = (cup.points[name] || 0) + pts;
    cup.awarded = true;
    cup.colors = cup.colors || {};
    for (const { c } of rows) cup.colors[c.name] = c.color;
  }
  const last = cup.round === cupTracks().length - 1;
  const table = Object.entries(cup.points).sort((a, b) => b[1] - a[1]);
  const humanNames = G.race.players.map((c) => c.name);
  const placeOf = (name) => table.findIndex(([n]) => n === name) + 1;
  const myPlace = Math.min(...humanNames.map(placeOf));
  $('cup-caption').textContent = last ? 'Konečné pořadí šampionátu' : `Šampionát po ${cup.round + 1}. závodě`;
  $('cup-body').innerHTML = table
    .map(([name, total], i) => {
      const color = '#' + (cup.colors[name] ?? 0x888888).toString(16).padStart(6, '0');
      return `<tr class="${humanNames.includes(name) ? 'me' : ''}"><td class="pos">${i + 1}</td>` +
        `<td><span class="chip" style="background:${color}"></span>${name}</td>` +
        `<td class="num plus">+${gained[name] ?? 0}</td><td class="num">${total}</td></tr>`;
    })
    .join('');
  if (last) {
    if (humanNames.length === 1) {
      $('res-title').textContent = `Šampionát: ${myPlace}. místo`;
      if (myPlace === 1) badges.unshift(`Vítěz: ${currentCup().name}`);
      const rec = cupRecord(currentCup().id);
      if (!rec.best || myPlace < rec.best) {
        rec.best = myPlace;
        store.save();
      }
    } else {
      const best = humanNames.reduce((a, b) => (placeOf(a) < placeOf(b) ? a : b));
      $('res-title').textContent = `${best} vyhrál souboj o šampionát`;
      if (placeOf(best) === 1) badges.unshift(`${currentCup().name}: vyhrál ${best}`);
    }
    again.textContent = 'Nový šampionát';
  } else {
    const next = trackDef(cupTracks()[cup.round + 1]);
    again.textContent = `Další závod: ${next.name}`;
  }
}
