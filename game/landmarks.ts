import * as THREE from 'three';
import { PLANET_R, BRICK_H } from './constants';
import { CityFrame } from './life';
import { Terrain } from './terrain';
import { LANDMARKS, LandmarkDef } from './landmark-data';
import { latLonToDir, tangentBasis, basisQuat, curvatureDrop, makeAOBox, clamp, hash2, DEG2RAD } from './util';
import { NYC_AD_TOWERS, createAdScreens, AdScreens } from './adscreens';
import { bus } from './bus';

const DISCOVERED_KEY = 'brickfly.discovered';

/**
 * How much bigger than authored each landmark is rendered, to reach a more
 * real-life sense of scale. The brick builder compensates sphere curvature for
 * this factor and the city frames (cars/people) scale to match.
 */
export const LANDMARK_SCALE: Record<string, number> = {
  nyc: 3.4,
  eiffel: 8.0,
  bigben: 7.5,
  colosseum: 7.5,
  taj: 6.0,
  sydney: 6.0,
  burj: 5.0,
  giza: 4.5,
  fuji: 3.4,
  cali: 3.4,
  wall: 1.6
};

export function landmarkScale(id: string): number {
  return LANDMARK_SCALE[id] ?? 1.8;
}

interface BrickSpec {
  x: number;
  y: number;
  z: number;
  w: number;
  h: number;
  d: number;
  color: number;
  ry: number;
  studs: boolean;
  glow: boolean;
}

const sharedBrickGeo = makeAOBox();
const sharedStudGeo = new THREE.CylinderGeometry(1.5, 1.5, 1.3, 10);
const brickMat = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.32, metalness: 0.04 });
const studMat = new THREE.MeshStandardMaterial({ roughness: 0.3, metalness: 0.04 });
const sharedGlowGeo = new THREE.BoxGeometry(1, 1, 1);
const glowMat = new THREE.MeshBasicMaterial();

/** Collects axis-aligned (plus Y-rotated) bricks in a local tangent frame. */
class Bricks {
  list: BrickSpec[] = [];
  /** Group scale this brickset will be rendered at, so the sphere-curvature
   *  compensation is applied for the final world size, not the local size. */
  curveScale = 1;

  add(
    x: number,
    y: number,
    z: number,
    w: number,
    h: number,
    d: number,
    color: number,
    opts: { ry?: number; studs?: boolean; glow?: boolean } = {}
  ): void {
    this.list.push({
      x,
      y: y - curvatureDrop(x, z) * this.curveScale,
      z,
      w,
      h,
      d,
      color,
      ry: opts.ry ?? 0,
      studs: opts.studs ?? false,
      glow: opts.glow ?? false
    });
  }

  build(): THREE.Group {
    const group = new THREE.Group();
    const solid = this.list.filter((b) => !b.glow);
    const glows = this.list.filter((b) => b.glow);
    const bricks = new THREE.InstancedMesh(sharedBrickGeo, brickMat, solid.length);
    const m = new THREE.Matrix4();
    const q = new THREE.Quaternion();
    const e = new THREE.Euler();
    const pos = new THREE.Vector3();
    const scale = new THREE.Vector3();
    const col = new THREE.Color();

    const studXf: THREE.Matrix4[] = [];
    const studCols: THREE.Color[] = [];

    solid.forEach((b, i) => {
      e.set(0, b.ry, 0);
      q.setFromEuler(e);
      pos.set(b.x, b.y + b.h / 2, b.z);
      scale.set(b.w, b.h, b.d);
      m.compose(pos, q, scale);
      bricks.setMatrixAt(i, m);
      bricks.setColorAt(i, col.setHex(b.color));

      if (b.studs) {
        const nx = clamp(Math.round(b.w / 5), 1, 7);
        const nz = clamp(Math.round(b.d / 5), 1, 7);
        const cosR = Math.cos(b.ry);
        const sinR = Math.sin(b.ry);
        for (let gx = 0; gx < nx; gx++) {
          for (let gz = 0; gz < nz; gz++) {
            const lx = ((gx + 0.5) / nx - 0.5) * b.w;
            const lz = ((gz + 0.5) / nz - 0.5) * b.d;
            const rx = lx * cosR + lz * sinR;
            const rz = -lx * sinR + lz * cosR;
            const sm = new THREE.Matrix4().makeTranslation(b.x + rx, b.y + b.h + 0.65, b.z + rz);
            studXf.push(sm);
            studCols.push(col.clone());
          }
        }
      }
    });

    bricks.instanceMatrix.needsUpdate = true;
    if (bricks.instanceColor) bricks.instanceColor.needsUpdate = true;
    bricks.castShadow = true;
    bricks.receiveShadow = true;
    group.add(bricks);

    if (studXf.length > 0) {
      const studs = new THREE.InstancedMesh(sharedStudGeo, studMat, studXf.length);
      studXf.forEach((sm, i) => {
        studs.setMatrixAt(i, sm);
        studs.setColorAt(i, studCols[i]);
      });
      studs.instanceMatrix.needsUpdate = true;
      if (studs.instanceColor) studs.instanceColor.needsUpdate = true;
      group.add(studs);
    }

    if (glows.length > 0) {
      const glow = new THREE.InstancedMesh(sharedGlowGeo, glowMat, glows.length);
      glows.forEach((b, i) => {
        e.set(0, b.ry, 0);
        q.setFromEuler(e);
        pos.set(b.x, b.y + b.h / 2, b.z);
        scale.set(b.w, b.h, b.d);
        m.compose(pos, q, scale);
        glow.setMatrixAt(i, m);
        glow.setColorAt(i, col.setHex(b.color));
      });
      glow.instanceMatrix.needsUpdate = true;
      if (glow.instanceColor) glow.instanceColor.needsUpdate = true;
      group.add(glow);
    }

    return group;
  }
}

/* ------------------------------------------------------------------ cities */

interface CityStyle {
  walls: number[];
  roofs: number[];
  band: number;
  floors: [number, number];
  plaza: number;
  road: number;
  rings: number[];
  perRing: number[];
  trees: number;
  glow?: boolean;
}

