import * as THREE from 'three';
import { PLANET_R, MIN_SPEED, MAX_SPEED, CEILING, START } from './constants';
import { Terrain } from './terrain';
import { clamp, latLonToDir, tangentBasis, DEG2RAD } from './util';
import { bus } from './bus';

export interface ControlInput {
  pitch: number;
  roll: number;
  yaw: number;
  throttleDelta: number;
  throttleAbsolute: number | null;
}

const DEADZONE = 0.12;

function dz(v: number): number {
  return Math.abs(v) < DEADZONE ? 0 : v;
}

export class Input {
  private keys = new Set<string>();
  readonly state: ControlInput = { pitch: 0, roll: 0, yaw: 0, throttleDelta: 0, throttleAbsolute: null };

  private onKeyDown = (e: KeyboardEvent) => {
    if (['Space', 'ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight'].includes(e.code)) e.preventDefault();
    this.keys.add(e.code);
  };

  private onKeyUp = (e: KeyboardEvent) => {
    this.keys.delete(e.code);
  };

  private onBlur = () => this.keys.clear();

  attach(): void {
    window.addEventListener('keydown', this.onKeyDown);
    window.addEventListener('keyup', this.onKeyUp);
    window.addEventListener('blur', this.onBlur);
  }

  detach(): void {
    window.removeEventListener('keydown', this.onKeyDown);
    window.removeEventListener('keyup', this.onKeyUp);
    window.removeEventListener('blur', this.onBlur);
  }

  read(): ControlInput {
    const k = this.keys;
    const s = this.state;
    s.pitch = (k.has('KeyW') || k.has('ArrowUp') ? 1 : 0) - (k.has('KeyS') || k.has('ArrowDown') ? 1 : 0);
    s.roll = (k.has('KeyD') || k.has('ArrowRight') ? 1 : 0) - (k.has('KeyA') || k.has('ArrowLeft') ? 1 : 0);
    s.yaw = (k.has('KeyQ') ? 1 : 0) - (k.has('KeyE') ? 1 : 0);
    s.throttleDelta = (k.has('Space') ? 1 : 0) - (k.has('ShiftLeft') || k.has('ShiftRight') ? 1 : 0);
    s.throttleAbsolute = null;

    const pads = typeof navigator !== 'undefined' && navigator.getGamepads ? navigator.getGamepads() : [];
    const gp = pads && pads[0];
    if (gp) {
      const roll = dz(gp.axes[0] ?? 0);
      const pitch = dz(-(gp.axes[1] ?? 0));
      const yaw = dz(-(gp.axes[2] ?? 0));
      if (roll !== 0) s.roll = roll;
      if (pitch !== 0) s.pitch = pitch;
      if (yaw !== 0) s.yaw = yaw;
      const rt = gp.buttons[7]?.value ?? 0;
      const lt = gp.buttons[6]?.value ?? 0;
      if (rt > 0.03 || lt > 0.03) s.throttleAbsolute = clamp(rt - lt * 0.5, 0, 1);
    }
    return s;
  }
}

const PITCH_RATE = 1.6;
const ROLL_RATE = 2.3;
const YAW_RATE = 1.0;
const TURN_RATE = 1.15;
const LEVEL_RATE = 1.3;

const qTmp = new THREE.Quaternion();
const X_AXIS = new THREE.Vector3(1, 0, 0);
const Y_AXIS = new THREE.Vector3(0, 1, 0);
const Z_AXIS = new THREE.Vector3(0, 0, 1);

const vUpOld = new THREE.Vector3();
const vUpNew = new THREE.Vector3();
const vFwd = new THREE.Vector3();
const vRight = new THREE.Vector3();
const vEast = new THREE.Vector3();
const vNorth = new THREE.Vector3();

export class Flight {
  readonly pos = new THREE.Vector3();
  readonly quat = new THREE.Quaternion();
  readonly velocity = new THREE.Vector3();
  speed = 120;
  throttle = 0.55;
  crashed = false;

  private respawnTimer = 0;

  constructor(private terrain: Terrain) {
    this.reset(START.lat, START.lon, START.heading, START.alt);
  }

  reset(latDeg: number, lonDeg: number, headingDeg: number, alt: number): void {
    const up = latLonToDir(latDeg * DEG2RAD, lonDeg * DEG2RAD);
    this.pos.copy(up).multiplyScalar(PLANET_R + alt);
    this.setLevelHeading(headingDeg * DEG2RAD);
    this.speed = 120;
    this.throttle = 0.55;
    this.crashed = false;
  }

