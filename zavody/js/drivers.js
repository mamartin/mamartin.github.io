// Stálá výkonnost a povaha jezdců. pace = −1 až 1, násobí rozptyl výkonnosti obtížnosti, takže
// hlavní měřítko zůstává obtížnost; aggr = 0–1 důraz v soubojích; errors = násobek chyb.
export const DRIVERS = {
  'Max Verstappen': { pace: 1, aggr: 1, errors: 0.6 },
  'Charles Leclerc': { pace: 0.7, aggr: 0.7, errors: 1 },
  'Lando Norris': { pace: 0.7, aggr: 0.5, errors: 0.8 },
  'Oscar Piastri': { pace: 0.65, aggr: 0.6, errors: 0.6 },
  'George Russell': { pace: 0.55, aggr: 0.6, errors: 0.8 },
  'Lewis Hamilton': { pace: 0.5, aggr: 0.6, errors: 0.6 },
  'Fernando Alonso': { pace: 0.4, aggr: 0.9, errors: 0.5 },
  'Kimi Antonelli': { pace: 0.25, aggr: 0.7, errors: 1.5 },
  'Carlos Sainz': { pace: 0.2, aggr: 0.5, errors: 0.7 },
  'Alex Albon': { pace: 0, aggr: 0.4, errors: 0.8 },
  'Isack Hadjar': { pace: 0, aggr: 0.8, errors: 1.3 },
  'Nico Hülkenberg': { pace: -0.1, aggr: 0.5, errors: 0.7 },
  'Pierre Gasly': { pace: -0.1, aggr: 0.5, errors: 0.9 },
  'Esteban Ocon': { pace: -0.2, aggr: 0.9, errors: 1 },
  'Oliver Bearman': { pace: -0.25, aggr: 0.7, errors: 1.3 },
  'Gabriel Bortoleto': { pace: -0.3, aggr: 0.5, errors: 1.1 },
  'Liam Lawson': { pace: -0.35, aggr: 0.9, errors: 1.3 },
  'Arvid Lindblad': { pace: -0.45, aggr: 0.8, errors: 1.6 },
  'Sergio Pérez': { pace: -0.45, aggr: 0.6, errors: 1.2 },
  'Valtteri Bottas': { pace: -0.55, aggr: 0.3, errors: 0.8 },
  'Franco Colapinto': { pace: -0.7, aggr: 0.8, errors: 1.7 },
  'Lance Stroll': { pace: -0.85, aggr: 0.6, errors: 1.8 },
};

// stejné jméno = stejný číselný základ (stopa a rytmus jezdce)
export function nameSeed(name) {
  let h = 2166136261;
  for (let i = 0; i < name.length; i++) h = Math.imul(h ^ name.charCodeAt(i), 16777619);
  return (h >>> 0) % 1000003;
}

// nejsilnější jezdec ze seznamu jmen
export const strongest = (names) => names.reduce((a, b) => ((DRIVERS[b]?.pace ?? -9) > (DRIVERS[a]?.pace ?? -9) ? b : a), names[0]);

// krátký popis povahy pro kartu rivala
export function driverTrait(name) {
  const d = DRIVERS[name];
  if (!d) return '';
  const speed = d.pace >= 0.4 ? 'rychlý' : d.pace <= -0.4 ? 'pomalejší' : 'vyrovnaný';
  const style = d.errors >= 1.3 ? 'chybuje' : d.aggr >= 0.8 ? 'agresivní' : d.errors <= 0.6 ? 'spolehlivý' : d.aggr <= 0.4 ? 'opatrný' : 'čistý';
  return style === 'chybuje' ? `${speed}, ale chybuje` : `${speed} a ${style}`;
}