const CITY_CONFIGS: Record<string, { style?: CityStyle; frame?: { ring: number; plaza: number; groundY: number } }> = {
  eiffel: {
    style: {
      walls: [0xe8dcc0, 0xddd0b0, 0xf0e6d2],
      roofs: [0x5a6b7a, 0x4a5a68],
      band: 0xfdf6e3,
      floors: [5, 10],
      plaza: 46,
      road: 60,
      rings: [80, 112],
      perRing: [10, 13],
      trees: 12
    },
    frame: { ring: 60, plaza: 42, groundY: 1.4 }
  },
  bigben: {
    style: {
      walls: [0xc46a4a, 0xb05b3e, 0xcf8a5b],
      roofs: [0x555b63, 0x474c54],
      band: 0xf3e9d2,
      floors: [5, 9],
      plaza: 54,
      road: 68,
      rings: [88, 118],
      perRing: [10, 13],
      trees: 10
    },
    frame: { ring: 68, plaza: 50, groundY: 1.4 }
  },
  colosseum: {
    style: {
      walls: [0xd98859, 0xc97748, 0xe0a067],
      roofs: [0xb5533c, 0xa64a35],
      band: 0xf0e0c8,
      floors: [4, 8],
      plaza: 58,
      road: 74,
      rings: [94, 124],
      perRing: [11, 14],
      trees: 8
    },
    frame: { ring: 74, plaza: 54, groundY: 1.4 }
  },
  taj: {
    style: {
      walls: [0xf0e0c0, 0xe8d5b0, 0xdac59a],
      roofs: [0xc96a3b, 0xb85d33],
      band: 0xfff4dd,
      floors: [4, 8],
      plaza: 50,
      road: 64,
      rings: [84, 114],
      perRing: [10, 12],
      trees: 12
    },
    frame: { ring: 64, plaza: 46, groundY: 1.4 }
  },
  sydney: {
    style: {
      walls: [0xdfe5ea, 0xc9d4dc, 0x9fb6c6],
      roofs: [0x6b7684, 0x59636f],
      band: 0x8fd8e8,
      floors: [7, 14],
      plaza: 54,
      road: 68,
      rings: [88, 116],
      perRing: [10, 12],
      trees: 8
    },
    frame: { ring: 68, plaza: 50, groundY: 1.4 }
  },
  burj: {
    style: {
      walls: [0x9fb6c6, 0xb7cbd8, 0x8fb0c4],
      roofs: [0xdde6ec],
      band: 0x28d8ff,
      floors: [14, 30],
      plaza: 46,
      road: 62,
      rings: [84, 116],
      perRing: [9, 11],
      trees: 6,
      glow: true
    },
    frame: { ring: 62, plaza: 42, groundY: 1.4 }
  },
  fuji: {
    style: {
      walls: [0x6b4a35, 0x7a5741, 0xf4efe4],
      roofs: [0x474c54, 0x3a3f46],
      band: 0xf4efe4,
      floors: [3, 5],
      plaza: 0,
      road: 0,
      rings: [118],
      perRing: [8],
      trees: 10
    }
  },
  nyc: { frame: { ring: 130, plaza: 170, groundY: 3 } }
};

/**
 * A large flat ground area tiled into many small bricks. A single huge brick
 * would stay flat and lift off the curved planet at its edges (by roughly
 * halfWidth²/2R), reading as a tilted slab; tiling lets each piece drop onto
 * the sphere so the surface stays flush.
 */
function plate(
  B: Bricks,
  cx: number,
  cz: number,
  w: number,
  d: number,
  y: number,
  h: number,
  color: number,
  tile = 110
): void {
  const nx = Math.max(1, Math.ceil(w / tile));
  const nz = Math.max(1, Math.ceil(d / tile));
  const tw = w / nx;
  const td = d / nz;
  for (let i = 0; i < nx; i++) {
    for (let j = 0; j < nz; j++) {
      const x = cx - w / 2 + (i + 0.5) * tw;
      const z = cz - d / 2 + (j + 0.5) * td;
      B.add(x, y, z, tw + 0.6, h, td + 0.6, color);
    }
  }
}

/** Generic brick city district: plaza, roads, housing rings, trees, lamps. */
function city(B: Bricks, s: CityStyle, seed: number): void {
  if (s.plaza > 0) {
    B.add(0, 0, 0, s.plaza * 2, 1.2, s.plaza * 2, 0xc9cdd3);
    B.add(0, 0, 0, s.plaza * 2, 1.2, s.plaza * 2, 0xc9cdd3, { ry: Math.PI / 4 });
  }

  if (s.road > 0) {
    const R = s.road;
    for (let side = 0; side < 4; side++) {
      const horizontal = side % 2 === 0;
      const off = side < 2 ? R : -R;
      if (horizontal) B.add(0, 0, off, R * 2 + 10, 0.9, 10, 0x3e434b);
      else B.add(off, 0, 0, 10, 0.9, R * 2 + 10, 0x3e434b);
      for (let d = -R + 8; d <= R - 8; d += 12) {
        if (horizontal) B.add(d, 0.95, off, 3.2, 0.3, 0.8, 0xf4f4f2);
        else B.add(off, 0.95, d, 0.8, 0.3, 3.2, 0xf4f4f2);
      }
    }
    for (const sx of [-1, 1]) {
      for (const sz of [-1, 1]) {
        B.add(sx * R, 1, sz * R, 0.5, 5, 0.5, 0x33363c);
        B.add(sx * R, 6, sz * R, 1.1, 1.1, 1.1, 0xffe9a8, { glow: true });
      }
    }

    const outer = s.rings[s.rings.length - 1] + 14;
    for (let a = 0; a < 4; a++) {
      const horiz = a % 2 === 0;
      const from = s.plaza + 2;
      const mid = (from + outer) / 2;
      const len = outer - from;
      const sign = a < 2 ? 1 : -1;
      if (horiz) B.add(sign * mid, 0, 0, len, 0.9, 8, 0x3e434b);
      else B.add(0, 0, sign * mid, 8, 0.9, len, 0x3e434b);
    }
  }

  let n = 0;
  s.rings.forEach((r, ri) => {
    const count = s.perRing[ri];
    for (let i = 0; i < count; i++) {
      const a = ((i + 0.5) / count) * Math.PI * 2;
      // keep the radial avenues clear
      if (Math.min(Math.abs(Math.cos(a)), Math.abs(Math.sin(a))) < 0.12) continue;
      const x = Math.cos(a) * r;
      const z = Math.sin(a) * r;
      const h1 = hash2(seed + n * 13, ri * 7 + 1);
      const h2 = hash2(seed + n * 29, ri * 11 + 3);
      const w = 11 + h1 * 6;
      const height = (s.floors[0] + h2 * (s.floors[1] - s.floors[0])) * 2.4;
      // Paved plinth so the tower reads as sitting on the ground, not sunk in grass.
      B.add(x, 0, z, w + 4, 1.4, w + 4, 0xc4c9cf, { ry: -a });
      B.add(x, 1, z, w, height, w, s.walls[n % s.walls.length], { ry: -a, studs: true });
      B.add(x, 1 + height, z, w + 1.6, 2, w + 1.6, s.roofs[n % s.roofs.length], { ry: -a });
      for (let y = 5; y < height - 3; y += 5.5) {
        B.add(x, 1 + y, z, w + 0.5, 0.9, w + 0.5, s.band, { ry: -a, glow: true });
      }
      n++;
    }
  });

  for (let i = 0; i < s.trees; i++) {
    const a = hash2(seed + i * 3, 17) * Math.PI * 2;
    const r = (s.plaza > 0 ? s.plaza : s.rings[0] * 0.55) + 6 + hash2(i, seed) * 8;
    const x = Math.cos(a) * r;
    const z = Math.sin(a) * r;
    B.add(x, 1, z, 1.1, 3.2, 1.1, 0x8a6743);
    B.add(x, 4.2, z, 4.5, 4.5, 4.5, i % 2 ? 0x2e7d1e : 0x3fa021);
  }
}

/**
 * A dense outer belt of mid-rise blocks, ring roads and parks that fills the
 * flattened pad from the downtown core out to the edge, so a landmark never
 * sits on a lonely patch of empty lawn.
 */
