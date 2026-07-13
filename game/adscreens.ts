import * as THREE from 'three';

/**
 * Animated city billboards. A shared corridor layout drives both the brick
 * towers (built in landmarks.ts) and the glowing screens here, so the ads sit
 * flush on the tower faces. Each screen is a canvas texture redrawn a few
 * times a second to fake a live LED wall. Channels rotate between brand
 * adverts and animated shows: a dancing chibi idol, a bouncing cat, and a
 * neon equaliser. Meshes are children of the NYC group so they inherit its
 * placement on the globe automatically.
 */

export interface AdTower {
  x: number;
  z: number;
  w: number;
  h: number;
  /** which way the screen on this tower faces */
  face: 'px' | 'nx' | 'nz';
  /** hero towers get the biggest screen and always run the idol show */
  hero?: boolean;
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
  { x: 0, z: 74, w: 46, h: 150, face: 'nz', hero: true }
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

type Channel = 'brand' | 'dancer' | 'cat' | 'eq';

interface Screen {
  canvas: HTMLCanvasElement;
  ctx: CanvasRenderingContext2D;
  tex: THREE.CanvasTexture;
  seed: number;
  channel: Channel;
}

const W = 256;
const H = 320;

function drawTicker(g: CanvasRenderingContext2D, elapsed: number, seed: number): void {
  g.fillStyle = '#000000';
  g.fillRect(14, H - 58, W - 28, 40);
  g.fillStyle = '#ffe23a';
  g.font = 'bold 24px system-ui, sans-serif';
  g.textAlign = 'left';
  g.textBaseline = 'alphabetic';
  const scroll = (elapsed * 90 + seed * 40) % 1400;
  g.fillText(TICKER + TICKER, W - scroll, H - 30);
}

function drawBrand(g: CanvasRenderingContext2D, elapsed: number, seed: number): void {
  const idx = (Math.floor(elapsed / 3.2) + seed) % ADS.length;
  const ad = ADS[idx];
  const pulse = 0.5 + 0.5 * Math.sin(elapsed * 3 + seed);

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

  drawTicker(g, elapsed, seed);
}

function heart(g: CanvasRenderingContext2D, x: number, y: number, s: number): void {
  g.beginPath();
  g.moveTo(x, y + s * 0.9);
  g.bezierCurveTo(x - s, y, x - s * 0.9, y - s, x, y - s * 0.35);
  g.bezierCurveTo(x + s * 0.9, y - s, x + s, y, x, y + s * 0.9);
  g.fill();
}

/** The idol show: a chibi dancer with pigtails, glow sticks and hearts. */
function drawDancer(g: CanvasRenderingContext2D, elapsed: number, seed: number): void {
  const beat = elapsed * 2.4 + seed;
  const bounce = Math.abs(Math.sin(beat)) * 14;

  const grad = g.createLinearGradient(0, 0, 0, H);
  grad.addColorStop(0, '#2b0a4e');
  grad.addColorStop(1, '#ff3d9e');
  g.fillStyle = grad;
  g.fillRect(0, 0, W, H);

  // sweeping spotlights
  g.save();
  g.globalAlpha = 0.16;
  g.fillStyle = '#ffffff';
  for (let k = 0; k < 3; k++) {
    const a = Math.sin(elapsed * 0.9 + k * 2.1 + seed) * 0.9;
    g.save();
    g.translate(W / 2 + (k - 1) * 70, 0);
    g.rotate(a);
    g.fillRect(-14, 0, 28, H);
    g.restore();
  }
  g.restore();

  // stage floor
  g.fillStyle = 'rgba(20,6,40,0.85)';
  g.fillRect(0, H - 72, W, 72);

  const cx = W / 2 + Math.sin(beat * 0.5) * 26;
  const cy = H - 128 - bounce;
  const skin = '#ffe3c8';
  const hair = ['#ff77c8', '#7fd4ff', '#c99bff', '#ffd166'][seed % 4];
  const dress = ['#ff2e88', '#38e1ff', '#ffd21e', '#a06bff'][(seed + 1) % 4];
  const armSwing = Math.sin(beat * 2) * 0.9;
  const step = Math.sin(beat * 2);

  // legs
  g.strokeStyle = skin;
  g.lineWidth = 9;
  g.lineCap = 'round';
  g.beginPath();
  g.moveTo(cx - 8, cy + 36);
  g.lineTo(cx - 14 - step * 6, cy + 70 - Math.max(0, step) * 10);
  g.stroke();
  g.beginPath();
  g.moveTo(cx + 8, cy + 36);
  g.lineTo(cx + 14 + step * 6, cy + 70 + Math.min(0, step) * 10);
  g.stroke();

  // dress
  g.fillStyle = dress;
  g.beginPath();
  g.moveTo(cx, cy - 2);
  g.lineTo(cx - 30, cy + 44);
  g.lineTo(cx + 30, cy + 44);
  g.closePath();
  g.fill();

  // arms + glow sticks
  g.strokeStyle = skin;
  g.lineWidth = 8;
  g.beginPath();
  g.moveTo(cx - 14, cy + 6);
  g.lineTo(cx - 38, cy - 12 - armSwing * 18);
  g.stroke();
  g.beginPath();
  g.moveTo(cx + 14, cy + 6);
  g.lineTo(cx + 38, cy - 12 + armSwing * 18);
  g.stroke();
  g.lineWidth = 5;
  g.strokeStyle = '#a6ff4d';
  g.beginPath();
  g.moveTo(cx - 38, cy - 12 - armSwing * 18);
  g.lineTo(cx - 46, cy - 26 - armSwing * 18);
  g.stroke();
  g.strokeStyle = '#4dffff';
  g.beginPath();
  g.moveTo(cx + 38, cy - 12 + armSwing * 18);
  g.lineTo(cx + 46, cy - 26 + armSwing * 18);
  g.stroke();

  // chibi head with pigtails, buns and bangs
  const hy = cy - 34 + Math.sin(beat * 2 + 0.5) * 2;
  const sw = Math.sin(beat * 2) * 10;
  g.fillStyle = hair;
  g.beginPath();
  g.ellipse(cx - 38, hy + 8 + sw, 12, 22, 0.5, 0, Math.PI * 2);
  g.fill();
  g.beginPath();
  g.ellipse(cx + 38, hy + 8 - sw, 12, 22, -0.5, 0, Math.PI * 2);
  g.fill();
  g.fillStyle = skin;
  g.beginPath();
  g.arc(cx, hy, 30, 0, Math.PI * 2);
  g.fill();
  g.fillStyle = hair;
  g.beginPath();
  g.arc(cx, hy - 8, 30, Math.PI * 1.02, Math.PI * 1.98);
  g.fill();
  g.beginPath();
  g.arc(cx - 24, hy - 20, 11, 0, Math.PI * 2);
  g.fill();
  g.beginPath();
  g.arc(cx + 24, hy - 20, 11, 0, Math.PI * 2);
  g.fill();

  // big sparkly eyes (with blink), blush and a smile
  const blink = Math.sin(elapsed * 1.7 + seed) > 0.96 ? 0.15 : 1;
  g.fillStyle = '#241a33';
  g.beginPath();
  g.ellipse(cx - 11, hy + 4, 5.5, 8 * blink, 0, 0, Math.PI * 2);
  g.fill();
  g.beginPath();
  g.ellipse(cx + 11, hy + 4, 5.5, 8 * blink, 0, 0, Math.PI * 2);
  g.fill();
  g.fillStyle = '#ffffff';
  g.beginPath();
  g.arc(cx - 9, hy + 1, 2, 0, Math.PI * 2);
  g.fill();
  g.beginPath();
  g.arc(cx + 13, hy + 1, 2, 0, Math.PI * 2);
  g.fill();
  g.fillStyle = 'rgba(255,110,160,0.7)';
  g.beginPath();
  g.arc(cx - 20, hy + 12, 4.5, 0, Math.PI * 2);
  g.fill();
  g.beginPath();
  g.arc(cx + 20, hy + 12, 4.5, 0, Math.PI * 2);
  g.fill();
  g.strokeStyle = '#8a3a55';
  g.lineWidth = 2.5;
  g.beginPath();
  g.arc(cx, hy + 13, 7, 0.15 * Math.PI, 0.85 * Math.PI);
  g.stroke();

  // floating hearts
  const heartCols = ['#ff5ca8', '#ffd21e', '#7fd4ff', '#ff8a3a'];
  for (let k = 0; k < 4; k++) {
    const t = (elapsed * 0.35 + k * 0.25 + seed * 0.1) % 1;
    const hx = 30 + ((seed * 37 + k * 67) % 196);
    g.globalAlpha = Math.sin(t * Math.PI);
    g.fillStyle = heartCols[k];
    heart(g, hx, H - t * (H - 40), 8);
    g.globalAlpha = 1;
  }

  g.fillStyle = 'rgba(0,0,0,0.72)';
  g.fillRect(0, H - 34, W, 34);
  g.fillStyle = '#ff9ecf';
  g.font = 'bold 21px system-ui, sans-serif';
  g.textAlign = 'center';
  g.textBaseline = 'middle';
  g.fillText('☆ MINIFIG IDOL — LIVE ☆', W / 2, H - 17);
}

/** A bouncing cartoon cat over scrolling rainbow stripes. */
function drawCat(g: CanvasRenderingContext2D, elapsed: number, seed: number): void {
  const stripes = ['#ff4d6d', '#ff8a3a', '#ffd21e', '#4cd964', '#38b6ff', '#a06bff'];
  const off = (elapsed * 60) % 54;
  for (let k = -1; k < 8; k++) {
    g.fillStyle = stripes[((k % 6) + 6) % 6];
    g.fillRect(0, k * 54 + off - 54, W, 55);
  }

  const cx = W / 2;
  const cy = H / 2 - 24 + Math.sin(elapsed * 3 + seed) * 12;
  const tilt = Math.sin(elapsed * 1.5 + seed) * 0.12;

  g.save();
  g.translate(cx, cy);
  g.rotate(tilt);
  // ears
  g.fillStyle = '#8d97a1';
  g.beginPath();
  g.moveTo(-52, -28);
  g.lineTo(-30, -70);
  g.lineTo(-8, -34);
  g.closePath();
  g.fill();
  g.beginPath();
  g.moveTo(52, -28);
  g.lineTo(30, -70);
  g.lineTo(8, -34);
  g.closePath();
  g.fill();
  g.fillStyle = '#ffb3c8';
  g.beginPath();
  g.moveTo(-42, -34);
  g.lineTo(-30, -58);
  g.lineTo(-16, -36);
  g.closePath();
  g.fill();
  g.beginPath();
  g.moveTo(42, -34);
  g.lineTo(30, -58);
  g.lineTo(16, -36);
  g.closePath();
  g.fill();
  // head
  g.fillStyle = '#9aa3ab';
  g.beginPath();
  g.arc(0, 0, 56, 0, Math.PI * 2);
  g.fill();
  // eyes (blink)
  const blink = Math.sin(elapsed * 1.3 + seed) > 0.94 ? 0.12 : 1;
  g.fillStyle = '#232a31';
  g.beginPath();
  g.ellipse(-20, -6, 8, 12 * blink, 0, 0, Math.PI * 2);
  g.fill();
  g.beginPath();
  g.ellipse(20, -6, 8, 12 * blink, 0, 0, Math.PI * 2);
  g.fill();
  // nose + mouth
  g.fillStyle = '#ffb3c8';
  g.beginPath();
  g.moveTo(0, 8);
  g.lineTo(-6, 16);
  g.lineTo(6, 16);
  g.closePath();
  g.fill();
  g.strokeStyle = '#232a31';
  g.lineWidth = 3;
  g.beginPath();
  g.arc(-8, 24, 8, 0.1 * Math.PI, 0.9 * Math.PI);
  g.stroke();
  g.beginPath();
  g.arc(8, 24, 8, 0.1 * Math.PI, 0.9 * Math.PI);
  g.stroke();
  // whiskers
  g.lineWidth = 2.5;
  for (const s of [-1, 1]) {
    for (let k = -1; k <= 1; k++) {
      g.beginPath();
      g.moveTo(s * 30, 10 + k * 7);
      g.lineTo(s * 78, 4 + k * 12);
      g.stroke();
    }
  }
  g.restore();

  g.fillStyle = 'rgba(0,0,0,0.72)';
  g.fillRect(0, H - 34, W, 34);
  g.fillStyle = '#8ef0ff';
  g.font = 'bold 22px system-ui, sans-serif';
  g.textAlign = 'center';
  g.textBaseline = 'middle';
  g.fillText('NYAN FM 101.5', W / 2, H - 17);
}

/** A neon equaliser bouncing to an invisible beat. */
function drawEq(g: CanvasRenderingContext2D, elapsed: number, seed: number): void {
  g.fillStyle = '#0b0618';
  g.fillRect(0, 0, W, H);
  const bars = 12;
  const bw = (W - 40) / bars;
  for (let k = 0; k < bars; k++) {
    const v = Math.abs(Math.sin(elapsed * (2.2 + (((k * 7 + seed) % 5) * 0.35)) + k * 0.9 + seed));
    const bh = 26 + v * (H * 0.52);
    const hue = (k * 30 + elapsed * 40) % 360;
    g.fillStyle = `hsl(${hue}, 95%, 60%)`;
    g.fillRect(20 + k * bw, H - 84 - bh, bw - 5, bh);
    g.globalAlpha = 0.3;
    g.fillRect(20 + k * bw, H - 80, bw - 5, bh * 0.32);
    g.globalAlpha = 1;
  }
  g.fillStyle = 'rgba(0,0,0,0.7)';
  g.fillRect(0, 0, W, 52);
  g.fillStyle = '#38e1ff';
  g.font = 'bold 26px system-ui, sans-serif';
  g.textAlign = 'center';
  g.textBaseline = 'middle';
  g.fillText('NEON NIGHTS', W / 2, 26);
}

function drawScreen(s: Screen, elapsed: number): void {
  switch (s.channel) {
    case 'dancer':
      drawDancer(s.ctx, elapsed, s.seed);
      break;
    case 'cat':
      drawCat(s.ctx, elapsed, s.seed);
      break;
    case 'eq':
      drawEq(s.ctx, elapsed, s.seed);
      break;
    default:
      drawBrand(s.ctx, elapsed, s.seed);
  }
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
    const channel: Channel = t.hero ? 'dancer' : (['brand', 'dancer', 'brand', 'eq', 'cat'] as Channel[])[i % 5];
    const screen: Screen = { canvas, ctx, tex, seed: i * 3 + 1, channel };
    drawScreen(screen, 0);
    screens.push(screen);

    const sw = t.w * (t.hero ? 0.98 : 0.86);
    const sh = t.h * (t.hero ? 0.64 : 0.5);
    const mesh = new THREE.Mesh(
      new THREE.PlaneGeometry(sw, sh),
      new THREE.MeshBasicMaterial({ map: tex, toneMapped: false })
    );
    const y = 6 + sh / 2 + t.h * (t.hero ? 0.1 : 0.16);
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
