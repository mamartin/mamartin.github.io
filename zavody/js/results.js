// Výsledky závodu: uložení rekordů a medailí, tabulka, odznaky a body do šampionátu.
import { formatTime } from './hud.js';
import { medalFor, nextMedal } from './medals.js';
import { $, G, S, store, audio } from './state.js';
import { trackDef, baseId, currentTrackId, cupTracks, currentCup, cupRecord, CUP_POINTS, currentEvent } from './trackdefs.js';
import {
  goals, submitEvent, totalStars, starsHtml, UNLOCKS, unlockName, SERIES, SEASON_EVENTS, eventOpen, eventStars,
} from './season.js';

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
    // skóre série mezi hráči (počítá se jednou za závod)
    if (!race.duelCounted) {
      race.duelCounted = true;
      const wins = [...(S.duel?.wins || [0, 0])];
      wins[winner === a ? 0 : 1]++;
      S.duel = { wins };
      store.save();
    }
    const [w1, w2] = S.duel.wins;
    badges.push(`<span class="good">Série ${a.name} ${w1} : ${w2} ${b.name}</span>`);
  }
  if (G.results?.lap) badges.push('Nový rekord kola');
  if (G.results?.race) badges.push('Nový rekord závodu');
  if (G.results?.medal) {
    badges.push(`<span class="medal ${G.results.medal.id}">Medaile: ${G.results.medal.name}</span>`);
    audio.say({ gold: 'Zlatá medaile', silver: 'Stříbrná medaile', bronze: 'Bronzová medaile' }[G.results.medal.id]);
  }
  if (G.results?.next) badges.push(`Na ${G.results.next.name.toLowerCase()} chybí ${G.results.next.gap.toFixed(2).replace('.', ',')} s`);
  renderRival(rows, badges);
  renderCup(rows, badges);
  renderSeason(rows, badges);
  $('res-badges').innerHTML = badges.map((b) => `<span class="badge">${b}</span>`).join('');
  $('res-body').innerHTML = rows
    .map(({ c, t }, i) => {
      const est = !c.finished;
      const color = '#' + c.color.toString(16).padStart(6, '0');
      return `<tr class="${c.isPlayer ? 'me' : ''}"><td class="pos">${i + 1}</td>` +
        `<td><span class="chip" style="background:${color}"></span>${c.name}${c === race.rival ? ' <span class="tw-rival">rival</span>' : ''}</td>` +
        `<td class="num ${est ? 'est' : ''}">${est ? '~' : ''}${formatTime(t)}</td>` +
        `<td class="num">${formatTime(c.bestLap)}</td></tr>`;
    })
    .join('');
  G.recording = false;
  $('replay-btn').hidden = !G.replayRec || G.replayRec.duration < 3;
  // ghost nejlepšího kola jde poslat odkazem (jen pevné tratě, ty má každý)
  const gb = $('ghost-share-btn');
  gb.textContent = 'Sdílet ghost';
  gb.hidden = !(race.mode === 'time' && G.shareableTrack?.(w.def.id) && store.ghost(w.def.id, p.kind));
  // sólo tabulka ustoupí stranou, ať je vidět auto v cíli; ve dvou by zakryla pohled druhého hráče
  $('results').classList.toggle('side', race.players.length === 1);
  $('results').hidden = false;
  $('again-btn').focus();
}

// rival: výsledek souboje a kdo bude rivalem příště (kdo skončil těsně před hráčem, u vítěze za ním)
function renderRival(rows, badges) {
  const race = G.race;
  if (!race.rival) return;
  const place = (car) => rows.findIndex((r) => r.c === car);
  const mine = place(race.player);
  if (place(race.rival) > mine) badges.push(`<span class="good">Rival poražen: ${race.rival.name}</span>`);
  else badges.push(`Rival ${race.rival.name} byl před tebou`);
  S.rival = (rows[mine - 1] ?? rows[mine + 1]).c.name;
  S.rivalBeat = mine > 0;
  store.save();
}

// sezóna: vyhodnocení cílů, hvězdy, odměny a další závod
function renderSeason(rows, badges) {
  const ev = currentEvent();
  const box = $('res-goals');
  const again = $('again-btn');
  box.hidden = !ev;
  $('retry-btn').hidden = true;
  G.seasonNext = null;
  if (!ev) return;
  const race = G.race;
  const place = rows.findIndex((r) => r.c === race.player);
  const reached = [place + 1 <= ev.place, race.player.miniTurbos >= ev.drift, rows.findIndex((r) => r.c === race.rival) > place];
  const before = totalStars(store);
  const mask = reached.reduce((m, ok, i) => m | (ok ? 1 << i : 0), 0);
  const total = submitEvent(store, ev.id, mask);
  box.innerHTML = goals(ev, race.rival.name).map((g, i) => {
    const old = total & (1 << i) && !reached[i];
    return `<li class="${reached[i] ? 'ok' : old ? 'old' : ''}"><span class="goal-star">★</span>${g.text}${old ? ' <em>(splněno dřív)</em>' : ''}</li>`;
  }).join('');
  const after = totalStars(store);
  if (after > before) badges.unshift(`Hvězdy: +${after - before} · celkem ${after} ${starsHtml(eventStars(store, ev.id))}`);
  for (const u of UNLOCKS) if (u.stars > before && u.stars <= after) badges.push(`Odemčeno v garáži: ${unlockName(u)}`);
  for (const s of SERIES) if (s.need > before && s.need <= after) badges.push(`Odemčena série ${s.name}`);
  // po aspoň jedné hvězdě nabídne další závod, když je otevřený
  const next = SEASON_EVENTS[SEASON_EVENTS.indexOf(ev) + 1];
  if (next && eventStars(store, ev.id) > 0 && eventOpen(store, next)) {
    G.seasonNext = next.id;
    again.textContent = `Další závod: ${trackDef(next.track).name}`;
    $('retry-btn').hidden = false;
  }
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