function suburbs(B: Bricks, s: CityStyle, seed: number, rInner: number, rOuter: number): void {
  // Concentric ring roads.
  for (let r = rInner + 18; r < rOuter; r += 62) {
    const seg = Math.max(28, Math.floor(r / 5));
    for (let i = 0; i < seg; i++) {
      const a = (i / seg) * Math.PI * 2;
      B.add(Math.cos(a) * r, 0, Math.sin(a) * r, 8, 0.8, 8, 0x3a3f46, { ry: -a });
    }
  }

  // Low-rise blocks on a polar grid, so the landmark towers over its town.
  // Bright accent roofs keep the belt colourful rather than a grey slab.
  const ACCENTS = [0xd6382c, 0x2c6bd6, 0xf2a10a, 0x18a558, 0x9d5cff, 0x2e9e9b, 0xff7a1a];
  let n = 0;
  for (let r = rInner + 22; r < rOuter - 8; r += 28) {
    const count = Math.max(8, Math.floor((2 * Math.PI * r) / 38));
    for (let i = 0; i < count; i++) {
      const a = ((i + (Math.round(r) % 2 ? 0.5 : 0)) / count) * Math.PI * 2;
      // keep the four cardinal avenues open
      if (Math.min(Math.abs(Math.cos(a)), Math.abs(Math.sin(a))) < 0.06) continue;
      const jr = r + (hash2(seed + n, 3) - 0.5) * 16;
      const x = Math.cos(a) * jr;
      const z = Math.sin(a) * jr;
      const h1 = hash2(seed + n * 13, 7);
      const w = 8 + h1 * 6;
      // Deliberately low (a few storeys) so it never competes with the monument.
      const height = 5 + h1 * 9;
      const roof = hash2(seed + n * 5, 23) > 0.55 ? ACCENTS[n % ACCENTS.length] : s.roofs[n % s.roofs.length];
      B.add(x, 0, z, w + 3, 1.2, w + 3, 0xc4c9cf, { ry: -a });
      B.add(x, 1, z, w, height, w, s.walls[n % s.walls.length], { ry: -a, studs: true });
      B.add(x, 1 + height, z, w + 1.2, 1.6, w + 1.2, roof, { ry: -a });
      for (let y = 5; y < height - 2; y += 5) {
        B.add(x, 1 + y, z, w + 0.4, 0.8, w + 0.4, s.band, { ry: -a, glow: true });
      }
      n++;
    }
  }

  // Pocket parks so the belt isn't wall-to-wall concrete.
  for (let i = 0; i < 34; i++) {
    const a = hash2(seed + i * 5, 21) * Math.PI * 2;
    const r = rInner + hash2(i, seed + 3) * (rOuter - rInner);
    const x = Math.cos(a) * r;
    const z = Math.sin(a) * r;
    B.add(x, 1, z, 1.1, 3, 1.1, 0x8a6743);
    B.add(x, 4, z, 4.2, 4.2, 4.2, i % 2 ? 0x2e7d1e : 0x3fa021);
  }
}

/* ---------------------------------------------------------------- builders */

function eiffel(B: Bricks): void {
  const grey = 0x8a8f96;
  const dark = 0x6a6f76;
  for (let y = 0; y < 60; y += 4) {
    const t = y / 60;
    const w = 30 * Math.pow(1 - t, 1.75) + 3;
    const lw = 4.2 * (1 - t) + 1.4;
    const color = (y / 4) % 2 ? grey : dark;
    for (const sx of [-1, 1]) {
      for (const sz of [-1, 1]) {
        B.add((sx * w) / 2, y, (sz * w) / 2, lw, 4, lw, color);
      }
    }
    if (y === 16 || y === 32) {
      B.add(0, y, 0, w + 8, 3, w + 8, dark, { studs: true });
    } else if (y % 12 === 0 && y > 0) {
      B.add(0, y + 1, 0, w + lw, 1.6, 3, grey);
      B.add(0, y + 1, 0, 3, 1.6, w + lw, grey);
    }
  }
  for (let y = 60; y < 84; y += 4) {
    B.add(0, y, 0, 4.5, 4, 4.5, (y / 4) % 2 ? grey : dark);
  }
  B.add(0, 84, 0, 6.5, 2.5, 6.5, dark, { studs: true });
  B.add(0, 86.5, 0, 1.6, 10, 1.6, grey);

  // Golden beacon and a French tricolour flying from the mast.
  B.add(0, 92, 0, 2.2, 2.2, 2.2, 0xffd24a, { glow: true });
  B.add(0, 96, 0, 0.8, 9, 0.8, 0xf4f4f2);
  B.add(2.4, 100, 0, 2.6, 4.4, 0.4, 0x2c3e9e, { glow: true });
  B.add(5, 100, 0, 2.6, 4.4, 0.4, 0xf4f4f2, { glow: true });
  B.add(7.6, 100, 0, 2.6, 4.4, 0.4, 0xd5202b, { glow: true });

  // Coloured platform up-lights for a festive night-time glow.
  for (const yy of [16, 32]) {
    for (const sx of [-1, 1]) {
      for (const sz of [-1, 1]) {
        const w = 30 * Math.pow(1 - yy / 60, 1.75) + 3;
        B.add((sx * (w + 6)) / 2, yy, (sz * (w + 6)) / 2, 1.4, 1.4, 1.4, sx * sz > 0 ? 0x38d0ff : 0xffd24a, { glow: true });
      }
    }
  }
}

// Real-life-ish Manhattan facade palette: glass, brick, limestone and steel.
const NYC_FACADES = [
  0x8fb4c9, 0x6fae9e, 0xb5623f, 0x9c6b4a, 0xd9cdb0, 0x5a7fa0, 0xc7d0d6, 0x7d8a94, 0xa8c4b0, 0x4f6472
];

/** A full grid Manhattan: rivers, avenues and cross-streets with flyable gaps,
 *  colourful glass/brick towers, Central Park, a Times Square screen district
 *  and a few named supertalls. */
