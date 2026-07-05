import * as THREE from 'three';

/**
 * Animated Times Square billboards. A shared corridor layout drives both the
 * brick towers (built in landmarks.ts) and the glowing screens here, so the
 * ads sit flush on the tower faces. Each screen is a canvas texture redrawn a
 * few times a second to fake a live LED wall: cycling adverts, colour pulses
 * and a scrolling ticker. Meshes are children of the NYC group so they inherit
 * its placement on the globe automatically.
 */

export interface AdTower {
  x: number;
  z: number;
  w: number;
  h: number;
  /** which way the screen on this tower faces */
  face: 'px' | 'nx' | 'nz';
}

// Two rows of towers forming a canyon along +z, plus a hero tower capping the
// south end. Screens face inward toward the plaza the cars/people move through.
export const NYC_AD_TOWERS: AdTower[] = [
  { x: -46, z: -70, w: 30, h: 150, face: 'px' },
  { x: -46, z: -20, w: 28, h: 190, face: 'px' },
  { x: -46, z: 32, w: 30, h: 165, face: 'px' },
  { x: 46, z: -70, w: 30, h: 175, face: 'nx' },
  { x: 46, z: -20, w: 28, h: 205, face: 'nx' },
  { x: 46, z: 32, w: 30, h: 160, face: 'nx' },
  { x: 0, z: 74, w: 46, h: 150, face: 'nz' }
];

const ADS: { name: string; bg: string; fg: string; sub: string }[] = [
  { name: 'BRICK COLA', bg: '#d5202b', fg: '#ffffff', sub: 'TASTE THE STUD' },
  { name: "McBRICK'S", bg: '#d21b1b', fg: '#ffd21e', sub: "I'M SNAPPIN' IT" },
  { name: 'STUD BULL', bg: '#0a2a6b', fg: '#ffd21e', sub: 'GIVES YOU BRICKS' },
  { name: 'BRICKFLY AIR', bg: '#0b8a55', fg: '#ffffff', sub: 'FLY THE WORLD' },
  { name: 'PLATE PIZZA', bg: '#e0451c', fg: '#fff2cc', sub: '2x2 SLICES' },
  { name: 'SNAP TOK', bg: '#fff21e', fg: '#111111', sub: 'CLICK. BUILD.' },
  { name: 'MINIFIG TV', bg: '#111827', fg: '#38e1ff', sub: 'NOW STREAMING' },
  { name: 'NEON NIGHTS', bg: '#12013a', fg: '#ff2ea6', sub: 'LIVE FROM NYC' }
];

const TICKER = '  BRICKFLY NEWS  ✦  RECORD CROWDS IN TIMES SQUARE  ✦  UFO SPOTTED OVER AREA 51  ✦  BALLOON FESTIVAL TONIGHT  ✦  ';

interface Screen {
  canvas: HTMLCanvasElement;
  ctx: CanvasRenderingContext2D;
  tex: THREE.CanvasTexture;
  seed: number;
}

const W = 256;
const H = 320;

function drawScreen(s: Screen, elapsed: number): void {
  const g = s.ctx;
  const idx = (Math.floor(elapsed / 3.2) + s.seed) % ADS.length;
  const ad = ADS[idx];
  const pulse = 0.5 + 0.5 * Math.sin(elapsed * 3 + s.seed);

  g.fillStyle = ad.bg;
  g.fillRect(0, 0, W, H);

  g.strokeStyle = ad.fg;
  g.lineWidth = 8 + pulse * 6;
  g.strokeRect(10, 10, W - 20, H - 20);

  g.fillStyle = ad.fg;
  g.textAlign = 'center';
  g.textBaseline = 'middle';
  const words = ad.name.split(' ');
  g.font = 'bold 44px system-ui, sans-serif';
  if (words.length > 1) {
    g.fillText(words[0], W / 2, H * 0.32);
    g.fillText(words.slice(1).join(' '), W / 2, H * 0.46);
  } else {
    g.fillText(ad.name, W / 2, H * 0.39);
  }

  g.font = 'bold 22px system-ui, sans-serif';
  g.globalAlpha = 0.85 + pulse * 0.15;
  g.fillText(ad.sub, W / 2, H * 0.62);
  g.globalAlpha = 1;

  g.fillStyle = '#000000';
  g.fillRect(14, H - 58, W - 28, 40);
  g.fillStyle = '#ffe23a';
  g.font = 'bold 24px system-ui, sans-serif';
  g.textAlign = 'left';
  const scroll = (elapsed * 90 + s.seed * 40) % 1400;
  g.fillText(TICKER + TICKER, W - scroll, H - 38);

  s.tex.needsUpdate = true;
}

export interface AdScreens {
  objects: THREE.Object3D[];
  update(elapsed: number): void;
}

/** Build the animated billboards for one tower layout (NYC-local coordinates). */
export function createAdScreens(towers: AdTower[]): AdScreens {
  const screens: Screen[] = [];
  const objects: THREE.Object3D[] = [];

  towers.forEach((t, i) => {
    const canvas = document.createElement('canvas');
    canvas.width = W;
    canvas.height = H;
    const ctx = canvas.getContext('2d')!;
    const tex = new THREE.CanvasTexture(canvas);
    tex.anisotropy = 4;
    const screen: Screen = { canvas, ctx, tex, seed: i * 3 + 1 };
    drawScreen(screen, 0);
    screens.push(screen);

    const sw = t.w * 0.86;
    const sh = t.h * 0.5;
    const mesh = new THREE.Mesh(
      new THREE.PlaneGeometry(sw, sh),
      new THREE.MeshBasicMaterial({ map: tex, toneMapped: false })
    );
    const y = 6 + sh / 2 + t.h * 0.16;
    const off = t.w / 2 + 0.6;
    if (t.face === 'px') {
      mesh.position.set(t.x + off, y, t.z);
      mesh.rotation.y = Math.PI / 2;
    } else if (t.face === 'nx') {
      mesh.position.set(t.x - off, y, t.z);
      mesh.rotation.y = -Math.PI / 2;
    } else {
      mesh.position.set(t.x, y, t.z - off);
      mesh.rotation.y = Math.PI;
    }
    mesh.frustumCulled = false;
    objects.push(mesh);
  });

  let lastDraw = -1;
  return {
    objects,
    update(elapsed: number) {
      // Redraw at ~12 fps regardless of framerate: enough for the ticker/pulse,
      // but cheap enough to run many billboards across the city without stutter.
      if (elapsed - lastDraw < 0.08) return;
      lastDraw = elapsed;
      for (const s of screens) drawScreen(s, elapsed);
    }
  };
}
