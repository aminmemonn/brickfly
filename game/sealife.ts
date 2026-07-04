import * as THREE from 'three';
import { PLANET_R } from './constants';
import { Terrain } from './terrain';
import { LANDMARKS } from './landmark-data';
import { latLonToDir, tangentBasis, hash2, DEG2RAD } from './util';

/**
 * Fills the oceans so flying over water isn't dull: long luxury yachts towing
 * side adverts, jet-skiers carving circles around them, breaching dolphins and
 * flickering schools of fish. Placed in clusters over deep water; each mover is
 * a small group re-oriented per frame in its own tangent frame on the sphere.
 */

const YACHT_ADS = ['BRICKFLY  YACHTS', 'STUD  BULL', 'BRICK  COLA', 'PLATE  PIZZA'];
const YACHT_BG = [0x0e8f9c, 0x1f57c4, 0xd42a1f, 0x18a558];
const SKI_COLORS = [0xff5a3c, 0xf7d354, 0x9d5cff, 0x2c6bd6, 0x4cb227];

interface Orbiter {
  obj: THREE.Group;
  center: THREE.Vector3;
  east: THREE.Vector3;
  north: THREE.Vector3;
  orbitR: number;
  alt: number;
  speed: number;
  phase: number;
}

interface Dolphin extends Orbiter {
  body: THREE.Object3D;
  arc: number;
}

interface School {
  obj: THREE.Group;
  dir: THREE.Vector3;
  alt: number;
  phase: number;
}

const vUp = new THREE.Vector3();
const vPos = new THREE.Vector3();
const vNext = new THREE.Vector3();

function bannerTexture(text: string, bg: number): THREE.CanvasTexture {
  const c = document.createElement('canvas');
  c.width = 512;
  c.height = 96;
  const g = c.getContext('2d')!;
  const col = new THREE.Color(bg);
  g.fillStyle = `rgb(${col.r * 255},${col.g * 255},${col.b * 255})`;
  g.fillRect(0, 0, 512, 96);
  g.fillStyle = '#ffffff';
  g.font = 'bold 52px system-ui, sans-serif';
  g.textAlign = 'center';
  g.textBaseline = 'middle';
  g.fillText(text, 256, 52);
  const tex = new THREE.CanvasTexture(c);
  tex.anisotropy = 4;
  return tex;
}

export class SeaLife {
  readonly group = new THREE.Group();
  private yachts: Orbiter[] = [];
  private skis: Orbiter[] = [];
  private dolphins: Dolphin[] = [];
  private schools: School[] = [];