function nyc(B: Bricks): void {
  const asphalt = 0x3c4046;
  const stripe = 0x6a707a;
  const win = 0xffe98a;
  const HX = 210;
  const HZ = 780;

  // Hudson + East rivers filling the pad, with the island asphalt on top.
  // Tiled so the huge ground area follows the planet's curve instead of
  // lifting off as one flat slab.
  plate(B, 0, -20, 1650, 1750, -2, 2.4, 0x2f6fae, 120);
  plate(B, 0, 0, HX * 2 + 24, HZ * 2 + 24, 0, 3, asphalt, 110);
  // Waterfront piers along both rivers.
  for (let z = -HZ + 80; z < HZ; z += 150) {
    for (const s of [-1, 1]) {
      B.add(s * (HX + 20), 3, z, 40, 1.4, 14, 0x8a7250, { studs: true });
    }
  }

  const AVENUES = [-180, -120, -60, 0, 60, 120, 180];
  // Street stripes segmented so they hug the curve rather than arch off it.
  for (const ax of AVENUES) {
    for (let z = -HZ; z < HZ; z += 110) B.add(ax, 3.2, z + 55, 8, 0.4, 112, stripe);
  }
  for (let z = -HZ; z <= HZ; z += 44) {
    for (let x = -HX; x < HX; x += 110) B.add(x + 55, 3.2, z, 112, 0.4, 8, stripe);
  }

  // Central Park: a long green rectangle with a pond and trees.
  const parkZ0 = -600;
  const parkZ1 = -380;
  B.add(0, 3, (parkZ0 + parkZ1) / 2, 250, 1.8, parkZ1 - parkZ0, 0x3fa021, { studs: true });
  B.add(-40, 4, -470, 70, 1, 46, 0x3f8fd4);
  for (let i = 0; i < 46; i++) {
    const tx = (hash2(i, 3) - 0.5) * 230;
    const tz = parkZ0 + hash2(i, 7) * (parkZ1 - parkZ0);
    B.add(tx, 4, tz, 1.4, 4, 1.4, 0x8a6743);
    B.add(tx, 8, tz, 6, 6, 6, i % 2 ? 0x2e7d1e : 0x3fa021);
  }

  // City blocks on a regular grid, footprints smaller than the cell so the
  // streets stay open enough to fly down.
  let n = 0;
  for (let cx = -180; cx <= 180; cx += 60) {
    for (let cz = -HZ + 34; cz <= HZ - 34; cz += 44) {
      if (cz > parkZ0 - 10 && cz < parkZ1 + 10 && Math.abs(cx) < 130) continue; // park
      if (Math.abs(cx) < 46 && Math.abs(cz) < 70) continue; // Times Square core
      const r1 = hash2(cx * 3 + n, cz * 5 + 7);
      const r2 = hash2(cx * 7 + 13, cz * 3 + n);
      const w = 34 + r1 * 10;
      const d = 30 + r2 * 8;
      // Two skyline peaks: Midtown (z≈0) and the Financial District (z≈+620).
      const midtown = 1 - Math.min(1, Math.abs(cz) / 320);
      const downtown = 1 - Math.min(1, Math.abs(cz - 620) / 240);
      const peak = Math.max(midtown, downtown * 0.92);
      const h = 24 + peak * 140 + r1 * 44;
      const color = NYC_FACADES[(n * 3 + (cx < 0 ? 2 : 5)) % NYC_FACADES.length];
      B.add(cx, 3, cz, w + 3, 1, d + 3, 0x9a9ea3);
      B.add(cx, 3, cz, w, h, d, color, { studs: true });
      for (let y = 10; y < h - 6; y += 9) {
        B.add(cx, 3 + y, cz, w + 0.6, 1.4, d + 0.6, win, { glow: true });
      }
      B.add(cx, 3 + h, cz, w * 0.62, 4, d * 0.62, 0x5f666e);
      n++;
    }
  }

  // Times Square: dark-glass towers wrapped in glowing ad screens.
  NYC_AD_TOWERS.forEach((t, i) => {
    B.add(t.x, 3, t.z, t.w, t.h, t.w, 0x30363d, { studs: true });
    for (let y = 12; y < t.h - 6; y += 10) {
      B.add(t.x, 3 + y, t.z, t.w + 0.7, 1.4, t.w + 0.7, 0xffd24a, { glow: true });
    }
    B.add(t.x, 3 + t.h, t.z, t.w * 0.5, 10, t.w * 0.5, 0x30363d);
    B.add(t.x, 3 + t.h + 10, t.z, 1.6, 12, 1.6, 0xff3b6b, { glow: true }); // beacon
  });

  // Named supertalls.
  // Empire State (midtown).
  B.add(120, 3, 40, 34, 96, 34, 0xb7bcc2, { studs: true });
  B.add(120, 99, 40, 23, 46, 23, 0xb7bcc2);
  B.add(120, 145, 40, 14, 26, 14, 0xc7ccd1);
  B.add(120, 171, 40, 2.6, 24, 2.6, 0xe6ebf0);
  for (let y = 12; y < 90; y += 12) B.add(120, 3 + y, 40, 34.7, 1.4, 34.7, win, { glow: true });
  // One World Trade (downtown, tapered glass).
  B.add(0, 3, 660, 30, 150, 30, 0x9ec6dd, { studs: true });
  B.add(0, 153, 660, 6, 60, 6, 0xcfe4f2);
  for (let y = 12; y < 150; y += 11) B.add(0, 3 + y, 660, 30.6, 1.3, 30.6, 0xbfe0ff, { glow: true });
  // Chrysler-style crown.
  B.add(-120, 3, 30, 26, 104, 26, 0xc7cdd2, { studs: true });
  for (let k = 0; k < 5; k++) B.add(-120, 107 + k * 6, 30, 20 - k * 3.4, 6, 20 - k * 3.4, 0xd9e0e6);
  B.add(-120, 137, 30, 1.6, 18, 1.6, 0xe6ebf0);

  // A couple of McBrick's on the avenues.
  burgerJoint(B, 40, -150);
  burgerJoint(B, -40, 220);
}

/** A little fast-food stand crowned with golden arches. */
function burgerJoint(B: Bricks, cx: number, cz: number): void {
  const red = 0xd5202b;
  const gold = 0xffc21e;
  B.add(cx, 3, cz, 20, 12, 16, red, { studs: true });
  B.add(cx, 15, cz, 21, 2, 17, 0xf4f4f2);
  B.add(cx, 3, cz + 8.2, 6, 8, 1, 0x9fd8ff, { glow: true }); // lit doorway/window
  // two golden arches on the roof
  for (const ax of [-5, 5]) {
    B.add(cx + ax - 2.4, 17, cz, 1.8, 10, 2, gold);
    B.add(cx + ax + 2.4, 17, cz, 1.8, 10, 2, gold);
    B.add(cx + ax, 26.5, cz, 6.8, 2, 2, gold);
  }
}

function taj(B: Bricks): void {
  const white = 0xf6f3ee;
  const cream = 0xefe9df;
  const teal = 0x2e9e9b;
  const gold = 0xd8b84a;

  B.add(0, 0, 0, 76, 4, 76, white, { studs: true });

  for (const sx of [-1, 1]) {
    for (const sz of [-1, 1]) {
      const x = sx * 34;
      const z = sz * 34;
      B.add(x, 4, z, 4.5, 24, 4.5, white);
      B.add(x, 28, z, 6.2, 2, 6.2, cream);
      B.add(x, 30, z, 3.6, 3, 3.6, white);
    }
  }

  B.add(0, 4, 0, 30, 16, 30, white);
  B.add(0, 6, 15.2, 10, 12, 1.6, teal);
  B.add(10, 7, 15.2, 5, 8, 1.4, teal);
  B.add(-10, 7, 15.2, 5, 8, 1.4, teal);

  for (const sx of [-1, 1]) {
    for (const sz of [-1, 1]) {
      B.add(sx * 11, 20, sz * 11, 5, 2, 5, cream);
      B.add(sx * 11, 22, sz * 11, 3.6, 2.6, 3.6, white);
    }
  }

  const domeWidths = [13, 15.5, 16.5, 16, 14, 11, 7.5, 4.5];
  domeWidths.forEach((w, i) => {
    B.add(0, 20 + i * 2.4, 0, w, 2.4, w, white, { ry: i % 2 ? Math.PI / 4 : 0 });
  });
  B.add(0, 20 + domeWidths.length * 2.4, 0, 1.4, 4.5, 1.4, gold);
}

