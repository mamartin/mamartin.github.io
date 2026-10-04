// Roční období jako palety. Scéna mezi nimi plynule prolíná podle spojitého
// času `season` (0 = jaro, 1 = léto, 2 = podzim, 3 = zima, 4 = zase jaro).
// Nové období nebo biom = nová paleta se stejnými klíči.
import * as THREE from 'three';

export const SEASONS = [
  {
    id: 'jaro',
    name: 'Jaro',
    colors: {
      meadow: '#86b85a', forest: '#5d7f3e', clearing: '#8e8256', rock: '#8a9078', bed: '#7d6d50',
      soil: '#6b4a32', clay: '#9a7452', stone: '#6d6862',
      grass: '#9ad462', spruce: '#2f5d3c', beech: '#a4d86a', birch: '#c4e47c', rowan: '#8cc761',
      fern: '#7bbf55', herb: '#6fa64f', fireweed: '#7fb257', berry: '#8cc761', mushroom: '#b8452f',
      water: '#4a9bb0', sky: '#ffffff',
    },
    amounts: {
      leaves: 0.75, herbs: 0.6, flowers: 0, fern: 0.8, berries: 0, mushrooms: 0, grass: 0.8,
      snow: 0, ice: 0, wind: 0.8, fireflies: 0.3, pollen: 1, falling: 0, snowfall: 0,
    },
  },
  {
    id: 'leto',
    name: 'Léto',
    colors: {
      meadow: '#79ad4a', forest: '#4c7234', clearing: '#9a8a52', rock: '#878f72', bed: '#7a6a4c',
      soil: '#6b4a32', clay: '#9a7452', stone: '#6d6862',
      grass: '#88c44c', spruce: '#2a5436', beech: '#62a03e', birch: '#7cb24c', rowan: '#5a9a3a',
      fern: '#5a9a3e', herb: '#5d8f40', fireweed: '#e0559a', berry: '#ea7a2a', mushroom: '#c43d28',
      water: '#3f93a8', sky: '#ffffff',
    },
    amounts: {
      leaves: 1, herbs: 1, flowers: 1, fern: 1, berries: 0.6, mushrooms: 0.15, grass: 1,
      snow: 0, ice: 0, wind: 1, fireflies: 1, pollen: 0.6, falling: 0, snowfall: 0,
    },
  },
  {
    id: 'podzim',
    name: 'Podzim',
    colors: {
      meadow: '#a3a259', forest: '#7a6436', clearing: '#a08250', rock: '#8f8a74', bed: '#76664a',
      soil: '#664530', clay: '#94704e', stone: '#6a655e',
      grass: '#bdb264', spruce: '#2c5236', beech: '#dc842b', birch: '#f2c42e', rowan: '#d4452b',
      fern: '#bb873c', herb: '#9a5a3a', fireweed: '#ebe1d4', berry: '#e3262a', mushroom: '#d63a22',
      water: '#3f7f96', sky: '#ffe8cf',
    },
    amounts: {
      leaves: 0.9, herbs: 0.85, flowers: 0.8, fern: 0.9, berries: 1, mushrooms: 1, grass: 0.85,
      snow: 0, ice: 0, wind: 1.35, fireflies: 0.1, pollen: 0, falling: 1, snowfall: 0,
    },
  },
  {
    id: 'zima',
    name: 'Zima',
    colors: {
      meadow: '#c9d3d6', forest: '#8d9188', clearing: '#a49c8c', rock: '#8a8a8a', bed: '#8a8274',
      soil: '#5e4232', clay: '#8a6c52', stone: '#66625e',
      grass: '#b0ad8c', spruce: '#284838', beech: '#8a6a4a', birch: '#8a6a4a', rowan: '#8a6a4a',
      fern: '#8a6a40', herb: '#8a6a4a', fireweed: '#ddd6cc', berry: '#c41f2a', mushroom: '#b8452f',
      water: '#b4d2de', sky: '#dfe9ff',
    },
    amounts: {
      leaves: 0, herbs: 0, flowers: 0, fern: 0, berries: 0.55, mushrooms: 0, grass: 0.4,
      snow: 1, ice: 1, wind: 0.7, fireflies: 0, pollen: 0, falling: 0, snowfall: 1,
    },
  },
];

// Předpočítané barvy (lineární prostor) pro rychlé prolínání.
const COMPILED = SEASONS.map((s) => ({
  colors: Object.fromEntries(Object.entries(s.colors).map(([k, v]) => [k, new THREE.Color(v)])),
  amounts: s.amounts,
}));

const smooth = (t) => t * t * (3 - 2 * t);

// Paleta pro spojitý čas sezóny. Objekty se recyklují, aby se nealokovalo v každém snímku.
export class SeasonPalette {
  constructor() {
    this.colors = Object.fromEntries(Object.keys(SEASONS[0].colors).map((k) => [k, new THREE.Color()]));
    this.amounts = { ...SEASONS[0].amounts };
    this.value = -1;
  }

  set(value) {
    const v = ((value % 4) + 4) % 4;
    if (v === this.value) return false;
    this.value = v;
    const i = Math.floor(v);
    const t = smooth(v - i);
    const a = COMPILED[i], b = COMPILED[(i + 1) % 4];
    for (const k in this.colors) this.colors[k].lerpColors(a.colors[k], b.colors[k], t);
    for (const k in this.amounts) this.amounts[k] = a.amounts[k] + (b.amounts[k] - a.amounts[k]) * t;
    return true;
  }
}
