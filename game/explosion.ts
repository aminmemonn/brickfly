import * as THREE from 'three';
import { ABS_SOLID_MATERIAL } from './brick-material';

const POOL = 96;
const LIFE = 2.2;
const PALETTE = [0xd6382c, 0xf4f4f2, 0xf7a231, 0xf7d354, 0x2c6bd6];

const tmpMat = new THREE.Matrix4();
const tmpQuat = new THREE.Quaternion();
const tmpScale = new THREE.Vector3();
const tmpAxis = new THREE.Vector3();

interface Chunk {
  pos: THREE.Vector3;
  vel: THREE.Vector3;
  axis: THREE.Vector3;
  angle: number;
  spin: number;
  life: number;
  size: number;
}

/** One-shot burst of plane-colored bricks on crash. */
export class Explosion {
  readonly mesh: THREE.InstancedMesh;
  private chunks: Chunk[] = [];
  private gravityDir = new THREE.Vector3(0, -1, 0);
  private active = false;

  constructor() {
    this.mesh = new THREE.InstancedMesh(new THREE.BoxGeometry(1, 1, 1), ABS_SOLID_MATERIAL, POOL);
    this.mesh.frustumCulled = false;
    const col = new THREE.Color();
    for (let i = 0; i < POOL; i++) {
      this.chunks.push({
        pos: new THREE.Vector3(),
        vel: new THREE.Vector3(),
        axis: new THREE.Vector3(1, 0, 0),
        angle: 0,
        spin: 0,
        life: 0,
        size: 1
      });
      tmpMat.makeScale(0, 0, 0);
      this.mesh.setMatrixAt(i, tmpMat);
      col.setHex(PALETTE[i % PALETTE.length]);
      this.mesh.setColorAt(i, col);
    }
    if (this.mesh.instanceColor) this.mesh.instanceColor.needsUpdate = true;
  }

  trigger(pos: THREE.Vector3, vel: THREE.Vector3, up: THREE.Vector3): void {
    this.active = true;
    this.gravityDir.copy(up).negate();
    for (const c of this.chunks) {
      c.pos.copy(pos);
      tmpAxis.randomDirection();
      c.vel
        .copy(vel)
        .multiplyScalar(0.3)
        .addScaledVector(tmpAxis, 25 + Math.random() * 55)
        .addScaledVector(up, 20 + Math.random() * 30);
      c.axis.randomDirection();
      c.angle = Math.random() * Math.PI;
      c.spin = (Math.random() - 0.5) * 10;
      c.life = LIFE * (0.6 + Math.random() * 0.4);
      c.size = 1 + Math.random() * 1.8;
    }
  }

  update(dt: number): void {
    if (!this.active) return;
    let alive = 0;
    for (let i = 0; i < POOL; i++) {
      const c = this.chunks[i];
      if (c.life <= 0) continue;
      c.life -= dt;
      if (c.life <= 0) {
        tmpMat.makeScale(0, 0, 0);
        this.mesh.setMatrixAt(i, tmpMat);
        continue;
      }
      alive++;
      c.vel.addScaledVector(this.gravityDir, 70 * dt);
      c.pos.addScaledVector(c.vel, dt);
      c.angle += c.spin * dt;
      const t = Math.min(1, c.life / 0.5);
      tmpQuat.setFromAxisAngle(c.axis, c.angle);
      tmpScale.setScalar(c.size * t);
      tmpMat.compose(c.pos, tmpQuat, tmpScale);
      this.mesh.setMatrixAt(i, tmpMat);
    }
    this.mesh.instanceMatrix.needsUpdate = true;
    if (alive === 0) this.active = false;
  }
}
