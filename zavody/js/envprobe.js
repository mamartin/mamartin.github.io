// Odraz okolí v laku a skle auta, které sleduje kamera: malá krychlová mapa (128 px) kolem auta.
// Každý snímek se překreslí jen jedna stěna krychle, celá je hotová za 6 snímků (zpoždění odrazu
// je při jízdě neviditelné). Kreslí se bez stínů, se stávajícím výběrem kulis a bez sledovaného auta.
// Jen na vysoké kvalitě a pro jednoho hráče; jinak lak odráží oblohu (scene.environment).
import * as THREE from 'three';

export class EnvProbe {
  constructor(renderer, size = 128) {
    this.renderer = renderer;
    this.rt = new THREE.WebGLCubeRenderTarget(size, { type: THREE.HalfFloatType, generateMipmaps: false });
    this.cam = new THREE.CubeCamera(0.4, 2500, this.rt); // obloha je koule 1900 m kolem kamery
    this.face = 0;
    this.ready = false;
    this.mats = new Set();
  }

  get texture() {
    return this.rt.texture;
  }

  // materiály auta, které mají odrážet okolí (až po prvním celém obtočení krychle)
  attach(mats) {
    this.detach();
    for (const m of mats) if (m && (m.isMeshStandardMaterial || m.isMeshPhysicalMaterial)) this.mats.add(m);
    this.ready = false;
    this.face = 0;
  }

  detach() {
    for (const m of this.mats) {
      if (m.envMap === this.rt.texture) {
        m.envMap = null;
        m.needsUpdate = true;
      }
    }
    this.mats.clear();
  }

  // pos = střed auta; hide = model auta (při kreslení odrazu skrytý)
  update(scene, pos, hide, G) {
    if (!this.mats.size) return;
    const r = this.renderer;
    const cam = this.cam;
    if (cam.coordinateSystem !== r.coordinateSystem) {
      cam.coordinateSystem = r.coordinateSystem;
      cam.updateCoordinateSystem();
    }
    cam.position.set(pos.x, pos.y + 0.9, pos.z);
    cam.updateMatrixWorld(true);
    const face = cam.children[this.face];
    const prevTarget = r.getRenderTarget(), prevShadow = r.shadowMap.autoUpdate, prevXr = r.xr.enabled;
    const wasVisible = hide?.visible;
    if (hide) hide.visible = false;
    r.shadowMap.autoUpdate = false;
    r.xr.enabled = false;
    G.probing = true;
    r.setRenderTarget(this.rt, this.face);
    r.render(scene, face);
    G.probing = false;
    r.setRenderTarget(prevTarget);
    r.shadowMap.autoUpdate = prevShadow;
    r.xr.enabled = prevXr;
    if (hide) hide.visible = wasVisible;
    this.face = (this.face + 1) % 6;
    if (this.face === 0) {
      this.rt.texture.needsPMREMUpdate = true;
      if (!this.ready) {
        this.ready = true;
        for (const m of this.mats) {
          m.envMap = this.rt.texture;
          m.needsUpdate = true;
        }
      }
    }
  }

  dispose() {
    this.detach();
    this.rt.dispose();
  }
}