function sydney(B: Bricks): void {
  const white = 0xf7f5f0;
  const cream = 0xe8e2d4;
  const tan = 0xcbb59a;

  B.add(0, 0, 0, 84, 5, 36, tan, { studs: true });

  const sail = (cx: number, cz: number, s: number, dir: number) => {
    const profile = [0.35, 0.62, 0.85, 1, 0.8, 0.5, 0.22];
    profile.forEach((p, i) => {
      const x = cx + dir * i * 2.7;
      B.add(x, 5, cz, 2.3, s * p, Math.max(4, s * 0.85 - i * 1.7), i % 2 ? white : cream);
    });
  };

  sail(-30, -5, 30, 1);
  sail(-6, -3, 24, 1);
  sail(13, -1, 17, 1);
  sail(38, 8, 15, -1);
  sail(26, 10, 11, -1);
}

function colosseum(B: Bricks): void {
  const stone = 0xd9c49a;
  const dark = 0xc4ad82;
  const sand = 0xe3cf9e;
  const R0 = 40;
  const n = 34;

  for (let i = 0; i < n; i++) {
    const th = (i / n) * Math.PI * 2;
    const x = Math.cos(th) * R0;
    const z = Math.sin(th) * R0;
    const ry = -th + Math.PI / 2;
    const broken = th > 4.5;
    const color = i % 2 ? stone : dark;

    if (i % 5 === 0) {
      B.add(x, 5, z, 7.2, 6, 6, color, { ry });
    } else {
      B.add(x, 0, z, 7.2, 11, 6, color, { ry });
    }
    if (!broken) {
      B.add(x, 11, z, 7.2, 10, 6, i % 2 ? dark : stone, { ry });
      if (th < 3.4) B.add(x, 21, z, 7.2, 9, 6, color, { ry, studs: true });
    }
  }

  for (let i = 0; i < 22; i++) {
    const th = (i / 22) * Math.PI * 2;
    const x = Math.cos(th) * 26;
    const z = Math.sin(th) * 26;
    B.add(x, 0, z, 8, 13, 5, i % 2 ? sand : stone, { ry: -th + Math.PI / 2 });
  }

  B.add(0, 0, 0, 38, 2.5, 38, 0xd8b878, { ry: Math.PI / 4 });
  B.add(0, 0, 0, 38, 2.5, 38, 0xd8b878);
}

function fuji(B: Bricks): void {
  const snow = 0xf4f6f8;
  for (let y = 0; y < 64; y += 4) {
    const t = y / 64;
    const r = 55 * Math.pow(1 - t, 1.22) + 7;
    let color: number;
    if (t > 0.7) color = snow;
    else if (t > 0.58) color = 0x8d8377;
    else color = (y / 4) % 2 ? 0x7c6f5f : 0x6f6355;
    B.add(0, y, 0, r * 2, 4, r * 2, color, { ry: ((y / 4) % 2) * (Math.PI / 4) });
  }
  B.add(0, 64, 0, 15, 3, 15, snow, { ry: Math.PI / 4 });
  B.add(0, 65, 0, 9, 2.6, 9, 0x5c5248);
}

/** The Great Sphinx: a reclining lion body with a pharaoh's nemes headdress. */
function sphinx(B: Bricks, cx: number, cz: number): void {
  const stone = 0xd9b26a;
  const stone2 = 0xcaa25c;
  const gold = 0xd8b84a;
  const blue = 0x2c6bd6;
  // Body lies along +Z with the head/paws facing out toward -Z.
  B.add(cx, 0, cz, 28, 20, 66, stone, { studs: true });
  B.add(cx, 0, cz, 34, 6, 74, stone2); // plinth
  for (const s of [-1, 1]) {
    B.add(cx + s * 9, 0, cz - 44, 9, 9, 30, stone2); // outstretched paws
    B.add(cx + s * 9, 0, cz - 58, 9, 5, 4, stone); // toes
  }
  B.add(cx, 20, cz - 20, 20, 16, 18, stone); // chest / neck
  // Nemes headdress with striped lappets and a gold brow band.
  B.add(cx, 34, cz - 24, 22, 18, 18, stone2); // head block
  for (const s of [-1, 1]) {
    B.add(cx + s * 10.5, 30, cz - 22, 4, 22, 18, blue);
  }
  B.add(cx, 44, cz - 22, 24, 4, 18, gold);
  B.add(cx, 30, cz - 33.6, 14, 12, 1.6, 0xe6c07e); // face
  B.add(cx, 22, cz - 33.6, 5, 3, 1.6, gold); // ceremonial beard
}

function giza(B: Bricks): void {
  const glyphCols = [0x2e9e9b, 0xd8b84a, 0xc0432f, 0x2c6bd6];
  const sand = 0xe3cf9e;
  const sandDark = 0xd7bf85;

  // Wide desert plaza (tiled to follow the planet's curve).
  plate(B, 0, 0, 520, 520, 0, 2, sand, 90);
  for (let i = 0; i < 40; i++) {
    B.add((hash2(i, 2) - 0.5) * 480, 2, (hash2(i, 6) - 0.5) * 480, 22, 0.3, 22, sandDark);
  }

  // Giant stepped pyramids, with hieroglyphic cartouches climbing the faces.
  const pyramid = (cx: number, cz: number, base: number, glyphs: boolean) => {
    const h = base * 0.68;
    for (let y = 0; y < h; y += 4) {
      const w = base * (1 - y / h) + 3;
      const color = y > h - 12 ? 0xeed9a8 : (y / 4) % 2 ? 0xdcb56e : 0xcfa75f;
      B.add(cx, y, cz, w, 4, w, color);
      if (glyphs && (y / 4) % 2 === 0 && y > 6 && y < h - 16) {
        B.add(cx, y + 1, cz + w / 2 + 0.4, 3.4, 2.6, 0.7, glyphCols[(y / 8) % glyphCols.length], { glow: true });
      }
    }
    B.add(cx, h, cz, 6, 5, 6, 0xd8b84a); // gilded capstone
  };
  pyramid(-150, -70, 210, true);
  pyramid(40, 50, 168, true);
  pyramid(190, 160, 120, false);

  // The Great Sphinx, out in front of the pyramids.
  sphinx(B, -30, -210);

  // A pair of glyph-carved obelisks flanking the approach.
  for (const ox of [-210, 210]) {
    for (let y = 0; y < 78; y += 5) {
      const w = 9 * (1 - y / 110);
      B.add(ox, y, -150, w, 5, w, (y / 5) % 2 ? 0xdcb56e : 0xcfa75f);
    }
    B.add(ox, 78, -150, 7, 9, 7, 0xd8b84a); // gold pyramidion
    for (let y = 8; y < 66; y += 10) {
      B.add(ox, y, -145.6, 3, 3.4, 0.7, glyphCols[(y / 10) % glyphCols.length], { glow: true });
    }
  }

  // Palms dotted around the sacred site.
  for (let i = 0; i < 16; i++) {
    const a = (i / 16) * Math.PI * 2;
    const r = 230 + hash2(i, 12) * 30;
    palm(B, Math.cos(a) * r, Math.sin(a) * r + 30, i * 3 + 2);
  }
}

