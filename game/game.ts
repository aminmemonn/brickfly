import * as THREE from 'three';
import { PLANET_R, MAX_SPEED } from './constants';
import { bus } from './bus';
import { Terrain } from './terrain';
import { buildGlobe } from './globe';
import { Water } from './water';
import { Sky } from './sky';
import { buildClouds, updateClouds } from './clouds';
import { BrickField } from './brickfield';
import { BrickPlane } from './plane';
import { Flight, Input } from './flight';
import { CameraRig, CameraMode } from './camera';
import { Contrail } from './contrail';
import { Explosion } from './explosion';
import { LandmarkManager, landmarkScale } from './landmarks';
import { AudioManager, RADIO_STATIONS } from './audio';
import { Ambient } from './ambient';
import { SkyLife } from './skylife';
import { SeaLife } from './sealife';
import { CityLife } from './life';
import { regionAt } from './regions';
import { LANDMARKS } from './landmark-data';
import { buildSettlements } from './settlements';
import { Settings, QUALITY_PRESETS, loadSettings } from './settings';
import { dirToLatLon, RAD2DEG, DEG2RAD } from './util';
import { updateABSStudioLighting } from './brick-material';
import { BrickStudPool } from './brick-stud-pool';

export type GameMode = 'boot' | 'menu' | 'playing' | 'paused';

const nextFrame = () => new Promise<void>((resolve) => requestAnimationFrame(() => resolve()));

const vTmp = new THREE.Vector3();
const vWingL = new THREE.Vector3();
const vWingR = new THREE.Vector3();
const vFillDir = new THREE.Vector3();
const vLightUp = new THREE.Vector3();
const absAmbient = new THREE.Color();

const FOG_DAY = new THREE.Color(0xbfe3ff);
const FOG_NIGHT = new THREE.Color(0x1b2b4a);
const FOG_GOLDEN = new THREE.Color(0xffb27a);
const KEY_GOLDEN = new THREE.Color(0xffae68);
const KEY_NIGHT = new THREE.Color(0x9fb6dc);
const FILL_NIGHT = new THREE.Color(0x7189bb);
const AMBIENT_NIGHT = new THREE.Color(0x64759c);

export class Game {
  mode: GameMode = 'boot';
  mapUrl = '';

  private renderer: THREE.WebGLRenderer;
  private scene = new THREE.Scene();
  private camera: THREE.PerspectiveCamera;

  private terrain!: Terrain;
  private water!: Water;
  private sky!: Sky;
  private clouds!: THREE.Group;
  private field!: BrickField;
  private plane!: BrickPlane;
  private flight!: Flight;
  private rig!: CameraRig;
  private contrail!: Contrail;
  private explosion!: Explosion;
  private landmarks!: LandmarkManager;
  private ambient!: Ambient;
  private skyLife!: SkyLife;
  private seaLife!: SeaLife;
  private life!: CityLife;
  private studPool: BrickStudPool;
  private audio = new AudioManager();
  private input = new Input();

  private ambientLight: THREE.AmbientLight;
  private sun: THREE.DirectionalLight;
  private fill: THREE.DirectionalLight;

  private settings: Settings;
  private clock = new THREE.Clock();
  private elapsed = 0;
  private hudTimer = 0;
  private posTimer = 0;
  private regionTimer = 0;
  private lastRegion = '';
  private fogColor = new THREE.Color(0xbfe3ff);
  private fogNear = 2600;
  private fogFar = 34000;
  private menuAngle = 0;
  private raf = 0;
  private disposed = false;

  private dragging = false;
  private lastPointer = { x: 0, y: 0 };

