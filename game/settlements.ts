import * as THREE from 'three';
import { PLANET_R, BRICK_H } from './constants';
import { Terrain } from './terrain';
import { LANDMARKS } from './landmark-data';
import { latLonToDir, tangentBasis, basisQuat, makeAOBox, clamp, DEG2RAD } from './util';

const MAX_BRICKS = 3200;
const MAX_GLOW = 900;

const WALLS = [0xe8dcc0, 0xc46a4a, 0xd9c49a, 0x9fb6c6, 0xf0e6d2, 0xb05b3e];
const ROOFS = [0xb5533c, 0x555b63, 0x8a6743, 0x3f5a4e];
const WINDOW_GLOW = 0xffd88a;

function mulberry(seed: number): () => number {
  let a = seed;
  return () => {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/**
 * Scatters hamlets (houses with glowing windows) and tree clusters across
 * every continent so the globe never feels empty between landmarks.
 * Everything is two static instanced draws plus one glow draw.
 */
export function buildSettlements(terrain: Terrain): THREE.Group {
  const group = new THREE.Group();
  const rand = mulberry(20260703);

  const landmarkDirs = LANDMARKS.map((lm) => latLonToDir(lm.lat * DEG2RAD, lm.lon * DEG2RAD));

  const bricks = new THREE.InstancedMesh(
    makeAOBox(),
    new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.38, metalness: 0.04 }),
    MAX_BRICKS
  );
  const glow = new THREE.InstancedMesh(
    new THREE.BoxGeometry(1, 1, 1),
    new THREE.MeshBasicMaterial(),
    MAX_GLOW
  );

  const dir = new THREE.Vector3();
  const east = new THREE.Vector3();
  const north = new THREE.Vector3();
  const up = new THREE.Vector3();
  const probe = new THREE.Vector3();
  const q = new THREE.Quaternion();
  const qy = new THREE.Quaternion();
  const qf = new THREE.Quaternion();
  const pos = new THREE.Vector3();
  const scale = new THREE.Vector3();
  const m = new THREE.Matrix4();
  const col = new THREE.Color();
  const Y = new THREE.Vector3(0, 1, 0);

  let bi = 0;
  let gi = 0;
  let villages = 0;
  let groves = 0;

  const place = (
    lx: number,
    ly: number,
    lz: number,
    w: number,
    h: number,
    d: number,
    color: number,
    baseR: number,
    ry: number,
    glowBrick: boolean
  ) => {
    pos.copy(dir).multiplyScalar(baseR + ly + h / 2).addScaledVector(east, lx).addScaledVector(north, lz);
    qy.setFromAxisAngle(Y, ry);
    qf.copy(q).multiply(qy);
    scale.set(w, h, d);
    m.compose(pos, qf, scale);
    if (glowBrick) {
      if (gi >= MAX_GLOW) return;
      glow.setMatrixAt(gi, m);
      glow.setColorAt(gi, col.setHex(color));
      gi++;
    } else {
      if (bi >= MAX_BRICKS) return;
      bricks.setMatrixAt(bi, m);
      bricks.setColorAt(bi, col.setHex(color));
      bi++;
    }
  };

  for (let attempt = 0; attempt < 5000 && (villages < 150 || groves < 260); attempt++) {
    const z = rand() * 2 - 1;
    const phi = rand() * Math.PI * 2;
    const r = Math.sqrt(Math.max(0, 1 - z * z));
    dir.set(r * Math.cos(phi), z, r * Math.sin(phi));

    const lat = Math.abs(Math.asin(clamp(dir.y, -1, 1)));
    if (lat > 1.15) continue;
    const h = terrain.height(dir);
    if (h < 6 || h > 70) continue;

    let nearLandmark = false;
    for (const lm of landmarkDirs) {
      if (dir.dot(lm) > 0.9985) {
        nearLandmark = true;
        break;
      }
    }
    if (nearLandmark) continue;

    up.copy(dir);
    tangentBasis(up, east, north);
    basisQuat(east, up, north, q);

    // A hamlet's flat plate only looks grounded on near-level land, so reject
    // slopes where the footprint would bury the uphill side.
    let hMin = h;
    let hMax = h;
    for (const [ex, nz] of [[26, 0], [-26, 0], [0, 26], [0, -26]] as const) {
      probe.copy(dir).multiplyScalar(PLANET_R).addScaledVector(east, ex).addScaledVector(north, nz).normalize();
      const ph = terrain.height(probe);
      if (ph < hMin) hMin = ph;
      if (ph > hMax) hMax = ph;
    }
    if (hMax - hMin > BRICK_H * 1.6) continue;

    const baseR = PLANET_R + Math.ceil(h / BRICK_H) * BRICK_H + 0.2;

    const isVillage = villages < 150 && (groves >= 260 || rand() < 0.4);
    if (isVillage) {
      villages++;
      const houses = 3 + Math.floor(rand() * 4);
      for (let k = 0; k < houses; k++) {
        const hx = (rand() - 0.5) * 44;
        const hz = (rand() - 0.5) * 44;
        const hw = 5.5 + rand() * 3;
        const hh = 4.5 + rand() * 3;
        const ry = rand() * Math.PI;
        place(hx, 0, hz, hw, hh, hw, WALLS[Math.floor(rand() * WALLS.length)], baseR, ry, false);
        place(hx, hh, hz, hw + 1.4, 1.8, hw + 1.4, ROOFS[Math.floor(rand() * ROOFS.length)], baseR, ry, false);
        place(hx, 1.6, hz + hw / 2 - 0.2, 1.6, 1.6, 1.2, WINDOW_GLOW, baseR, ry, true);
      }
      // Village lane and a tree
      place(0, -0.4, 0, 9, 0.8, 40, 0x8a8f96, baseR, rand() * Math.PI, false);
      place(14, 0, 14, 1.1, 3, 1.1, 0x8a6743, baseR, 0, false);
      place(14, 3.6, 14, 4.6, 4.4, 4.6, 0x2e7d1e, baseR, 0, false);
    } else {
      groves++;
      const trees = 2 + Math.floor(rand() * 4);
      for (let k = 0; k < trees; k++) {
        const tx = (rand() - 0.5) * 36;
        const tz = (rand() - 0.5) * 36;
        const th = 2.6 + rand() * 2;
        place(tx, 0, tz, 1.1, th, 1.1, 0x8a6743, baseR, 0, false);
        place(tx, th, tz, 3.8 + rand() * 2.2, 3.8 + rand() * 2, 3.8 + rand() * 2.2, rand() > 0.5 ? 0x2e7d1e : 0x3fa021, baseR, 0, false);
      }
    }
  }

  bricks.count = bi;
  glow.count = gi;
  bricks.instanceMatrix.needsUpdate = true;
  glow.instanceMatrix.needsUpdate = true;
  if (bricks.instanceColor) bricks.instanceColor.needsUpdate = true;
  if (glow.instanceColor) glow.instanceColor.needsUpdate = true;
  bricks.frustumCulled = false;
  glow.frustumCulled = false;
  bricks.receiveShadow = true;

  group.add(bricks, glow);
  return group;
}
