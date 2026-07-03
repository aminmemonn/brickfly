import * as THREE from 'three';
import { STUD_R, STUD_H } from './constants';

const COLORS = {
  red: 0xd6382c,
  white: 0xf4f4f2,
  dark: 0x33363c,
  blue: 0x2c6bd6,
  glass: 0x9fd6ff
};

const matCache = new Map<number, THREE.MeshStandardMaterial>();

function mat(color: number, opts: { transparent?: boolean; opacity?: number } = {}): THREE.MeshStandardMaterial {
  if (!opts.transparent && matCache.has(color)) return matCache.get(color)!;
  const m = new THREE.MeshStandardMaterial({
    color,
    roughness: 0.32,
    metalness: 0.05,
    transparent: opts.transparent ?? false,
    opacity: opts.opacity ?? 1
  });
  if (!opts.transparent) matCache.set(color, m);
  return m;
}

const boxGeo = new THREE.BoxGeometry(1, 1, 1);

function box(
  parent: THREE.Object3D,
  color: number,
  w: number,
  h: number,
  d: number,
  x: number,
  y: number,
  z: number,
  opts: { transparent?: boolean; opacity?: number } = {}
): THREE.Mesh {
  const mesh = new THREE.Mesh(boxGeo, mat(color, opts));
  mesh.scale.set(w, h, d);
  mesh.position.set(x, y, z);
  mesh.castShadow = !opts.transparent;
  parent.add(mesh);
  return mesh;
}

/**
 * The player's toy-brick aircraft. Forward is -Z. Control surfaces animate
 * with input; the propeller spins with throttle.
 */
export class BrickPlane {
  readonly group = new THREE.Group();

  private propeller: THREE.Group;
  private aileronL: THREE.Group;
  private aileronR: THREE.Group;
  private elevator: THREE.Group;
  private rudder: THREE.Group;

  constructor() {
    const g = this.group;

    // Fuselage
    box(g, COLORS.red, 2.8, 2.6, 9, 0, 0, 0.5);
    box(g, COLORS.white, 2.9, 0.9, 9.2, 0, -1, 0.5);
    box(g, COLORS.red, 2.2, 2, 2, 0, -0.1, -4.9);
    box(g, COLORS.dark, 2.5, 2.5, 0.8, 0, -0.1, -6);
    box(g, COLORS.glass, 1.8, 1.3, 2.6, 0, 1.75, -1.1, { transparent: true, opacity: 0.55 });

    // Propeller
    this.propeller = new THREE.Group();
    this.propeller.position.set(0, -0.1, -6.6);
    box(this.propeller, COLORS.dark, 0.7, 0.7, 0.6, 0, 0, 0);
    box(this.propeller, COLORS.dark, 0.55, 7.4, 0.18, 0, 0, -0.2);
    box(this.propeller, COLORS.dark, 7.4, 0.55, 0.18, 0, 0, -0.2);
    g.add(this.propeller);

    // Wings with dihedral
    for (const side of [-1, 1]) {
      const wing = box(g, COLORS.white, 7, 0.8, 3.6, side * 4.8, 0.85, -0.6);
      wing.rotation.z = side * -0.05;
      box(g, COLORS.red, 1, 0.85, 3.6, side * 8.3, 1, -0.6);
    }

    // Ailerons (hinged at their leading edge)
    this.aileronL = this.makeSurface(COLORS.white, 3, 0.5, 1.1, -6.4, 0.85, 1.35);
    this.aileronR = this.makeSurface(COLORS.white, 3, 0.5, 1.1, 6.4, 0.85, 1.35);

    // Tail
    box(g, COLORS.white, 6.4, 0.6, 2, 0, 0.5, 4.6);
    this.elevator = this.makeSurface(COLORS.white, 6, 0.45, 0.9, 0, 0.5, 5.85);
    box(g, COLORS.red, 0.7, 2.8, 2.2, 0, 1.9, 4.5);
    this.rudder = this.makeSurface(COLORS.red, 0.55, 2.4, 0.9, 0, 2, 5.85);

    // Engine accents
    box(g, COLORS.blue, 3, 0.5, 1.4, 0, 1.45, 1.6);

    this.addStuds();
  }

  private makeSurface(color: number, w: number, h: number, d: number, x: number, y: number, z: number): THREE.Group {
    const pivot = new THREE.Group();
    pivot.position.set(x, y, z);
    box(pivot, color, w, h, d, 0, 0, d / 2);
    this.group.add(pivot);
    return pivot;
  }

  private addStuds(): void {
    const spots: [number, number, number][] = [];
    for (const side of [-1, 1]) {
      for (let i = 0; i < 3; i++) {
        spots.push([side * (3.4 + i * 1.7), 1.32, -1.2]);
        spots.push([side * (3.4 + i * 1.7), 1.32, 0]);
      }
    }
    for (let i = 0; i < 3; i++) spots.push([0, 1.38, 1.6 + i * 1.2]);

    const geo = new THREE.CylinderGeometry(STUD_R * 0.42, STUD_R * 0.42, STUD_H * 0.5, 10);
    const studs = new THREE.InstancedMesh(geo, mat(COLORS.white), spots.length);
    const m = new THREE.Matrix4();
    spots.forEach((s, i) => {
      m.makeTranslation(s[0], s[1], s[2]);
      studs.setMatrixAt(i, m);
    });
    studs.castShadow = true;
    this.group.add(studs);
  }

  update(dt: number, input: { pitch: number; roll: number; yaw: number }, throttle: number): void {
    this.propeller.rotation.z += dt * (6 + throttle * 46);
    const ease = 1 - Math.exp(-12 * dt);
    this.aileronL.rotation.x += (input.roll * 0.55 - this.aileronL.rotation.x) * ease;
    this.aileronR.rotation.x += (-input.roll * 0.55 - this.aileronR.rotation.x) * ease;
    this.elevator.rotation.x += (-input.pitch * 0.5 - this.elevator.rotation.x) * ease;
    this.rudder.rotation.y += (input.yaw * 0.6 - this.rudder.rotation.y) * ease;
  }
}