  constructor(private canvas: HTMLCanvasElement) {
    this.settings = loadSettings();

    this.renderer = new THREE.WebGLRenderer({
      canvas,
      antialias: true,
      powerPreference: 'high-performance'
    });
    this.renderer.outputColorSpace = THREE.SRGBColorSpace;
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
    this.renderer.toneMappingExposure = 1.05;
    this.renderer.shadowMap.enabled = true;
    this.renderer.shadowMap.type = THREE.PCFSoftShadowMap;

    this.camera = new THREE.PerspectiveCamera(62, 1, 0.5, 100000);
    this.camera.position.set(0, 0, PLANET_R * 2.7);
    this.scene.fog = new THREE.Fog(0xbfe3ff, this.fogNear, this.fogFar);

    this.ambientLight = new THREE.AmbientLight(0x7f8da2, 0.28);
    this.scene.add(this.ambientLight);

    this.sun = new THREE.DirectionalLight(0xffd29b, 2.2);
    this.sun.shadow.mapSize.set(2048, 2048);
    this.sun.shadow.camera.left = -280;
    this.sun.shadow.camera.right = 280;
    this.sun.shadow.camera.top = 280;
    this.sun.shadow.camera.bottom = -280;
    this.sun.shadow.camera.near = 10;
    this.sun.shadow.camera.far = 4000;
    this.sun.shadow.bias = -0.0004;
    this.scene.add(this.sun);
    this.scene.add(this.sun.target);

    this.fill = new THREE.DirectionalLight(0x9ec9ff, this.sun.intensity * 0.3);
    this.scene.add(this.fill);
    this.scene.add(this.fill.target);

    this.studPool = new BrickStudPool();
    this.scene.add(this.studPool.mesh);

    this.handleResize();
    window.addEventListener('resize', this.handleResize);
    window.addEventListener('keydown', this.handleKey);
    canvas.addEventListener('pointerdown', this.handlePointerDown);
    window.addEventListener('pointermove', this.handlePointerMove);
    window.addEventListener('pointerup', this.handlePointerUp);
  }

  async build(): Promise<void> {
    const progress = (pct: number, label: string) => bus.emit('progress', { pct, label });

    progress(5, 'Molding bricks');
    await nextFrame();
    this.terrain = new Terrain();
    this.mapUrl = this.terrain.makeMapDataURL();
    bus.emit('map', this.mapUrl);

    progress(22, 'Forming continents');
    await nextFrame();
    this.scene.add(buildGlobe(this.terrain));

    progress(50, 'Filling the oceans');
    await nextFrame();
    this.water = new Water(this.terrain);
    this.scene.add(this.water.mesh);
    this.sky = new Sky();
    this.scene.add(this.sky.group);
    this.clouds = buildClouds();
    this.scene.add(this.clouds);
    this.ambient = new Ambient(this.terrain);
    this.scene.add(this.ambient.group);
    this.skyLife = new SkyLife(this.terrain);
    this.scene.add(this.skyLife.group);
    this.seaLife = new SeaLife(this.terrain);
    this.scene.add(this.seaLife.group);

    progress(66, 'Raising landmarks');
    await nextFrame();
    this.landmarks = new LandmarkManager(this.terrain, this.studPool);
    this.landmarks.build();
    this.scene.add(this.landmarks.group);
    this.life = new CityLife(this.landmarks.cities);
    this.scene.add(this.life.group);
    this.scene.add(buildSettlements(this.terrain, this.studPool));

    progress(82, 'Stacking terrain');
    await nextFrame();
    const preset = QUALITY_PRESETS[this.settings.quality];
    this.field = new BrickField(this.terrain, preset);
    this.scene.add(this.field.group);

    progress(92, 'Fueling the plane');
    await nextFrame();
    this.plane = new BrickPlane();
    this.scene.add(this.plane.group);
    this.flight = new Flight(this.terrain);
    this.rig = new CameraRig(this.terrain);
    this.contrail = new Contrail();
    this.scene.add(this.contrail.mesh);
    this.explosion = new Explosion();
    this.scene.add(this.explosion.mesh);
    this.input.attach();
    this.syncPlane();

    bus.on('crash', this.onCrash);
    bus.on('respawn', this.onRespawn);
    bus.on('discovered', () => this.audio.discover());

    this.applySettings(this.settings);
    this.mode = 'menu';
    progress(100, 'Ready for takeoff');
    bus.emit('ready');

    this.clock.start();
    this.loop();
  }

