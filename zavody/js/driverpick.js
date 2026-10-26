// Výběr jezdce: tlačítko s rozbalovacím seznamem jezdců F1 po týmech a polem pro vlastní jméno.
import { F1_TEAMS } from './race.js';
import { S, store } from './state.js';
import { humanCount } from './players.js';

// výběr jezdce: tlačítko s rozbalovacím seznamem jezdců F1 po týmech (místo systémového selectu)
export function bindDriverPick(root, noneLabel, onChange) {
  const key = root.dataset.key;
  const btn = root.querySelector('.pick');
  const pop = root.querySelector('.pick-pop');
  const option = (name, label) => {
    const b = document.createElement('button');
    b.type = 'button';
    b.className = 'pick-opt';
    b.setAttribute('role', 'option');
    b.dataset.name = name;
    b.textContent = label;
    b.addEventListener('click', () => {
      S[key] = name;
      store.save();
      close(true);
      onChange();
    });
    pop.appendChild(b);
  };
  // vlastní jméno: krátký text bez znaků, které by šly do HTML výsledků
  const form = document.createElement('form');
  form.className = 'pick-custom';
  form.innerHTML = '<input type="text" maxlength="18" placeholder="Vlastní jméno" aria-label="Vlastní jméno" autocomplete="off" spellcheck="false"><button type="submit">OK</button>';
  const input = form.querySelector('input');
  form.addEventListener('submit', (e) => {
    e.preventDefault();
    const name = input.value.replace(/[<>&"]/g, '').replace(/\s+/g, ' ').trim();
    if (!name) return;
    S[key] = name;
    store.save();
    close(true);
    onChange();
  });
  pop.appendChild(form);
  option('', noneLabel);
  for (const t of F1_TEAMS) {
    const h = document.createElement('div');
    h.className = 'pick-team-head';
    h.textContent = t.team;
    pop.appendChild(h);
    for (const d of t.drivers) option(d, d);
  }
  const options = () => [...pop.querySelectorAll('.pick-opt:not(:disabled)')];
  const close = (focus) => {
    if (pop.hidden) return;
    pop.hidden = true;
    btn.setAttribute('aria-expanded', 'false');
    document.removeEventListener('pointerdown', outside, true);
    if (focus) btn.focus();
  };
  const outside = (e) => {
    if (!root.contains(e.target)) close(false);
  };
  btn.addEventListener('click', () => {
    if (!pop.hidden) return close(true);
    // otevřít nahoru, když pod tlačítkem není místo
    const r = btn.getBoundingClientRect();
    root.classList.toggle('up', innerHeight - r.bottom < 330 && r.top > innerHeight - r.bottom);
    pop.hidden = false;
    btn.setAttribute('aria-expanded', 'true');
    document.addEventListener('pointerdown', outside, true);
    const cur = pop.querySelector('.pick-opt[aria-selected="true"]') || (input.value ? input : options()[0]);
    cur.scrollIntoView({ block: 'center' });
    cur.focus();
  });
  pop.addEventListener('keydown', (e) => {
    const list = options();
    const i = list.indexOf(document.activeElement);
    if (document.activeElement === input && e.key !== 'ArrowDown' && e.key !== 'Escape') return;
    if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
      e.preventDefault();
      const next = list[Math.max(0, Math.min(list.length - 1, i + (e.key === 'ArrowDown' ? 1 : -1)))];
      next.focus();
      next.scrollIntoView({ block: 'nearest' });
    } else if (e.key === 'Escape') {
      e.stopPropagation();
      close(true);
    } else if (e.key === 'Tab') close(false);
  });
}

export function refreshDriverPick(root, name, other) {
  const team = F1_TEAMS.find((t) => t.drivers.includes(name));
  const input = root.querySelector('.pick-custom input');
  if (document.activeElement !== input) input.value = name && !team ? name : '';
  root.querySelector('.pick-name').textContent = name || root.querySelector('.pick-opt').textContent;
  root.querySelector('.pick-team').textContent = team ? team.team : '';
  for (const b of root.querySelectorAll('.pick-opt')) {
    b.setAttribute('aria-selected', String(b.dataset.name === name));
    // jméno, které má druhý hráč, nejde vybrat
    b.disabled = !!b.dataset.name && b.dataset.name === other && humanCount() === 2;
  }
}
