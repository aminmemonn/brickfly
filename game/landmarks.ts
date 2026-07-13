import * as THREE from 'three';
import { PLANET_R, BRICK_H, STUD_PITCH } from './constants';
import { CityFrame } from './life';
import { Terrain } from './terrain';
import { LANDMARKS, LandmarkDef } from './landmark-data';
import { latLonToDir, tangentBasis, basisQuat, sphereMap, hash2, DEG2RAD } from './util';
import { NYC_AD_TOWERS, createAdScreens, AdScreens, AdTower } from './adscreens';
import { bus } from './bus';
import { ABS_BRICK_MATERIAL, makeABSBrickGeometry, makeStudGridAttribute } from './brick-material';
import { BrickStudPool, studCountForSpan } from './brick-stud-pool';

const DISCOVERED_KEY = 'brickfly.discovered';

/**
 * How much bigger than authored each landmark is rendered, to reach a more
 * real-life sense of scale. The brick builder compensates sphere curvature for
 * this factor and the city frames (cars/people) scale to match.
 */
export const LANDMARK_SCALE: Record<string, number> = {
  nyc: 3.4,
  eiffel: 8.0,
  bigben: 8.5,
  // 7 keeps the arena colossal; at 9 the ring city spread so thin that Rome
  // read as empty lawn with a few lonely giant houses.
  colosseum: 7.0,
  taj: 6.0,
  sydney: 6.0,
  burj: 5.5,
  giza: 6.0,
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
  beam: boolean;
}

const sharedGlowGeo = new THREE.BoxGeometry(1, 1, 1);
const glowMat = new THREE.MeshBasicMaterial();
// Volumetric-looking light columns (pyramid beams, spotlights): additive and
// translucent so they read as light, not plastic.
const beamMat = new THREE.MeshBasicMaterial({
  transparent: true,
  opacity: 0.3,
  blending: THREE.AdditiveBlending,
  depthWrite: false,
  fog: false
});

/**
 * Collects axis-aligned (plus Y-rotated) bricks in a local tangent frame.
 * At build time every brick is mapped EXACTLY onto the sphere: positioned on
 * the curved surface and tilted to the local normal. A single tangent frame
 * for a city the size of Manhattan otherwise leaves towers at the far ends
 * leaning ~14 degrees off vertical (the "tilted city" bug).
 */
class Bricks {
  list: BrickSpec[] = [];
  /** Group scale this brickset will be rendered at, so the sphere-curvature
   *  mapping is applied for the final world size, not the local size. */
  curveScale = 1;

  private get localR(): number {
    return PLANET_R / this.curveScale;
  }

  add(
    x: number,
    y: number,
    z: number,
    w: number,
    h: number,
    d: number,
    color: number,
    opts: { ry?: number; studs?: boolean; glow?: boolean; beam?: boolean } = {}
  ): void {
    this.list.push({
      x,
      y,
      z,
      w,
      h,
      d,
      color,
      ry: opts.ry ?? 0,
      studs: opts.studs ?? false,
      glow: opts.glow ?? false,
      beam: opts.beam ?? false
    });
  }

  build(): THREE.Group {
    const group = new THREE.Group();
    const solid = this.list.filter((b) => !b.glow && !b.beam);
    const glows = this.list.filter((b) => b.glow);
    const beams = this.list.filter((b) => b.beam);
    const brickGeometry = makeABSBrickGeometry();
    const studGrid = makeStudGridAttribute(solid.length);
    brickGeometry.setAttribute('instanceStudGrid', studGrid);
    const bricks = new THREE.InstancedMesh(brickGeometry, ABS_BRICK_MATERIAL, solid.length);
    const m = new THREE.Matrix4();
    const q = new THREE.Quaternion();
    const qTilt = new THREE.Quaternion();
    const e = new THREE.Euler();
    const pos = new THREE.Vector3();
    const scale = new THREE.Vector3();
    const col = new THREE.Color();
    const r = this.localR;

    const place = (mesh: THREE.InstancedMesh, b: BrickSpec, i: number) => {
      e.set(0, b.ry, 0);
      q.setFromEuler(e);
      sphereMap(b.x, b.y + b.h / 2, b.z, r, pos, qTilt);
      q.premultiply(qTilt);
      scale.set(b.w, b.h, b.d);
      m.compose(pos, q, scale);
      mesh.setMatrixAt(i, m);
      mesh.setColorAt(i, col.setHex(b.color));
    };

    solid.forEach((b, i) => {
      place(bricks, b, i);
      const nx = studCountForSpan(b.w, STUD_PITCH);
      const nz = studCountForSpan(b.d, STUD_PITCH);
      studGrid.setXY(i, nx > 0 && nz > 0 ? nx : 0, nx > 0 && nz > 0 ? nz : 0);
    });

    bricks.instanceMatrix.needsUpdate = true;
    studGrid.needsUpdate = true;
    if (bricks.instanceColor) bricks.instanceColor.needsUpdate = true;
    bricks.castShadow = true;
    bricks.receiveShadow = true;
    group.add(bricks);

    if (glows.length > 0) {
      const glow = new THREE.InstancedMesh(sharedGlowGeo, glowMat, glows.length);
      glows.forEach((b, i) => place(glow, b, i));
      glow.instanceMatrix.needsUpdate = true;
      if (glow.instanceColor) glow.instanceColor.needsUpdate = true;
      group.add(glow);
    }

    if (beams.length > 0) {
      const beam = new THREE.InstancedMesh(sharedGlowGeo, beamMat, beams.length);
      beams.forEach((b, i) => place(beam, b, i));
      beam.instanceMatrix.needsUpdate = true;
      if (beam.instanceColor) beam.instanceColor.needsUpdate = true;
      group.add(beam);
    }

    return group;
  }

