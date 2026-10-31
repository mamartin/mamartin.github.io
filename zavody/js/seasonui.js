// Sezóna v menu: seznam sérií a závodů, cíle vybraného závodu, hvězdy a další odměna.
import { $, S, store } from './state.js';
import { trackDef } from './trackdefs.js';
import { DIFFICULTY } from './ai.js';
import { playerNames } from './players.js';
import {
  SERIES, UNLOCKS, unlockName, seasonEvent, goals, totalStars, seriesOpen, eventMask, eventStars, starsHtml,
} from './season.js';

export function renderSeasonMenu(onPick) {
  const stars = totalStars(store);
  const next = UNLOCKS.find((u) => u.stars > stars);
  $('season-total').innerHTML = `<b>★ ${stars}</b> z 36${next ? ` · další odměna za ${next.stars}: ${unlockName(next)}` : ' · máš všechny odměny'}`;
  const chosen = seasonEvent(S.seasonEvent);
  const box = $('season-list');
  box.innerHTML = '';
  for (const series of SERIES) {
    const open = seriesOpen(store, series);
    const wrap = document.createElement('div');
    wrap.className = 'season-series';
    wrap.innerHTML = `<h2 class="label"><span>${series.name}</span>${open ? '' : `<span>★ ${series.need} otevře sérii</span>`}</h2>`;
    for (const ev of series.events) {
      const b = document.createElement('button');
      b.type = 'button';
      b.className = 'season-event';
      b.setAttribute('role', 'radio');
      b.setAttribute('aria-checked', String(ev === chosen));
      b.disabled = !open;
      const def = trackDef(ev.track);
      const rival = playerNames().includes(ev.rival) ? 'nejsilnější soupeř' : ev.rival;
      const mask = eventMask(store, ev.id);
      const goalList = ev === chosen
        ? `<ul class="se-goals">${goals(ev, rival).map((g, i) => `<li class="${mask & (1 << i) ? 'ok' : ''}">★ ${g.text}</li>`).join('')}</ul>`
        : '';
      b.innerHTML = `<span class="se-name">${def.name}</span>${starsHtml(eventStars(store, ev.id))}`
        + `<span class="se-meta">${ev.laps} ${ev.laps < 5 ? 'kola' : 'kol'} · ${DIFFICULTY[ev.difficulty].label}${ev.rain ? ' · déšť' : ''}${ev.weapons === false ? ' · bez power-upů' : ''}</span>${goalList}`;
      b.addEventListener('click', () => onPick(ev.id));
      wrap.appendChild(b);
    }
    box.appendChild(wrap);
  }
}
