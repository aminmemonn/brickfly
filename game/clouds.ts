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
export function buildClouds(count = 42): THREE.Group {
  const group = new THREE.Group();
  const rand = seeded(99);

  const boxes: { pos: THREE.Vector3; quat: THREE.Quaternion; scale: THREE.Vector3 }[] = [];
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

    const alt = PLANET_R + 260 + rand() * 130;
    const center = up.clone().multiplyScalar(alt);
    const parts = 4 + Math.floor(rand() * 7);
    for (let p = 0; p < parts; p++) {
      const ox = (rand() - 0.5) * 90;
      const oz = (rand() - 0.5) * 55;
      const oy = (rand() - 0.5) * 14;
      const w = 22 + rand() * 34;
      const pos = center
        .clone()
        .addScaledVector(east, ox)
        .addScaledVector(north, oz)
        .addScaledVector(up, oy);
      boxes.push({
        pos,
        quat: q.clone(),
        scale: new THREE.Vector3(w, 9 + rand() * 8, w * (0.55 + rand() * 0.4))
      });
    }
  }

  const mat = new THREE.MeshStandardMaterial({
    color: 0xffffff,
    vertexColors: true,
    flatShading: true,
    roughness: 0.9,
    metalness: 0
  });
  const mesh = new THREE.InstancedMesh(makeAOBox(), mat, boxes.length);
  const m = new THREE.Matrix4();
  boxes.forEach((b, i) => {
    m.compose(b.pos, b.quat, b.scale);
    mesh.setMatrixAt(i, m);
  });
  mesh.instanceMatrix.needsUpdate = true;
  mesh.frustumCulled = false;

  group.add(mesh);
  return group;
}

export function updateClouds(group: THREE.Group, dt: number): void {
  group.rotation.y += dt * 0.0022;
}
