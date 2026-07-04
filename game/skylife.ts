import * as THREE from 'three';
import { PLANET_R } from './constants';
import { Terrain } from './terrain';
import { latLonToDir, tangentBasis, hash2, DEG2RAD } from './util';

/**
 * Populates the sky: little brick planes towing paper-banner adverts, drifting
 * hot-air balloons far from the cities, and a couple of UFO easter eggs that
 * hover over Area 51 and Mount Shasta. Everything is a handful of small groups
 * animated per frame, so the cost is negligible.
 */

const BANNER_ADS = ['FLY  BRICKZ', 'STUD  BULL', 'BRICK  COLA', 'BUILD  IT!', 'PLATE  PIZZA', 'SNAP  &  GO'];
const BANNER_BG = [0xe23b3b, 0x2c6bd6, 0x18a558, 0xf2a10a, 0x9d5cff, 0xff2e88];
const BALLOON_PALETTES: number[][] = [
  [0xd6382c, 0xf7d354, 0xd6382c, 0xf7d354, 0xf4f4f2],
  [0x2c6bd6, 0xf4f4f2, 0x2c6bd6, 0xf4f4f2, 0x2c6bd6],
  [0xf7a231, 0xf4f4f2, 0x4cb227, 0xf4f4f2, 0xf7a231],
  [0x9d5cff, 0xf7d354, 0x9d5cff, 0xf7d354, 0xf4f4f2],
  [0x18a5a0, 0xf4f4f2, 0xff2e88, 0xf4f4f2, 0x18a5a0]
];
const RING_WIDTHS = [6, 9.5, 10.5, 9, 5.5];

// Easter-egg UFO sites: Area 51 (Nevada) and Mount Shasta (California).
const UFO_SITES: [number, number][] = [
  [37.24, -115.8],
  [37.4, -116.2],
  [41.41, -122.19]
];

interface Flyer {
  obj: THREE.Group;
  center: THREE.Vector3;
  east: THREE.Vector3;
  north: THREE.Vector3;
  orbitR: number;
  alt: number;
  speed: number;
  phase: number;
}

interface Ufo {
  obj: THREE.Group;
  dir: THREE.Vector3;
  alt: number;
  phase: number;
}

interface Drifter {
  obj: THREE.Group;
  dir: THREE.Vector3;
  alt: number;
  phase: number;
}

const vPos = new THREE.Vector3();
const vNext = new THREE.Vector3();
const vUp = new THREE.Vector3();
const Y_AXIS = new THREE.Vector3(0, 1, 0);

function bannerTexture(text: string, bg: number): THREE.CanvasTexture {
  const c = document.createElement('canvas');
  c.width = 512;
  c.height = 128;
  const g = c.getContext('2d')!;
  const col = new THREE.Color(bg);
  g.fillStyle = `rgb(${col.r * 255},${col.g * 255},${col.b * 255})`;
  g.fillRect(0, 0, 512, 128);
  g.strokeStyle = '#ffffff';
  g.lineWidth = 10;
  g.strokeRect(8, 8, 496, 112);
  g.fillStyle = '#ffffff';
  g.font = 'bold 66px system-ui, sans-serif';
  g.textAlign = 'center';
  g.textBaseline = 'middle';
  g.fillText(text, 256, 70);
  const tex = new THREE.CanvasTexture(c);
  tex.anisotropy = 4;
  return tex;
}

function glowRingGeo(): THREE.TorusGeometry {
  const g = new THREE.TorusGeometry(9, 1.1, 8, 20);
  g.rotateX(Math.PI / 2);
  return g;
}

export class SkyLife {
  readonly group = new THREE.Group();
  private planes: Flyer[] = [];
  private ufos: Ufo[] = [];
  private drifters: Drifter[] = [];

