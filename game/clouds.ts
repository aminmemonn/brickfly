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
    // rain-bellied clusters for variety. Every cluster keeps a fat core slab
    // with satellites overlapping it — sparse clusters of small boxes fall
    // apart into lone cubes that read as floating glitches at flight level.
    const layer = rand();
    // Cloud ceiling sits well above the sightseeing band (plane cruises at
    // ~300-600 above terrain). Parked low, the deck put a wall of stray white
    // cubes right at flight level; lifted to 1400-2400 it reads as sky.
    const alt = PLANET_R + 1400 + layer * 1000;
    const grey = rand() > 0.85 ? 0.72 : 0.95 + rand() * 0.05;
    const center = up.clone().multiplyScalar(alt);
    const big = rand() > 0.6;
    const parts = big ? 7 + Math.floor(rand() * 6) : 5 + Math.floor(rand() * 4);
    const coreW = (big ? 74 : 60) + rand() * 46;
    for (let p = 0; p < parts; p++) {
      const core = p === 0;
      const w = core ? coreW : 30 + rand() * (big ? 46 : 30);
      // Satellite offsets are bounded by the two half-widths so every box
      // overlaps the core slab — free-floating satellites read as glitch
      // cubes when the flight path passes through the deck.
      const ox = core ? 0 : (rand() - 0.5) * (coreW + w) * 0.75;
      const oz = core ? 0 : (rand() - 0.5) * (coreW + w) * 0.5;
      const oy = (rand() - 0.5) * 10;
      const pos = center
        .clone()
        .addScaledVector(east, ox)
        .addScaledVector(north, oz)
        .addScaledVector(up, oy);
      boxes.push({
        pos,
        quat: q.clone(),
        scale: new THREE.Vector3(w, (layer > 0.75 ? 6 : 10) + rand() * 8, w * (0.55 + rand() * 0.4)),
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
    emissiveIntensity: 0.16,
    transparent: true,
    depthWrite: false
  });
  // Fade any cloud fragment near the camera to transparent. Flying up into the
  // deck should feel like passing through vapour, not clipping through hard
  // floating cubes; distant clouds (>480 units) stay fully opaque.
  mat.onBeforeCompile = (shader) => {
    shader.vertexShader = shader.vertexShader
      .replace('#include <common>', '#include <common>\nvarying vec3 vBfWorld;')
      .replace(
        '#include <project_vertex>',
        `#include <project_vertex>
        {
          vec4 bfWP = vec4(transformed, 1.0);
          #ifdef USE_INSTANCING
            bfWP = instanceMatrix * bfWP;
          #endif
          vBfWorld = (modelMatrix * bfWP).xyz;
        }`
      );
    shader.fragmentShader = shader.fragmentShader
      .replace('#include <common>', '#include <common>\nvarying vec3 vBfWorld;')
      .replace(
        '#include <dithering_fragment>',
        `gl_FragColor.a *= smoothstep(140.0, 480.0, distance(cameraPosition, vBfWorld));
        #include <dithering_fragment>`
      );
  };
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