  /* ------------------------------------------------------------- controls */

  start(): void {
    this.audio.init();
    const at = new URLSearchParams(window.location.search).get('at');
    if (at) {
      const def = LANDMARKS.find((lm) => lm.id === at);
      if (def) {
        // Arrive a fixed world distance out (not degrees, which balloon at
        // high latitudes) and high enough to clear the tallest builds. Close
        // enough that the arrival lands inside THIS landmark's discovery zone
        // rather than a neighbour's.
        const s = landmarkScale(def.id);
        const offLon = (700 + 220 * s) / (PLANET_R * DEG2RAD * Math.cos(def.lat * DEG2RAD));
        this.flight.reset(def.lat, def.lon - offLon, 90, 200 + 130 * s);
      }
    }
    this.mode = 'playing';
    this.rig.beginTransition();
  }

  pause(): void {
    if (this.mode === 'playing') this.mode = 'paused';
  }

  resume(): void {
    if (this.mode === 'paused') this.mode = 'playing';
  }

  toMenu(): void {
    this.mode = 'menu';
    this.menuAngle = Math.atan2(this.camera.position.z, this.camera.position.x);
  }

  uiClick(): void {
    this.audio.init();
    this.audio.click();
  }

  setCameraMode(mode: CameraMode): void {
    this.rig.setMode(mode);
    bus.emit('camera', mode);
  }

  setThrottle(v: number): void {
    if (this.flight) this.flight.throttle = Math.min(1, Math.max(0, v));
  }

  cycleRadio(): void {
    this.audio.init();
    const idx = this.audio.nextStation();
    bus.emit('radio', RADIO_STATIONS[idx]);
    this.audio.click();
  }

