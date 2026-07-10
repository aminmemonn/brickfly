import * as THREE from 'three';
import { basisQuat } from './util';
import { ABS_SOLID_MATERIAL, createABSColoredMaterial } from './brick-material';

/** A city's local frame on the sphere, produced by LandmarkManager. */
export interface CityFrame {
  origin: THREE.Vector3;
  up: THREE.Vector3;
  east: THREE.Vector3;
  north: THREE.Vector3;
  /** Half-extent of the square ring road cars drive on. 0 disables cars. */
  ring: number;
  /** Plaza radius citizens wander in. 0 disables citizens. */
  plaza: number;
  /** Local height of the street surface. */
  groundY: number;
}

const CAR_COLORS = [0xd6382c, 0x2c6bd6, 0xf7d354, 0x4cb227, 0xf4f4f2, 0xf7a231];
const SHIRT_COLORS = [0xd6382c, 0x2c6bd6, 0x4cb227, 0xf7a231, 0x9d5cff, 0xf4f4f2, 0x2e9e9b];
const PANTS_COLORS = [0x33363c, 0x2c4a6b, 0x5a4632, 0x3f5a4e];
const SKIN = 0xf5c542;

const CARS_PER_CITY = 16;
const PEOPLE_PER_CITY = 34;
// Cars and citizens are drawn larger than life so they stay visible from the
// air now that the cities themselves are rendered at a much bigger scale.
const LIFE_SCALE = 2.2;

interface Car {
  frame: CityFrame;
  cityQuat: THREE.Quaternion;
  t: number;
  speed: number;
}

interface Person {
  frame: CityFrame;
  cityQuat: THREE.Quaternion;
  ax: number;
  az: number;
  bx: number;
  bz: number;
  phase: number;
  speed: number;
}

const vPos = new THREE.Vector3();
const qYaw = new THREE.Quaternion();
const qFinal = new THREE.Quaternion();
const mTmp = new THREE.Matrix4();
const sTmp = new THREE.Vector3();
const Y_AXIS = new THREE.Vector3(0, 1, 0);

function rand(seed: number): number {
  const s = Math.sin(seed * 127.1 + 311.7) * 43758.5453;
  return s - Math.floor(s);
}

/**
 * Animated city life: brick cars looping the ring roads and citizens
 * strolling the plazas. Everything is instanced; transforms are recomputed
 * per frame in each city's tangent frame.
 */
export class CityLife {
  readonly group = new THREE.Group();

  private carBody: THREE.InstancedMesh;
  private carTop: THREE.InstancedMesh;
  private legs: THREE.InstancedMesh;
  private torso: THREE.InstancedMesh;
  private head: THREE.InstancedMesh;

  private cars: Car[] = [];
  private people: Person[] = [];

  constructor(cities: CityFrame[]) {
    const box = new THREE.BoxGeometry(1, 1, 1);
    const headGeo = new THREE.CylinderGeometry(0.48, 0.48, 0.72, 8);
    const mat = ABS_SOLID_MATERIAL;
    const skinMat = createABSColoredMaterial(SKIN);

    const carFrames = cities.filter((c) => c.ring > 0);
    const peopleFrames = cities.filter((c) => c.plaza > 0);

    for (const frame of carFrames) {
      const cityQuat = basisQuat(frame.east, frame.up, frame.north, new THREE.Quaternion());
      for (let i = 0; i < CARS_PER_CITY; i++) {
        this.cars.push({
          frame,
          cityQuat,
          t: i / CARS_PER_CITY,
          speed: 9 + rand(i * 3 + frame.ring) * 6
        });
      }
    }

    for (const frame of peopleFrames) {
      const cityQuat = basisQuat(frame.east, frame.up, frame.north, new THREE.Quaternion());
      for (let i = 0; i < PEOPLE_PER_CITY; i++) {
        const a1 = rand(i * 7 + frame.plaza) * Math.PI * 2;
        const a2 = rand(i * 13 + frame.plaza + 5) * Math.PI * 2;
        const r1 = frame.plaza * (0.35 + rand(i + 1) * 0.55);
        const r2 = frame.plaza * (0.35 + rand(i + 9) * 0.55);
        this.people.push({
          frame,
          cityQuat,
          ax: Math.cos(a1) * r1,
          az: Math.sin(a1) * r1,
          bx: Math.cos(a2) * r2,
          bz: Math.sin(a2) * r2,
          phase: rand(i * 31) * 10,
          speed: 0.06 + rand(i * 17) * 0.05
        });
      }
    }

    this.carBody = new THREE.InstancedMesh(box, mat, Math.max(1, this.cars.length));
    this.carTop = new THREE.InstancedMesh(box, mat, Math.max(1, this.cars.length));
    this.legs = new THREE.InstancedMesh(box, mat, Math.max(1, this.people.length));
    this.torso = new THREE.InstancedMesh(box, mat, Math.max(1, this.people.length));
    this.head = new THREE.InstancedMesh(headGeo, skinMat, Math.max(1, this.people.length));

    const col = new THREE.Color();
    this.cars.forEach((_, i) => {
      this.carBody.setColorAt(i, col.setHex(CAR_COLORS[i % CAR_COLORS.length]));
      this.carTop.setColorAt(i, col.setHex(0xd7ecf7));
    });
    this.people.forEach((_, i) => {
      this.torso.setColorAt(i, col.setHex(SHIRT_COLORS[i % SHIRT_COLORS.length]));
      this.legs.setColorAt(i, col.setHex(PANTS_COLORS[i % PANTS_COLORS.length]));
    });

    for (const mesh of [this.carBody, this.carTop, this.legs, this.torso, this.head]) {
      mesh.frustumCulled = false;
      mesh.castShadow = true;
      this.group.add(mesh);
    }
  }