  constructor(terrain: Terrain) {
    const box = new THREE.BoxGeometry(1, 1, 1);
    const mats = new Map<number, THREE.MeshStandardMaterial>();
    const mat = (c: number) => {
      if (!mats.has(c)) mats.set(c, new THREE.MeshStandardMaterial({ color: c, roughness: 0.5, metalness: 0.05 }));
      return mats.get(c)!;
    };

    // Gather deep-water sites: some seeded randomly, plus one just offshore of
    // each landmark so coastal cities always have boats in view.
    const sites: THREE.Vector3[] = [];
    const east = new THREE.Vector3();
    const north = new THREE.Vector3();

    for (const lm of LANDMARKS) {
      const dir = latLonToDir(lm.lat * DEG2RAD, lm.lon * DEG2RAD);
      tangentBasis(dir, east, north);
      for (let a = 0; a < 8; a++) {
        const ang = (a / 8) * Math.PI * 2;
        const probe = dir
          .clone()
          .multiplyScalar(PLANET_R)
          .addScaledVector(east, Math.cos(ang) * (lm.radius + 700))
          .addScaledVector(north, Math.sin(ang) * (lm.radius + 700))
          .normalize();
        if (terrain.height(probe) < -14) {
          sites.push(probe);
          break;
        }
      }
    }

    for (let i = 0; i < 4000 && sites.length < 34; i++) {
      const z = hash2(i, 81) * 2 - 1;
      const phi = hash2(i, 82) * Math.PI * 2;
      const r = Math.sqrt(Math.max(0, 1 - z * z));
      const dir = new THREE.Vector3(r * Math.cos(phi), z, r * Math.sin(phi));
      if (Math.abs(dir.y) > 0.94) continue;
      if (terrain.height(dir) < -20) sites.push(dir);
    }

    sites.forEach((dir, si) => {
      tangentBasis(dir, east, north);
      const e = east.clone();
      const n = north.clone();

      // --- Yacht ---
      {
        const obj = new THREE.Group();
        const hull = new THREE.Mesh(box, mat(0xf4f4f2));
        hull.scale.set(12, 5, 46);
        obj.add(hull);
        const bow = new THREE.Mesh(box, mat(0xf4f4f2));
        bow.scale.set(7, 4, 10);
        bow.position.set(0, 0.2, -27);
        obj.add(bow);
        const stripe = new THREE.Mesh(box, mat(0x1f57c4));
        stripe.scale.set(12.4, 1.4, 46);
        stripe.position.set(0, -1.4, 0);
        obj.add(stripe);
        const deck = new THREE.Mesh(box, mat(0xe9eef2));
        deck.scale.set(9, 1.2, 34);
        deck.position.set(0, 2.6, 2);
        obj.add(deck);
        const cabin = new THREE.Mesh(box, mat(0xdfe6ec));
        cabin.scale.set(7.5, 5, 16);
        cabin.position.set(0, 5.4, 4);
        obj.add(cabin);
        const glass = new THREE.Mesh(box, new THREE.MeshBasicMaterial({ color: 0x9fd8ff }));
        glass.scale.set(7.7, 2.2, 12);
        glass.position.set(0, 6.4, 2);
        obj.add(glass);
        const mast = new THREE.Mesh(box, mat(0xd7dde3));
        mast.scale.set(0.8, 12, 0.8);
        mast.position.set(0, 13, 6);
        obj.add(mast);
        // Side advert boards along the hull.
        const adTex = bannerTexture(YACHT_ADS[si % YACHT_ADS.length], YACHT_BG[si % YACHT_BG.length]);
        const adMat = new THREE.MeshBasicMaterial({ map: adTex, side: THREE.DoubleSide });
        for (const s of [1, -1]) {
          const panel = new THREE.Mesh(new THREE.PlaneGeometry(40, 6.5), adMat);
          panel.position.set(s * 6.2, 0.4, 4);
          panel.rotation.y = s > 0 ? Math.PI / 2 : -Math.PI / 2;
          obj.add(panel);
        }
        obj.scale.setScalar(2.2);
        this.group.add(obj);
        this.yachts.push({ obj, center: dir, east: e, north: n, orbitR: 220 + hash2(si, 83) * 260, alt: 3, speed: 0.02 + hash2(si, 84) * 0.02, phase: hash2(si, 85) * Math.PI * 2 });
      }

      // --- Jet-skiers carving circles around the yacht ---
      const skiN = 2 + Math.floor(hash2(si, 86) * 2);
      for (let k = 0; k < skiN; k++) {
        const col = SKI_COLORS[(si + k) % SKI_COLORS.length];
        const obj = new THREE.Group();
        const hull = new THREE.Mesh(box, mat(col));
        hull.scale.set(2.6, 1.6, 8);
        obj.add(hull);
        const nose = new THREE.Mesh(box, mat(col));
        nose.scale.set(1.8, 1.4, 3);
        nose.position.set(0, 0.3, -5);
        obj.add(nose);
        const column = new THREE.Mesh(box, mat(0x2a2f36));
        column.scale.set(1, 2.2, 1);
        column.position.set(0, 1.4, -1);
        obj.add(column);
        // rider: torso + head
        const torso = new THREE.Mesh(box, mat(0x222831));
        torso.scale.set(1.8, 2.4, 1.6);
        torso.position.set(0, 2.4, 1.4);
        obj.add(torso);
        const head = new THREE.Mesh(box, mat(0xf5c542));
        head.scale.set(1.3, 1.3, 1.3);
        head.position.set(0, 4.1, 1.4);
        obj.add(head);
        obj.scale.setScalar(2);
        this.group.add(obj);
        this.skis.push({ obj, center: dir, east: e, north: n, orbitR: 60 + k * 34 + hash2(si + k, 87) * 30, alt: 2, speed: 0.22 + hash2(si + k, 88) * 0.12, phase: hash2(si * 3 + k, 89) * Math.PI * 2 });
      }

      // --- A pod of breaching dolphins ---
      const podN = 2 + Math.floor(hash2(si, 90) * 2);
      for (let k = 0; k < podN; k++) {
        const obj = new THREE.Group();
        const body = new THREE.Group();
        const grey = 0x5a6b78;
        const belly = 0xcdd6dc;
        for (let s = 0; s < 4; s++) {
          const seg = new THREE.Mesh(box, mat(grey));
          seg.scale.set(2.6 - s * 0.3, 2.8 - s * 0.4, 4);
          seg.position.set(0, 0, -3 + s * 3.4);
          body.add(seg);
        }
        const snout = new THREE.Mesh(box, mat(grey));
        snout.scale.set(1.6, 1.6, 3);
        snout.position.set(0, -0.2, -6);
        body.add(snout);
        const under = new THREE.Mesh(box, mat(belly));
        under.scale.set(2, 1, 9);
        under.position.set(0, -1.2, 0);
        body.add(under);
        const dorsal = new THREE.Mesh(box, mat(grey));
        dorsal.scale.set(0.6, 3, 2.6);
        dorsal.position.set(0, 2, 0);
        body.add(dorsal);
        const fluke = new THREE.Mesh(box, mat(grey));
        fluke.scale.set(5.5, 0.7, 2.4);
        fluke.position.set(0, 0, 7);
        body.add(fluke);
        obj.add(body);
        obj.scale.setScalar(1.9);
        this.group.add(obj);
        this.dolphins.push({ obj, body, arc: 10 + hash2(si + k, 91) * 6, center: dir, east: e, north: n, orbitR: 90 + k * 26, alt: 0, speed: 0.16 + hash2(si + k, 92) * 0.08, phase: hash2(si * 4 + k, 93) * Math.PI * 2 });
      }

      // --- A shimmering school of fish just under the surface ---
      {
        const obj = new THREE.Group();
        const fishCols = [0xf2a10a, 0xdfe6ec, 0xff7a1a, 0x9fd8ff];
        for (let k = 0; k < 10; k++) {
          const fish = new THREE.Mesh(box, mat(fishCols[k % fishCols.length]));
          fish.scale.set(1, 1.4, 3);
          fish.position.set((hash2(si * 9 + k, 94) - 0.5) * 22, (hash2(si * 9 + k, 95) - 0.5) * 4, (hash2(si * 9 + k, 96) - 0.5) * 22);
          obj.add(fish);
        }
        obj.scale.setScalar(1.6);
        const fdir = dir
          .clone()
          .multiplyScalar(PLANET_R)
          .addScaledVector(e, (hash2(si, 97) - 0.5) * 200)
          .addScaledVector(n, (hash2(si, 98) - 0.5) * 200)
          .normalize();
        this.group.add(obj);
        this.schools.push({ obj, dir: fdir, alt: -0.5, phase: hash2(si, 99) * Math.PI * 2 });
      }
    });
  }

