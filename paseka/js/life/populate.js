// Výchozí podoba ostrova: zbytek živého lesa, holina se soušemi a pařezy, louka a skalka.
import { RNG } from '../core/rng.js';

export function populate(board, flora, seed = 3) {
  const rng = new RNG(seed);
  const put = (tile, id, opts = {}) => flora.place(board, tile, id, { grown: true, ...opts });
  const repeat = (n, fn) => { for (let i = 0; i < n; i++) fn(); };

  for (const t of board.tiles) {
    switch (t.type) {
      case 'les':
        repeat(rng.int(2, 3), () => put(t, rng.chance(0.58) ? 'smrk' : rng.chance(0.7) ? 'buk' : 'briza'));
        if (rng.chance(0.6)) repeat(rng.int(1, 2), () => put(t, 'kapradi'));
        if (rng.chance(0.4)) put(t, 'muchomurka');
        break;
      case 'paseka':
        if (rng.chance(0.7)) repeat(rng.int(1, 2), () => put(t, 'sous'));
        if (rng.chance(0.65)) repeat(rng.int(1, 2), () => put(t, 'parez'));
        repeat(rng.int(0, 3), () => put(t, 'vrbovka'));
        if (rng.chance(0.18)) put(t, 'briza', { scale: rng.range(0.45, 0.7) });
        if (rng.chance(0.08)) put(t, 'jerab', { scale: rng.range(0.5, 0.75) });
        break;
      case 'louka':
        if (rng.chance(0.12)) put(t, 'vrbovka');
        if (rng.chance(0.05)) put(t, 'briza');
        if (rng.chance(0.05)) put(t, 'jerab');
        if (rng.chance(0.06)) put(t, 'kamen');
        break;
      case 'skala':
        repeat(rng.int(2, 4), () => put(t, 'kamen'));
        if (rng.chance(0.3)) put(t, 'smrk', { scale: rng.range(0.6, 0.9) });
        if (rng.chance(0.25)) put(t, 'kapradi');
        break;
    }
  }
}
