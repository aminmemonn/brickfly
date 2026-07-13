import * as THREE from 'three';
import { PLANET_R } from './constants';
import { Terrain } from './terrain';
import { LANDMARKS } from './landmark-data';
import { latLonToDir, tangentBasis, basisQuat, hash2, DEG2RAD } from './util';
import { createABSColoredMaterial, ABS_SOLID_MATERIAL } from './brick-material';

/**
 * Fills the oceans so flying over water isn't dull: mega-yachts and cruise
 * liners with glowing portholes, jet-skiers carving foamy circles, breaching
 * dolphins, spouting whales and flickering schools of fish, plus a globe-wide
 * instanced fleet of little sailboats so no stretch of open water is empty.
 * Placed in clusters over deep water; each mover is a small group re-oriented
 * per frame in its own tangent frame on the sphere.
 */

const YACHT_ADS = ['BRICKFLY  YACHTS', 'STUD  BULL', 'BRICK  COLA', 'PLATE  PIZZA'];
const YACHT_BG = [0x0e8f9c, 0x1f57c4, 0xd42a1f, 0x18a558];
const SKI_COLORS = [0xff5a3c, 0xf7d354, 0x9d5cff, 0x2c6bd6, 0x4cb227];
const SAIL_COLORS = [0xf4f4f2, 0xff5a3c, 0xf7d354, 0x2c6bd6, 0x4cb227, 0xff2e88, 0x38e1ff];

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

interface Whale extends Orbiter {
  body: THREE.Object3D;
  spout: THREE.Object3D;
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
  private whales: Whale[] = [];
  private schools: School[] = [];

