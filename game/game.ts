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
import { dirToLatLon, RAD2DEG } from './util';

export type GameMode = 'boot' | 'menu' | 'playing' | 'paused';

const nextFrame = () => new Promise<void>((resolve) => requestAnimationFrame(() => resolve()));

const vTmp = new THREE.Vector3();
const vWingL = new THREE.Vector3();
const vWingR = new THREE.Vector3();

const FOG_DAY = new THREE.Color(0xbfe3ff);
const FOG_NIGHT = new THREE.Color(0x0e1830);
const FOG_GOLDEN = new THREE.Color(0xffb27a);

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
  private audio = new AudioManager();
  private input = new Input();

  private hemi: THREE.HemisphereLight;
  private sun: THREE.DirectionalLight;

  private settings: Settings;
  private clock = new THREE.Clock();
  private elapsed = 0;
  private hudTimer = 0;
  private posTimer = 0;
  private regionTimer = 0;
  private lastRegion = '';
  private fogColor = new THREE.Color(0xbfe3ff);
  private fogNear = 2200;
  private fogFar = 15000;
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

    this.camera = new THREE.PerspectiveCamera(62, 1, 0.5, 60000);
    this.camera.position.set(0, 0, PLANET_R * 2.7);
    this.scene.fog = new THREE.Fog(0xbfe3ff, this.fogNear, this.fogFar);

    this.hemi = new THREE.HemisphereLight(0xbfe3ff, 0x4a5568, 0.6);
    this.scene.add(this.hemi);

    this.sun = new THREE.DirectionalLight(0xffffff, 2.2);
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
    this.landmarks = new LandmarkManager(this.terrain);
    this.landmarks.build();
    this.scene.add(this.landmarks.group);
    this.life = new CityLife(this.landmarks.cities);
    this.scene.add(this.life.group);
    this.scene.add(buildSettlements(this.terrain));

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
        // Arrive proportionally farther out and higher for bigger landmarks so
        // the whole skyline is in view instead of spawning inside it.
        const s = landmarkScale(def.id);
        this.flight.reset(def.lat, def.lon - 2.0 * s, 90, 150 + 120 * s);
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
      this.field.update(dt, vTmp);
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

    // A moonlight floor keeps the night readable instead of pitch black.
    this.sun.intensity = 0.55 + day * 1.8;
    this.sun.color
      .setHex(0xffffff)
      .lerp(new THREE.Color(0xffb070), golden)
      .lerp(new THREE.Color(0x93a7cc), (1 - day) * 0.7);
    this.hemi.intensity = 0.42 + day * 0.55;

    // Distance haze: match the horizon tint, disabled for the menu's
    // from-space view of the whole planet.
    const menuView = this.mode === 'menu';
    this.fogNear = menuView ? 45000 : 2200;
    this.fogFar = menuView ? 58000 : 15000;
    this.fogColor.copy(FOG_NIGHT).lerp(FOG_DAY, day).lerp(FOG_GOLDEN, golden * 0.5);
    const fog = this.scene.fog as THREE.Fog;
    fog.color.copy(this.fogColor);
    fog.near = this.fogNear;
    fog.far = this.fogFar;

    const anchor = this.mode === 'menu' ? this.camera.position : this.flight.pos;
    if (this.sun.castShadow) {
      this.sun.position.copy(anchor).addScaledVector(this.sky.sunDir, 900);
      this.sun.target.position.copy(anchor);
    } else {
      this.sun.position.copy(this.sky.sunDir).multiplyScalar(PLANET_R * 3);
      this.sun.target.position.set(0, 0, 0);
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
