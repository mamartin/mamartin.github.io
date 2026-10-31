// Vizuální a jízdní parametry prostředí.
export const BIOMES = {
  forest: {
    name: 'Les',
    sky: { top: '#2f6fc4', horizon: '#c3d9e6', bottom: '#8fa3a6', glow: 0.55 },
    sunDir: [0.42, 0.62, 0.38],
    sun: { color: '#fff0d4', intensity: 2.7 },
    hemi: { sky: '#d2e4ff', ground: '#46552f', intensity: 1.25 },
    fog: { color: '#bcd2df', near: 160, far: 1150 },
    exposure: 1.0,
    night: false,
    clouds: '#ffffff',
    cloudCover: 0.52,
    bloom: { strength: 0.35, threshold: 2.6 },
    terrain: { groundA: '#4f7d37', groundB: '#33592a', groundC: '#86a049', rock: '#7d7b72', nearTrack: '#5d7b3b', shore: '#b5a77c' },
    track: {
      asphalt: '#3c3f45', curbA: '#d3302a', curbB: '#f1f0ea',
      shoulderA: '#5a8238', shoulderB: '#537b34',
      barrier: 'rail', barrierA: '#bcc1c7', barrierB: '#b1b7be', barrierTop: '#d2d6da', postColor: '#7e848c',
      gantry: '#1f2b45', bannerBg: '#10223f',
    },
    offGrip: 0.62,
    offDrag: 3.2,
    dust: [0.42, 0.36, 0.25],
  },
  canyon: {
    name: 'Kaňon',
    sky: { top: '#27346f', horizon: '#f79a5c', bottom: '#8a4b36', glow: 1.3 },
    sunDir: [-0.62, 0.16, -0.45],
    sun: { color: '#ffb57a', intensity: 3.0 },
    hemi: { sky: '#ffcba6', ground: '#7a3f2a', intensity: 1.1 },
    fog: { color: '#d8916a', near: 200, far: 1400 },
    exposure: 1.02,
    night: false,
    clouds: '#ffc4a0',
    cloudCover: 0.6,
    bloom: { strength: 0.45, threshold: 2.4 },
    terrain: { groundA: '#d49b5f', groundB: '#b0552f', groundC: '#e3b980', rock: '#8a3a22', nearTrack: '#caa06c' },
    track: {
      asphalt: '#46413e', curbA: '#c8321f', curbB: '#f3eee4',
      shoulderA: '#cf9d63', shoulderB: '#c69359',
      barrier: 'block', barrierA: '#c73a2b', barrierB: '#efe8dd', barrierTop: '#d9d2c7',
      gantry: '#3a2a22', bannerBg: '#3b1a12',
    },
    offGrip: 0.55,
    offDrag: 3.6,
    dust: [0.78, 0.55, 0.36],
  },
  winter: {
    name: 'Zima',
    sky: { top: '#6a8cb8', horizon: '#e2eaf1', bottom: '#b7c4d1', glow: 0.5 },
    sunDir: [0.5, 0.33, 0.62],
    sun: { color: '#fff3e2', intensity: 2.3 },
    hemi: { sky: '#e8f0ff', ground: '#98a4b3', intensity: 1.3 },
    fog: { color: '#d8e2eb', near: 110, far: 900 },
    exposure: 0.92,
    night: false,
    clouds: '#f4f7fb',
    cloudCover: 0.45,
    snow: true,
    bloom: { strength: 0.3, threshold: 2.8 },
    terrain: { groundA: '#eef3f8', groundB: '#d5dfea', groundC: '#ffffff', rock: '#5d6570', nearTrack: '#e1e8f0' },
    track: {
      asphalt: '#393d44', curbA: '#d3302a', curbB: '#f1f0ea',
      shoulderA: '#e6ecf3', shoulderB: '#dde5ee',
      barrier: 'rail', barrierA: '#bcc1c7', barrierB: '#b1b7be', barrierTop: '#e8edf2', postColor: '#6d737b',
      gantry: '#1f2b45', bannerBg: '#10223f',
    },
    roadGrip: 0.9,
    offGrip: 0.48,
    offDrag: 3.8,
    dust: [0.93, 0.96, 1.0],
  },
  city: {
    name: 'Město',
    sky: { top: '#03060f', horizon: '#1b2848', bottom: '#080b15', glow: 0.25 },
    sunDir: [0.3, 0.55, -0.55],
    sun: { color: '#8fa6ff', intensity: 0.55 },
    hemi: { sky: '#3a4a78', ground: '#15151c', intensity: 0.75 },
    fog: { color: '#0e1528', near: 110, far: 700 },
    exposure: 1.15,
    night: true,
    bloom: { strength: 0.7, threshold: 1.15 },
    terrain: { groundA: '#2a2c31', groundB: '#212328', groundC: '#2a2c31', rock: '#2a2c31', nearTrack: '#34363b', flat: false },
    track: {
      asphalt: '#303237', curbA: '#d7d7d2', curbB: '#b8302a', centerLine: '#d9c04a', lineColor: '#dedbd0',
      shoulderA: '#6e7074', shoulderB: '#67696d',
      barrier: 'wall', barrierA: '#8d9095', barrierB: '#80838a', barrierTop: '#e0bf3c', barrierPeriod: 5,
      gantry: '#1a1d26', bannerBg: '#0b0f1c',
    },
    offGrip: 0.8,
    offDrag: 1.6,
    dust: [0.35, 0.35, 0.38],
  },
};

