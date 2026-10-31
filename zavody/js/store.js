// Nastavení, rekordy a ghost jízdy v localStorage (vše obalené try/catch).
const KEY = 'turbo-okruh-v1';
const GHOST_KEY = 'turbo-okruh-ghost-';

const DEFAULTS = {
  bunStain: 0, // hráč (1 nebo 2), kterému bába pošpinila auto
  mode: 'race',
  track: 'sumava',
  laps: 3,
  difficulty: 'medium',
  color: 0,
  vehicle: 'car',
  quality: null,
  sound: true,
  music: true,
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

// rekordy a ghost zvlášť pro každý typ vozu; auto má původní klíč (starší uložení)
const recordKey = (trackId, kind) => (kind && kind !== 'car' ? `${trackId}@${kind}` : trackId);

export class Store {
  constructor() {
    const data = read(KEY) || {};
    this.settings = { ...DEFAULTS, ...(data.settings || {}) };
    this.records = data.records || {};
    this.custom = Array.isArray(data.custom) ? data.custom : [];
    this.season = data.season || {};
  }

  save() {
    return write(KEY, { settings: this.settings, records: this.records, custom: this.custom, season: this.season });
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

  record(trackId, kind = 'car') {
    return this.records[recordKey(trackId, kind)] || {};
  }

  // vrací, co se zlepšilo
  submit(trackId, { lap, race, laps, mode }, kind = 'car') {
    const key = recordKey(trackId, kind);
    const r = (this.records[key] = this.records[key] || {});
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

  // nejlepší časy sektorů; vrací předchozí nejlepší (pro rozdíl) a zda se zlepšil
  submitSector(trackId, kind, index, time) {
    const key = recordKey(trackId, kind);
    const r = (this.records[key] = this.records[key] || {});
    r.sectors = r.sectors || [];
    const prev = r.sectors[index] ?? null;
    const better = prev == null || time < prev;
    if (better) {
      r.sectors[index] = time;
      this.save();
    }
    return { prev, better };
  }

  ghost(trackId, kind = 'car') {
    return read(GHOST_KEY + recordKey(trackId, kind));
  }

  saveGhost(trackId, ghost, kind = 'car') {
    return write(GHOST_KEY + recordKey(trackId, kind), ghost);
  }
}