function bigben(B: Bricks): void {
  const tan = 0xcfae72;
  const dark = 0xb2945c;
  const white = 0xf3efe6;
  const green = 0x3f5a4e;
  const black = 0x30343c;

  // Clock tower
  for (let y = 0; y < 52; y += 6.5) {
    B.add(30, y, 0, 13, 6.5, 13, (y / 6.5) % 2 ? tan : dark);
  }
  B.add(30, 52, 0, 15, 10, 15, tan);
  for (const side of [-1, 1]) {
    B.add(30 + side * 7.8, 55, 0, 1.2, 8, 8, white);
    B.add(30 + side * 8.5, 56.5, 0, 0.8, 3, 3, black);
    B.add(30, 55, side * 7.8, 8, 8, 1.2, white);
    B.add(30, 56.5, side * 8.5, 3, 3, 0.8, black);
  }
  B.add(30, 62, 0, 14, 3, 14, green);
  B.add(30, 65, 0, 10, 3.5, 10, green);
  B.add(30, 68.5, 0, 6, 3.5, 6, green);
  B.add(30, 72, 0, 2.6, 4, 2.6, green);
  B.add(30, 76, 0, 1.2, 6, 1.2, 0xd8b84a);

  // Union Jack flying beside the spire.
  B.add(30, 82, 0, 0.7, 8, 0.7, 0xf4f4f2);
  B.add(33, 86, 0, 3.2, 4.2, 0.4, 0x1a3a8f, { glow: true });
  B.add(33, 86, 0.06, 3.2, 1.2, 0.4, 0xd5202b, { glow: true });
  B.add(33, 86, 0.06, 1.0, 4.2, 0.4, 0xd5202b, { glow: true });

  // Gilded clock surrounds so the faces catch the eye.
  for (const side of [-1, 1]) {
    B.add(30 + side * 8.9, 55, 0, 0.5, 9, 9, 0xd8b84a);
    B.add(30, 55, side * 8.9, 9, 9, 0.5, 0xd8b84a);
  }

  // Westminster hall
  B.add(-10, 0, 0, 56, 14, 20, tan, { studs: true });
  for (let x = -34; x <= 12; x += 6) {
    B.add(x, 14, 0, 1.8, 4, 20.6, dark);
  }
  B.add(-10, 14, 0, 56, 3.2, 9, dark);
  B.add(-38, 0, 0, 13, 24, 13, tan);
  B.add(-38, 24, 0, 10, 3, 10, green);
  B.add(-38, 27, 0, 5, 3, 5, green);
}

function burj(B: Bricks): void {
  const silver = 0xaebfcc;
  const light = 0xc7d6e0;
  const glass = 0x8fb0c4;

  for (let i = 0; i < 12; i++) {
    const y = i * 11;
    const r = 30 * (1 - i / 12);
    for (let k = 0; k < 3; k++) {
      if (i < 11 - k * 2.5) {
        const a = (k * 2 * Math.PI) / 3 + Math.PI / 6;
        const d = r * 0.42 + 3;
        const wing = Math.max(5, r * 0.5);
        B.add(Math.cos(a) * d, y, Math.sin(a) * d, wing, 11, wing, k % 2 ? glass : silver, { ry: -a });
      }
    }
    const core = Math.max(4, r * 0.6);
    B.add(0, y, 0, core, 11, core, light, { ry: (i % 2) * (Math.PI / 6) });
  }
  B.add(0, 132, 0, 3, 10, 3, silver);
  B.add(0, 142, 0, 1.4, 16, 1.4, light);
}

/** A leaning palm: brown trunk plus a burst of green fronds. */
function palm(B: Bricks, x: number, z: number, seed: number): void {
  const lean = (hash2(seed, 4) - 0.5) * 2.4;
  const h = 12 + hash2(seed, 9) * 6;
  for (let y = 0; y < h; y += 3) {
    B.add(x + (y / h) * lean, 3 + y, z, 1.8, 3, 1.8, y % 6 ? 0x9c7238 : 0x8a6330);
  }
  const tx = x + lean;
  const ty = 3 + h;
  for (const [dx, dz] of [[-4, 0], [4, 0], [0, -4], [0, 4], [-3, -3], [3, 3]] as const) {
    B.add(tx + dx, ty, z + dz, 6, 1.2, 4, 0x2f9e3a);
  }
  B.add(tx, ty + 1, z, 3, 2, 3, 0x3fb84a);
}

/** A vertical Ferris wheel of cabins, spokes and a support A-frame. */
function ferrisWheel(B: Bricks, cx: number, cz: number): void {
  const R = 34;
  const hubY = 3 + R + 6;
  const spokes = 16;
  const cabinCols = [0xd6382c, 0x2c6bd6, 0xf7d354, 0x4cb227, 0x9d5cff, 0xff2e88];
  for (let i = 0; i < spokes; i++) {
    const a = (i / spokes) * Math.PI * 2;
    const x = cx + Math.cos(a) * R;
    const y = hubY + Math.sin(a) * R;
    // spoke
    for (let t = 0.15; t < 1; t += 0.16) {
      B.add(cx + Math.cos(a) * R * t, hubY + Math.sin(a) * R * t, cz, 1.2, 1.2, 1.2, 0xdfe6ec);
    }
    // cabin
    B.add(x, y - 2.4, cz, 5, 4.5, 5, cabinCols[i % cabinCols.length], { studs: true });
  }
  // hub + rim caps
  B.add(cx, hubY, cz, 5, 5, 6, 0xb7c0c8);
  // support A-frame legs
  for (const s of [-1, 1]) {
    for (let y = 0; y < hubY - 2; y += 5) {
      const lx = cx + s * (1 - y / hubY) * (R * 0.7);
      B.add(lx, 3 + y, cz, 2.4, 5, 2.4, 0xc2c8cf);
    }
  }
}

const BEACH_SHIRTS = [0xd6382c, 0x2c6bd6, 0xf7d354, 0x4cb227, 0x9d5cff, 0xff2e88, 0x2e9e9b];

/** A little brick beach-goer standing on the sand. */
function beachPerson(B: Bricks, x: number, z: number, seed: number): void {
  const shirt = BEACH_SHIRTS[Math.floor(hash2(seed, 3) * BEACH_SHIRTS.length)];
  B.add(x, 3, z, 1.2, 2.4, 0.9, 0x33363c);
  B.add(x, 5.4, z, 1.6, 2.4, 1.1, shirt);
  B.add(x, 7.8, z, 1.2, 1.2, 1.2, 0xf5c542);
}

/** A colourful cabana tent with an open front. */
function cabana(B: Bricks, x: number, z: number, color: number): void {
  B.add(x, 3, z, 11, 0.5, 11, 0xf0ead8);
  B.add(x, 3, z, 9, 5, 9, color, { studs: true });
  B.add(x, 8, z, 11, 2, 11, 0xf4f4f2);
  B.add(x, 3.5, z - 4.6, 5, 4, 0.6, 0x9fd8ff, { glow: true });
}

/** Santa-Monica-style beach: sand, surf, a pier with a Ferris wheel, palms,
 *  umbrellas and lifeguard towers, with a low beachfront town behind. */
