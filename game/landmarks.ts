import * as THREE from 'three';
import { PLANET_R, BRICK_H } from './constants';
import { CityFrame } from './life';
import { Terrain } from './terrain';
import { LANDMARKS, LandmarkDef } from './landmark-data';
import { latLonToDir, tangentBasis, basisQuat, curvatureDrop, makeAOBox, clamp, hash2, DEG2RAD } from './util';
import { bus } from './bus';

const DISCOVERED_KEY = 'brickfly.discovered';

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
      y: y - curvatureDrop(x, z),
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
      floors: [8, 18],
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
      floors: [7, 14],
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
      floors: [6, 11],
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
      floors: [6, 12],
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
      floors: [10, 22],
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
  giza: {
    style: {
      walls: [0xd9c49a, 0xcbb083],
      roofs: [0xb89b6a],
      band: 0xefe0c0,
      floors: [4, 7],
      plaza: 0,
      road: 0,
      rings: [128],
      perRing: [9],
      trees: 5
    }
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
  nyc: { frame: { ring: 72, plaza: 0, groundY: 5 } }
};

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
}

function nyc(B: Bricks): void {
  const greys = [0x9aa2ab, 0x7f8790, 0xb0b6bd, 0x89929b, 0x848c95, 0xa7adb4];
  const glowColors = [0x28d8ff, 0xff3d8e, 0xffd428, 0x7cff3a, 0xff7a1a, 0x9d5cff];
  const win = 0xf7d354;

  // Island street plate (kept compact so the district reads as a skyline)
  B.add(0, 0, 5, 132, 3, 190, 0x6a707a);

  // Central Park up north
  B.add(0, 3, -78, 84, 2.5, 52, 0x3fa021, { studs: true });
  for (let i = 0; i < 14; i++) {
    const tx = (hash2(i, 3) - 0.5) * 72;
    const tz = -78 + (hash2(i, 7) - 0.5) * 42;
    B.add(tx, 5.5, tz, 4, 6 + hash2(i, 11) * 5, 4, i % 2 ? 0x2e7d1e : 0x3fa021);
  }

  // City blocks on the avenue grid; Times Square towers carry glowing ads
  let bi = 0;
  for (let gx = -2; gx <= 2; gx++) {
    for (let gz = 0; gz <= 4; gz++) {
      if ((gx === 0 && gz === 2) || (gx === 1 && gz === 1) || (gx === -1 && gz === 4)) {
        continue; // plazas reserved for the hero buildings
      }
      const x = gx * 26;
      const z = gz * 30 - 42;
      const r = hash2(gx * 7 + 31, gz * 13 + 5);
      const w = 13 + r * 6;
      const midtown = Math.max(0, 1 - Math.abs(gz - 1.5) * 0.28 - Math.abs(gx) * 0.14);
      const h = 22 + r * 30 + midtown * 58;
      B.add(x, 3, z, w, h, w, greys[bi % greys.length], { studs: true });
      for (let y = 12; y < h - 6; y += 12) B.add(x, 3 + y, z, w + 0.7, 1.1, w + 0.7, win, { glow: true });

      if (Math.abs(gx) <= 1 && gz <= 2) {
        const ads = 2 + Math.floor(r * 3);
        for (let a = 0; a < ads; a++) {
          const gy = 8 + hash2(bi, a * 5) * h * 0.55;
          const side = hash2(a, bi + 2) > 0.5 ? 1 : -1;
          const gw = 9 + hash2(a * 7, bi) * 8;
          const gh = 8 + hash2(a, bi * 2) * 9;
          const color = glowColors[(bi + a) % glowColors.length];
          if (hash2(a * 9, bi) > 0.5) {
            B.add(x + side * (w / 2 + 0.55), 3 + gy, z + (hash2(a * 3, bi) - 0.5) * w * 0.4, 1, gh, gw, color, { glow: true });
          } else {
            B.add(x + (hash2(a * 3, bi) - 0.5) * w * 0.4, 3 + gy, z + side * (w / 2 + 0.55), gw, gh, 1, color, { glow: true });
          }
        }
      }
      bi++;
    }
  }

  // Empire State Building
  B.add(0, 3, 9, 24, 42, 24, 0xaab1b9, { studs: true });
  B.add(0, 45, 9, 17, 26, 17, 0xaab1b9);
  B.add(0, 71, 9, 11, 15, 11, 0xaab1b9);
  B.add(0, 86, 9, 5, 7, 5, 0xc0c6cc);
  B.add(0, 93, 9, 1.8, 12, 1.8, 0xd9dde1);
  for (let y = 10; y < 38; y += 9) B.add(0, 3 + y, 9, 24.7, 1.1, 24.7, win, { glow: true });
  // Jumbo screen facing the square
  B.add(0, 28, 21.4, 16, 11, 1, 0x28d8ff, { glow: true });

  // Chrysler Building
  B.add(28, 3, -23, 15, 58, 15, 0xbfc9d2, { studs: true });
  for (let i = 0; i < 7; i++) {
    B.add(28, 61 + i * 2.8, -23, 14 - i * 1.9, 2.8, 14 - i * 1.9, 0xd3dde6);
  }
  B.add(28, 81, -23, 1.4, 10, 1.4, 0xe3eaf0);

  // One World Trade Center
  B.add(-26, 3, 74, 19, 26, 19, 0xc7d3dd, { studs: true });
  B.add(-26, 29, 74, 15, 32, 15, 0xbcccd9);
  B.add(-26, 61, 74, 12, 24, 12, 0xc7d3dd);
  B.add(-26, 85, 74, 1.8, 18, 1.8, 0xdde6ec);
  for (let y = 8; y < 52; y += 10) B.add(-26, 3 + y, 74, 19.7, 1.1, 19.7, win, { glow: true });
  B.add(-26, 24, 63.8, 14, 10, 1, 0xff3d8e, { glow: true });

  // Lady Liberty off the southern tip
  B.add(-12, 0, 104, 10, 5, 10, 0xd9c49a, { studs: true });
  B.add(-12, 5, 104, 4, 4, 4, 0xb8c4a8);
  B.add(-12, 9, 104, 3, 11, 3, 0x7fae8f);
  B.add(-10.2, 16, 104, 1.2, 7, 1.2, 0x7fae8f);
  B.add(-10.2, 23.5, 104, 1.6, 2, 1.6, 0xffd428, { glow: true });
  B.add(-12, 20, 104, 2.2, 2.4, 2.2, 0x8fbc9f);
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

function giza(B: Bricks): void {
  const pyramid = (cx: number, cz: number, base: number) => {
    const h = base * 0.63;
    for (let y = 0; y < h; y += 4) {
      const w = base * (1 - y / h) + 2;
      const color = y > h - 9 ? 0xeed9a8 : (y / 4) % 2 ? 0xdcb56e : 0xcfa75f;
      B.add(cx, y, cz, w, 4, w, color);
    }
  };
  pyramid(-34, -20, 72);
  pyramid(12, 8, 54);
  pyramid(42, 36, 34);

  // A tiny sphinx keeping watch
  B.add(-2, 0, -44, 6, 5, 14, 0xd9b26a);
  B.add(-2, 5, -49, 4.5, 4.5, 4, 0xe0bd78);
  B.add(-2, 9.5, -49, 5.5, 1.4, 4.5, 0xc9a35f);
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
  private discovered = new Set<string>();
  private nearId: string | null = null;

  constructor(private terrain: Terrain) {
    try {
      const raw = localStorage.getItem(DISCOVERED_KEY);
      if (raw) JSON.parse(raw).forEach((id: string) => this.discovered.add(id));
    } catch {
      /* start with an empty collection */
    }
  }

  build(): void {
    const east = new THREE.Vector3();
    const north = new THREE.Vector3();
    const q = new THREE.Quaternion();

    for (const def of LANDMARKS) {
      const dir = latLonToDir(def.lat * DEG2RAD, def.lon * DEG2RAD);
      const anchorH = Math.max(this.terrain.height(dir), 1);
      const B = new Bricks();

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
      }

      const cfg = CITY_CONFIGS[def.id];
      if (cfg?.style) city(B, cfg.style, Math.abs(def.lat * 7 + def.lon));

      const group = B.build();
      if (def.id === 'nyc') group.scale.setScalar(1.2);
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
          ring: cfg.frame.ring,
          plaza: cfg.frame.plaza,
          groundY: cfg.frame.groundY
        });
      }

      this.items.push({ def, dir, worldPos: group.position.clone(), group });
    }

    this.emitCollection();
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
