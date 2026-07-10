import * as THREE from 'three';
import { PLANET_R } from './constants';
import { Terrain } from './terrain';
import { LANDMARKS } from './landmark-data';
import { latLonToDir, tangentBasis, basisQuat, hash2, DEG2RAD } from './util';
import { createABSColoredMaterial } from './brick-material';

const BALLOON_PALETTES: number[][] = [
  [0xd6382c, 0xf7d354, 0xd6382c, 0xf7d354, 0xf4f4f2],
  [0x2c6bd6, 0xf4f4f2, 0x2c6bd6, 0xf4f4f2, 0x2c6bd6],
  [0xf7a231, 0xf4f4f2, 0x4cb227, 0xf4f4f2, 0xf7a231],
  [0x9d5cff, 0xf7d354, 0x9d5cff, 0xf7d354, 0xf4f4f2]
];

const RING_WIDTHS = [6, 9.5, 10.5, 9, 5.5];

interface Balloon {
  obj: THREE.Group;
  dir: THREE.Vector3;
  baseAlt: number;
  baseQuat: THREE.Quaternion;
  phase: number;
}

const qSpin = new THREE.Quaternion();
const Y_AXIS = new THREE.Vector3(0, 1, 0);

/** Ambient brick hot-air balloons drifting near landmarks. */
export class Ambient {
  readonly group = new THREE.Group();
  private balloons: Balloon[] = [];

  constructor(terrain: Terrain) {
    const east = new THREE.Vector3();
    const north = new THREE.Vector3();
    const boxGeo = new THREE.BoxGeometry(1, 1, 1);
    const mats = new Map<number, THREE.ShaderMaterial>();
    const mat = (c: number) => {
      if (!mats.has(c)) mats.set(c, createABSColoredMaterial(c));
      return mats.get(c)!;
    };

    LANDMARKS.forEach((lm, i) => {
      if (i % 3 === 2) return; // balloons near two of every three landmarks
      const palette = BALLOON_PALETTES[i % BALLOON_PALETTES.length];
      const offLat = (hash2(i, 1) - 0.5) * 3.2;
      const offLon = (hash2(i, 2) - 0.5) * 3.2;
      const dir = latLonToDir((lm.lat + offLat) * DEG2RAD, (lm.lon + offLon) * DEG2RAD);
      const ground = Math.max(terrain.height(dir), 1);

      const obj = new THREE.Group();
      RING_WIDTHS.forEach((w, ring) => {
        const mesh = new THREE.Mesh(boxGeo, mat(palette[ring % palette.length]));
        mesh.scale.set(w, 2.6, w);
        mesh.position.y = ring * 2.6;
        mesh.castShadow = true;
        obj.add(mesh);
      });
      const basket = new THREE.Mesh(boxGeo, mat(0x8a6743));
      basket.scale.set(3.2, 2.6, 3.2);
      basket.position.y = -5.5;
      obj.add(basket);

      tangentBasis(dir, east, north);
      const baseQuat = basisQuat(east, dir, north, new THREE.Quaternion());
      obj.quaternion.copy(baseQuat);

      this.group.add(obj);
      this.balloons.push({
        obj,
        dir: dir.clone(),
        baseAlt: ground + 70 + hash2(i, 5) * 50,
        baseQuat,
        phase: hash2(i, 9) * Math.PI * 2
      });
    });
  }

  update(t: number): void {
    for (const b of this.balloons) {
      const bob = Math.sin(t * 0.4 + b.phase) * 7;
      b.obj.position.copy(b.dir).multiplyScalar(PLANET_R + b.baseAlt + bob);
      qSpin.setFromAxisAngle(Y_AXIS, t * 0.06 + b.phase);
      b.obj.quaternion.copy(b.baseQuat).multiply(qSpin);
    }
  }
}