  private setLevelHeading(headingRad: number): void {
    vUpNew.copy(this.pos).normalize();
    tangentBasis(vUpNew, vEast, vNorth);
    vFwd.copy(vNorth).multiplyScalar(Math.cos(headingRad)).addScaledVector(vEast, Math.sin(headingRad));
    vRight.crossVectors(vFwd, vUpNew).normalize();
    const back = vFwd.clone().negate();
    const m = new THREE.Matrix4().makeBasis(vRight, vUpNew.clone(), back);
    this.quat.setFromRotationMatrix(m);
  }

  get dir(): THREE.Vector3 {
    return this.pos.clone().normalize();
  }

  get altitude(): number {
    vUpNew.copy(this.pos).normalize();
    const h = Math.max(this.terrain.height(vUpNew), 0.5);
    return this.pos.length() - (PLANET_R + h);
  }

  get heading(): number {
    vUpNew.copy(this.pos).normalize();
    tangentBasis(vUpNew, vEast, vNorth);
    vFwd.set(0, 0, -1).applyQuaternion(this.quat);
    const deg = (Math.atan2(vFwd.dot(vEast), vFwd.dot(vNorth)) * 180) / Math.PI;
    return (deg + 360) % 360;
  }

  update(dt: number, input: ControlInput): void {
    if (this.crashed) {
      this.respawnTimer -= dt;
      if (this.respawnTimer <= 0) {
        vUpNew.copy(this.pos).normalize();
        const lat = Math.asin(clamp(vUpNew.y, -1, 1));
        const lon = -Math.atan2(vUpNew.z, vUpNew.x);
        const heading = this.heading;
        this.reset((lat * 180) / Math.PI, (lon * 180) / Math.PI, heading, 280);
        bus.emit('respawn');
      }
      return;
    }

    // Throttle
    if (input.throttleAbsolute !== null) {
      this.throttle += (input.throttleAbsolute - this.throttle) * Math.min(1, dt * 4);
    } else {
      this.throttle = clamp(this.throttle + input.throttleDelta * dt * 0.55, 0, 1);
    }
    const targetSpeed = MIN_SPEED + this.throttle * (MAX_SPEED - MIN_SPEED);
    this.speed += (targetSpeed - this.speed) * Math.min(1, dt * 0.9);

    // Attitude from input (local-frame rotations)
    this.quat.multiply(qTmp.setFromAxisAngle(X_AXIS, input.pitch * PITCH_RATE * dt));
    this.quat.multiply(qTmp.setFromAxisAngle(Z_AXIS, -input.roll * ROLL_RATE * dt));
    this.quat.multiply(qTmp.setFromAxisAngle(Y_AXIS, input.yaw * YAW_RATE * dt));

    vUpOld.copy(this.pos).normalize();
    vRight.set(1, 0, 0).applyQuaternion(this.quat);
    const bank = vRight.dot(vUpOld);

    // Bank-to-turn: banking rotates the nose around the radial up axis
    this.quat.premultiply(qTmp.setFromAxisAngle(vUpOld, bank * TURN_RATE * dt));

    // Gentle auto-level when the stick is released
    if (Math.abs(input.roll) < 0.05) {
      this.quat.multiply(qTmp.setFromAxisAngle(Z_AXIS, -bank * LEVEL_RATE * dt));
    }

    // Soft altitude ceiling
    const alt = this.pos.length() - PLANET_R;
    if (alt > CEILING) {
      vFwd.set(0, 0, -1).applyQuaternion(this.quat);
      if (vFwd.dot(vUpOld) > -0.05) {
        this.quat.multiply(qTmp.setFromAxisAngle(X_AXIS, -0.5 * dt));
      }
    }

    // Advance and transport the local frame around the sphere
    vFwd.set(0, 0, -1).applyQuaternion(this.quat);
    this.velocity.copy(vFwd).multiplyScalar(this.speed);
    this.pos.addScaledVector(this.velocity, dt);
    vUpNew.copy(this.pos).normalize();
    qTmp.setFromUnitVectors(vUpOld, vUpNew);
    this.quat.premultiply(qTmp);
    this.quat.normalize();

    // Terrain collision
    const ground = PLANET_R + Math.max(this.terrain.height(vUpNew), 0.5);
    if (this.pos.length() < ground + 2.4) {
      this.crashed = true;
      this.respawnTimer = 2.4;
      bus.emit('crash');
    }
  }
}