  applySettings(s: Settings): void {
    this.settings = s;
    const preset = QUALITY_PRESETS[s.quality];
    this.field.setQuality(preset);
    this.field.setShadows(preset.shadows);
    this.studPool.setEnabled(preset.studs);
    this.sun.castShadow = preset.shadows;
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, preset.maxDpr));
    this.audio.setEnabled(s.music, s.sfx);
  }

  /* --------------------------------------------------------------- events */

  private onCrash = () => {
    this.audio.crash();
    vTmp.copy(this.flight.pos).normalize();
    this.explosion.trigger(this.flight.pos, this.flight.velocity, vTmp);
    this.plane.group.visible = false;
  };

  private onRespawn = () => {
    this.plane.group.visible = true;
    this.rig.beginTransition();
  };

  private handleResize = () => {
    const w = window.innerWidth;
    const h = window.innerHeight;
    this.renderer.setSize(w, h, false);
    this.camera.aspect = w / h;
    this.camera.updateProjectionMatrix();
  };

  private handleKey = (e: KeyboardEvent) => {
    if (this.mode !== 'playing') return;
    const idx = ['Digit1', 'Digit2', 'Digit3', 'Digit4'].indexOf(e.code);
    if (idx >= 0) this.setCameraMode(idx as CameraMode);
  };

  private handlePointerDown = (e: PointerEvent) => {
    if (this.mode !== 'playing' || e.button !== 0) return;
    this.dragging = true;
    this.lastPointer = { x: e.clientX, y: e.clientY };
  };

  private handlePointerMove = (e: PointerEvent) => {
    if (!this.dragging) return;
    this.rig.drag(e.clientX - this.lastPointer.x, e.clientY - this.lastPointer.y);
    this.lastPointer = { x: e.clientX, y: e.clientY };
  };

  private handlePointerUp = () => {
    this.dragging = false;
    this.rig?.endDrag();
  };

  /* ----------------------------------------------------------------- loop */

  private syncPlane(): void {
    this.plane.group.position.copy(this.flight.pos);
    this.plane.group.quaternion.copy(this.flight.quat);
    this.plane.group.updateMatrixWorld();
  }

  private loop = () => {
    if (this.disposed) return;
    this.raf = requestAnimationFrame(this.loop);

    const dt = Math.min(this.clock.getDelta(), 0.05);
    this.elapsed += dt;

    const playing = this.mode === 'playing';
    const input = this.input.read();

    if (playing) {
      this.flight.update(dt, input);
      this.syncPlane();
      this.plane.update(dt, input, this.flight.throttle);
      this.landmarks.update(this.flight.pos);
    }

    if (this.mode !== 'menu') {
      vTmp.copy(this.flight.pos).normalize();
      this.field.update(dt, vTmp, this.camera.position);
      this.rig.update(dt, this.camera, this.flight, this.flight.speed);
    } else {
      this.menuAngle += dt * 0.045;
      const r = PLANET_R * 2.6;
      this.camera.position.set(Math.cos(this.menuAngle) * r, PLANET_R * 0.75, Math.sin(this.menuAngle) * r);
      this.camera.up.set(0, 1, 0);
      this.camera.lookAt(0, 0, 0);
      if (Math.abs(this.camera.fov - 55) > 0.01) {
        this.camera.fov = 55;
        this.camera.updateProjectionMatrix();
      }
    }

    // Contrail from the wingtips
    vWingL.set(-8, 1, -0.6);
    vWingR.set(8, 1, -0.6);
    this.plane.group.localToWorld(vWingL);
    this.plane.group.localToWorld(vWingR);
    this.contrail.update(
      dt,
      [vWingL, vWingR],
      playing && !this.flight.crashed && this.flight.throttle > 0.5,
      this.flight.speed
    );
    this.explosion.update(dt);
    this.studPool.update(this.camera.position);

    // Environment
    const playerUp = vTmp.copy(this.mode === 'menu' ? this.camera.position : this.flight.pos).normalize();
    this.sky.update(dt, this.camera.position, playerUp);
    this.water.update(this.elapsed, this.sky.sunDir, this.sky.dayMix, this.fogColor, this.fogNear, this.fogFar);
    updateClouds(this.clouds, dt);
    this.ambient.update(this.elapsed);
    this.skyLife.update(this.elapsed);
    this.seaLife.update(this.elapsed);
    this.landmarks.updateAds(this.elapsed);
    this.life.update(dt, this.elapsed);
    this.updateLighting();

    // Audio
    this.audio.setFlight(this.flight.throttle, this.flight.speed, !playing || this.flight.crashed);

    // UI events
    this.hudTimer -= dt;
    if (playing && this.hudTimer <= 0) {
      this.hudTimer = 0.12;
      bus.emit('hud', {
        alt: Math.max(0, Math.round(this.flight.altitude)),
        speed: Math.round(this.flight.speed),
        heading: Math.round(this.flight.heading),
        throttle: this.flight.throttle,
        dist: this.flight.distance,
        maxSpeed: MAX_SPEED
      });
    }
    this.posTimer -= dt;
    if (this.posTimer <= 0) {
      this.posTimer = 0.25;
      const { lat, lon } = dirToLatLon(vTmp.copy(this.flight.pos).normalize());
      bus.emit('pos', { lat: lat * RAD2DEG, lon: lon * RAD2DEG, heading: this.flight.heading });
    }
    this.regionTimer -= dt;
    if (playing && this.regionTimer <= 0) {
      this.regionTimer = 0.6;
      vTmp.copy(this.flight.pos).normalize();
      const info = regionAt(vTmp, this.terrain.height(vTmp) > 0.5);
      const key = `${info.primary}|${info.secondary ?? ''}`;
      if (key !== this.lastRegion) {
        this.lastRegion = key;
        bus.emit('region', info);
      }
    }

    this.renderer.render(this.scene, this.camera);
  };

  private updateLighting(): void {
    const day = this.sky.dayMix;
    const golden = this.sky.golden;
    const anchor = this.mode === 'menu' ? this.camera.position : this.flight.pos;
    vLightUp.copy(anchor).normalize();
    vFillDir.copy(this.sky.sunDir).negate().addScaledVector(vLightUp, 0.32).normalize();

    // Product-shot key: warm and slightly golden. Night retains a restrained
    // cool bias without losing the hard-plastic highlight response.
    this.sun.intensity = 1.15 + day * 1.1;
    this.sun.color
      .setHex(0xffd29b)
      .lerp(KEY_GOLDEN, golden * 0.72)
      .lerp(KEY_NIGHT, (1 - day) * 0.55);

    // The opposing cool fill is deliberately locked to 30% of the key. A low
    // neutral ambient floor separates shadowed brick colours without flattening
    // the seam AO.
    this.fill.intensity = this.sun.intensity * 0.3;
    this.fill.color.setHex(0x9ec9ff).lerp(FILL_NIGHT, (1 - day) * 0.35);
    // Night keeps a readable moonlit floor: facades stay visible as blue-grey
    // silhouettes behind the neon instead of vanishing into black.
    this.ambientLight.intensity = 0.34 + day * 0.05;
    this.ambientLight.color.setHex(0x7f8da2).lerp(AMBIENT_NIGHT, 1 - day);

    absAmbient.copy(this.ambientLight.color).multiplyScalar(this.ambientLight.intensity);
    updateABSStudioLighting({
      keyDirection: this.sky.sunDir,
      keyColor: this.sun.color,
      keyIntensity: this.sun.intensity,
      fillDirection: vFillDir,
      fillColor: this.fill.color,
      fillIntensity: this.fill.intensity,
      ambientColor: absAmbient
    });

    // Distance haze: match the horizon tint, disabled for the menu's
    // from-space view of the whole planet. Tuned so objects at horizon range
    // (~5600 at cruise altitude) carry real aerial perspective — colossal
    // landmarks a country away must fade to silhouettes, not read as
    // next-door neighbours.
    const menuView = this.mode === 'menu';
    this.fogNear = menuView ? 62000 : 1500;
    this.fogFar = menuView ? 88000 : 11500;
    this.fogColor.copy(FOG_NIGHT).lerp(FOG_DAY, day).lerp(FOG_GOLDEN, golden * 0.5);
    const fog = this.scene.fog as THREE.Fog;
    fog.color.copy(this.fogColor);
    fog.near = this.fogNear;
    fog.far = this.fogFar;

    if (this.sun.castShadow) {
      this.sun.position.copy(anchor).addScaledVector(this.sky.sunDir, 900);
      this.sun.target.position.copy(anchor);
      this.fill.position.copy(anchor).addScaledVector(vFillDir, 720);
      this.fill.target.position.copy(anchor);
    } else {
      this.sun.position.copy(this.sky.sunDir).multiplyScalar(PLANET_R * 3);
      this.sun.target.position.set(0, 0, 0);
      this.fill.position.copy(vFillDir).multiplyScalar(PLANET_R * 3);
      this.fill.target.position.set(0, 0, 0);
    }
  }

  dispose(): void {
    this.disposed = true;
    cancelAnimationFrame(this.raf);
    window.removeEventListener('resize', this.handleResize);
    window.removeEventListener('keydown', this.handleKey);
    window.removeEventListener('pointermove', this.handlePointerMove);
    window.removeEventListener('pointerup', this.handlePointerUp);
    this.input.detach();
    this.audio.dispose();
    this.renderer.dispose();
  }
}

let game: Game | null = null;

export function createGame(canvas: HTMLCanvasElement): Game {
  if (!game) {
    game = new Game(canvas);
    void game.build();
  }
  return game;
}

export function getGame(): Game | null {
  return game;
}