  update(dt: number, elapsed: number): void {
    this.cars.forEach((car, i) => {
      const R = car.frame.ring;
      const perimeter = 8 * R;
      car.t = (car.t + (car.speed * dt) / perimeter) % 1;
      const s = car.t * perimeter;
      const side = Math.floor(s / (2 * R));
      const u = s - side * 2 * R - R;
      let lx = 0;
      let lz = 0;
      let dx = 0;
      let dz = 0;
      if (side === 0) { lx = u; lz = -R; dx = 1; }
      else if (side === 1) { lx = R; lz = u; dz = 1; }
      else if (side === 2) { lx = -u; lz = R; dx = -1; }
      else { lx = -R; lz = -u; dz = -1; }

      qYaw.setFromAxisAngle(Y_AXIS, -Math.atan2(dz, dx));
      qFinal.copy(car.cityQuat).multiply(qYaw);

      const ly = car.frame.groundY + 1.1 * LIFE_SCALE;
      vPos.copy(car.frame.origin)
        .addScaledVector(car.frame.east, lx)
        .addScaledVector(car.frame.north, lz)
        .addScaledVector(car.frame.up, ly);
      mTmp.compose(vPos, qFinal, sTmp.set(5.5, 1.7, 2.8).multiplyScalar(LIFE_SCALE));
      this.carBody.setMatrixAt(i, mTmp);

      vPos.addScaledVector(car.frame.up, 1.5 * LIFE_SCALE);
      mTmp.compose(vPos, qFinal, sTmp.set(3.1, 1.3, 2.4).multiplyScalar(LIFE_SCALE));
      this.carTop.setMatrixAt(i, mTmp);
    });

    this.people.forEach((p, i) => {
      const wave = (elapsed * p.speed + p.phase) % 2;
      const u = wave < 1 ? wave : 2 - wave;
      const lx = p.ax + (p.bx - p.ax) * u;
      const lz = p.az + (p.bz - p.az) * u;
      const dirSign = wave < 1 ? 1 : -1;
      const heading = -Math.atan2((p.bz - p.az) * dirSign, (p.bx - p.ax) * dirSign);
      const bob = Math.abs(Math.sin(elapsed * 5 + p.phase)) * 0.2 * LIFE_SCALE;

      qYaw.setFromAxisAngle(Y_AXIS, heading);
      qFinal.copy(p.cityQuat).multiply(qYaw);

      const base = p.frame.groundY + bob;
      vPos.copy(p.frame.origin)
        .addScaledVector(p.frame.east, lx)
        .addScaledVector(p.frame.north, lz)
        .addScaledVector(p.frame.up, base + 0.65 * LIFE_SCALE);
      mTmp.compose(vPos, qFinal, sTmp.set(1.3, 1.3, 0.8).multiplyScalar(LIFE_SCALE));
      this.legs.setMatrixAt(i, mTmp);

      vPos.addScaledVector(p.frame.up, 1.25 * LIFE_SCALE);
      mTmp.compose(vPos, qFinal, sTmp.set(1.5, 1.25, 0.9).multiplyScalar(LIFE_SCALE));
      this.torso.setMatrixAt(i, mTmp);

      vPos.addScaledVector(p.frame.up, 1.0 * LIFE_SCALE);
      mTmp.compose(vPos, qFinal, sTmp.set(1, 1, 1).multiplyScalar(LIFE_SCALE));
      this.head.setMatrixAt(i, mTmp);
    });

    for (const mesh of [this.carBody, this.carTop, this.legs, this.torso, this.head]) {
      mesh.instanceMatrix.needsUpdate = true;
    }
    if (this.carBody.instanceColor) this.carBody.instanceColor.needsUpdate = true;
    if (this.torso.instanceColor) this.torso.instanceColor.needsUpdate = true;
  }
}