function caliBeach(B: Bricks): void {
  const sand = 0xecd48c;
  const sandDark = 0xdcc074;
  const sea = 0x2f8fd4;
  const seaLight = 0x69b6e8;
  const deck = 0xb98a4a;
  const deckDark = 0x9c7238;

  // The pad is split into open ocean (seaward, -Z) and sand (shore, +Z), each
  // extending to the pad edge so the water reads as coast joined to the real
  // ocean rather than a lone blue diamond on the grass.
  plate(B, 0, -260, 960, 470, -1, 2.4, sea, 95);
  for (let i = 0; i < 40; i++) {
    const x = (hash2(i, 7) - 0.5) * 900;
    const z = -260 + (hash2(i, 11) - 0.5) * 440;
    B.add(x, 2.5, z, 26, 0.3, 4, seaLight); // foam lines
  }
  plate(B, 0, 220, 960, 500, 0, 3, sand, 95);
  for (let i = 0; i < 34; i++) {
    const x = (hash2(i, 2) - 0.5) * 900;
    const z = 55 + hash2(i, 5) * 380;
    B.add(x, 3, z, 20, 0.3, 20, sandDark);
  }
  // Wet-sand surf line where sea meets shore.
  plate(B, 0, -22, 960, 44, 2.6, 0.6, seaLight, 95);

  // Pier deck on pilings, reaching out over the water.
  const pierZ1 = -150;
  const pierW = 28;
  for (let z = -6; z >= pierZ1; z -= 10) {
    B.add(0, 3, z, pierW, 2, 10, (Math.round(z) / 10) % 2 ? deck : deckDark, { studs: true });
    B.add(-pierW / 2 + 2, -6, z, 2.4, 12, 2.4, 0x6f5330);
    B.add(pierW / 2 - 2, -6, z, 2.4, 12, 2.4, 0x6f5330);
    B.add(-pierW / 2, 5, z, 0.8, 3, 8, 0xf0ead8);
    B.add(pierW / 2, 5, z, 0.8, 3, 8, 0xf0ead8);
  }

  // Ferris wheel and a little arcade at the pier's end.
  ferrisWheel(B, 0, pierZ1 + 20);
  B.add(0, 3, pierZ1 + 52, 22, 12, 16, 0xd5202b, { studs: true });
  B.add(0, 15, pierZ1 + 52, 23, 2, 17, 0xf4f4f2);
  B.add(0, 3, pierZ1 + 60, 8, 7, 1, 0x9fd8ff, { glow: true });

  // Palms lining the top of the beach.
  for (let i = 0; i < 12; i++) {
    palm(B, -150 + i * 27 + (hash2(i, 3) - 0.5) * 8, 120 + (hash2(i, 8) - 0.5) * 20, i * 5 + 1);
  }

  // Beach umbrellas and towels dotted on the sand.
  const brellas = [0xff5a3c, 0x2c6bd6, 0xf7d354, 0x4cb227, 0xff2e88, 0xf4f4f2];
  for (let i = 0; i < 26; i++) {
    const x = (hash2(i, 21) - 0.5) * 280;
    const z = 60 + hash2(i, 23) * 120;
    B.add(x, 3, z, 5, 0.4, 3, brellas[(i + 2) % brellas.length]); // towel
    B.add(x + 3, 3, z, 0.5, 5, 0.5, 0xdddddd); // pole
    B.add(x + 3, 8, z, 9, 1.4, 9, brellas[i % brellas.length]); // canopy
  }

  // Sunbathers and beach-goers dotted across the sand.
  for (let i = 0; i < 40; i++) {
    beachPerson(B, (hash2(i, 51) - 0.5) * 300, 55 + hash2(i, 53) * 120, i * 7 + 3);
  }

  // Colourful cabana tents.
  const tentCols = [0xff5a3c, 0x2c6bd6, 0x18a558, 0xf7d354, 0x9d5cff];
  for (let i = 0; i < 7; i++) {
    cabana(B, -160 + i * 52, 70 + (hash2(i, 55) - 0.5) * 30, tentCols[i % tentCols.length]);
  }

  // Beach-volleyball net with players.
  B.add(-40, 3, 100, 0.8, 10, 0.8, 0xf4f4f2);
  B.add(-24, 3, 100, 0.8, 10, 0.8, 0xf4f4f2);
  B.add(-32, 9, 100, 17, 3, 0.4, 0xf4f4f2);
  beachPerson(B, -36, 90, 61);
  beachPerson(B, -28, 112, 62);

  // Surfers riding boards out in the water.
  const boardCols = [0xff5a3c, 0xf7d354, 0x2c6bd6, 0x4cb227, 0x9d5cff];
  for (let i = 0; i < 9; i++) {
    const x = (hash2(i, 57) - 0.5) * 300;
    const z = -40 - hash2(i, 59) * 90;
    B.add(x, 2.8, z, 3, 0.5, 11, boardCols[i % boardCols.length]);
    B.add(x, 3.3, z, 1.4, 2, 0.9, 0x33363c);
    B.add(x, 5.3, z, 1.6, 2, 1.1, BEACH_SHIRTS[i % BEACH_SHIRTS.length]);
    B.add(x, 7, z, 1.1, 1.1, 1.1, 0xf5c542);
  }

  // Dolphins leaping in the surf just off the sand.
  for (const [dx, dz] of [[-80, -110], [20, -130], [100, -95], [-140, -80]] as const) {
    B.add(dx, 5, dz, 5, 4.5, 13, 0x5a6b78);
    B.add(dx, 4, dz, 6, 1.4, 4, 0xcdd6dc);
    B.add(dx, 8, dz - 7, 3.4, 3.4, 5, 0x5a6b78);
    B.add(dx, 3, dz - 10, 2, 2, 3, 0x5a6b78);
    B.add(dx, 10, dz, 0.7, 3.4, 3, 0x5a6b78);
  }

  // Lifeguard towers.
  for (const lx of [-90, 70]) {
    B.add(lx, 3, 90, 8, 7, 8, 0xdfe6ec);
    B.add(lx, 10, 90, 10, 5, 10, 0xff6a3c, { studs: true });
    B.add(lx, 3, 82, 3, 7, 1, 0x8a6743); // ramp post
  }

  // Low beachfront town set back from the sand.
  const townWalls = [0xf3c1d6, 0xbfe3ff, 0xfff0c2, 0xd7f0d5, 0xe8d5ff];
  const townRoofs = [0xd5202b, 0x2c6bd6, 0xf2a10a, 0x18a558];
  for (let i = 0; i < 18; i++) {
    const x = -170 + i * 20;
    const z = 160 + (hash2(i, 31) - 0.5) * 10;
    const w = 12 + hash2(i, 33) * 4;
    const h = 10 + hash2(i, 35) * 14;
    B.add(x, 0, z, w + 2, 1.2, w + 2, 0xd8d2c4);
    B.add(x, 1, z, w, h, w, townWalls[i % townWalls.length], { studs: true });
    B.add(x, 1 + h, z, w + 1.2, 1.6, w + 1.2, townRoofs[i % townRoofs.length]);
    B.add(x, 4, z - w / 2 - 0.2, 3, 3, 1, 0x9fd8ff, { glow: true });
  }
  // Coast road along the town front.
  B.add(0, 0, 142, 380, 0.9, 12, 0x3e434b);

  // A second row of town buildings further inland so the land side isn't bare.
  for (let i = 0; i < 16; i++) {
    const x = -150 + i * 20 + (hash2(i, 41) - 0.5) * 8;
    const z = 185 + (hash2(i, 43) - 0.5) * 16;
    const w = 12 + hash2(i, 45) * 5;
    const h = 12 + hash2(i, 47) * 18;
    B.add(x, 0, z, w + 2, 1.2, w + 2, 0xd8d2c4);
    B.add(x, 1, z, w, h, w, townWalls[(i + 2) % townWalls.length], { studs: true });
    B.add(x, 1 + h, z, w + 1.2, 1.6, w + 1.2, townRoofs[(i + 1) % townRoofs.length]);
  }
}

