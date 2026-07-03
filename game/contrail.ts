import * as THREE from 'three';

const POOL = 240;
const SPAWN_INTERVAL = 0.035;
const LIFE = 1.5;

const tmpMat = new THREE.Matrix4();
const tmpQuat = new THREE.Quaternion();
const tmpScale = new THREE.Vector3();
const spinAxis = new THREE.Vector3(0.4, 0.8, 0.44).normalize();

interface Particle {
  pos: THREE.Vector3;
  vel: THREE.Vector3;
  life: number;
  size: number;
  spin: number;
}

/** Wingtip trail of tiny white brick particles. */
export class Contrail {
  readonly mesh: THREE.InstancedMesh;
  private particles: Particle[] = [];
  private head = 0;
  private accum = 0;

  constructor() {
    const mat = new THREE.MeshStandardMaterial({
      color: 0xffffff,
      transparent: true,
      opacity: 0.85,
      roughness: 0.7,
      emissive: 0xffffff,
      emissiveIntensity: 0.12
    });
    this.mesh = new THREE.InstancedMesh(new THREE.BoxGeometry(1, 1, 1), mat, POOL);
    this.mesh.frustumCulled = false;
    for (let i = 0; i < POOL; i++) {
      this.particles.push({
        pos: new THREE.Vector3(),
        vel: new THREE.Vector3(),
        life: 0,
        size: 1,
        spin: 0
      });
      tmpMat.makeScale(0, 0, 0);
      this.mesh.setMatrixAt(i, tmpMat);
    }
  }

  update(dt: number, emitters: THREE.Vector3[], active: boolean, speed: number): void {
    if (active && speed > 70) {
      this.accum += dt;
      while (this.accum >= SPAWN_INTERVAL) {
        this.accum -= SPAWN_INTERVAL;
        for (const e of emitters) {
          const p = this.particles[this.head];
          this.head = (this.head + 1) % POOL;
          p.pos.copy(e);
          p.vel.set((Math.random() - 0.5) * 3, (Math.random() - 0.5) * 3, (Math.random() - 0.5) * 3);
          p.life = LIFE;
          p.size = 0.7 + Math.random() * 0.7;
          p.spin = Math.random() * Math.PI;
        }
      }
    } else {
      this.accum = 0;
    }

    for (let i = 0; i < POOL; i++) {
      const p = this.particles[i];
      if (p.life <= 0) continue;
      p.life -= dt;
      if (p.life <= 0) {
        tmpMat.makeScale(0, 0, 0);
        this.mesh.setMatrixAt(i, tmpMat);
        continue;
      }
      p.pos.addScaledVector(p.vel, dt);
      const t = p.life / LIFE;
      const s = p.size * (0.4 + t * 0.8);
      tmpQuat.setFromAxisAngle(spinAxis, p.spin + p.life * 2);
      tmpScale.set(s, s, s);
      tmpMat.compose(p.pos, tmpQuat, tmpScale);
      this.mesh.setMatrixAt(i, tmpMat);
    }
    this.mesh.instanceMatrix.needsUpdate = true;
  }
}