  registerStudSurfaces(pool: BrickStudPool, group: THREE.Group): void {
    group.updateMatrixWorld(true);
    const worldScale = new THREE.Vector3();
    const groupQuaternion = new THREE.Quaternion();
    const localQuaternion = new THREE.Quaternion();
    const tiltQuaternion = new THREE.Quaternion();
    const worldQuaternion = new THREE.Quaternion();
    const topCenter = new THREE.Vector3();
    const axisX = new THREE.Vector3();
    const axisY = new THREE.Vector3();
    const axisZ = new THREE.Vector3();
    const color = new THREE.Color();
    const yAxis = new THREE.Vector3(0, 1, 0);
    const r = this.localR;
    group.getWorldScale(worldScale);
    group.getWorldQuaternion(groupQuaternion);

    for (const brick of this.list) {
      if (brick.glow || brick.beam) continue;
      const nx = studCountForSpan(brick.w, STUD_PITCH);
      const nz = studCountForSpan(brick.d, STUD_PITCH);
      if (nx === 0 || nz === 0) continue;
      localQuaternion.setFromAxisAngle(yAxis, brick.ry);
      sphereMap(brick.x, brick.y + brick.h, brick.z, r, topCenter, tiltQuaternion);
      worldQuaternion.copy(groupQuaternion).multiply(tiltQuaternion).multiply(localQuaternion);
      axisX.set(1, 0, 0).applyQuaternion(worldQuaternion);
      axisY.set(0, 1, 0).applyQuaternion(worldQuaternion);
      axisZ.set(0, 0, 1).applyQuaternion(worldQuaternion);
      topCenter.applyMatrix4(group.matrixWorld);
      pool.registerSurface({
        center: topCenter,
        axisX,
        axisY,
        axisZ,
        width: brick.w * worldScale.x,
        depth: brick.d * worldScale.z,
        bodyHeight: brick.h * worldScale.y,
        pitch: STUD_PITCH * Math.min(worldScale.x, worldScale.z),
        color: color.setHex(brick.color)
      });
    }
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

const CITY_CONFIGS: Record<
  string,
  {
    style?: CityStyle;
    frame?: { ring: number; plaza: number; groundY: number };
    /** Landmark builds its own bespoke downtown; skip the generic ring city. */
    custom?: { rInner: number; avoid?: (x: number, z: number) => boolean };
  }
> = {
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
    frame: { ring: 60, plaza: 42, groundY: 1.4 },
    custom: {
      rInner: 158,
      avoid: (x, z) =>
        Math.abs(z + 150) < 26 || // the Seine
        (Math.abs(x) < 44 && z > 55 && z < 215) || // Champ de Mars lawn
        Math.hypot(x + 165, z - 70) < 46 || // Arc de Triomphe circle
        Math.hypot(x - 150, z + 195) < 62 // the Louvre
    }
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
    frame: { ring: 68, plaza: 50, groundY: 1.4 },
    custom: {
      rInner: 160,
      avoid: (x, z) =>
        Math.abs(z - 100) < 24 || // the Thames
        Math.hypot(x - 95, z - 145) < 42 || // London Eye
        Math.hypot(x + 160, z - 100) < 40 // Tower Bridge
    }
  },
  colosseum: {
    style: {
      walls: [0xd98859, 0xc97748, 0xe0a067],
      roofs: [0xb5533c, 0xa64a35],
      band: 0xf0e0c8,
      floors: [4, 8],
      plaza: 58,
      road: 74,
      rings: [82, 108, 136],
      perRing: [14, 18, 22],
      trees: 14
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
  nyc: { frame: { ring: 210, plaza: 260, groundY: 3 } }
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
function suburbs(
  B: Bricks,
  s: CityStyle,
  seed: number,
  rInner: number,
  rOuter: number,
  avoid?: (x: number, z: number) => boolean
): void {
  // Concentric ring roads.
  for (let r = rInner + 18; r < rOuter; r += 62) {
    const seg = Math.max(28, Math.floor(r / 5));
    for (let i = 0; i < seg; i++) {
      const a = (i / seg) * Math.PI * 2;
      const rx = Math.cos(a) * r;
      const rz = Math.sin(a) * r;
      if (avoid?.(rx, rz)) continue;
      B.add(rx, 0, rz, 8, 0.8, 8, 0x3a3f46, { ry: -a });
    }
  }

  // Low-rise blocks on a polar grid, so the landmark towers over its town.
  // Bright accent roofs keep the belt colourful rather than a grey slab.
  const ACCENTS = [0xd6382c, 0x2c6bd6, 0xf2a10a, 0x18a558, 0x9d5cff, 0x2e9e9b, 0xff7a1a];
  let n = 0;
  for (let r = rInner + 20; r < rOuter - 8; r += 24) {
    const count = Math.max(10, Math.floor((2 * Math.PI * r) / 32));
    for (let i = 0; i < count; i++) {
      const a = ((i + (Math.round(r) % 2 ? 0.5 : 0)) / count) * Math.PI * 2;
      // keep the four cardinal avenues open
      if (Math.min(Math.abs(Math.cos(a)), Math.abs(Math.sin(a))) < 0.06) continue;
      const jr = r + (hash2(seed + n, 3) - 0.5) * 16;
      const x = Math.cos(a) * jr;
      const z = Math.sin(a) * jr;
      if (avoid?.(x, z)) continue;
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
    if (avoid?.(x, z)) continue;
    B.add(x, 1, z, 1.1, 3, 1.1, 0x8a6743);
    B.add(x, 4, z, 4.2, 4.2, 4.2, i % 2 ? 0x2e7d1e : 0x3fa021);
  }
}

/* ---------------------------------------------------------------- builders */

function eiffel(B: Bricks): void {
  const iron = 0x8a6a4c;
  const dark = 0x6e5238;
  const gold = 0xffd24a;

  // Four curved lattice legs merging into the tower body.
  const half = (t: number) => 34 * Math.pow(1 - t, 1.65) + 5.5;
  for (let y = 0; y < 80; y += 3.2) {
    const t = y / 80;
    const w = half(t);
    const lw = 6.2 * (1 - t) + 2.2;
    const color = Math.round(y / 3.2) % 2 ? iron : dark;
    for (const sx of [-1, 1]) {
      for (const sz of [-1, 1]) {
        B.add(sx * w, y, sz * w, lw, 3.2, lw, color);
      }
    }
    // Ring girders tying the legs into a lattice.
    if (Math.round(y / 3.2) % 3 === 0 && y > 3 && y < 76) {
      B.add(0, y + 1, 0, w * 2 + lw, 1.3, 2.2, iron);
      B.add(0, y + 1, 0, 2.2, 1.3, w * 2 + lw, iron);
    }
  }

  // Ground arches sweeping between the feet on all four faces.
  const w0 = half(0);
  for (const s of [-1, 1]) {
    B.add(0, 17, s * w0, w0 * 1.5, 3, 2.8, dark);
    B.add(s * w0, 17, 0, 2.8, 3, w0 * 1.5, dark);
    for (let k = 1; k <= 3; k++) {
      const drop = k * k * 1.5;
      const off = w0 * (0.3 + k * 0.18);
      B.add(off, 17 - drop, s * w0, 2.4, 2.8, 2.4, dark);
      B.add(-off, 17 - drop, s * w0, 2.4, 2.8, 2.4, dark);
      B.add(s * w0, 17 - drop, off, 2.4, 2.8, 2.4, dark);
      B.add(s * w0, 17 - drop, -off, 2.4, 2.8, 2.4, dark);
    }
  }

  // Observation platforms with golden edge lights.
  const platform = (y: number, w: number) => {
    B.add(0, y, 0, w, 3.2, w, dark, { studs: true });
    B.add(0, y + 3.2, 0, w - 3, 1.2, w - 3, iron);
    for (const s of [-1, 1]) {
      B.add(s * (w / 2), y + 2.4, 0, 1.1, 1.1, w, gold, { glow: true });
      B.add(0, y + 2.4, s * (w / 2), w, 1.1, 1.1, gold, { glow: true });
    }
  };
  platform(26, 2 * half(26 / 80) + 12);
  platform(52, 2 * half(52 / 80) + 9);

  // Upper column to the summit deck.
  for (let y = 80; y < 122; y += 3.2) {
    const t = (y - 80) / 42;
    const w = 11 * (1 - t) + 5.2;
    B.add(0, y, 0, w, 3.2, w, Math.round(y / 3.2) % 2 ? iron : dark);
  }

  // Summit deck, antenna, beacon and tricolour.
  B.add(0, 122, 0, 10.5, 3, 10.5, dark, { studs: true });
  B.add(0, 125, 0, 8, 1.2, 8, gold, { glow: true });
  B.add(0, 126.2, 0, 3.4, 6, 3.4, iron);
  for (let y = 132; y < 146; y += 3.5) {
    B.add(0, y, 0, 1.7, 3.5, 1.7, Math.round(y / 3.5) % 2 ? iron : dark);
  }
  B.add(0, 146, 0, 2.6, 2.6, 2.6, 0xfff3c2, { glow: true });
  B.add(0, 149, 0, 1, 5, 1, 0xf4f4f2);
  B.add(2.2, 151, 0, 2.4, 4, 0.4, 0x2c3e9e, { glow: true });
  B.add(4.6, 151, 0, 2.4, 4, 0.4, 0xf4f4f2, { glow: true });
  B.add(7, 151, 0, 2.4, 4, 0.4, 0xd5202b, { glow: true });

  // Summit searchlight, firing straight up like the real night beacon.
  B.add(0, 150, 0, 3, 130, 3, 0xfff2c8, { beam: true });

  // Champagne sparkle: dozens of tiny golden lights riding the frame.
  for (let i = 0; i < 60; i++) {
    const y = hash2(i, 41) * 120;
    let x: number;
    let z: number;
    if (y < 80) {
      const w = half(y / 80);
      const sx = hash2(i, 43) > 0.5 ? 1 : -1;
      const sz = hash2(i, 47) > 0.5 ? 1 : -1;
      x = sx * (w + 1.2) * (0.75 + hash2(i, 53) * 0.3);
      z = sz * (w + 1.2) * (0.75 + hash2(i, 59) * 0.3);
    } else {
      const w = 11 * (1 - (y - 80) / 42) + 5.2;
      x = (hash2(i, 43) - 0.5) * (w + 2);
      z = (hash2(i, 47) - 0.5) * (w + 2);
    }
    B.add(x, y, z, 0.9, 0.9, 0.9, 0xffe9a0, { glow: true });
  }
}

/**
 * Bespoke Paris downtown: Champ de Mars, Trocadéro fountains, the Seine with
 * lamp-lined bridges, Haussmann boulevards, the Arc de Triomphe on its star
 * plaza and the Louvre with its glowing glass pyramid.
 */
function parisDowntown(B: Bricks): void {
  const cream = 0xefe3c8;
  const cream2 = 0xe6d8b8;
  const mansard = 0x53616f;
  const lawn = 0x3fa021;
  const lawn2 = 0x4cb227;
  const water = 0x3f8fd4;
  const stone = 0xcfc6b2;
  const asphalt = 0x3e434b;
  const gold = 0xffd98a;

  // Plaza under the tower + the square ring road the traffic loop drives.
  B.add(0, 0, 0, 96, 1.2, 96, 0xc9cdd3);
  B.add(0, 0, 0, 96, 1.2, 96, 0xc9cdd3, { ry: Math.PI / 4 });
  const R = 60;
  for (let side = 0; side < 4; side++) {
    const horizontal = side % 2 === 0;
    const off = side < 2 ? R : -R;
    if (horizontal) B.add(0, 0, off, R * 2 + 10, 0.9, 10, asphalt);
    else B.add(off, 0, 0, 10, 0.9, R * 2 + 10, asphalt);
  }

  // Champ de Mars: a long tree-lined lawn stretching south of the tower.
  plate(B, 0, 140, 74, 145, 0.4, 1.4, lawn, 70);
  B.add(0, 1.9, 140, 9, 0.4, 145, 0xd9cdb0);
  for (let i = 0; i < 9; i++) {
    const z = 80 + i * 15;
    for (const sx of [-31, 31]) {
      B.add(sx, 1, z, 1.4, 4, 1.4, 0x8a6743);
      B.add(sx, 5.5, z, 5.5, 5, 5.5, i % 2 ? 0x2e7d1e : lawn2);
    }
  }
  // École Militaire closing the vista.
  B.add(0, 0, 224, 64, 14, 18, cream, { studs: true });
  B.add(0, 14, 224, 66, 3, 20, mansard);
  B.add(0, 17, 224, 18, 8, 14, cream2);
  B.add(0, 25, 224, 20, 2.5, 16, mansard);

  // Trocadéro esplanade + fountain jets across the river axis.
  B.add(0, 0, -88, 80, 1.6, 44, stone);
  B.add(0, 1.6, -88, 40, 1, 26, water);
  for (let i = -2; i <= 2; i++) B.add(i * 8, 2.6, -88, 1.4, 3.5, 1.4, 0xbfe9ff, { glow: true });
  for (const s of [-1, 1]) {
    B.add(s * 34, 0, -106, 26, 16, 12, cream, { ry: s * 0.5, studs: true });
    B.add(s * 34, 16, -106, 28, 3, 14, mansard, { ry: s * 0.5 });
  }

  // The Seine: a broad blue ribbon with stone quays and two lamp-lit bridges.
  plate(B, 0, -150, 400, 30, -0.6, 1.6, water, 100);
  plate(B, 0, -168, 400, 6, 0.4, 1.4, stone, 100);
  plate(B, 0, -132, 400, 6, 0.4, 1.4, stone, 100);
  for (const bx of [-60, 60]) {
    B.add(bx, 1.4, -150, 16, 1.6, 40, 0xd8d2c4, { studs: true });
    B.add(bx - 7, 0.6, -150, 2, 2.5, 40, stone);
    B.add(bx + 7, 0.6, -150, 2, 2.5, 40, stone);
    for (const lz of [-164, -136]) {
      for (const s of [-1, 1]) {
        B.add(bx + s * 7, 3, lz, 0.8, 3.5, 0.8, 0x33363c);
        B.add(bx + s * 7, 6.8, lz, 1.2, 1.2, 1.2, gold, { glow: true });
      }
    }
  }
  // A bateau-mouche drifting under the bridges.
  B.add(-20, 0.8, -150, 8, 2.2, 26, 0xf4f4f2);
  B.add(-20, 3, -150, 6, 2, 16, 0x9fd8ff, { glow: true });

  // Haussmann quarters: cream facades, mansard roofs, warm balcony bands.
  let n = 0;
  for (let gx = -152; gx <= 152; gx += 38) {
    for (let gz = -104; gz <= 48; gz += 36) {
      if (Math.abs(gx) < 60 && Math.abs(gz) < 60) continue; // tower plaza + ring
      if (Math.abs(gx) < 46 && gz > -110 && gz < -60) continue; // Trocadéro
      if (Math.hypot(gx + 165, gz - 70) < 48) continue; // Arc plaza
      if (Math.abs(Math.abs(gx) - 60) < 10) continue; // bridge boulevards
      const w = 17 + hash2(n, 3) * 6;
      const h = 13 + hash2(n, 7) * 6;
      B.add(gx, 0, gz, w + 3, 1.2, w + 3, 0xc4c9cf);
      B.add(gx, 1, gz, w, h, w, n % 2 ? cream : cream2, { studs: true });
      B.add(gx, 1 + h, gz, w + 1.4, 2.8, w + 1.4, mansard);
      B.add(gx, 3.8 + h, gz, w * 0.55, 2.2, w * 0.55, mansard);
      for (let y = 4.6; y < h - 2; y += 4.6) {
        B.add(gx, 1 + y, gz, w + 0.5, 0.9, w + 0.5, 0xffe2ad, { glow: true });
      }
      n++;
    }
  }

  // Arc de Triomphe on its own star plaza, eternal flame below the vault.
  const AX = -165;
  const AZ = 70;
  B.add(AX, 0, AZ, 66, 1.2, 66, 0xc9cdd3, { ry: Math.PI / 8 });
  B.add(AX, 0, AZ, 66, 1.2, 66, 0xc9cdd3, { ry: -Math.PI / 8 });
  for (const s of [-1, 1]) B.add(AX + s * 10, 1, AZ, 8, 24, 13, cream, { studs: true });
  B.add(AX, 25, AZ, 30, 8, 15, cream);
  B.add(AX, 33, AZ, 26, 3.5, 13, cream2);
  B.add(AX, 1.2, AZ, 2, 2, 2, 0xffb347, { glow: true });

  // Avenue des Champs-Élysées running from the Arc toward the tower plaza.
  B.add(-82.5, 0, 35, 172, 0.9, 11, asphalt, { ry: Math.atan2(70, -165) + Math.PI });
  for (let k = 1; k < 7; k++) {
    const t = k / 7;
    const x = AX * (1 - t);
    const z = AZ * (1 - t);
    for (const s of [-1, 1]) {
      const px = x + s * 8 * (AZ / 179);
      const pz = z + s * 8 * (165 / 179);
      B.add(px, 1, pz, 0.7, 5, 0.7, 0x33363c);
      B.add(px, 6.4, pz, 1.3, 1.3, 1.3, gold, { glow: true });
    }
  }

  // The Louvre: palace wings wrapping the glowing glass pyramid.
  const LX = 150;
  const LZ = -195;
  B.add(LX, 0, LZ, 74, 1.4, 54, 0xd8d2c4, { studs: true });
  B.add(LX, 1, LZ - 21, 70, 12, 12, cream, { studs: true });
  B.add(LX - 31, 1, LZ + 2, 12, 12, 34, cream);
  B.add(LX + 31, 1, LZ + 2, 12, 12, 34, cream);
  B.add(LX, 13, LZ - 21, 72, 2.5, 14, mansard);
  B.add(LX - 31, 13, LZ + 2, 14, 2.5, 36, mansard);
  B.add(LX + 31, 13, LZ + 2, 14, 2.5, 36, mansard);
  for (let k = 0; k < 5; k++) {
    B.add(LX, 1.4 + k * 2.6, LZ + 6, 16 - k * 3, 2.6, 16 - k * 3, 0x9fe8ff, { glow: k % 2 === 0 });
  }
}

// Real-life-ish Manhattan facade palette: glass, brick, limestone and steel.
const NYC_FACADES = [
  0x8fb4c9, 0x6fae9e, 0xb5623f, 0x9c6b4a, 0xd9cdb0, 0x5a7fa0, 0xc7d0d6, 0x7d8a94, 0xa8c4b0, 0x4f6472,
  0x3f6fb0, 0x2f9e8f, 0xcf7a3a, 0xd8b44a, 0x6b5b95, 0xb0555f, 0x4a8db5, 0x9ec6dd, 0xe0d7c2, 0x557a55
];

// Bright glowing colours for rooftop billboards that break up the skyline.
const NYC_ROOF_SIGNS = [0xff3b6b, 0xffd21e, 0x38e1ff, 0x2fd08f, 0xff8a3a, 0xc46bff];

// Animated billboards scattered across Manhattan (beyond Times Square). Each is
// built as a dark-glass tower so its ad screen sits flush on the face. Kept away
// from Central Park, the Times Square core and the named supertalls.
const NYC_ADS_SCATTERED: AdTower[] = [
  { x: -120, z: -260, w: 30, h: 210, face: 'px' },
  { x: 120, z: -220, w: 28, h: 224, face: 'nx' },
  { x: -60, z: 300, w: 30, h: 206, face: 'px' },
  { x: 60, z: 250, w: 30, h: 196, face: 'nx' },
  { x: -180, z: 60, w: 26, h: 182, face: 'px' },
  { x: 180, z: -120, w: 26, h: 188, face: 'nx' },
  { x: 180, z: -470, w: 26, h: 200, face: 'nx' },
  { x: -120, z: 440, w: 28, h: 198, face: 'px' },
  { x: 120, z: 150, w: 30, h: 212, face: 'nx' },
  { x: -60, z: -140, w: 30, h: 218, face: 'px' },
  { x: -180, z: -420, w: 28, h: 214, face: 'px' },
  { x: 180, z: 320, w: 28, h: 206, face: 'nx' },
  { x: -120, z: 640, w: 30, h: 220, face: 'px' },
  { x: 120, z: -640, w: 28, h: 208, face: 'nx' },
  { x: 60, z: 560, w: 26, h: 190, face: 'nx' },
  { x: -60, z: -560, w: 26, h: 186, face: 'px' }
];

// Window tones cycled across the skyline so night floors aren't one flat cream.
const NYC_WIN_TONES = [0xffe9a8, 0xcfe4ff, 0xbfead9, 0xffd9c4];

/** A full grid Manhattan: rivers, avenues and cross-streets with flyable gaps,
 *  colourful glass/brick towers, Central Park, a Times Square screen district
 *  and a few named supertalls. */
function nyc(B: Bricks): void {
  const asphalt = 0x3c4046;
  const stripe = 0x6a707a;
  const win = 0xffe98a;
  const HX = 300; // island half-width
  const HZ = 1040; // island half-length — bigger, GTA-style scale

  // Tapered island outline: full width through the body, narrowing to points at
  // the north/south tips (like the real Manhattan / Battery Park).
  const islandHalf = (cz: number): number => {
    const t = Math.max(0, (Math.abs(cz) - 0.56 * HZ) / (0.44 * HZ));
    return HX * (1 - 0.82 * t * t);
  };

  // Solid island built as tapered z-slices matching the building shoreline. Each
  // slice is a DEEP bedrock block that drops well below the harbour surface, so
  // the island reads as land rising from the seabed instead of a thin slab
  // floating over the water (no see-under, no water seeping through the streets).
  const TILE = 108;
  const bedrock = 0x4a4640;
  for (let cz = -HZ - 10; cz <= HZ + 10; cz += TILE) {
    const halfW = islandHalf(cz) + 22;
    const nx = Math.max(1, Math.ceil((2 * halfW) / TILE));
    const tw = (2 * halfW) / nx;
    for (let i = 0; i < nx; i++) {
      const x = -halfW + (i + 0.5) * tw;
      B.add(x, -14, cz, tw + 1, 17, TILE + 1, bedrock); // deep foundation below sea
      B.add(x, 2.4, cz, tw + 1, 0.8, TILE + 1, asphalt); // dark asphalt street cap
    }
  }

  // Wide avenues + cross-streets (only where there is island under them).
  for (let ax = -252; ax <= 252; ax += 84) {
    for (let z = -HZ; z < HZ; z += 110) {
      if (Math.abs(ax) < islandHalf(z) - 10) B.add(ax, 3.2, z + 55, 9, 0.4, 112, stripe);
    }
  }
  for (let z = -HZ; z <= HZ; z += 76) {
    const hw = islandHalf(z) - 10;
    for (let x = -hw; x < hw; x += 110) B.add(x + 55, 3.2, z, 112, 0.4, 9, stripe);
  }

  // Central Park: a long green rectangle with a pond and trees.
  const parkZ0 = -640;
  const parkZ1 = -320;
  B.add(0, 3, (parkZ0 + parkZ1) / 2, 320, 1.8, parkZ1 - parkZ0, 0x3fa021, { studs: true });
  B.add(-60, 4, -470, 100, 1, 66, 0x3f8fd4);
  for (let i = 0; i < 64; i++) {
    const tx = (hash2(i, 3) - 0.5) * 300;
    const tz = parkZ0 + hash2(i, 7) * (parkZ1 - parkZ0);
    B.add(tx, 4, tz, 1.6, 4, 1.6, 0x8a6743);
    B.add(tx, 8, tz, 7, 7, 7, i % 2 ? 0x2e7d1e : 0x3fa021);
  }

  // City blocks — wide flyable avenues, stepped Art-Deco setbacks and spires for
  // a varied, artistic skyline. Buildings are inset from the tapered shoreline.
  const allAds = [...NYC_AD_TOWERS, ...NYC_ADS_SCATTERED];
  const nearAd = (x: number, z: number) =>
    allAds.some((t) => Math.abs(x - t.x) < 44 && Math.abs(z - t.z) < 44);

  let n = 0;
  for (let cx = -252; cx <= 252; cx += 84) {
    for (let cz = -HZ + 96; cz <= HZ - 96; cz += 78) {
      if (Math.abs(cx) > islandHalf(cz) - 46) continue; // inset from the shore
      if (cz > parkZ0 - 12 && cz < parkZ1 + 12 && Math.abs(cx) < 176) continue; // park
      if (Math.abs(cx) < 62 && Math.abs(cz) < 96) continue; // Times Square core
      if (nearAd(cx, cz)) continue; // billboard towers built below
      const r1 = hash2(cx * 3 + n, cz * 5 + 7);
      const r2 = hash2(cx * 7 + 13, cz * 3 + n);
      const w = 42 + r1 * 18;
      const d = 36 + r2 * 14;
      // Two skyline peaks: Midtown (z≈0) and the Financial District (z≈+800).
      const midtown = 1 - Math.min(1, Math.abs(cz) / 380);
      const downtown = 1 - Math.min(1, Math.abs(cz - 800) / 280);
      const peak = Math.max(midtown, downtown * 0.9);
      const h1 = 26 + peak * 156 + r1 * 54;
      const ci = Math.floor(hash2(cx * 11 + 5, cz * 13 + 3) * NYC_FACADES.length) % NYC_FACADES.length;
      const ci2 = (ci + 3 + Math.floor(r2 * 5)) % NYC_FACADES.length;
      const tone = NYC_WIN_TONES[Math.floor(hash2(cx * 23 + 1, cz * 29 + 7) * NYC_WIN_TONES.length) % NYC_WIN_TONES.length];
      B.add(cx, 3, cz, w + 4, 1, d + 4, 0x9a9ea3); // sidewalk footprint
      B.add(cx, 3, cz, w, h1, d, NYC_FACADES[ci], { studs: true });
      for (let y = 12; y < h1 - 6; y += 9) {
        // some floors stay dark so the night skyline reads lived-in, not striped
        if (hash2(cx + y * 3, cz - y * 5) > 0.84) continue;
        B.add(cx, 3 + y, cz, w + 0.6, 1.3, d + 0.6, tone, { glow: true });
      }
      // Setback upper tier.
      const h2 = 14 + r2 * 48;
      const w2 = w * 0.66;
      const d2 = d * 0.66;
      B.add(cx, 3 + h1, cz, w2, h2, d2, NYC_FACADES[ci2], { studs: true });
      for (let y = 8; y < h2 - 4; y += 9) {
        if (hash2(cx - y * 7, cz + y * 3) > 0.84) continue;
        B.add(cx, 3 + h1 + y, cz, w2 + 0.6, 1.2, d2 + 0.6, tone, { glow: true });
      }
      // Neon corner strips on the tall midtown towers.
      if (h1 > 120) {
        const neon = NYC_ROOF_SIGNS[(ci * 7 + 1) % NYC_ROOF_SIGNS.length];
        for (const sx of [-1, 1]) {
          B.add(cx + sx * (w / 2 + 0.4), 3 + h1 * 0.3, cz + (d / 2 + 0.4), 1, h1 * 0.62, 1, neon, { glow: true });
        }
      }
      // Crown: rooftop billboard, spire, or brick water-tower for variety.
      const cap = hash2(cx * 17 + 9, cz * 19 + 1);
      const topY = 3 + h1 + h2;
      if (cap > 0.72) {
        const sign = NYC_ROOF_SIGNS[ci % NYC_ROOF_SIGNS.length];
        B.add(cx, topY + 7, cz, w2 * 0.92, 13, 2.6, sign, { glow: true });
        B.add(cx, topY, cz, 2.6, 8, 2.6, 0x5f666e);
      } else if (cap > 0.46) {
        const sp = 22 + r1 * 30;
        B.add(cx, topY, cz, 3, sp, 3, 0xc9d2da);
        B.add(cx, topY + sp, cz, 1.2, 9, 1.2, 0xff3b6b, { glow: true });
        // parapet neon trim under the spire
        B.add(cx, topY - 1.4, cz, w2 + 0.8, 1.1, d2 + 0.8, NYC_ROOF_SIGNS[(ci + 2) % NYC_ROOF_SIGNS.length], { glow: true });
      } else {
        B.add(cx + w2 * 0.22, topY, cz, 6, 7, 6, 0x7a5a3a); // rooftop water tower
        B.add(cx + w2 * 0.22, topY + 7, cz, 7, 3, 7, 0x5a3f28);
      }
      n++;
    }
  }

  // Times Square + scattered billboard towers: dark glass, glowing trim, beacon.
  for (const t of allAds) {
    B.add(t.x, 3, t.z, t.w, t.h, t.w, 0x30363d, { studs: true });
    for (let y = 12; y < t.h - 6; y += 10) {
      B.add(t.x, 3 + y, t.z, t.w + 0.7, 1.4, t.w + 0.7, 0xffd24a, { glow: true });
    }
    B.add(t.x, 3 + t.h, t.z, t.w * 0.5, 10, t.w * 0.5, 0x30363d);
    B.add(t.x, 3 + t.h + 10, t.z, 1.6, 12, 1.6, 0xff3b6b, { glow: true }); // beacon
  }

  // Named supertalls (repositioned for the bigger island).
  // Empire State (midtown).
  B.add(168, 3, 40, 40, 118, 40, 0xb7bcc2, { studs: true });
  B.add(168, 121, 40, 27, 54, 27, 0xb7bcc2);
  B.add(168, 175, 40, 16, 30, 16, 0xc7ccd1);
  B.add(168, 205, 40, 3, 28, 3, 0xe6ebf0);
  for (let y = 14; y < 112; y += 12) B.add(168, 3 + y, 40, 40.7, 1.4, 40.7, win, { glow: true });
  // One World Trade (downtown).
  B.add(0, 3, 820, 34, 176, 34, 0x9ec6dd, { studs: true });
  B.add(0, 179, 820, 7, 66, 7, 0xcfe4f2);
  for (let y = 14; y < 176; y += 12) B.add(0, 3 + y, 820, 34.6, 1.3, 34.6, 0xbfe0ff, { glow: true });
  // Chrysler-style crown.
  B.add(-168, 3, 24, 30, 122, 30, 0xc7cdd2, { studs: true });
  for (let k = 0; k < 6; k++) B.add(-168, 125 + k * 6, 24, 24 - k * 3.6, 6, 24 - k * 3.6, 0xd9e0e6);
  B.add(-168, 161, 24, 1.8, 20, 1.8, 0xe6ebf0);

  // Signature crown lighting so the supertalls own the night skyline.
  B.add(168, 120, 40, 28, 1.6, 28, 0x9fe8ff, { glow: true }); // Empire State setback ring
  B.add(168, 174, 40, 17, 1.6, 17, 0x9fe8ff, { glow: true });
  B.add(168, 233, 40, 2, 3, 2, 0xff3b6b, { glow: true }); // mast beacon
  B.add(0, 176, 820, 35, 2, 35, 0xbfe0ff, { glow: true }); // One WTC crown band
  B.add(0, 245, 820, 2, 4, 2, 0xff3b6b, { glow: true }); // spire beacon
  for (let k = 0; k < 6; k++) {
    B.add(-168, 128 + k * 6, 24, 25 - k * 3.6, 1, 25 - k * 3.6, 0xffd24a, { glow: true }); // Chrysler arcs
  }

  // Street lamps marching down the avenues.
  for (let ax = -252; ax <= 252; ax += 168) {
    for (let z = -HZ + 40; z < HZ; z += 150) {
      if (Math.abs(ax) > islandHalf(z) - 24) continue;
      for (const s of [-1, 1]) {
        B.add(ax + s * 7, 3.4, z, 0.6, 7, 0.6, 0x2a2f36);
        B.add(ax + s * 7, 10.6, z, 1.3, 1.3, 1.3, 0xfff3c2, { glow: true });
      }
    }
  }

  // Times Square floor: neon pavement panels washing the core in colour.
  for (let i = 0; i < 14; i++) {
    const px = (hash2(i, 71) - 0.5) * 100;
    const pz = (hash2(i, 73) - 0.5) * 150;
    B.add(px, 3.3, pz, 8 + hash2(i, 77) * 8, 0.4, 6 + hash2(i, 79) * 6, NYC_ROOF_SIGNS[i % NYC_ROOF_SIGNS.length], { glow: true });
  }

  // Liberty Island: star fort, pedestal, mint-green Lady with a golden torch.
  const LIX = -430;
  const LIZ = 760;
  const mint = 0x7fc4a8;
  B.add(LIX, -14, LIZ, 84, 15, 84, 0x4a4640); // islet bedrock rising from the seabed
  B.add(LIX, 1, LIZ, 74, 3, 74, 0x8a9a6b, { studs: true });
  B.add(LIX, 1, LIZ, 74, 3, 74, 0x8a9a6b, { ry: Math.PI / 4 }); // star points
  B.add(LIX, 4, LIZ, 30, 10, 30, 0xd9cdb0, { studs: true });
  B.add(LIX, 14, LIZ, 20, 14, 20, 0xcabc9e);
  B.add(LIX, 28, LIZ, 13, 6, 13, 0xd9cdb0);
  B.add(LIX, 34, LIZ, 12, 16, 12, mint); // robe
  B.add(LIX, 50, LIZ, 9, 12, 9, mint);
  B.add(LIX, 62, LIZ, 7, 9, 7, mint);
  B.add(LIX - 5.5, 58, LIZ, 3, 10, 3, mint); // tablet arm
  B.add(LIX - 6.5, 63, LIZ, 2.4, 6, 4.5, 0x9fd4b8);
  B.add(LIX, 71, LIZ, 4.5, 4.5, 4.5, 0x9fd4b8); // head
  B.add(LIX, 75.5, LIZ, 6.5, 1.6, 6.5, mint, { ry: Math.PI / 4 }); // crown
  B.add(LIX + 5, 66, LIZ, 2.6, 14, 2.6, mint); // raised torch arm
  B.add(LIX + 5, 80, LIZ, 2.2, 3, 2.2, 0xd8b84a);
  B.add(LIX + 5, 83, LIZ, 3, 3, 3, 0xffcf5e, { glow: true }); // flame

  // Brooklyn: a low-rise borough across the East River on its own bedrock.
  for (let cz = 360; cz <= 680; cz += 108) {
    for (let x = 880; x <= 1080; x += 108) {
      B.add(x, -14, cz, 109, 17, 109, 0x4a4640);
      B.add(x, 2.4, cz, 109, 0.8, 109, 0x3c4046);
    }
  }
  let bn = 0;
  for (let x = 890; x <= 1070; x += 44) {
    for (let cz = 380; cz <= 660; cz += 46) {
      const bw = 22 + hash2(x, cz) * 10;
      const bh = 14 + hash2(x * 3, cz * 7) * 22;
      const bc = NYC_FACADES[(bn * 5 + 3) % NYC_FACADES.length];
      B.add(x, 3, cz, bw, bh, bw, bc, { studs: true });
      for (let y = 9; y < bh - 3; y += 9) {
        if (hash2(x + y, cz) > 0.8) continue;
        B.add(x, 3 + y, cz, bw + 0.6, 1.2, bw + 0.6, 0xffe9a8, { glow: true });
      }
      B.add(x, 3 + bh, cz, bw * 0.4, 4, bw * 0.4, 0x7a5a3a);
      bn++;
    }
  }

  // A grand suspension bridge across the East River to Brooklyn.
  const deckY = 16;
  for (let x = 310; x <= 880; x += 30) {
    B.add(x + 15, deckY, 520, 31, 2.2, 16, 0x6a707a);
    B.add(x + 15, deckY + 1.2, 520, 31, 0.5, 1.2, 0xf7d354);
  }
  for (let k = 0; k < 5; k++) {
    B.add(298 - k * 12, deckY - 3 - k * 2.8, 520, 13, 2.2, 16, 0x6a707a);
    B.add(892 + k * 12, deckY - 3 - k * 2.8, 520, 13, 2.2, 16, 0x6a707a);
  }
  for (const tx of [430, 720]) {
    for (const s of [-1, 1]) B.add(tx, -8, 520 + s * 6, 8, 60, 5, 0xb8a88c);
    B.add(tx, 52, 520, 8, 6, 18, 0xb8a88c);
    B.add(tx, 58, 520, 9, 2, 19, 0x9c8c70);
    B.add(tx, 60, 520, 1.4, 6, 1.4, 0xff3b6b, { glow: true });
  }
  let ci3 = 0;
  for (let x = 316; x <= 874; x += 14) {
    let t: number;
    if (x < 430) t = (430 - x) / 120;
    else if (x <= 720) t = Math.abs(x - 575) / 145;
    else t = (x - 720) / 160;
    const cy = 19 + t * t * 37;
    for (const s of [-1, 1]) B.add(x, cy, 520 + s * 7.4, 6, 1.4, 1.2, 0xdfe6ec);
    if (ci3 % 3 === 0 && cy > 23) {
      for (const s of [-1, 1]) B.add(x, deckY + 2, 520 + s * 7.4, 0.5, cy - deckY - 2, 0.5, 0x9aa3ab);
    }
    // necklace lights along the cables
    if (ci3 % 2 === 0) B.add(x, cy + 1.4, 520, 1.1, 1.1, 1.1, 0xffe9a8, { glow: true });
    ci3++;
  }

  // Waterfront docks with moored boats along both shores (boats float at the
  // harbour surface, well below the raised island deck).
  const docks: [number, number][] = [
    [-700, -1], [-360, 1], [-60, -1], [260, 1], [560, -1], [820, 1]
  ];
  for (const [dz, side] of docks) {
    const hw = islandHalf(dz);
    const ex = side * hw;
    B.add(ex + side * 34, 3, dz, 66, 1.6, 18, 0x8a7250, { studs: true }); // pier deck
    nycBoat(B, ex + side * 82, dz, hash2(dz, 5));
  }

  // A couple of McBrick's on the avenues.
  burgerJoint(B, 60, -180);
  burgerJoint(B, -60, 260);
}

/** A moored brick boat/yacht sitting at the harbour surface next to the island. */
function nycBoat(B: Bricks, cx: number, cz: number, r: number): void {
  const hull = r > 0.5 ? 0xe8ecef : 0xf2efe6;
  const y = -1.5; // local level that lands the hull on the ocean surface (+1 world)
  B.add(cx, y, cz, 30, 5, 12, hull, { studs: true });
  B.add(cx, y + 5, cz, 18, 6, 9, 0xdfe6ec);
  B.add(cx, y + 5, cz, 30, 3.5, 3, 0x2a63b8, { glow: true }); // side advert stripe
  B.add(cx, y + 11, cz, 2, 9, 2, 0x9aa3ab); // mast
  B.add(cx + 5, y + 14, cz, 9, 6, 0.6, 0xf6f6f2); // sail/flag
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
  const light = 0xe8d7ae;
  const sand = 0xe3cf9e;
  const R0 = 46;
  const n = 40;

  for (let i = 0; i < n; i++) {
    const th = (i / n) * Math.PI * 2;
    const ry = -th + Math.PI / 2;
    const broken = th > 4.4; // the ruined southern arc, like the real thing
    const color = i % 2 ? stone : dark;
    const px = Math.cos(th);
    const pz = Math.sin(th);
    const ring = (rr: number, y: number, h: number, w: number, c: number, studs = false) =>
      B.add(px * rr, y, pz * rr, w, h, 6, c, { ry, studs });

    // Tier 1: piers with lintels so the gaps read as arcades.
    ring(R0, 0, 9, 4.2, color);
    ring(R0, 9, 3, 7.6, light);
    // Amber arch lamps glowing in the arcades at dusk.
    if (i % 2 === 0) B.add(px * (R0 + 2.9), 4.5, pz * (R0 + 2.9), 2.2, 3.4, 0.8, 0xffce7a, { ry, glow: true });

    if (!broken) {
      ring(R0 - 1, 12, 9, 4.2, i % 2 ? dark : stone);
      ring(R0 - 1, 21, 3, 7.6, light);
      ring(R0 - 2, 24, 9, 4.2, color);
      ring(R0 - 2, 33, 3, 7.6, light);
      // Attic wall + velarium masts flying pennants.
      ring(R0 - 2.5, 36, 6, 6.5, i % 2 ? light : stone, i % 3 === 0);
      if (i % 4 === 0) {
        B.add(px * (R0 - 2), 42, pz * (R0 - 2), 1, 8, 1, 0x8a6743, { ry });
        B.add(px * (R0 - 2), 50, pz * (R0 - 2), 2.6, 1.8, 0.5, i % 8 ? 0xd5202b : 0xd8b84a, { ry, glow: true });
      }
    } else if (th < 5.6) {
      // Crumbled shoulder stepping down into the ruin.
      ring(R0 - 1, 12, 6, 4.2, i % 2 ? dark : stone);
    }
  }

  // Inner bowl and seating rings.
  for (let i = 0; i < 26; i++) {
    const th = (i / 26) * Math.PI * 2;
    B.add(Math.cos(th) * 30, 0, Math.sin(th) * 30, 8.6, 10, 5, i % 2 ? sand : stone, { ry: -th + Math.PI / 2 });
    B.add(Math.cos(th) * 34, 6, Math.sin(th) * 34, 9.2, 5, 5, i % 2 ? stone : dark, { ry: -th + Math.PI / 2 });
  }

  // Arena floor with the hypogeum cross exposed, and a duel in progress.
  B.add(0, 0, 0, 40, 2.5, 40, 0xd8b878, { ry: Math.PI / 4 });
  B.add(0, 0, 0, 40, 2.5, 40, 0xd8b878);
  B.add(0, 2.5, 0, 30, 0.5, 4, 0x6b5b3f);
  B.add(0, 2.5, 0, 4, 0.5, 30, 0x6b5b3f);
  for (const [gx, gz, c] of [[-5, 2, 0xd5202b], [5, -2, 0x2c6bd6]] as const) {
    B.add(gx, 3, gz, 1.3, 2.2, 1, 0x8a6743);
    B.add(gx, 5.2, gz, 1.7, 2.2, 1.2, c);
    B.add(gx, 7.4, gz, 1.2, 1.2, 1.2, 0xf5c542);
    B.add(gx + (gx > 0 ? -2 : 2), 6, gz, 0.6, 4, 0.6, 0xc9d2da);
  }

  // Fallen columns resting on the plaza just outside the walls — kept in a
  // tight archaeological ring so they don't read as stray debris on the lawn.
  for (let i = 0; i < 10; i++) {
    const a = 0.5 + (i / 10) * Math.PI * 2;
    if (Math.min(Math.abs(Math.cos(a)), Math.abs(Math.sin(a))) < 0.14) continue; // keep the avenues clear
    const rr = 52 + hash2(i, 63) * 4;
    const x = Math.cos(a) * rr;
    const z = Math.sin(a) * rr;
    if (hash2(i, 67) > 0.45) {
      B.add(x, 1.2, z, 2.2, 2.2, 7, stone, { ry: -a + hash2(i, 68) });
      B.add(x + 2, 1.2, z + 1.6, 2, 2, 2, dark);
    } else {
      const ch = 6 + hash2(i, 69) * 5;
      B.add(x, 1.2, z, 2.6, ch, 2.6, i % 2 ? light : stone);
      B.add(x, 1.2 + ch, z, 3.6, 1.4, 3.6, dark);
    }
  }

  // A little triumphal arch on the approach.
  const AX = 52;
  const AZ = 52;
  for (const s of [-1, 1]) B.add(AX + s * 6, 0, AZ, 4, 14, 6, light, { ry: Math.PI / 4 });
  B.add(AX, 14, AZ, 18, 4, 7, stone, { ry: Math.PI / 4 });
  B.add(AX, 18, AZ, 15, 2.5, 6, dark, { ry: Math.PI / 4 });
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
function sphinx(B: Bricks, cx: number, cz: number, s = 1): void {
  const stone = 0xd9b26a;
  const stone2 = 0xcaa25c;
  const gold = 0xd8b84a;
  const blue = 0x2c6bd6;
  // Body lies along +Z with the head/paws facing out toward -Z.
  B.add(cx, 0, cz, 28 * s, 20 * s, 66 * s, stone, { studs: true });
  B.add(cx, 0, cz, 34 * s, 6 * s, 74 * s, stone2); // plinth
  for (const sd of [-1, 1]) {
    B.add(cx + sd * 9 * s, 0, cz - 44 * s, 9 * s, 9 * s, 30 * s, stone2); // outstretched paws
    B.add(cx + sd * 9 * s, 0, cz - 58 * s, 9 * s, 5 * s, 4 * s, stone); // toes
  }
  B.add(cx, 20 * s, cz - 20 * s, 20 * s, 16 * s, 18 * s, stone); // chest / neck
  // Nemes headdress with striped lappets and a gold brow band.
  B.add(cx, 34 * s, cz - 24 * s, 22 * s, 18 * s, 18 * s, stone2); // head block
  for (const sd of [-1, 1]) {
    B.add(cx + sd * 10.5 * s, 30 * s, cz - 22 * s, 4 * s, 22 * s, 18 * s, blue);
  }
  B.add(cx, 44 * s, cz - 22 * s, 24 * s, 4 * s, 18 * s, gold);
  B.add(cx, 30 * s, cz - 33.6 * s, 14 * s, 12 * s, 1.6 * s, 0xe6c07e); // face
  B.add(cx, 22 * s, cz - 33.6 * s, 5 * s, 3 * s, 1.6 * s, gold); // ceremonial beard
  // Glowing eyes watching the causeway at night.
  for (const sd of [-1, 1]) {
    B.add(cx + sd * 3.4 * s, 33 * s, cz - 34 * s, 2 * s, 1.4 * s, 0.8 * s, 0xffd24a, { glow: true });
  }
}

/** A two-humped brick camel plodding the desert. */
function camel(B: Bricks, x: number, z: number): void {
  const hide = 0xc89b5a;
  B.add(x, 3.5, z, 8.5, 3.4, 3, hide);
  for (const lx of [-3, 3]) {
    for (const lz of [-1, 1]) B.add(x + lx, 0.5, z + lz, 1, 3, 1, hide);
  }
  B.add(x - 1.5, 6.9, z, 2.2, 1.8, 2.6, hide);
  B.add(x + 1.5, 6.9, z, 2.2, 1.8, 2.6, hide);
  B.add(x + 4.8, 5.5, z, 1.4, 3.4, 1.4, hide);
  B.add(x + 5.4, 8.6, z, 2.2, 1.6, 1.6, 0xb9884a);
}

function giza(B: Bricks): void {
  const glyphCols = [0x2e9e9b, 0xd8b84a, 0xc0432f, 0x2c6bd6];
  const sand = 0xe3cf9e;
  const sandDark = 0xd7bf85;

  // Wide desert plaza (tiled to follow the planet's curve).
  plate(B, 0, 0, 560, 560, 0, 2, sand, 90);
  for (let i = 0; i < 46; i++) {
    B.add((hash2(i, 2) - 0.5) * 520, 2, (hash2(i, 6) - 0.5) * 520, 22, 0.3, 22, sandDark);
  }

  // Colossal stepped pyramids: glyph cartouches climb every face, and each
  // gilded crown fires a beam of light into the sky (Luxor style).
  const pyramid = (cx: number, cz: number, base: number, glyphs: boolean, capped: boolean) => {
    const h = base * 0.7;
    for (let y = 0; y < h; y += 4) {
      const w = base * (1 - y / h) + 3;
      const color = capped && y > h - base * 0.16 ? 0xf2e7c8 : (y / 4) % 2 ? 0xdcb56e : 0xcfa75f;
      B.add(cx, y, cz, w, 4, w, color);
      if (glyphs && (y / 4) % 2 === 0 && y > 6 && y < h - 18) {
        B.add(cx, y + 1, cz + w / 2 + 0.4, 3.6, 2.8, 0.7, glyphCols[(y / 8) % glyphCols.length], { glow: true });
        B.add(cx, y + 1, cz - w / 2 - 0.4, 3.6, 2.8, 0.7, glyphCols[(y / 8 + 1) % glyphCols.length], { glow: true });
        B.add(cx + w / 2 + 0.4, y + 1, cz, 0.7, 2.8, 3.6, glyphCols[(y / 8 + 2) % glyphCols.length], { glow: true });
        B.add(cx - w / 2 - 0.4, y + 1, cz, 0.7, 2.8, 3.6, glyphCols[(y / 8 + 3) % glyphCols.length], { glow: true });
      }
    }
    B.add(cx, h, cz, 7, 6, 7, 0xd8b84a); // gilded capstone
    B.add(cx, h + 4, cz, 3.4, 110, 3.4, 0xffecc0, { beam: true }); // skyward beam
  };
  pyramid(-170, -90, 250, true, false); // Khufu
  pyramid(55, 55, 195, true, true); // Khafre keeps its limestone cap
  pyramid(220, 185, 135, false, false); // Menkaure

  // The Great Sphinx, larger than life, gazing down the causeway.
  sphinx(B, -40, -250, 1.35);

  // Stone causeway from the Sphinx up to Khufu, lined with flame torches.
  B.add(-105, 0.5, -170, 212, 1.2, 14, 0xd8c894, { ry: -Math.atan2(160, -130) });
  for (let k = 1; k < 8; k++) {
    const t = k / 8;
    const x = -40 - 130 * t;
    const z = -250 + 160 * t;
    for (const s of [-1, 1]) {
      const px = x + s * (-160 / 206) * 9;
      const pz = z + s * (-130 / 206) * 9;
      B.add(px, 0.5, pz, 1, 6, 1, 0x8a6743);
      B.add(px, 6.8, pz, 1.6, 2, 1.6, 0xffb347, { glow: true });
    }
  }

  // A camel caravan plodding beside the causeway.
  for (let k = 0; k < 3; k++) {
    const t = 0.25 + k * 0.18;
    camel(B, -40 - 130 * t + 14, -250 + 160 * t + 8);
  }

  // Four glyph-carved obelisks guarding the site.
  for (const [ox, oz] of [[-240, -170], [240, -170], [-260, 120], [130, -280]] as const) {
    for (let y = 0; y < 88; y += 5) {
      const w = 10 * (1 - y / 125);
      B.add(ox, y, oz, w, 5, w, (y / 5) % 2 ? 0xdcb56e : 0xcfa75f);
    }
    B.add(ox, 88, oz, 7.5, 10, 7.5, 0xd8b84a);
    for (let y = 8; y < 74; y += 10) {
      B.add(ox, y, oz + 5.2, 3, 3.4, 0.7, glyphCols[Math.floor(y / 10) % glyphCols.length], { glow: true });
    }
  }

  // A palm-ringed oasis with a bazaar of striped market stalls.
  const OX = 180;
  const OZ = -140;
  B.add(OX, 0.4, OZ, 66, 0.8, 50, 0x69b6e8);
  B.add(OX, 0.5, OZ, 60, 1, 44, 0x3f8fd4);
  for (let i = 0; i < 8; i++) {
    const a = (i / 8) * Math.PI * 2;
    palm(B, OX + Math.cos(a) * 40, OZ + Math.sin(a) * 32, i * 5 + 7);
  }
  const stallCols = [0xd5202b, 0xf2a10a, 0x2c6bd6, 0x18a558];
  for (let i = 0; i < 4; i++) {
    const sx = OX - 46 + i * 18;
    B.add(sx, 0.5, OZ + 40, 8, 5, 6, 0xe8d9ae, { studs: true });
    B.add(sx, 5.5, OZ + 40, 10, 1.6, 8, stallCols[i]);
  }

  // Palms dotted around the sacred site.
  for (let i = 0; i < 18; i++) {
    const a = (i / 18) * Math.PI * 2;
    const r = 250 + hash2(i, 12) * 26;
    palm(B, Math.cos(a) * r, Math.sin(a) * r + 30, i * 3 + 2);
  }
}

function bigben(B: Bricks): void {
  const tan = 0xcfae72;
  const dark = 0xb2945c;
  const light = 0xe8d9ae;
  const green = 0x3f5a4e;
  const black = 0x30343c;
  const gold = 0xd8b84a;

  const TX = 34; // clock tower centre
  // Shaft with pale corner pilasters and glowing gothic window slits.
  for (let y = 0; y < 74; y += 4.6) {
    B.add(TX, y, 0, 17, 4.6, 17, Math.round(y / 4.6) % 2 ? tan : dark);
    for (const sx of [-1, 1]) {
      for (const sz of [-1, 1]) {
        B.add(TX + sx * 8.2, y, sz * 8.2, 2.4, 4.6, 2.4, light);
      }
    }
    if (Math.round(y / 4.6) % 3 === 1 && y > 6) {
      B.add(TX, y + 1, 8.9, 3.2, 2.8, 0.7, 0xfff0c0, { glow: true });
      B.add(TX, y + 1, -8.9, 3.2, 2.8, 0.7, 0xfff0c0, { glow: true });
    }
  }

  // Clock stage: gilded surrounds, glowing faces, black hands on all sides.
  B.add(TX, 74, 0, 21, 14, 21, tan, { studs: true });
  for (const side of [-1, 1]) {
    B.add(TX + side * 10.9, 76, 0, 0.8, 12, 12, gold);
    B.add(TX + side * 11.3, 77, 0, 0.6, 10, 10, 0xfff6d8, { glow: true });
    B.add(TX + side * 11.8, 80.5, 0, 0.5, 1.2, 4.5, black);
    B.add(TX + side * 11.8, 79, 0, 0.5, 4.5, 1.2, black);
    B.add(TX, 76, side * 10.9, 12, 12, 0.8, gold);
    B.add(TX, 77, side * 11.3, 10, 10, 0.6, 0xfff6d8, { glow: true });
    B.add(TX, 80.5, side * 11.8, 4.5, 1.2, 0.5, black);
    B.add(TX, 79, side * 11.8, 1.2, 4.5, 0.5, black);
  }

  // Green spire crowned in gold.
  B.add(TX, 88, 0, 19, 4, 19, green);
  B.add(TX, 92, 0, 14, 4.5, 14, green);
  B.add(TX, 96.5, 0, 9, 4.5, 9, green);
  B.add(TX, 101, 0, 5, 4.5, 5, green);
  B.add(TX, 105.5, 0, 2.6, 5, 2.6, green);
  B.add(TX, 110.5, 0, 1.4, 7, 1.4, gold);
  B.add(TX, 118, 0, 1.8, 1.8, 1.8, 0xffe9a0, { glow: true });

  // Union Jack flying beside the spire.
  B.add(TX + 4, 112, 0, 0.7, 9, 0.7, 0xf4f4f2);
  B.add(TX + 8, 117, 0, 4.4, 5.6, 0.5, 0x1a3a8f, { glow: true });
  B.add(TX + 8, 117, 0.06, 4.4, 1.6, 0.5, 0xd5202b, { glow: true });
  B.add(TX + 8, 117, 0.06, 1.4, 5.6, 0.5, 0xd5202b, { glow: true });

  // Palace of Westminster: long gothic hall with buttress ribs and lit windows.
  B.add(-22, 0, 0, 82, 20, 28, tan, { studs: true });
  for (let x = -58; x <= 12; x += 7) {
    B.add(x, 20, 0, 2.2, 5, 28.8, dark);
    B.add(x, 8, 14.2, 2, 8, 0.7, 0xfff0c0, { glow: true });
    B.add(x, 8, -14.2, 2, 8, 0.7, 0xfff0c0, { glow: true });
  }
  B.add(-22, 20, 0, 82, 4.4, 13, dark);

  // Victoria Tower with corner turrets.
  B.add(-63, 0, 0, 20, 34, 20, tan, { studs: true });
  B.add(-63, 34, 0, 22, 3, 22, dark);
  B.add(-63, 37, 0, 12, 5, 12, green);
  B.add(-63, 42, 0, 5, 4, 5, green);
  B.add(-63, 46, 0, 1.2, 6, 1.2, gold);
  for (const sx of [-1, 1]) {
    for (const sz of [-1, 1]) {
      B.add(-63 + sx * 9.4, 30, sz * 9.4, 3, 10, 3, light);
      B.add(-63 + sx * 9.4, 40, sz * 9.4, 1.6, 3, 1.6, gold);
    }
  }

  // Gilded uplights along the river facade.
  for (let x = -55; x <= 45; x += 12) B.add(x, 1, 15.4, 1.2, 1.2, 1.2, 0xffd98a, { glow: true });
}

/**
 * Bespoke London: Parliament Square, the Thames with Westminster Bridge, the
 * London Eye, Tower Bridge, brick terraces, a glass City cluster, and the
 * obligatory red buses and phone boxes.
 */
function londonDowntown(B: Bricks): void {
  const asphalt = 0x3e434b;
  const stone = 0xcfc6b2;
  const water = 0x3a7fc4;
  const brickRed = 0xb05b3e;
  const brick2 = 0xc46a4a;
  const cream = 0xf3e9d2;

  // Parliament Square plaza + the ring road the traffic loop drives.
  B.add(0, 0, 0, 104, 1.1, 104, 0xc9cdd3);
  const R = 68;
  for (let side = 0; side < 4; side++) {
    const horizontal = side % 2 === 0;
    const off = side < 2 ? R : -R;
    if (horizontal) B.add(0, 0, off, R * 2 + 10, 0.9, 10, asphalt);
    else B.add(off, 0, 0, 10, 0.9, R * 2 + 10, asphalt);
  }

  // The Thames with stone embankments.
  plate(B, 0, 100, 380, 40, -0.6, 1.6, water, 95);
  plate(B, 0, 76, 380, 6, 0.5, 1.5, stone, 95);
  plate(B, 0, 124, 380, 6, 0.5, 1.5, stone, 95);

  // Westminster Bridge (green, like the real one) on the clock tower's axis.
  B.add(34, 1.6, 100, 18, 1.8, 52, 0x4a7a52, { studs: true });
  for (const s of [-1, 1]) B.add(34 + s * 8, 2.6, 100, 1.6, 2.4, 52, cream);
  for (const lz of [82, 100, 118]) {
    for (const s of [-1, 1]) {
      B.add(34 + s * 8, 5, lz, 0.8, 3, 0.8, 0x33363c);
      B.add(34 + s * 8, 8.6, lz, 1.2, 1.2, 1.2, 0xffd98a, { glow: true });
    }
  }

  // The London Eye on the south bank, cabins lit at dusk.
  ferrisWheel(B, 95, 145, 42, true);

  // Tower Bridge downriver: twin gothic towers, road deck and high walkway.
  const BX = -160;
  for (const s of [-1, 1]) {
    B.add(BX + s * 22, 0, 100, 14, 40, 14, stone, { studs: true });
    B.add(BX + s * 22, 40, 100, 16, 3, 16, 0x53616f);
    B.add(BX + s * 22, 43, 100, 6, 6, 6, 0x53616f);
    B.add(BX + s * 22, 49, 100, 1.2, 4, 1.2, 0xd8b84a);
  }
  B.add(BX, 6, 100, 60, 2.5, 12, 0x3f6fb0, { studs: true });
  B.add(BX, 34, 100, 44, 2.2, 6, 0x8fb4c9);
  B.add(BX, 20, 100, 44, 1, 1.4, 0xbfd8ea);

  // Brick terraces north of the square, chimneys and lit doorways included.
  let tn = 0;
  for (let x = -140; x <= 140; x += 25) {
    if (Math.abs(x) < 82) continue;
    for (const z of [-95, -125]) {
      const h = 11 + hash2(tn, 9) * 5;
      B.add(x, 0, z, 16, h, 14, tn % 2 ? brickRed : brick2, { studs: true });
      B.add(x, h, z, 17, 2.2, 15, 0x53616f);
      B.add(x, h + 2, z, 10, 2, 12, tn % 2 ? brick2 : brickRed);
      B.add(x, 4, z + 7.2, 3, 3, 0.6, 0xffe9b8, { glow: true });
      B.add(x + 4.5, h + 3.2, z - 3, 1.6, 3.5, 1.6, 0x9c4a3a);
      tn++;
    }
  }

  // A compact cluster of glass City towers.
  const glass = [0x9ec6dd, 0x8fb4c9, 0x6f9ec4];
  for (let i = 0; i < 4; i++) {
    const gx = 108 + (i % 2) * 30;
    const gz = -78 - Math.floor(i / 2) * 32;
    const h = 34 + hash2(i, 13) * 22;
    B.add(gx, 0, gz, 17, h, 17, glass[i % glass.length], { studs: true });
    for (let y = 6; y < h - 3; y += 7) B.add(gx, y, gz, 17.6, 1.1, 17.6, 0xbfe0ff, { glow: true });
    B.add(gx, h, gz, 8, 4, 8, glass[(i + 1) % glass.length]);
  }

  // Double-decker buses around the square + red phone boxes.
  for (const [bx, bz, a] of [[-40, 62, 0], [52, -62, 0], [62, 30, Math.PI / 2]] as const) {
    B.add(bx, 1, bz, 11, 4, 4.6, 0xd5202b, { ry: a, studs: true });
    B.add(bx, 5, bz, 11, 3.6, 4.6, 0xd5202b, { ry: a });
    B.add(bx, 5.4, bz, 11.2, 1.6, 4, 0xffe9b8, { ry: a, glow: true });
  }
  for (const [px, pz] of [[-52, 40], [40, 52], [-30, -56]] as const) {
    B.add(px, 1, pz, 2.6, 5.5, 2.6, 0xd5202b);
    B.add(px, 3.4, pz, 2.9, 1.6, 2.9, 0xffd9d0, { glow: true });
    B.add(px, 6.5, pz, 3, 0.8, 3, 0xd5202b);
  }
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
function ferrisWheel(B: Bricks, cx: number, cz: number, R = 34, glowCabins = false): void {
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
    B.add(x, y - 2.4, cz, 5, 4.5, 5, cabinCols[i % cabinCols.length], { studs: true, glow: glowCabins });
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

  constructor(private terrain: Terrain, private studPool: BrickStudPool) {
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
        case 'eiffel': eiffel(B); parisDowntown(B); break;
        case 'nyc': nyc(B); break;
        case 'taj': taj(B); break;
        case 'wall': greatWall(B, this.terrain, dir, anchorH); break;
        case 'sydney': sydney(B); break;
        case 'colosseum': colosseum(B); break;
        case 'fuji': fuji(B); break;
        case 'giza': giza(B); break;
        case 'bigben': bigben(B); londonDowntown(B); break;
        case 'burj': burj(B); break;
        case 'cali': caliBeach(B); break;
      }

      const cfg = CITY_CONFIGS[def.id];
      const seed = Math.abs(def.lat * 7 + def.lon);
      // Landmarks with bespoke downtowns (Paris, London) build their own core;
      // everyone else gets the generic ring city.
      if (cfg?.style && !cfg.custom) city(B, cfg.style, seed);
      // Fill the flat pad out to its edge with a mid-rise belt so the landmark
      // isn't marooned on empty lawn. Skip the mountain and the wall.
      if (cfg?.style && def.flat && def.id !== 'fuji') {
        const rInner = cfg.custom ? cfg.custom.rInner : cfg.style.rings[cfg.style.rings.length - 1] + 14;
        const rOuter = (def.flat / S) * 0.9;
        if (rOuter > rInner + 40) suburbs(B, cfg.style, seed + 91, rInner, rOuter, cfg.custom?.avoid);
      }

      const group = B.build();
      if (def.id === 'nyc') {
        // Attach the animated Times Square billboards as children so they ride
        // the group's placement (and scale) on the globe. Each screen is bent
        // onto the sphere exactly like the tower bricks it sits on.
        const screens = createAdScreens([...NYC_AD_TOWERS, ...NYC_ADS_SCATTERED]);
        const rLocal = PLANET_R / S;
        const qTilt = new THREE.Quaternion();
        for (const o of screens.objects) {
          sphereMap(o.position.x, o.position.y, o.position.z, rLocal, o.position, qTilt);
          o.quaternion.premultiply(qTilt);
          group.add(o);
        }
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
      B.registerStudSurfaces(this.studPool, group);

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
    // Nearest landmark within its radius wins — with the bigger trigger zones
    // an array-order first-match can announce a neighbouring city instead.
    let near: PlacedLandmark | null = null;
    let nearDist = Infinity;
    for (const item of this.items) {
      const d = planePos.distanceTo(item.worldPos);
      if (d < item.def.radius && d < nearDist) {
        near = item;
        nearDist = d;
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
