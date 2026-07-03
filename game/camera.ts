import * as THREE from 'three';
import { PLANET_R, MAX_SPEED } from './constants';
import { Terrain } from './terrain';
import { clamp, damp, lerp } from './util';

export type CameraMode = 0 | 1 | 2 | 3;

export const CAMERA_NAMES = ['Chase', 'Cockpit', 'Orbit', 'Cinematic'];

const vFwd = new THREE.Vector3();
const vUp = new THREE.Vector3();
const vOffset = new THREE.Vector3();
const vLook = new THREE.Vector3();
const vDir = new THREE.Vector3();
const vRight = new THREE.Vector3();
const qUser = new THREE.Quaternion();
const qTmp = new THREE.Quaternion();
const X_AXIS = new THREE.Vector3(1, 0, 0);
const Y_AXIS = new THREE.Vector3(0, 1, 0);

export class CameraRig {
  mode: CameraMode = 0;

  private userYaw = 0;
  private userPitch = 0;
  private dragging = false;
  private orbitT = 0;
  private cineTimer = 0;
  private cinePos = new THREE.Vector3();
  private hasCinePos = false;
  private softStart = 0;
  private fov = 62;

  constructor(private terrain: Terrain) {}

  setMode(mode: CameraMode): void {
    this.mode = mode;
    this.hasCinePos = false;
    this.softStart = 1.2;
  }

  beginTransition(): void {
    this.softStart = 1.8;
  }

  drag(dx: number, dy: number): void {
    this.dragging = true;
    this.userYaw = clamp(this.userYaw - dx * 0.005, -2.4, 2.4);
    this.userPitch = clamp(this.userPitch - dy * 0.005, -1.1, 1.1);
  }

  endDrag(): void {
    this.dragging = false;
  }

  update(
    dt: number,
    cam: THREE.PerspectiveCamera,
    plane: { pos: THREE.Vector3; quat: THREE.Quaternion },
    speed: number
  ): void {
    this.softStart = Math.max(0, this.softStart - dt);
    if (!this.dragging) {
      const ease = damp(5, dt);
      this.userYaw *= 1 - ease;
      this.userPitch *= 1 - ease;
    }

    vUp.copy(plane.pos).normalize();
    vFwd.set(0, 0, -1).applyQuaternion(plane.quat);
    let targetFov = 62;

    switch (this.mode) {
      case 0: {
        qUser.copy(plane.quat);
        qUser.multiply(qTmp.setFromAxisAngle(Y_AXIS, this.userYaw));
        qUser.multiply(qTmp.setFromAxisAngle(X_AXIS, this.userPitch));
        vOffset.set(0, 4.5, 16).applyQuaternion(qUser);
        vLook.copy(plane.pos).add(vOffset);
        if (cam.position.distanceTo(plane.pos) > 700) cam.position.copy(vLook);
        const rate = this.softStart > 0 ? 2.4 : 7.5;
        cam.position.lerp(vLook, damp(rate, dt));
        this.clampToTerrain(cam.position);
        cam.up.set(0, 1, 0).applyQuaternion(plane.quat);
        vLook.copy(plane.pos).addScaledVector(vFwd, 12);
        cam.lookAt(vLook);
        targetFov = 60 + (speed / MAX_SPEED) * 18;
        break;
      }
      case 1: {
        vOffset.set(0, 2.75, 0.4).applyQuaternion(plane.quat);
        cam.position.copy(plane.pos).add(vOffset);
        cam.quaternion.copy(plane.quat);
        cam.quaternion.multiply(qTmp.setFromAxisAngle(Y_AXIS, this.userYaw * 0.8));
        cam.quaternion.multiply(qTmp.setFromAxisAngle(X_AXIS, this.userPitch * 0.8));
        targetFov = 72;
        break;
      }
      case 2: {
        this.orbitT += dt * 0.4;
        vOffset.copy(vFwd).multiplyScalar(-30).applyAxisAngle(vUp, this.orbitT);
        vOffset.addScaledVector(vUp, 9);
        cam.position.copy(plane.pos).add(vOffset);
        this.clampToTerrain(cam.position);
        cam.up.copy(vUp);
        cam.lookAt(plane.pos);
        targetFov = 55;
        break;
      }
      case 3: {
        this.cineTimer -= dt;
        const dist = this.hasCinePos ? cam.position.distanceTo(plane.pos) : Infinity;
        if (!this.hasCinePos || this.cineTimer <= 0 || dist > 220) {
          const side = Math.random() > 0.5 ? 1 : -1;
          vOffset
            .copy(vFwd)
            .multiplyScalar(90 + Math.random() * 70)
            .addScaledVector(vUp, 6 + Math.random() * 14);
          vRight.set(1, 0, 0).applyQuaternion(plane.quat);
          vOffset.addScaledVector(vRight, side * (30 + Math.random() * 50));
          this.cinePos.copy(plane.pos).add(vOffset);
          this.clampToTerrain(this.cinePos);
          this.hasCinePos = true;
          this.cineTimer = 4.5;
        }
        cam.position.copy(this.cinePos);
        cam.up.copy(vUp);
        cam.lookAt(plane.pos);
        targetFov = 52;
        break;
      }
    }

    this.fov = lerp(this.fov, targetFov, damp(4, dt));
    if (Math.abs(cam.fov - this.fov) > 0.01) {
      cam.fov = this.fov;
      cam.updateProjectionMatrix();
    }
  }

  private clampToTerrain(p: THREE.Vector3): void {
    vDir.copy(p).normalize();
    const minR = PLANET_R + Math.max(this.terrain.height(vDir), 0.5) + 4;
    if (p.length() < minR) p.copy(vDir).multiplyScalar(minR);
  }
}