function greatWall(B: Bricks, terrain: Terrain, anchorDir: THREE.Vector3, anchorH: number): void {
  const east = new THREE.Vector3();
  const north = new THREE.Vector3();
  tangentBasis(anchorDir, east, north);

  const grey = 0x9aa0a6;
  const dark = 0x82888e;
  const n = 60;
  const pts: { x: number; z: number; y: number }[] = [];
  const probe = new THREE.Vector3();

  for (let i = 0; i < n; i++) {
    const u = i / (n - 1);
    const x = (u - 0.5) * 900;
    const z = Math.sin(u * 7.5) * 70 + Math.sin(u * 3.1) * 45;
    probe
      .copy(anchorDir)
      .multiplyScalar(PLANET_R)
      .addScaledVector(east, x)
      .addScaledVector(north, z)
      .normalize();
    const h = Math.max(terrain.height(probe), 1);
    pts.push({ x, z, y: h - anchorH });
  }

  for (let i = 1; i < n; i++) {
    const a = pts[i - 1];
    const b = pts[i];
    const mx = (a.x + b.x) / 2;
    const mz = (a.z + b.z) / 2;
    const my = Math.min(a.y, b.y) - 3;
    const len = Math.hypot(b.x - a.x, b.z - a.z) + 2.5;
    const ry = -Math.atan2(b.z - a.z, b.x - a.x);
    B.add(mx, my, mz, len, 12, 7.5, i % 2 ? grey : dark, { ry, studs: i % 3 === 0 });
    if (i % 6 === 0) {
      B.add(b.x, b.y - 2, b.z, 13, 18, 13, dark, { studs: true });
    }
  }
}

/* ---------------------------------------------------------------- manager */

interface PlacedLandmark {
  def: LandmarkDef;
  dir: THREE.Vector3;
  worldPos: THREE.Vector3;
  group: THREE.Group;
}

export class LandmarkManager {
  readonly group = new THREE.Group();
  readonly cities: CityFrame[] = [];
  private items: PlacedLandmark[] = [];
  private ads: AdScreens[] = [];
  private discovered = new Set<string>();
  private nearId: string | null = null;

  constructor(private terrain: Terrain) {
    try {
      const raw = localStorage.getItem(DISCOVERED_KEY);
      if (raw) JSON.parse(raw).forEach((id: string) => this.discovered.add(id));
    } catch {
      /* start with an empty collection */
    }
    // Merge a collection pulled from the cloud (after sign-in) into the live game.
    bus.on('import-collection', (ids) => {
      let changed = false;
      for (const id of (ids as string[]) ?? []) {
        if (!this.discovered.has(id)) {
          this.discovered.add(id);
          changed = true;
        }
      }
      if (!changed) return;
      try {
        localStorage.setItem(DISCOVERED_KEY, JSON.stringify([...this.discovered]));
      } catch {
        /* ignore storage failures */
      }
      bus.emit('collection', [...this.discovered]);
    });
  }

  build(): void {
    const east = new THREE.Vector3();
    const north = new THREE.Vector3();
    const q = new THREE.Quaternion();

    for (const def of LANDMARKS) {
      const dir = latLonToDir(def.lat * DEG2RAD, def.lon * DEG2RAD);
      const anchorH = Math.max(this.terrain.height(dir), 1);
      const S = landmarkScale(def.id);
      const B = new Bricks();
      B.curveScale = S;

      switch (def.id) {
        case 'eiffel': eiffel(B); break;
        case 'nyc': nyc(B); break;
        case 'taj': taj(B); break;
        case 'wall': greatWall(B, this.terrain, dir, anchorH); break;
        case 'sydney': sydney(B); break;
        case 'colosseum': colosseum(B); break;
        case 'fuji': fuji(B); break;
        case 'giza': giza(B); break;
        case 'bigben': bigben(B); break;
        case 'burj': burj(B); break;
        case 'cali': caliBeach(B); break;
      }

      const cfg = CITY_CONFIGS[def.id];
      const seed = Math.abs(def.lat * 7 + def.lon);
      if (cfg?.style) city(B, cfg.style, seed);
      // Fill the flat pad out to its edge with a mid-rise belt so the landmark
      // isn't marooned on empty lawn. Skip the mountain and the wall.
      if (cfg?.style && def.flat && def.id !== 'fuji') {
        const rInner = cfg.style.rings[cfg.style.rings.length - 1] + 14;
        const rOuter = (def.flat / S) * 0.9;
        if (rOuter > rInner + 40) suburbs(B, cfg.style, seed + 91, rInner, rOuter);
      }

      const group = B.build();
      if (def.id === 'nyc') {
        // Attach the animated Times Square billboards as children so they ride
        // the group's placement (and scale) on the globe.
        const screens = createAdScreens(NYC_AD_TOWERS);
        for (const o of screens.objects) group.add(o);
        this.ads.push(screens);
      }
      group.scale.setScalar(S);
      // Snap the base onto the top of the quantized voxel terrain so
      // monuments sit flush on the bricks instead of sinking into them.
      const baseR = PLANET_R + Math.ceil(Math.max(anchorH, 1) / BRICK_H) * BRICK_H + 0.2;
      group.position.copy(dir).multiplyScalar(baseR);
      tangentBasis(dir, east, north);
      basisQuat(east, dir, north, q);
      group.quaternion.copy(q);
      this.group.add(group);

      if (cfg?.frame) {
        this.cities.push({
          origin: dir.clone().multiplyScalar(baseR),
          up: dir.clone(),
          east: east.clone(),
          north: north.clone(),
          ring: cfg.frame.ring * S,
          plaza: cfg.frame.plaza * S,
          groundY: cfg.frame.groundY * S
        });
      }

      this.items.push({ def, dir, worldPos: group.position.clone(), group });
    }

    this.emitCollection();
  }

  updateAds(elapsed: number): void {
    for (const a of this.ads) a.update(elapsed);
  }

  update(planePos: THREE.Vector3): void {
    let near: PlacedLandmark | null = null;
    for (const item of this.items) {
      if (planePos.distanceTo(item.worldPos) < item.def.radius) {
        near = item;
        break;
      }
    }

    const id = near ? near.def.id : null;
    if (id !== this.nearId) {
      this.nearId = id;
      if (near) {
        const isNew = !this.discovered.has(near.def.id);
        if (isNew) {
          this.discovered.add(near.def.id);
          this.persist();
          bus.emit('discovered', { def: near.def, count: this.discovered.size, total: LANDMARKS.length });
          this.emitCollection();
        }
        bus.emit('landmark', { def: near.def, isNew });
      } else {
        bus.emit('landmark', null);
      }
    }
  }

  private persist(): void {
    try {
      localStorage.setItem(DISCOVERED_KEY, JSON.stringify([...this.discovered]));
    } catch {
      /* non-persistent session */
    }
  }

  private emitCollection(): void {
    bus.emit('collection', [...this.discovered]);
  }
}
