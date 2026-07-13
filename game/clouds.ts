import * as THREE from 'three';
import { PLANET_R } from './constants';
import { tangentBasis, basisQuat, makeAOBox } from './util';

function seeded(seed: number): () => number {
  let a = seed;
  return () => {
    a = (a * 1664525 + 1013904223) % 4294967296;
    return a / 4294967296;
  };
}

/** Chunky brick-cluster clouds drifting slowly around the planet. */
export function buildClouds(count = 150): THREE.Group {
  const group = new THREE.Group();
  const rand = seeded(99);

  const boxes: { pos: THREE.Vector3; quat: THREE.Quaternion; scale: THREE.Vector3; tint: number }[] = [];
  const up = new THREE.Vector3();
  const east = new THREE.Vector3();
  const north = new THREE.Vector3();
  const q = new THREE.Quaternion();

  for (let i = 0; i < count; i++) {
    // Bias clouds away from the poles.
    const lat = (rand() - 0.5) * 2.2;
    const lon = rand() * Math.PI * 2;
    const c = Math.cos(lat);
    up.set(c * Math.cos(lon), Math.sin(lat), -c * Math.sin(lon));
    tangentBasis(up, east, north);
    basisQuat(east, up, north, q);

    // Layered deck: low cumulus, mid puffs, high thin wisps; a few grey
    // rain-bellied clusters for variety.
    const layer = rand();
    const alt = PLANET_R + 320 + layer * 520;
    const grey = rand() > 0.85 ? 0.72 : 0.95 + rand() * 0.05;
    const center = up.clone().multiplyScalar(alt);
    const big = rand() > 0.6;
    const parts = big ? 6 + Math.floor(rand() * 7) : 3 + Math.floor(rand() * 4);
    const spread = big ? 170 : 100;
    for (let p = 0; p < parts; p++) {
      const ox = (rand() - 0.5) * spread;
      const oz = (rand() - 0.5) * spread * 0.62;
      const oy = (rand() - 0.5) * 18;
      const w = (big ? 30 : 22) + rand() * 52;
      const pos = center
        .clone()
        .addScaledVector(east, ox)
        .addScaledVector(north, oz)
        .addScaledVector(up, oy);
      boxes.push({
        pos,
        quat: q.clone(),
        scale: new THREE.Vector3(w, (layer > 0.75 ? 5 : 9) + rand() * 8, w * (0.55 + rand() * 0.4)),
        tint: grey
      });
    }
  }

  const mat = new THREE.MeshStandardMaterial({
    color: 0xffffff,
    vertexColors: true,
    flatShading: true,
    roughness: 0.9,
    metalness: 0,
    emissive: 0x8fa0bd,
    emissiveIntensity: 0.16
  });
  const mesh = new THREE.InstancedMesh(makeAOBox(), mat, boxes.length);
  const m = new THREE.Matrix4();
  const col = new THREE.Color();
  boxes.forEach((b, i) => {
    m.compose(b.pos, b.quat, b.scale);
    mesh.setMatrixAt(i, m);
    mesh.setColorAt(i, col.setScalar(b.tint));
  });
  mesh.instanceMatrix.needsUpdate = true;
  if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true;
  mesh.frustumCulled = false;

  group.add(mesh);
  return group;
}

export function updateClouds(group: THREE.Group, dt: number): void {
  group.rotation.y += dt * 0.0022;
}
