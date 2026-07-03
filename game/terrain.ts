import * as THREE from 'three';
import { Simplex } from './noise';
import { PLANET_R } from './constants';
import { clamp, smoothstep, latLonToDir, DEG2RAD } from './util';
import { LANDMARKS } from './landmark-data';

/** Stylized continental plates: [latDeg, lonDeg, angular radius in radians]. */
const CONTINENTS: [number, number, number][] = [
  [8, 22, 0.55],     // Africa
  [52, 70, 0.72],    // Central Eurasia
  [50, 18, 0.38],    // Europe
  [22, 78, 0.28],    // Indian subcontinent
  [32, 108, 0.42],   // East Asia
  [46, -100, 0.55],  // North America
  [-14, -58, 0.45],  // South America
  [-25, 134, 0.32],  // Australia
  [-88, 0, 0.42],    // Antarctica
  [74, -41, 0.2],    // Greenland
  [36, 138, 0.14],   // Japan
  [54, -3, 0.13],    // Britain
  [24, 47, 0.3]      // Arabian peninsula
];

interface Anchor {
  dir: THREE.Vector3;
  plateau: number;
  r0: number;
  r1: number;
}

const PALETTE = {
  grass1: new THREE.Color(0x4cb227),
  grass2: new THREE.Color(0x3fa021),
  forest: new THREE.Color(0x2e7d1e),
  beach: new THREE.Color(0xead28b),
  desert1: new THREE.Color(0xdfa348),
  desert2: new THREE.Color(0xd19434),
  snow: new THREE.Color(0xf4f6f8),
  rock1: new THREE.Color(0x969ba3),
  rock2: new THREE.Color(0x7f848c),
  floor: new THREE.Color(0xc8b273),
  deepFloor: new THREE.Color(0x5e7f92)
};

const MAP_DEEP = '#1a5fb8';
const MAP_SHALLOW = '#2f7fd4';

export class Terrain {
  private noise = new Simplex(20260702);
  private anchors: Anchor[] = [];

  constructor() {
    for (const lm of LANDMARKS) {
      if (!lm.flat) continue;
      const dir = latLonToDir(lm.lat * DEG2RAD, lm.lon * DEG2RAD);
      const r0 = lm.flat / PLANET_R;
      this.anchors.push({ dir, plateau: lm.plateau ?? 10, r0, r1: r0 * 2.2 });
    }
  }

  private contDirs = CONTINENTS.map(([lat, lon, r]) => ({
    dir: latLonToDir(lat * DEG2RAD, lon * DEG2RAD),
    r
  }));

  private continentMask(d: THREE.Vector3): number {
    const wobble = this.noise.fbm(d.x * 3.1, d.y * 3.1, d.z * 3.1, 3) * 0.055;
    let m = 0;
    for (const c of this.contDirs) {
      const ang = Math.acos(clamp(d.dot(c.dir), -1, 1)) + wobble;
      const e = 1 - smoothstep(c.r * 0.55, c.r, ang);
      if (e > m) m = e;
    }
    return m;
  }

  /** Terrain height above sea level in world units, before landmark flattening. */
  rawHeight(d: THREE.Vector3): number {
    const m = this.continentMask(d);
    const n = this.noise.fbm(d.x * 2.4, d.y * 2.4, d.z * 2.4, 4);
    const e = m * 1.05 + n * 0.32 - 0.58;
    let h: number;
    if (e > 0) {
      h = Math.pow(e, 0.85) * 70;
      const ridge = 1 - Math.abs(this.noise.noise3(d.x * 5 + 9, d.y * 5, d.z * 5));
      h += smoothstep(0.25, 0.6, e) * ridge * 55;
    } else {
      h = e * 90;
    }
    return clamp(h, -70, 120);
  }

  /** Terrain height including landmark plateaus. */
  height(d: THREE.Vector3): number {
    let h = this.rawHeight(d);
    for (const a of this.anchors) {
      const ang = Math.acos(clamp(d.dot(a.dir), -1, 1));
      if (ang < a.r1) {
        const t = 1 - smoothstep(a.r0, a.r1, ang);
        h = h * (1 - t) + a.plateau * t;
      }
    }
    return h;
  }

  /** Biome color for a point. h <= 0.5 is treated as sea floor. */
  colorAt(d: THREE.Vector3, h: number, out: THREE.Color): THREE.Color {
    if (h <= 0.5) {
      const depth = clamp(-h / 60, 0, 1);
      return out.copy(PALETTE.floor).lerp(PALETTE.deepFloor, depth);
    }
    const lat = Math.abs(Math.asin(clamp(d.y, -1, 1)));
    const v = this.noise.noise3(d.x * 7.3 + 11, d.y * 7.3, d.z * 7.3);
    if (h > 74 || lat > 1.15 - h * 0.004) return out.copy(PALETTE.snow);
    if (h > 50) return out.copy(v > 0 ? PALETTE.rock1 : PALETTE.rock2);
    if (h < 3.5) return out.copy(PALETTE.beach);
    if (lat > 0.28 && lat < 0.6 && v > -0.25 && h < 26) {
      return out.copy(v > 0.3 ? PALETTE.desert2 : PALETTE.desert1);
    }
    if (v > 0.42) return out.copy(PALETTE.forest);
    return out.copy(v > 0 ? PALETTE.grass1 : PALETTE.grass2);
  }

  /** Equirectangular world map used by the minimap and menus. */
  makeMapDataURL(w = 256, h = 128): string {
    const canvas = document.createElement('canvas');
    canvas.width = w;
    canvas.height = h;
    const ctx = canvas.getContext('2d')!;
    const dir = new THREE.Vector3();
    const col = new THREE.Color();
    const img = ctx.createImageData(w, h);
    for (let y = 0; y < h; y++) {
      const lat = ((h / 2 - y - 0.5) / h) * Math.PI;
      for (let x = 0; x < w; x++) {
        const lon = ((x + 0.5) / w) * 2 * Math.PI - Math.PI;
        latLonToDir(lat, lon, dir);
        const hh = this.rawHeight(dir);
        const idx = (y * w + x) * 4;
        if (hh <= 0.5) {
          const c = new THREE.Color(hh > -14 ? MAP_SHALLOW : MAP_DEEP);
          img.data[idx] = c.r * 255;
          img.data[idx + 1] = c.g * 255;
          img.data[idx + 2] = c.b * 255;
        } else {
          this.colorAt(dir, hh, col);
          img.data[idx] = col.r * 255;
          img.data[idx + 1] = col.g * 255;
          img.data[idx + 2] = col.b * 255;
        }
        img.data[idx + 3] = 255;
      }
    }
    ctx.putImageData(img, 0, 0);
    return canvas.toDataURL();
  }
}