  update(elapsed: number): void {
    const orbit = (o: Orbiter, altY: number, ahead = 0.02) => {
      const a = elapsed * o.speed + o.phase;
      vUp
        .copy(o.center)
        .multiplyScalar(PLANET_R)
        .addScaledVector(o.east, Math.cos(a) * o.orbitR)
        .addScaledVector(o.north, Math.sin(a) * o.orbitR)
        .normalize();
      vPos.copy(vUp).multiplyScalar(PLANET_R + altY);
      const a2 = a + ahead;
      vNext
        .copy(o.center)
        .multiplyScalar(PLANET_R)
        .addScaledVector(o.east, Math.cos(a2) * o.orbitR)
        .addScaledVector(o.north, Math.sin(a2) * o.orbitR)
        .normalize()
        .multiplyScalar(PLANET_R + altY);
      o.obj.position.copy(vPos);
      o.obj.up.copy(vUp);
      o.obj.lookAt(vNext);
    };

    for (const y of this.yachts) {
      orbit(y, y.alt + Math.sin(elapsed * 0.6 + y.phase) * 1.2);
      y.obj.rotateZ(Math.sin(elapsed * 0.5 + y.phase) * 0.04);
    }
    for (const s of this.skis) {
      orbit(s, s.alt + Math.abs(Math.sin(elapsed * 3 + s.phase)) * 1.4);
      s.obj.rotateZ(Math.sin(elapsed * 2 + s.phase) * 0.25);
    }
    for (const d of this.dolphins) {
      const arcT = Math.sin(elapsed * d.speed * 6 + d.phase);
      orbit(d, d.alt + arcT * d.arc);
      // Pitch the body up as it leaps, down as it dives back in.
      d.body.rotation.x = Math.cos(elapsed * d.speed * 6 + d.phase) * 0.9;
    }
    for (const sc of this.schools) {
      vUp.copy(sc.dir);
      sc.obj.position.copy(sc.dir).multiplyScalar(PLANET_R + sc.alt + Math.sin(elapsed * 1.2 + sc.phase) * 0.6);
      sc.obj.up.copy(vUp);
      sc.obj.lookAt(vNext.copy(sc.obj.position).add(sc.dir));
      sc.obj.rotateY(elapsed * 0.25 + sc.phase);
    }
  }
}