  constructor(terrain: Terrain) {
    const box = new THREE.BoxGeometry(1, 1, 1);
    const mats = new Map<number, THREE.MeshStandardMaterial>();
    const mat = (c: number) => {
      if (!mats.has(c)) mats.set(c, new THREE.MeshStandardMaterial({ color: c, roughness: 0.42, metalness: 0.05 }));
      return mats.get(c)!;
    };
    const glow = (c: number) => new THREE.MeshBasicMaterial({ color: c });

    // --- Banner planes: little planes towing paper adverts on holding loops ---
    for (let i = 0; i < 7; i++) {
      const lat = (hash2(i, 21) - 0.5) * 120;
      const lon = hash2(i, 22) * 360 - 180;
      const center = latLonToDir(lat * DEG2RAD, lon * DEG2RAD);
      const east = new THREE.Vector3();
      const north = new THREE.Vector3();
      tangentBasis(center, east, north);

      const obj = new THREE.Group();
      const body = new THREE.Mesh(box, mat(0xf4f4f2));
      body.scale.set(2.4, 2, 7);
      obj.add(body);
      const wing = new THREE.Mesh(box, mat(0xd6382c));
      wing.scale.set(13, 1, 3);
      wing.position.set(0, 0.4, 0.5);
      obj.add(wing);
      const tail = new THREE.Mesh(box, mat(0xd6382c));
      tail.scale.set(4.5, 1, 2);
      tail.position.set(0, 0.6, 3.4);
      obj.add(tail);
      const fin = new THREE.Mesh(box, mat(0xf4f4f2));
      fin.scale.set(1, 3, 2);
      fin.position.set(0, 1.4, 3.4);
      obj.add(fin);

      // towed banner behind the plane (+Z is behind since -Z is forward)
      const tex = bannerTexture(BANNER_ADS[i % BANNER_ADS.length], BANNER_BG[i % BANNER_BG.length]);
      const banner = new THREE.Mesh(
        new THREE.PlaneGeometry(34, 8.5),
        new THREE.MeshBasicMaterial({ map: tex, side: THREE.DoubleSide })
      );
      banner.position.set(0, 0.4, 26);
      banner.rotation.y = Math.PI / 2;
      obj.add(banner);
      const rope = new THREE.Mesh(box, mat(0x33363c));
      rope.scale.set(0.3, 0.3, 12);
      rope.position.set(0, 0.4, 8.5);
      obj.add(rope);

      obj.scale.setScalar(1.6);
      this.group.add(obj);
      this.planes.push({
        obj,
        center,
        east,
        north,
        orbitR: 900 + hash2(i, 23) * 1400,
        alt: 360 + hash2(i, 24) * 460,
        speed: 0.05 + hash2(i, 25) * 0.05,
        phase: hash2(i, 26) * Math.PI * 2
      });
    }

    // --- Free-floating balloons scattered across the globe to fill the sky ---
    for (let i = 0; i < 26; i++) {
      const lat = (hash2(i, 31) - 0.5) * 150;
      const lon = hash2(i, 32) * 360 - 180;
      const dir = latLonToDir(lat * DEG2RAD, lon * DEG2RAD);
      const ground = Math.max(terrain.height(dir), 1);
      const palette = BALLOON_PALETTES[i % BALLOON_PALETTES.length];
      const obj = new THREE.Group();
      RING_WIDTHS.forEach((w, ring) => {
        const m = new THREE.Mesh(box, mat(palette[ring % palette.length]));
        m.scale.set(w, 2.6, w);
        m.position.y = ring * 2.6;
        obj.add(m);
      });
      const basket = new THREE.Mesh(box, mat(0x8a6743));
      basket.scale.set(3.2, 2.6, 3.2);
      basket.position.y = -5.5;
      obj.add(basket);
      this.group.add(obj);
      this.drifters.push({
        obj,
        dir,
        alt: ground + 120 + hash2(i, 33) * 220,
        phase: hash2(i, 34) * Math.PI * 2
      });
    }

    // --- UFO easter eggs hovering over Area 51 and Mount Shasta ---
    for (let i = 0; i < UFO_SITES.length; i++) {
      const [lat, lon] = UFO_SITES[i];
      const dir = latLonToDir(lat * DEG2RAD, lon * DEG2RAD);
      const obj = new THREE.Group();
      const disc = new THREE.Mesh(new THREE.CylinderGeometry(15, 15, 3, 20), mat(0xb8c0c8));
      obj.add(disc);
      const rim = new THREE.Mesh(new THREE.CylinderGeometry(9, 15, 2, 20), mat(0x8b939b));
      rim.position.y = -1.6;
      obj.add(rim);
      const dome = new THREE.Mesh(new THREE.SphereGeometry(6.5, 16, 10, 0, Math.PI * 2, 0, Math.PI / 2), glow(0x8ffcff));
      dome.position.y = 1.4;
      obj.add(dome);
      const beam = new THREE.Mesh(glowRingGeo(), glow(0x38ff9e));
      beam.position.y = -1.9;
      obj.add(beam);
      obj.scale.setScalar(1.4);
      this.group.add(obj);
      this.ufos.push({ obj, dir, alt: Math.max(terrain.height(dir), 1) + 190 + i * 40, phase: i * 2.1 });
    }
  }

  update(elapsed: number): void {
    for (const p of this.planes) {
      const a = elapsed * p.speed + p.phase;
      const cx = Math.cos(a) * p.orbitR;
      const cz = Math.sin(a) * p.orbitR;
      vUp.copy(p.center).multiplyScalar(PLANET_R).addScaledVector(p.east, cx).addScaledVector(p.north, cz).normalize();
      vPos.copy(vUp).multiplyScalar(PLANET_R + p.alt);
      const a2 = a + 0.02;
      vNext
        .copy(p.center)
        .multiplyScalar(PLANET_R)
        .addScaledVector(p.east, Math.cos(a2) * p.orbitR)
        .addScaledVector(p.north, Math.sin(a2) * p.orbitR)
        .normalize()
        .multiplyScalar(PLANET_R + p.alt);
      p.obj.position.copy(vPos);
      p.obj.up.copy(vUp);
      p.obj.lookAt(vNext);
    }

    for (const d of this.drifters) {
      const bob = Math.sin(elapsed * 0.35 + d.phase) * 9;
      d.obj.position.copy(d.dir).multiplyScalar(PLANET_R + d.alt + bob);
      d.obj.up.copy(d.dir);
      d.obj.lookAt(vNext.copy(d.obj.position).add(d.dir));
      d.obj.rotateY(elapsed * 0.05 + d.phase);
    }

    for (const u of this.ufos) {
      const bob = Math.sin(elapsed * 0.7 + u.phase) * 6;
      u.obj.position.copy(u.dir).multiplyScalar(PLANET_R + u.alt + bob);
      u.obj.up.copy(u.dir);
      u.obj.lookAt(vNext.copy(u.obj.position).add(u.dir));
      u.obj.rotateY(elapsed * 1.4 + u.phase);
    }
  }
}