// déšť: zatažená obloha, bližší šedá mlha, slabé slunce, tmavší mokrý asfalt a menší přilnavost
const mixHex = (a, b, t) => {
  const pa = parseInt(a.slice(1), 16), pb = parseInt(b.slice(1), 16);
  const ch = (sh) => Math.round(((pa >> sh) & 255) * (1 - t) + ((pb >> sh) & 255) * t);
  return '#' + ((ch(16) << 16) | (ch(8) << 8) | ch(0)).toString(16).padStart(6, '0');
};

export const WET_GRIP = 0.82;
export const SNOW_GRIP = 0.84;

// sněžení: zatažená bílošedá obloha bez slunce, hustý sníh a blízká mlha, zasněžená silnice
export function snowBiome(b) {
  return {
    ...b,
    snowfall: true,
    sky: { top: '#8794a3', horizon: '#d2d9e0', bottom: '#b4bec8', glow: 0.12 },
    sun: { ...b.sun, intensity: b.sun.intensity * 0.35 },
    hemi: { ...b.hemi, intensity: b.hemi.intensity * 1.05 },
    fog: { color: '#cdd5dd', near: 35, far: 340 },
    exposure: b.exposure * 0.97,
    clouds: '#c4ccd5',
    cloudCover: 0.12,
    roadGrip: (b.roadGrip ?? 1) * SNOW_GRIP,
    offGrip: (b.offGrip ?? 0.6) * 0.9,
    track: { ...b.track, asphalt: mixHex(b.track.asphalt, '#6b737d', 0.35), snowy: true },
  };
}

export function wetBiome(b) {
  // v noci míříme k tmavým šedým, aby se obloha nerozsvítila
  const grey = b.night
    ? { top: '#1a1e24', horizon: '#2c3239', bottom: '#1e2226', fog: '#242a30', clouds: '#3a4048' }
    : { top: '#5d6670', horizon: '#8f979e', bottom: '#5b6166', fog: '#8a9298', clouds: '#9aa1a8' };
  return {
    ...b,
    wet: true,
    sky: { top: mixHex(b.sky.top, grey.top, 0.65), horizon: mixHex(b.sky.horizon, grey.horizon, 0.6), bottom: mixHex(b.sky.bottom, grey.bottom, 0.5), glow: b.sky.glow * 0.25 },
    sun: { ...b.sun, intensity: b.sun.intensity * 0.4 },
    hemi: { ...b.hemi, intensity: b.hemi.intensity * 0.9 },
    fog: { color: mixHex(b.fog.color, grey.fog, 0.6), near: b.fog.near * 0.45, far: b.fog.far * 0.55 },
    exposure: b.exposure * 0.92,
    clouds: b.clouds && mixHex(b.clouds, grey.clouds, 0.6),
    cloudCover: 0.2,
    roadGrip: (b.roadGrip ?? 1) * WET_GRIP,
    offGrip: (b.offGrip ?? 0.6) * 0.85,
    track: { ...b.track, asphalt: mixHex(b.track.asphalt, '#1c1e22', 0.45), wet: true },
  };
}
