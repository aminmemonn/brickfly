import * as THREE from 'three';
import { PLANET_R } from './constants';
import { Terrain } from './terrain';
import { hash2 } from './util';

/**
 * The base planet mesh: a displaced, flat-shaded sphere with per-face biome
 * colors. Near-field brick detail is layered on top by BrickField.
 */
export function buildGlobe(terrain: Terrain): THREE.Mesh {
  const base = new THREE.SphereGeometry(PLANET_R, 288, 180);
  const pos = base.attributes.position;
  const dir = new THREE.Vector3();

  for (let i = 0; i < pos.count; i++) {
    dir.fromBufferAttribute(pos, i).normalize();
    const h = terrain.height(dir);
    pos.setXYZ(i, dir.x * (PLANET_R + h), dir.y * (PLANET_R + h), dir.z * (PLANET_R + h));
  }

  const geo = base.toNonIndexed();
  base.dispose();

  const p = geo.attributes.position;
  const colors = new Float32Array(p.count * 3);
  const a = new THREE.Vector3();
  const b = new THREE.Vector3();
  const c = new THREE.Vector3();
  const centroid = new THREE.Vector3();
  const col = new THREE.Color();

  for (let f = 0; f < p.count / 3; f++) {
    a.fromBufferAttribute(p, f * 3);
    b.fromBufferAttribute(p, f * 3 + 1);
    c.fromBufferAttribute(p, f * 3 + 2);
    const h = (a.length() + b.length() + c.length()) / 3 - PLANET_R;
    centroid.copy(a).add(b).add(c).normalize();
    terrain.colorAt(centroid, h, col);
    col.multiplyScalar(0.93 + hash2(f, 7) * 0.14);
    for (let v = 0; v < 3; v++) {
      colors[(f * 3 + v) * 3] = col.r;
      colors[(f * 3 + v) * 3 + 1] = col.g;
      colors[(f * 3 + v) * 3 + 2] = col.b;
    }
  }

  geo.setAttribute('color', new THREE.BufferAttribute(colors, 3));
  geo.computeVertexNormals();

  const mat = new THREE.MeshStandardMaterial({
    vertexColors: true,
    flatShading: true,
    roughness: 0.55,
    metalness: 0
  });

  const mesh = new THREE.Mesh(geo, mat);
  mesh.receiveShadow = true;
  return mesh;
}