  constructor(terrain: Terrain) {
    const box = new THREE.BoxGeometry(1, 1, 1);
    const mats = new Map<number, THREE.ShaderMaterial>();
    const mat = (c: number) => {
      if (!mats.has(c)) mats.set(c, createABSColoredMaterial(c));
      return mats.get(c)!;
    };
    const glowStrip = new THREE.MeshBasicMaterial({ color: 0xffe9a8 });
    const wakeMat = new THREE.MeshBasicMaterial({
      color: 0xffffff,
      transparent: true,
      opacity: 0.5,
      depthWrite: false
    });
    const addWake = (obj: THREE.Group, w: number, len: number, y: number, z: number) => {
      const wake = new THREE.Mesh(box, wakeMat);
      wake.scale.set(w, 0.35, len);
      wake.position.set(0, y, z);
      obj.add(wake);
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

    for (let i = 0; i < 9000 && sites.length < 56; i++) {
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

      // --- Hero vessel: mega-yacht on even sites, cruise liner on odd ---
      if (si % 2 === 0) {
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
        mast.scale.set(1, 18, 1);
        mast.position.set(0, 16, 6);
        obj.add(mast);
        // Colourful sun-deck pads.
        const padCols = [0xff5a3c, 0xf7d354, 0x2c6bd6, 0x18a558];
        for (let p = 0; p < 4; p++) {
          const pad = new THREE.Mesh(box, mat(padCols[p]));
          pad.scale.set(3, 0.5, 3);
          pad.position.set(-3 + (p % 2) * 6, 3.4, -13 + Math.floor(p / 2) * 6);
          obj.add(pad);
        }
        // Rear helipad with an H.
        const heli = new THREE.Mesh(box, mat(0x2a2f36));
        heli.scale.set(9, 0.5, 9);
        heli.position.set(0, 3.3, -19);
        obj.add(heli);
        const heliH = new THREE.Mesh(box, new THREE.MeshBasicMaterial({ color: 0xf7d354 }));
        heliH.scale.set(1.2, 0.6, 5);
        heliH.position.set(0, 3.7, -19);
        obj.add(heliH);
        // Bunting pennants strung down from the mast.
        const flagCols = [0xd6382c, 0xf7d354, 0x2c6bd6, 0x18a558, 0x9d5cff, 0xff2e88];
        for (let f = 0; f < 6; f++) {
          const flag = new THREE.Mesh(box, new THREE.MeshBasicMaterial({ color: flagCols[f] }));
          flag.scale.set(0.3, 2, 2.6);
          flag.position.set(0, 23 - f * 2.6, 6 - f * 3);
          obj.add(flag);
        }
        // Big side advert boards along the hull.
        const adTex = bannerTexture(YACHT_ADS[si % YACHT_ADS.length], YACHT_BG[si % YACHT_BG.length]);
        const adMat = new THREE.MeshBasicMaterial({ map: adTex, side: THREE.DoubleSide });
        for (const s of [1, -1]) {
          const panel = new THREE.Mesh(new THREE.PlaneGeometry(62, 9), adMat);
          panel.position.set(s * 6.3, 0.6, 4);
          panel.rotation.y = s > 0 ? Math.PI / 2 : -Math.PI / 2;
          obj.add(panel);
        }
        addWake(obj, 6, 26, -1.6, 38);
        // Mega scale; hovers near the cluster centre so the jet-skis ring it.
        obj.scale.setScalar(7);
        this.group.add(obj);
        this.yachts.push({ obj, center: dir, east: e, north: n, orbitR: 30 + hash2(si, 83) * 30, alt: 3.5, speed: 0.03 + hash2(si, 84) * 0.02, phase: hash2(si, 85) * Math.PI * 2 });
      } else {
        // --- Cruise liner: three decks of portholes that blaze at night ---
        const obj = new THREE.Group();
        const hull = new THREE.Mesh(box, mat(0xf4f4f2));
        hull.scale.set(14, 7, 78);
        obj.add(hull);
        const bow = new THREE.Mesh(box, mat(0xf4f4f2));
        bow.scale.set(8, 6, 12);
        bow.position.set(0, 0, -44);
        obj.add(bow);
        const belt = new THREE.Mesh(box, mat(0xd42a1f));
        belt.scale.set(14.4, 1.6, 78);
        belt.position.set(0, -2.2, 0);
        obj.add(belt);
        for (let d = 0; d < 3; d++) {
          const deck = new THREE.Mesh(box, mat(0xe9eef2));
          deck.scale.set(12 - d * 2, 4.5, 64 - d * 12);
          deck.position.set(0, 5.8 + d * 4.5, 2);
          obj.add(deck);
          for (const s of [-1, 1]) {
            const lights = new THREE.Mesh(box, glowStrip);
            lights.scale.set(0.5, 1.4, 60 - d * 12);
            lights.position.set(s * (6.1 - d), 6.4 + d * 4.5, 2);
            obj.add(lights);
          }
        }
        const bridge = new THREE.Mesh(box, mat(0xdfe6ec));
        bridge.scale.set(9, 3.5, 8);
        bridge.position.set(0, 19, -26);
        obj.add(bridge);
        const bridgeGlass = new THREE.Mesh(box, glowStrip);
        bridgeGlass.scale.set(9.3, 1.4, 7);
        bridgeGlass.position.set(0, 19.6, -26.2);
        obj.add(bridgeGlass);
        for (const fz of [4, 20]) {
          const funnel = new THREE.Mesh(box, mat(0xd42a1f));
          funnel.scale.set(3.5, 7, 5);
          funnel.position.set(0, 21, fz);
          obj.add(funnel);
          const funnelTop = new THREE.Mesh(box, mat(0x2a2f36));
          funnelTop.scale.set(3.7, 1.4, 5.2);
          funnelTop.position.set(0, 25, fz);
          obj.add(funnelTop);
        }
        const pool = new THREE.Mesh(box, new THREE.MeshBasicMaterial({ color: 0x54c4f0 }));
        pool.scale.set(6, 0.6, 10);
        pool.position.set(0, 17.6, -8);
        obj.add(pool);
        addWake(obj, 7, 32, -2.4, 58);
        obj.scale.setScalar(6);
        this.group.add(obj);
        this.yachts.push({ obj, center: dir, east: e, north: n, orbitR: 42 + hash2(si, 83) * 26, alt: 4, speed: 0.018 + hash2(si, 84) * 0.014, phase: hash2(si, 85) * Math.PI * 2 });
      }

      // --- Jet-skiers carving circles around the hero vessel ---
      const skiN = 4 + Math.floor(hash2(si, 86) * 3);
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
        addWake(obj, 2.4, 8, -0.6, 7.5);
        obj.scale.setScalar(3);
        this.group.add(obj);
        this.skis.push({ obj, center: dir, east: e, north: n, orbitR: 95 + k * 26 + hash2(si + k, 87) * 20, alt: 2, speed: 0.24 + hash2(si + k, 88) * 0.14, phase: hash2(si * 3 + k, 89) * Math.PI * 2 });
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

      // --- A whale surfacing and spouting on some sites ---
      if (hash2(si, 101) > 0.55) {
        const obj = new THREE.Group();
        const body = new THREE.Group();
        const blue = 0x46586c;
        for (let s = 0; s < 4; s++) {
          const seg = new THREE.Mesh(box, mat(blue));
          seg.scale.set(6.5 - s * 0.9, 6 - s * 1, 9);
          seg.position.set(0, 0, -8 + s * 7.5);
          body.add(seg);
        }
        const head = new THREE.Mesh(box, mat(blue));
        head.scale.set(5.5, 4.5, 6);
        head.position.set(0, -0.5, -13.5);
        body.add(head);
        const under = new THREE.Mesh(box, mat(0xb8c4cc));
        under.scale.set(5, 2, 24);
        under.position.set(0, -2.6, -1);
        body.add(under);
        const fluke = new THREE.Mesh(box, mat(blue));
        fluke.scale.set(12, 1.2, 5);
        fluke.position.set(0, 1, 17);
        body.add(fluke);
        for (const s of [-1, 1]) {
          const fin = new THREE.Mesh(box, mat(blue));
          fin.scale.set(5, 1, 3);
          fin.position.set(s * 5, -2, -8);
          body.add(fin);
        }
        const spout = new THREE.Mesh(box, new THREE.MeshBasicMaterial({ color: 0xeafaff, transparent: true, opacity: 0.85 }));
        spout.scale.set(1.6, 6, 1.6);
        spout.position.set(0, 7, -12);
        body.add(spout);
        obj.add(body);
        obj.scale.setScalar(3.2);
        this.group.add(obj);
        this.whales.push({ obj, body, spout, center: dir, east: e, north: n, orbitR: 150 + hash2(si, 103) * 40, alt: -1, speed: 0.05 + hash2(si, 104) * 0.03, phase: hash2(si, 105) * Math.PI * 2 });
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

    // --- Globe-wide instanced sailboat fleet: no ocean is ever empty ---
    const fleetDirs: THREE.Vector3[] = [];
    for (let i = 0; i < 12000 && fleetDirs.length < 240; i++) {
      const z = hash2(i, 111) * 2 - 1;
      const phi = hash2(i, 112) * Math.PI * 2;
      const r = Math.sqrt(Math.max(0, 1 - z * z));
      const dir = new THREE.Vector3(r * Math.cos(phi), z, r * Math.sin(phi));
      if (Math.abs(dir.y) > 0.92) continue;
      if (terrain.height(dir) < -16) fleetDirs.push(dir);
    }
    const hulls = new THREE.InstancedMesh(box, ABS_SOLID_MATERIAL, Math.max(1, fleetDirs.length));
    const sails = new THREE.InstancedMesh(box, ABS_SOLID_MATERIAL, Math.max(1, fleetDirs.length));
    const m = new THREE.Matrix4();
    const q = new THREE.Quaternion();
    const qYaw = new THREE.Quaternion();
    const p = new THREE.Vector3();
    const sc = new THREE.Vector3();
    const col = new THREE.Color();
    const yAxis = new THREE.Vector3(0, 1, 0);
    fleetDirs.forEach((dir, i) => {
      tangentBasis(dir, east, north);
      basisQuat(east, dir, north, q);
      qYaw.setFromAxisAngle(yAxis, hash2(i, 113) * Math.PI * 2);
      q.multiply(qYaw);
      const size = 0.8 + hash2(i, 114) * 0.8;
      p.copy(dir).multiplyScalar(PLANET_R + 1.4);
      m.compose(p, q, sc.set(5 * size, 2.5 * size, 12 * size));
      hulls.setMatrixAt(i, m);
      hulls.setColorAt(i, col.setHex(SAIL_COLORS[(i * 3 + 1) % SAIL_COLORS.length]));
      p.copy(dir).multiplyScalar(PLANET_R + 1.4 + 6.5 * size);
      m.compose(p, q, sc.set(0.7 * size, 10 * size, 5.5 * size));
      sails.setMatrixAt(i, m);
      sails.setColorAt(i, col.setHex(i % 3 === 0 ? SAIL_COLORS[i % SAIL_COLORS.length] : 0xf4f4f2));
    });
    hulls.instanceMatrix.needsUpdate = true;
    sails.instanceMatrix.needsUpdate = true;
    if (hulls.instanceColor) hulls.instanceColor.needsUpdate = true;
    if (sails.instanceColor) sails.instanceColor.needsUpdate = true;
    hulls.frustumCulled = false;
    sails.frustumCulled = false;
    this.group.add(hulls);
    this.group.add(sails);
  }

  update(elapsed: number): void {
    // `ahead` is NEGATIVE: lookAt points the object's +Z at the target, and
    // every vessel here is authored with its bow toward -Z, so looking at the
    // point BEHIND the motion makes them all travel nose-first.
    const orbit = (o: Orbiter, altY: number, ahead = -0.025) => {
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
    for (const w of this.whales) {
      const surf = Math.sin(elapsed * w.speed * 4 + w.phase);
      orbit(w, w.alt + Math.max(0, surf) * 5);
      w.body.rotation.x = Math.cos(elapsed * w.speed * 4 + w.phase) * 0.18;
      // Spout blasts while the whale rides the surface.
      const blow = Math.max(0, surf - 0.35) / 0.65;
      w.spout.visible = blow > 0.02;
      w.spout.scale.set(1.6, 2 + blow * 9, 1.6);
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
