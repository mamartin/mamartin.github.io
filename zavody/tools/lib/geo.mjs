// Přepočty souřadnic pro nástroje trati: WGS84 -> S-JTSK (Křovák, EPSG:5514) a lokální metry.
// Přesnost posunu mezi datumy je zhruba 1 m, pro výškopis a trať to stačí.

const RAD = Math.PI / 180;

// parametry Besselova elipsoidu a Křovákova zobrazení (EPSG metoda 9819)
const A_BES = 6377397.155;
const F_BES = 1 / 299.1528128;
const E2_BES = 2 * F_BES - F_BES * F_BES;
const E_BES = Math.sqrt(E2_BES);
const PHI_C = 49.5 * RAD;
const LAM_0 = (24 + 50 / 60) * RAD;
const ALPHA_C = 30.28813975277778 * RAD;
const PHI_P = 78.5 * RAD;
const K_P = 0.9999;

const A_K = (A_BES * Math.sqrt(1 - E2_BES)) / (1 - E2_BES * Math.sin(PHI_C) ** 2);
const B_K = Math.sqrt(1 + (E2_BES * Math.cos(PHI_C) ** 4) / (1 - E2_BES));
const GAMMA_0 = Math.asin(Math.sin(PHI_C) / B_K);
const ecc = (phi) => ((1 + E_BES * Math.sin(phi)) / (1 - E_BES * Math.sin(phi))) ** ((E_BES * B_K) / 2);
const T_0 = (Math.tan(Math.PI / 4 + GAMMA_0 / 2) * ecc(PHI_C)) / Math.tan(Math.PI / 4 + PHI_C / 2) ** B_K;
const N_K = Math.sin(PHI_P);
const R_0 = (K_P * A_K) / Math.tan(PHI_P);

// S-JTSK -> WGS84 (towgs84 proj4), tady se používá obráceně
const TX = 570.8, TY = 85.7, TZ = 462.8;
const RX = (4.998 / 3600) * RAD, RY = (1.587 / 3600) * RAD, RZ = (5.261 / 3600) * RAD;
const SC = 1 + 3.56e-6;

const A_WGS = 6378137;
const F_WGS = 1 / 298.257223563;
const E2_WGS = 2 * F_WGS - F_WGS * F_WGS;

function toEcef(lat, lon, a, e2) {
  const s = Math.sin(lat);
  const n = a / Math.sqrt(1 - e2 * s * s);
  return [n * Math.cos(lat) * Math.cos(lon), n * Math.cos(lat) * Math.sin(lon), n * (1 - e2) * s];
}

function fromEcef(x, y, z, a, e2) {
  const p = Math.hypot(x, y);
  let lat = Math.atan2(z, p * (1 - e2));
  for (let i = 0; i < 6; i++) {
    const s = Math.sin(lat);
    const n = a / Math.sqrt(1 - e2 * s * s);
    lat = Math.atan2(z + e2 * n * s, p);
  }
  return [lat, Math.atan2(y, x)];
}

// vrací [easting, northing] v EPSG:5514 (obě záporné)
export function wgsToKrovak(latDeg, lonDeg) {
  const [xw, yw, zw] = toEcef(latDeg * RAD, lonDeg * RAD, A_WGS, E2_WGS);
  const dx = (xw - TX) / SC, dy = (yw - TY) / SC, dz = (zw - TZ) / SC;
  const xb = dx + RZ * dy - RY * dz;
  const yb = -RZ * dx + dy + RX * dz;
  const zb = RY * dx - RX * dy + dz;
  const [phi, lam] = fromEcef(xb, yb, zb, A_BES, E2_BES);

  const U = 2 * (Math.atan((T_0 * Math.tan(phi / 2 + Math.PI / 4) ** B_K) / ecc(phi)) - Math.PI / 4);
  const V = B_K * (LAM_0 - lam);
  const T = Math.asin(Math.cos(ALPHA_C) * Math.sin(U) + Math.sin(ALPHA_C) * Math.cos(U) * Math.cos(V));
  const D = Math.asin((Math.cos(U) * Math.sin(V)) / Math.cos(T));
  const theta = N_K * D;
  const r = (R_0 * Math.tan(Math.PI / 4 + PHI_P / 2) ** N_K) / Math.tan(T / 2 + Math.PI / 4) ** N_K;
  return [-(r * Math.sin(theta)), -(r * Math.cos(theta))];
}

// lokální metry kolem středu: x na východ, y na sever
export function localProjection(lat0, lon0) {
  const kx = 111320 * Math.cos(lat0 * RAD);
  const ky = 110574;
  return {
    forward: (lat, lon) => [(lon - lon0) * kx, (lat - lat0) * ky],
    inverse: (x, y) => [lat0 + y / ky, lon0 + x / kx],
  };
}
