// Nastavení, rekordy a ghost jízdy v localStorage (vše obalené try/catch).
const KEY = 'turbo-okruh-v1';
const GHOST_KEY = 'turbo-okruh-ghost-';

const DEFAULTS = {
  mode: 'race',
  track: 'sumava',
  laps: 3,
  difficulty: 'medium',
  color: 0,
  quality: null,
  sound: true,
  weapons: true,
  randomSeed: 20260930,
  camera: 'chase',
};

function read(key) {
  try {
    const v = localStorage.getItem(key);
    return v ? JSON.parse(v) : null;
  } catch {
    return null;
  }
}

function write(key, value) {
  try {
    localStorage.setItem(key, JSON.stringify(value));
    return true;
  } catch {
    return false;
  }
}

export class Store {
  constructor() {
    const data = read(KEY) || {};
    this.settings = { ...DEFAULTS, ...(data.settings || {}) };
    this.records = data.records || {};
    this.custom = Array.isArray(data.custom) ? data.custom : [];
  }

  save() {
    return write(KEY, { settings: this.settings, records: this.records, custom: this.custom });
  }

  // vlastní tratě z editoru
  getCustom(id) {
    return this.custom.find((t) => t.id === id) || null;
  }

  saveCustom(track) {
    const i = this.custom.findIndex((t) => t.id === track.id);
    if (i >= 0) this.custom[i] = track;
    else this.custom.push(track);
    return this.save();
  }

  deleteCustom(id) {
    this.custom = this.custom.filter((t) => t.id !== id);
    delete this.records[id];
    try {
      localStorage.removeItem(GHOST_KEY + id);
    } catch {
      /* nic */
    }
    this.save();
  }

  record(trackId) {
    return this.records[trackId] || {};
  }

  // vrací, co se zlepšilo
  submit(trackId, { lap, race, laps, mode }) {
    const r = (this.records[trackId] = this.records[trackId] || {});
    const out = {};
    if (lap && isFinite(lap) && (!r.lap || lap < r.lap)) {
      r.lap = lap;
      out.lap = true;
    }
    if (race && mode === 'race') {
      r.race = r.race || {};
      if (!r.race[laps] || race < r.race[laps]) {
        r.race[laps] = race;
        out.race = true;
      }
    }
    this.save();
    return out;
  }

  ghost(trackId) {
    return read(GHOST_KEY + trackId);
  }

  saveGhost(trackId, ghost) {
    return write(GHOST_KEY + trackId, ghost);
  }
}
