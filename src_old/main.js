import * as THREE from 'three';
import { SceneManager } from './SceneManager.js';
import { Player } from './Player.js';
import { AssetLoader } from './AssetLoader.js';
import { TankFarm } from './TankFarm.js';
import { InteractionSystem, InteractionType } from './InteractionSystem.js';
import { UIManager } from './UIManager.js';
import { ScenarioManager } from './ScenarioManager.js';
import { AudioManager } from './AudioManager.js';
import { FireEffect } from './FireEffect.js';
import { Minimap } from './Minimap.js';
import { WaypointSystem } from './WaypointSystem.js';
import { TTSManager } from './TTSManager.js';
import { ProceduralEffects } from './ProceduralEffects.js';
import { CollisionSystem } from './CollisionSystem.js';
import { EquipmentSystem } from './EquipmentSystem.js';
import { RadioPanel } from './RadioPanel.js';
import { NPCManager } from './NPCManager.js';
import { ActionPanel } from './ActionPanel.js';
import { WaterEffects } from './WaterEffects.js';
import { WorldAnimations } from './WorldAnimations.js';
import { scorch1, scorch2, scorch3 } from './SpriteTextures.js';
import { SaveSystem, ScoringSystem, CutsceneCamera, DayNightCycle, WeatherSystem } from './GameSystems.js';
import { SpatialAudio } from './SpatialAudio.js';
import { LODSystem } from './LODSystem.js';
import { HoseSystem } from './HoseSystem.js';
import gsap from 'gsap';

const POSITIONS = {
  TANK_A:         new THREE.Vector3(-18, 0, 0),
  TANK_B:         new THREE.Vector3(12, 0, 0),
  ROOF_DRAIN:     new THREE.Vector3(-18, 1.0, 5.8),
  DYKE_VALVE:     new THREE.Vector3(-39.2, 1.0, 0),
  MANIFOLD:       new THREE.Vector3(-5, 0, 18),
  COOLING_VALVE:  new THREE.Vector3(12, 0, 16),
  RADIO:          new THREE.Vector3(25, 1.1, 42),
  HYDRANT_H28:    new THREE.Vector3(-15, 0, 24),
  HYDRANT_H27:    new THREE.Vector3(-30, 0, 24),
  HYDRANT_H20:    new THREE.Vector3(18, 0, 49),
  CONTROL:        new THREE.Vector3(25, 0, 42),
  PIPE_MANIFOLD:  new THREE.Vector3(-5, 0, 20),
  FIRE_TRUCK_1:   new THREE.Vector3(-16, 0, 30),
  FIRE_TRUCK_2:   new THREE.Vector3(16, 0, 55),
  NOZZLE_AREA:    new THREE.Vector3(-22, 0, 24),
  PIPELINE_AREA:  new THREE.Vector3(-5, 2, 0),
};

const TRUCK1_START = new THREE.Vector3(-220, 0, 30);  // enters west on Road 10, fully off-screen
const TRUCK2_START = new THREE.Vector3(220, 0, 55);   // enters east on Road 12, fully off-screen
const TRUCK_DRIVE_DURATION = 9;                        // longer run = more dramatic approach

class App {
  constructor() {
    this.canvas = document.getElementById('viewport');
    this.ui = new UIManager();
    this.tts = new TTSManager();
    this.ui.setTTS(this.tts);
    this.scene = new SceneManager(this.canvas);
    this.loader = new AssetLoader();
    this.player = new Player(this.scene.camera, this.canvas);
    this.tankFarm = new TankFarm(this.scene.scene, this.loader);
    this.interaction = new InteractionSystem(this.scene.camera, this.scene.scene);
    this.audio = new AudioManager(this.scene.camera);
    this.scenario = new ScenarioManager(this.ui, this.interaction, this.audio, this.scene);
    this.minimap = new Minimap(this.player);
    this.waypoints = new WaypointSystem(this.scene.scene, this.scene.camera);
    this.fx = new ProceduralEffects(this.scene.scene);
    this.collision = new CollisionSystem();
    this.equipment = new EquipmentSystem(this.scene.camera);
    this.radioPanel = new RadioPanel(this.audio);
    this.actionPanel = new ActionPanel(this.audio);

    this.water = new WaterEffects(this.scene.scene);
    this.worldAnims = new WorldAnimations(this.scene.scene);
    this.fire = null;
    this.clock = new THREE.Clock();
    this.running = false;
    this._lastRadioMsgKey = null;

    this.truckAnims = [];
    this.hoses = [];
    this.npcs = [];
    this.npcManager = null;
    this.hoseSystem = null;

    // New game systems
    this.saveSystem = new SaveSystem();
    this.scoring = new ScoringSystem();
    this.cutscene = new CutsceneCamera(this.scene.camera);
    this.dayNight = new DayNightCycle(this.scene.scene, null);
    this.weather = new WeatherSystem(this.scene.scene);
    this.lod = new LODSystem(this.scene.camera);
    this.spatialAudio = null;
  }

  async init() {
    this.ui.setLoadingStatus('Loading industrial environment...');
    await this.scene.loadEnvironment((p) => this.ui.setLoadingProgress(p * 0.1));

    this.ui.setLoadingStatus('Building tank farm...');
    this.tankFarm.build();
    this.ui.setLoadingProgress(0.12);

    this.ui.setLoadingStatus('Loading 3D models and audio...');
    await this.loader.loadAll((p, status) => {
      this.ui.setLoadingProgress(0.12 + p * 0.8);
      this.ui.setLoadingStatus(status);
    });

    this.ui.setLoadingStatus('Placing equipment...');
    this.npcManager = new NPCManager(this.scene.scene);
    this._placeAllModels();
    this._setupCollisions();
    this._setupEquipment();
    this._setupInteractables();
    this._setupAudio();
    this._setupFire();
    this._setupHoseSystem();
    this._setupEffects();
    this._setupMinimap();
    this._setupWaypoints();
    this.ui.setLoadingProgress(0.92);

    // New game systems
    this.ui.setLoadingStatus('Initializing game systems...');
    this._setupGameSystems();
    this.ui.setLoadingProgress(0.95);

    this.ui.setLoadingStatus('Ready');
    this.ui.setLoadingProgress(1);
    await new Promise(r => setTimeout(r, 500));
    this.ui.hideLoading();

    // Check for saved game
    if (this.saveSystem.hasSave()) {
      this._showContinuePrompt();
    } else {
      this.ui.showStart();
    }
    this._bindStart();
  }

  // ── Game Systems Setup ────────────────────────────────────

  _setupGameSystems() {
    this.dayNight = new DayNightCycle(this.scene.scene, this.scene.moonLight);
    this.dayNight.setTime(0.4);

    this.weather.createRain(3000);

    try {
      this.spatialAudio = new SpatialAudio(
        this.scene.scene,
        this.scene.camera,
        this.audio.listener
      );
      this.spatialAudio.createWindAmbience();
      this.spatialAudio.createMachineryHum();
      this.spatialAudio.addMachineSound('pump_a', new THREE.Vector3(-18, 2, 10), 80);
      this.spatialAudio.addMachineSound('pump_b', new THREE.Vector3(12, 2, 10), 95);
      this.spatialAudio.addMachineSound('cooling', new THREE.Vector3(-75, 5, 70), 60);
      this.spatialAudio.addValveHiss('flare', new THREE.Vector3(-95, 50, -20));
    } catch (e) {
      console.warn('Spatial audio init skipped:', e.message);
    }

    this._autosaveInterval = setInterval(() => this._autosave(), 30000);
  }

  _showContinuePrompt() {
    this.ui.showStart();
    const startInner = document.getElementById('start-inner');
    if (!startInner) return;
    const btn = document.createElement('div');
    btn.id = 'continue-btn';
    btn.textContent = '[ CONTINUE SAVED GAME ]';
    btn.style.cssText = 'cursor:pointer;color:#ffaa44;margin-top:12px;font-size:14px;text-align:center;letter-spacing:2px;';
    btn.addEventListener('click', () => {
      btn.remove();
      this._loadSavedGame();
    });
    startInner.appendChild(btn);
  }

  _autosave() {
    if (!this.running || !this.scenario.fireStarted) return;
    this.saveSystem.save({
      playerPos: this.player.position,
      currentStep: this.scenario.currentStepId,
      completedSteps: [...(this.scenario.completedSteps || [])],
      phase: this.scenario.phase,
      elapsed: this.clock.getElapsedTime(),
      score: this.scoring.getGrade().score,
      warnings: this.scenario.warnings || 0,
      inventory: this.equipment.hasItem('radio') ? ['radio'] : [],
      fireStarted: this.scenario.fireStarted || false,
    });
  }

  _loadSavedGame() {
    const data = this.saveSystem.load();
    if (!data) return;
    if (data.playerPos) {
      this.player.position.set(data.playerPos.x, data.playerPos.y, data.playerPos.z);
    }
    this.ui.showNotification('Game loaded from save', 2000);
    this.saveSystem.clear();
  }

  _playIntroCutscene(onComplete) {
    this.player.disable();
    const tankA = POSITIONS.TANK_A;
    const waypoints = [
      { pos: { x: 0, y: 25, z: 80 }, lookAt: { x: tankA.x, y: 5, z: tankA.z }, duration: 3000 },
      { pos: { x: -40, y: 15, z: 40 }, lookAt: { x: tankA.x, y: 5, z: tankA.z }, duration: 2500 },
      { pos: { x: -10, y: 5, z: 30 }, lookAt: { x: tankA.x, y: 8, z: tankA.z }, duration: 2000 },
      { pos: { x: 0, y: 1.7, z: 40 }, lookAt: { x: tankA.x, y: 5, z: tankA.z }, duration: 1500 },
    ];
    this.cutscene.play(waypoints, () => {
      this.player.enable();
      this.canvas.requestPointerLock();
      if (onComplete) onComplete();
    });
  }

  // ── Model placement ────────────────────────────────────

  _placeModel(name, pos, scale, rotY = 0) {
    const model = this.loader.getModel(name);
    if (!model) return null;
    if (typeof scale === 'number') model.scale.setScalar(scale);
    else model.scale.set(scale[0], scale[1], scale[2]);
    model.rotation.y = rotY;
    model.traverse(c => {
      if (c.isMesh) { c.castShadow = true; c.receiveShadow = true; }
    });
    model.position.copy(pos);
    this.scene.scene.add(model);
    return model;
  }

  _placeOnGround(name, pos, scale, rotY = 0) {
    const model = this._placeModel(name, new THREE.Vector3(pos.x, 0, pos.z), scale, rotY);
    if (!model) return null;
    const box = new THREE.Box3().setFromObject(model);
    model.position.y = pos.y - box.min.y;
    return model;
  }

  _placeAllModels() {
    // ═══════════════════════════════════════════════════════════
    // 1. PRIMARY STORAGE TANKS — inside main dyke enclosure
    // ═══════════════════════════════════════════════════════════
    this.tankA = this._placeOnGround('tank_main', POSITIONS.TANK_A, 0.4, 0);
    this.tankB = this._placeOnGround('tank_secondary', POSITIONS.TANK_B, 0.25, Math.PI);

    // ═══════════════════════════════════════════════════════════
    // 2. MANIFOLD AREA — clear space around the interactive valve
    //    Only one pipe_kit + one valve GLB to set the scene;
    //    the interactive procedural valve has room to operate
    // ═══════════════════════════════════════════════════════════
    this.pipeKit = this._placeOnGround('pipe_kit', new THREE.Vector3(-5, 0, 21), 0.012, 0);
    this.valve1 = this._placeOnGround('industrial_valve', POSITIONS.MANIFOLD, 0.35, Math.PI / 2);
    this.lotoDisplay = this._placeModel('padlock', new THREE.Vector3(-4.8, 1.5, 19), 0.015, 0);
    // Quarter-turn lever handle anchored to the top of the industrial_valve GLB
    this.manifoldWheel = this._addLeverHandle(POSITIONS.MANIFOLD, this.valve1, 0xff6b1a);

    // ═══════════════════════════════════════════════════════════
    // 3. INTERACTIVE VALVES — procedural with operable hand-wheels
    // ═══════════════════════════════════════════════════════════
    this.roofDrainValve = this._createValvePost(
      new THREE.Vector3(POSITIONS.TANK_A.x, 0, POSITIONS.TANK_A.z + 5.8),
      'ROOF DRAIN', 0xff4444
    );
    this.roofDrainValve.rotation.x = Math.PI / 2;
    this.roofDrainValve.position.y = 1.0;
    {
      const bm = new THREE.MeshStandardMaterial({ color: 0x444444, roughness: 0.4, metalness: 0.7 });
      const br = new THREE.Mesh(new THREE.BoxGeometry(0.5, 0.5, 0.06), bm);
      br.position.set(POSITIONS.TANK_A.x, 1.0, POSITIONS.TANK_A.z + 5.5);
      this.scene.scene.add(br);
    }

    this.coolingValve = this._createValvePost(POSITIONS.COOLING_VALVE, 'COOLING WATER', 0x4488ff, 'wheel');

    // Dyke containment valve — gate valve → multi-turn circular wheel
    this.dykeValve = this._createValvePost(new THREE.Vector3(-39.2, 0, 0), 'DYKE VALVE', 0xff4444, 'wheel');
    this.dykeValve.rotation.z = -Math.PI / 2;
    this.dykeValve.position.y = 1.0;
    {
      const bracketMat = new THREE.MeshStandardMaterial({ color: 0x444444, roughness: 0.4, metalness: 0.7 });
      const bracket = new THREE.Mesh(new THREE.BoxGeometry(0.06, 0.5, 0.5), bracketMat);
      bracket.position.set(-40, 1.0, 0);
      bracket.castShadow = true;
      this.scene.scene.add(bracket);
    }

    // ═══════════════════════════════════════════════════════════
    // 4. CONTROL STATION — equipment shed SE of dyke
    // ═══════════════════════════════════════════════════════════
    this.controlStation = this._placeOnGround('control_station', POSITIONS.CONTROL, 0.006, Math.PI);
    this.controlDesk = this._placeOnGround('control_desk', new THREE.Vector3(25.5, 0, 41), 0.012, Math.PI);
    this.radioObj = this._placeModel('walkie_talkie', new THREE.Vector3(25, 1.0, 42), 0.08, 0);
    this._createMCP(new THREE.Vector3(23, 1.3, 41));
    this._placeOnGround('fire_extinguisher', new THREE.Vector3(23, 0, 39), 0.02, 0);
    this._placeOnGround('fire_extinguisher', new THREE.Vector3(27, 0, 43), 0.02, Math.PI * 0.3);
    this._placeOnGround('hydrant_key', new THREE.Vector3(24, 0, 40), 0.015, 0);

    // ═══════════════════════════════════════════════════════════
    // 5. FIRE HYDRANT STATIONS — along roads, per NFPA 24
    //    Each station: hydrant + extinguisher + key + nozzle
    //    Placed on the ROAD SIDE (south of dyke south wall)
    // ═══════════════════════════════════════════════════════════
    // H-28 on Road 10 (z=30) — primary attack hydrant
    // Real hydrant: ~0.65m tall × 0.22m diameter → scale [0.11, 0.325, 0.11]
    // H_SCALE: hydrant GLB keeps real proportions — only Y fills ±1, X/Z are ~±0.18.
    // Y scale 0.38 → height 0.76 m; X/Z scale 0.72 compensates for narrow raw extents → body ≈ 0.26 m wide.
    const H_SCALE = [0.72, 0.38, 0.72];
    const h28Model = this._placeOnGround('fire_hydrant', POSITIONS.HYDRANT_H28, H_SCALE, 0);
    // Procedural spinner handle on top of H-28 for the connect_hose_1 rotate step
    this.hydrantH28Wheel = this._buildHydrantHandle(POSITIONS.HYDRANT_H28, 0.70);
    this._placeOnGround('fire_extinguisher', new THREE.Vector3(-16, 0, 33), 0.02, 0);
    this._placeOnGround('hydrant_key', new THREE.Vector3(-13.5, 0, 33), 0.015, 0);
    this._placeOnGround('fire_nozzle', POSITIONS.NOZZLE_AREA, 0.008, Math.PI / 4);

    // H-27 on Road 10, further west (foam supply hydrant)
    this._placeOnGround('fire_hydrant', POSITIONS.HYDRANT_H27, H_SCALE, 0);
    this._placeOnGround('fire_extinguisher', new THREE.Vector3(-26, 0, 33), 0.02, 0);

    // H-20 on Road 12 (z=55), east side
    this._placeOnGround('fire_hydrant', POSITIONS.HYDRANT_H20, H_SCALE, 0);
    this.hydrantH20Wheel = this._buildHydrantHandle(POSITIONS.HYDRANT_H20, 0.70);
    this._placeOnGround('fire_extinguisher', new THREE.Vector3(19, 0, 58), 0.02, 0);
    this._placeOnGround('hydrant_key', new THREE.Vector3(16, 0, 58), 0.015, 0);
    this._placeOnGround('fire_nozzle', new THREE.Vector3(20, 0, 52), 0.008, 0);

    // Additional hydrants on road kerbs (not ON the road surface)
    this._placeOnGround('fire_hydrant', new THREE.Vector3(50, 0, 24), H_SCALE, 0);
    this._placeOnGround('fire_hydrant', new THREE.Vector3(-50, 0, 24), H_SCALE, 0);
    this._placeOnGround('fire_hydrant', new THREE.Vector3(-50, 0, 49), H_SCALE, 0);
    this._placeOnGround('fire_hydrant', new THREE.Vector3(50, 0, 49), H_SCALE, 0);
    this._placeOnGround('fire_hydrant', new THREE.Vector3(39, 0, -20), H_SCALE, Math.PI / 2);
    this._placeOnGround('fire_hydrant', new THREE.Vector3(39, 0, 10), H_SCALE, Math.PI / 2);

    // ═══════════════════════════════════════════════════════════
    // 6. FIRE EXTINGUISHERS — at dyke gates, manifold, roads
    // ═══════════════════════════════════════════════════════════
    this._placeOnGround('fire_extinguisher', new THREE.Vector3(-17, 0, 26), 0.02, 0);
    this._placeOnGround('fire_extinguisher', new THREE.Vector3(7, 0, 26), 0.02, 0);
    this._placeOnGround('fire_extinguisher', new THREE.Vector3(-41, 0, -8), 0.02, Math.PI / 2);
    this._placeOnGround('fire_extinguisher', new THREE.Vector3(31, 0, -8), 0.02, -Math.PI / 2);
    this._placeOnGround('fire_extinguisher', new THREE.Vector3(-3, 0, 20), 0.02, Math.PI);

    // ═══════════════════════════════════════════════════════════
    // 7. FIRE TRUCKS — hidden until turnout phase
    // ═══════════════════════════════════════════════════════════
    // The GLB keeps its real proportions: Z spans ±1 (length), X/Y raw extents ≈ ±0.17/±0.22.
    // Scale each axis independently so the truck reads as wide & tall, not just long:
    //   X (width)  = 14  →  ~4.8m wide
    //   Y (height) = 11  →  ~4.8m tall
    //   Z (length) = 9   →  ~18m long  (large pumper / fire tender)
    this.fireTruck1 = this._placeOnGround('fire_truck', POSITIONS.FIRE_TRUCK_1, [14, 11, 9], Math.PI / 2);
    if (this.fireTruck1) this.fireTruck1.visible = false;
    this.fireTruck2 = this._placeOnGround('fire_truck', POSITIONS.FIRE_TRUCK_2, [14, 11, 9], -Math.PI / 2);
    if (this.fireTruck2) this.fireTruck2.visible = false;

    this.hoseModelH28 = this._placeOnGround('water_hose', new THREE.Vector3(-16, 0, 30), 0.004, Math.PI / 4);
    if (this.hoseModelH28) this.hoseModelH28.visible = false;
    this.hoseModelH20 = this._placeOnGround('water_hose', new THREE.Vector3(17, 0, 55), 0.004, -Math.PI / 4);
    if (this.hoseModelH20) this.hoseModelH20.visible = false;

    const tankADir28 = Math.atan2(POSITIONS.TANK_A.x - (-14), POSITIONS.TANK_A.z - 30);
    const tankADir20 = Math.atan2(POSITIONS.TANK_A.x - 19, POSITIONS.TANK_A.z - 55);
    this.monitorH28 = this._placeOnGround('water_monitor', new THREE.Vector3(-14, 0, 30), 0.005, tankADir28);
    this.monitorH20 = this._placeOnGround('water_monitor', new THREE.Vector3(19, 0, 55), 0.005, tankADir20);
    if (this.monitorH28) this.monitorH28.visible = false;
    if (this.monitorH20) this.monitorH20.visible = false;

    // ═══════════════════════════════════════════════════════════
    // 8. EAST ENCLOSURE — TT-FR-104C and TT-FR-102A
    //    Tanks inside the east bund wall, with valves and piping
    // ═══════════════════════════════════════════════════════════
    this.chemTank1 = this._placeOnGround('chemical_tank', new THREE.Vector3(50, 0, -8), 2.0, 0);
    this.chemTank2 = this._placeOnGround('chemical_tank', new THREE.Vector3(60, 0, 8), 1.5, Math.PI / 3);
    this._placeOnGround('oil_tank', new THREE.Vector3(48, 0, -18), 0.18, 0);
    this._placeOnGround('industrial_valve', new THREE.Vector3(48, 0, 5), 0.3, Math.PI / 2);
    this._placeOnGround('industrial_valve', new THREE.Vector3(58, 0, -3), 0.3, 0);
    this._placeOnGround('pipe_kit', new THREE.Vector3(53, 0, 0), 0.01, Math.PI / 2);
    this._placeOnGround('fire_extinguisher', new THREE.Vector3(45, 0, -15), 0.02, 0);
    this._placeOnGround('fire_extinguisher', new THREE.Vector3(65, 0, 15), 0.02, 0);

    // ═══════════════════════════════════════════════════════════
    // 9. WEST ENCLOSURE — background storage tanks
    // ═══════════════════════════════════════════════════════════
    this._placeOnGround('chemical_tank', new THREE.Vector3(-55, 0, -42), 1.8, Math.PI / 2);
    this._placeOnGround('chemical_tank', new THREE.Vector3(-62, 0, -32), 1.4, 0);
    this._placeOnGround('oil_tank', new THREE.Vector3(-65, 0, -50), 0.16, Math.PI);
    this._placeOnGround('industrial_valve', new THREE.Vector3(-52, 0, -35), 0.3, 0);
    this._placeOnGround('pipe_kit', new THREE.Vector3(-58, 0, -37), 0.01, Math.PI / 2);
    this._placeOnGround('fire_extinguisher', new THREE.Vector3(-50, 0, -48), 0.02, 0);

    // Pipe infrastructure parallel to Road 15 — on east side kerb (x=39, outside road x=32..38)
    this._placeOnGround('pipe_kit', new THREE.Vector3(40, 0, -10), 0.01, 0);
    this._placeOnGround('pipe_kit', new THREE.Vector3(40, 0, 5), 0.01, 0);
    this._placeOnGround('pipe_kit', new THREE.Vector3(40, 0, 20), 0.01, 0);
    this._placeOnGround('industrial_valve', new THREE.Vector3(40, 0, -5), 0.25, 0);
    this._placeOnGround('industrial_valve', new THREE.Vector3(40, 0, 15), 0.25, 0);

    // Foam equipment — on kerb strip OUTSIDE roads (not on asphalt)
    this._createMEFG(new THREE.Vector3(-17, 0, 25));
    this._createMEFG(new THREE.Vector3(7, 0, 25));
    this._createMEFG(new THREE.Vector3(-17, 0, 48));
    this._createMEFG(new THREE.Vector3(7, 0, 48));
  }

  // ── Procedural props ───────────────────────────────────

  // type = 'wheel'  → multi-turn gate-valve handwheel (spins on Y)
  // type = 'lever'  → quarter-turn ball/butterfly valve lever (pivots 90° on Z)
  _createValvePost(pos, label, wheelColor = 0xcc3333, type = 'wheel') {
    const group = new THREE.Group();
    const baseMat  = new THREE.MeshStandardMaterial({ color: 0x555555, roughness: 0.5, metalness: 0.6 });
    const handleMat = new THREE.MeshStandardMaterial({ color: wheelColor, roughness: 0.35, metalness: 0.6 });

    // Stem / post
    const pipe = new THREE.Mesh(new THREE.CylinderGeometry(0.1, 0.1, 1.6, 8), baseMat);
    pipe.position.y = 0.8;
    group.add(pipe);

    const flange = new THREE.Mesh(new THREE.CylinderGeometry(0.2, 0.2, 0.08, 12), baseMat);
    flange.position.y = 0.6;
    group.add(flange);

    const operatorGroup = new THREE.Group();

    if (type === 'lever') {
      // Ball-valve / butterfly-valve body (sphere) at mid-stem
      const body = new THREE.Mesh(new THREE.SphereGeometry(0.14, 10, 8), baseMat);
      body.position.y = 1.0;
      group.add(body);

      // Lever arm — starts horizontal (open position); quarter-turn closes it
      operatorGroup.position.y = 1.2;
      const arm = new THREE.Mesh(new THREE.BoxGeometry(0.55, 0.045, 0.045), handleMat);
      arm.position.x = 0.27; // pivot at left end so rotation is intuitive
      operatorGroup.add(arm);

      // Small grip knob at end of lever
      const knob = new THREE.Mesh(new THREE.CylinderGeometry(0.04, 0.04, 0.09, 8), handleMat);
      knob.rotation.z = Math.PI / 2;
      knob.position.x = 0.52;
      knob.position.y = 0;
      operatorGroup.add(knob);

      // Safety indicator plate
      const plate = new THREE.Mesh(new THREE.BoxGeometry(0.12, 0.12, 0.02), baseMat);
      plate.position.set(0, 1.22, 0);
      group.add(plate);

      group.userData.valveMode = 'lever';
    } else {
      // Gate-valve handwheel — torus + 4 spokes
      operatorGroup.position.y = 1.5;

      const torus = new THREE.Mesh(new THREE.TorusGeometry(0.25, 0.04, 8, 20), handleMat);
      torus.rotation.x = Math.PI / 2;
      operatorGroup.add(torus);

      for (let i = 0; i < 4; i++) {
        const angle = (i / 4) * Math.PI;
        const spoke = new THREE.Mesh(new THREE.CylinderGeometry(0.015, 0.015, 0.5, 4), handleMat);
        spoke.rotation.z = Math.PI / 2;
        spoke.rotation.y = angle;
        operatorGroup.add(spoke);
      }

      group.userData.valveMode = 'wheel';
    }

    group.add(operatorGroup);
    group.userData.wheelGroup = operatorGroup;
    group.userData.label = label;
    group.position.copy(pos);
    this.scene.scene.add(group);
    return group;
  }

  // Quarter-turn lever handle — physically attached to the top of a GLB valve body.
  // refObj is the valve THREE.Object3D; its bounding box max.y determines the mount height.
  // Returns the operator group with userData.valveMode = 'lever'.
  _addLeverHandle(worldPos, refObj, color = 0xff6b1a) {
    // Derive mount height from the actual valve GLB bounding box
    let mountY = 1.5;
    if (refObj) {
      const box = new THREE.Box3().setFromObject(refObj);
      if (isFinite(box.max.y)) mountY = box.max.y;
    }

    const metalMat = new THREE.MeshStandardMaterial({ color: 0x4a4a4a, roughness: 0.45, metalness: 0.88 });
    const leverMat = new THREE.MeshStandardMaterial({
      color, roughness: 0.28, metalness: 0.75,
      emissive: new THREE.Color(color), emissiveIntensity: 0.07,
    });

    // ── Static mounting hardware (added directly to scene) ──
    // Bonnet flange disc sitting flush on top of valve body
    const bonnet = new THREE.Mesh(new THREE.CylinderGeometry(0.105, 0.12, 0.042, 12), metalMat);
    bonnet.position.set(worldPos.x, mountY + 0.021, worldPos.z);
    this.scene.scene.add(bonnet);

    // Rising stem from bonnet to pivot collar
    const stem = new THREE.Mesh(new THREE.CylinderGeometry(0.028, 0.028, 0.115, 8), metalMat);
    stem.position.set(worldPos.x, mountY + 0.104, worldPos.z);
    this.scene.scene.add(stem);

    // Pivot collar — wide cylinder where lever arm is bolted
    const collar = new THREE.Mesh(new THREE.CylinderGeometry(0.05, 0.05, 0.055, 10), metalMat);
    collar.position.set(worldPos.x, mountY + 0.189, worldPos.z);
    this.scene.scene.add(collar);

    // ── Animated lever operator group (pivots around Z) ──
    // group sits at the pivot point in world space; leverGroup rotates inside it.
    const group = new THREE.Group();
    group.position.set(worldPos.x, mountY + 0.217, worldPos.z);

    const leverGroup = new THREE.Group(); // position (0,0,0) relative to group

    // Pivot hub disc (visual centre of rotation)
    const hub = new THREE.Mesh(new THREE.CylinderGeometry(0.046, 0.046, 0.058, 10), metalMat);
    leverGroup.add(hub);

    // Lever arm: extends +X from pivot; arm centre at x=0.265
    const arm = new THREE.Mesh(new THREE.BoxGeometry(0.53, 0.048, 0.048), leverMat);
    arm.position.x = 0.265;
    leverGroup.add(arm);

    // Grip cylinder at far end of arm
    const grip = new THREE.Mesh(new THREE.CylinderGeometry(0.038, 0.033, 0.115, 8), leverMat);
    grip.rotation.z = Math.PI / 2;
    grip.position.x = 0.503;
    leverGroup.add(grip);

    // Stopper lug at pivot base (visual detail)
    const lug = new THREE.Mesh(new THREE.BoxGeometry(0.055, 0.055, 0.095), metalMat);
    lug.position.set(-0.055, 0, 0);
    leverGroup.add(lug);

    group.add(leverGroup);
    group.userData.wheelGroup = leverGroup;
    group.userData.valveMode  = 'lever';
    this.scene.scene.add(group);
    return group;
  }

  // Rising-stem gate valve handwheel — placed above a GLB valve body at world pos
  // Returns the operator group (registered separately for animation)
  _addGateValveHandwheel(worldPos, stemHeight, color = 0xff6b1a) {
    const group = new THREE.Group();
    const stemMat   = new THREE.MeshStandardMaterial({ color: 0x888888, roughness: 0.4, metalness: 0.8 });
    const handleMat = new THREE.MeshStandardMaterial({ color, roughness: 0.3, metalness: 0.7 });

    // Rising stem
    const stem = new THREE.Mesh(new THREE.CylinderGeometry(0.04, 0.04, 0.35, 8), stemMat);
    stem.position.set(worldPos.x, stemHeight, worldPos.z);
    this.scene.scene.add(stem);

    // Yoke / bonnet flange
    const yoke = new THREE.Mesh(new THREE.CylinderGeometry(0.14, 0.14, 0.07, 12), stemMat);
    yoke.position.set(worldPos.x, stemHeight - 0.12, worldPos.z);
    this.scene.scene.add(yoke);

    // Handwheel group (spins on Y when operated)
    const wheelGroup = new THREE.Group();
    wheelGroup.position.set(worldPos.x, stemHeight + 0.2, worldPos.z);

    const rim = new THREE.Mesh(new THREE.TorusGeometry(0.32, 0.045, 8, 24), handleMat);
    rim.rotation.x = Math.PI / 2;
    wheelGroup.add(rim);

    for (let i = 0; i < 6; i++) {
      const a = (i / 6) * Math.PI;
      const sp = new THREE.Mesh(new THREE.CylinderGeometry(0.018, 0.018, 0.64, 4), handleMat);
      sp.rotation.z = Math.PI / 2;
      sp.rotation.y = a;
      wheelGroup.add(sp);
    }

    this.scene.scene.add(wheelGroup);
    group.add(wheelGroup);
    group.userData.wheelGroup = wheelGroup;
    group.userData.valveMode  = 'wheel';

    this.scene.scene.add(group);
    return group;
  }

  _createMCP(pos) {
    const group = new THREE.Group();
    const box = new THREE.Mesh(
      new THREE.BoxGeometry(0.3, 0.3, 0.1),
      new THREE.MeshStandardMaterial({ color: 0xcc0000, roughness: 0.4, metalness: 0.3, emissive: 0x440000, emissiveIntensity: 0.3 })
    );
    group.add(box);
    const glass = new THREE.Mesh(
      new THREE.PlaneGeometry(0.2, 0.2),
      new THREE.MeshStandardMaterial({ color: 0xff0000, transparent: true, opacity: 0.3, emissive: 0xff0000, emissiveIntensity: 0.4 })
    );
    glass.position.z = 0.051;
    group.add(glass);
    group.position.copy(pos);
    group.castShadow = true;
    this.scene.scene.add(group);
    this.mcpBox = group;
    return group;
  }

  // ── Spray ring — fixed pipe deluge ring around Tank 101-B ──
  // Full compound-scale water-deluge pipe network.
  // Covers both tanks with overhead ring mains, a perimeter ground-level supply header,
  // risers, and inward-angled spray nozzles.  All nozzle meshes go in sprayRingGroup so
  // they glow blue when the cooling-water step fires.
  _buildDelugeSystem() {
    const pipeMat = new THREE.MeshStandardMaterial({ color: 0x4a6a80, roughness: 0.38, metalness: 0.9 });
    const nozzleMat = new THREE.MeshStandardMaterial({
      color: 0xaa6611, roughness: 0.3, metalness: 0.88,
      emissive: new THREE.Color(0x000000), emissiveIntensity: 0,
    });
    const stanchMat = new THREE.MeshStandardMaterial({ color: 0x363636, roughness: 0.55, metalness: 0.85 });

    const nozzleGroup = new THREE.Group();
    const S = this.scene.scene;

    // ── Pipe segment helper (arbitrary start → end, radius r) ──
    const P3 = (x, y, z) => new THREE.Vector3(x, y, z);
    const addPipe = (p1, p2, r = 0.065) => {
      const dir = new THREE.Vector3().subVectors(p2, p1);
      const len = dir.length();
      if (len < 0.05) return;
      const mid = new THREE.Vector3().addVectors(p1, p2).multiplyScalar(0.5);
      const mesh = new THREE.Mesh(new THREE.CylinderGeometry(r, r, len, 8, 1), pipeMat.clone());
      mesh.position.copy(mid);
      mesh.quaternion.setFromUnitVectors(P3(0, 1, 0), dir.normalize());
      S.add(mesh);
    };

    // Collar fitting — small wide cylinder at a junction point
    const addCollar = (x, y, z) => {
      const c = new THREE.Mesh(new THREE.CylinderGeometry(0.1, 0.1, 0.11, 10), pipeMat.clone());
      c.position.set(x, y, z);
      S.add(c);
    };

    // Vertical stanchion post (square hollow-look)
    const addPost = (x, z, h) => {
      const post = new THREE.Mesh(new THREE.CylinderGeometry(0.05, 0.05, h, 6), stanchMat.clone());
      post.position.set(x, h / 2, z);
      S.add(post);
      // Foot plate
      const foot = new THREE.Mesh(new THREE.BoxGeometry(0.18, 0.04, 0.18), stanchMat.clone());
      foot.position.set(x, 0.02, z);
      S.add(foot);
    };

    // Nozzle at world pos, rotated to aim INWARD + DOWNWARD toward tankCenter at 45°
    const addNozzle = (x, y, z, tankCX, tankCZ) => {
      const n = new THREE.Mesh(new THREE.CylinderGeometry(0.028, 0.06, 0.175, 6), nozzleMat.clone());
      n.position.set(x, y, z);
      // Point from nozzle toward tank center + downward component
      const inward = P3(tankCX - x, -1.4, tankCZ - z).normalize();
      n.quaternion.setFromUnitVectors(P3(0, 1, 0), inward);
      S.add(n);
      nozzleGroup.add(n);
    };

    // ═══════════════════════════════════════════════════════════════
    // 1. PERIMETER GROUND RING MAIN — inside dyke at Y=0.48
    //    Dyke interior: X[-40,+30], Z[-25,+25]
    // ═══════════════════════════════════════════════════════════════
    const RY = 0.48;
    // South leg
    addPipe(P3(-38, RY, -22), P3( 28, RY, -22));
    // North leg
    addPipe(P3(-38, RY,  22), P3( 28, RY,  22));
    // West leg
    addPipe(P3(-38, RY, -22), P3(-38, RY,  22));
    // East leg
    addPipe(P3( 28, RY, -22), P3( 28, RY,  22));
    // Corner collars
    [[-38, -22], [28, -22], [-38, 22], [28, 22]].forEach(([x, z]) => addCollar(x, RY, z));

    // Mid-compound cross feeds (T-branches south→north at tank X positions)
    addPipe(P3(-18, RY, -22), P3(-18, RY, -10));  // Tank A south branch feed
    addPipe(P3( 12, RY, -22), P3( 12, RY, -9));   // Tank B south branch feed
    addCollar(-18, RY, -22); addCollar(12, RY, -22);

    // North side feed branches (manifold / cooling valve area)
    addPipe(P3(-18, RY, 22), P3(-18, RY, 10));
    addPipe(P3( 12, RY, 22), P3( 12, RY, 9));
    addCollar(-18, RY, 22); addCollar(12, RY, 22);

    // ═══════════════════════════════════════════════════════════════
    // 2. TANK A DELUGE RING — fire tank (priority 1)
    //    Center (-18, 0, 0), ring radius 8.5m, ring height 4m
    // ═══════════════════════════════════════════════════════════════
    const A = { x: -18, z: 0 };
    const A_R = 8.5, A_H = 4.0;

    const ringA = new THREE.Mesh(new THREE.TorusGeometry(A_R, 0.075, 8, 80), pipeMat.clone());
    ringA.rotation.x = Math.PI / 2;
    ringA.position.set(A.x, A_H, A.z);
    S.add(ringA);

    // 6 vertical stanchions (every 60°, offset 15°)
    for (let i = 0; i < 6; i++) {
      const a = (i / 6) * Math.PI * 2 + Math.PI / 12;
      addPost(A.x + Math.cos(a) * A_R, A.z + Math.sin(a) * A_R, A_H);
      // Top cross-brace pipe connecting stanchion head to ring
      addCollar(A.x + Math.cos(a) * A_R, A_H, A.z + Math.sin(a) * A_R);
    }

    // 14 inward-angled spray nozzles
    for (let i = 0; i < 14; i++) {
      const a = (i / 14) * Math.PI * 2;
      addNozzle(A.x + Math.cos(a) * A_R, A_H - 0.07, A.z + Math.sin(a) * A_R, A.x, A.z);
    }

    // Risers from ground header up to ring height at south + north tangent positions
    addPipe(P3(A.x, RY, -10), P3(A.x, A_H, -10));     // south riser
    addPipe(P3(A.x, A_H, -10), P3(A.x, A_H, -A_R));   // horizontal to ring south tangent
    addPipe(P3(A.x, RY,  10), P3(A.x, A_H,  10));     // north riser
    addPipe(P3(A.x, A_H,  10), P3(A.x, A_H,  A_R));   // horizontal to ring north tangent
    [
      [A.x, A_H, -10], [A.x, A_H, 10],
      [A.x, A_H, -A_R], [A.x, A_H, A_R],
    ].forEach(([x, y, z]) => addCollar(x, y, z));
    addPost(A.x, -10, A_H);  // riser support post south
    addPost(A.x,  10, A_H);  // riser support post north

    // ═══════════════════════════════════════════════════════════════
    // 3. TANK B COOLING RING — adjacent tank (heat-radiation shield)
    //    Center (12, 0, 0), ring radius 8m, ring height 3.6m
    // ═══════════════════════════════════════════════════════════════
    const B = { x: 12, z: 0 };
    const B_R = 8.0, B_H = 3.6;

    const ringB = new THREE.Mesh(new THREE.TorusGeometry(B_R, 0.07, 8, 72), pipeMat.clone());
    ringB.rotation.x = Math.PI / 2;
    ringB.position.set(B.x, B_H, B.z);
    S.add(ringB);

    for (let i = 0; i < 5; i++) {
      const a = (i / 5) * Math.PI * 2 + Math.PI / 10;
      addPost(B.x + Math.cos(a) * B_R, B.z + Math.sin(a) * B_R, B_H);
      addCollar(B.x + Math.cos(a) * B_R, B_H, B.z + Math.sin(a) * B_R);
    }

    for (let i = 0; i < 12; i++) {
      const a = (i / 12) * Math.PI * 2;
      addNozzle(B.x + Math.cos(a) * B_R, B_H - 0.07, B.z + Math.sin(a) * B_R, B.x, B.z);
    }

    addPipe(P3(B.x, RY, -9),  P3(B.x, B_H, -9));
    addPipe(P3(B.x, B_H, -9), P3(B.x, B_H, -B_R));
    addPipe(P3(B.x, RY, 9),   P3(B.x, B_H, 9));
    addPipe(P3(B.x, B_H, 9),  P3(B.x, B_H, B_R));
    addPost(B.x, -9, B_H);
    addPost(B.x,  9, B_H);

    // ═══════════════════════════════════════════════════════════════
    // 4. OVERHEAD CROSS HEADER — connects Tank A ring to Tank B ring
    //    Runs at Y=4.5m, Z=0, X from -18 to +12
    //    Supported by a mid-span stanchion at X=-3
    // ═══════════════════════════════════════════════════════════════
    const OH = 4.55;
    addPipe(P3(A.x, OH, 0), P3(B.x, OH, 0), 0.06);
    addPost(-3, 0, OH);       // central support
    addCollar(-3, OH, 0);
    // Rise-up pipes from ring tops to overhead header
    addPipe(P3(A.x, A_H, 0), P3(A.x, OH, 0), 0.055);
    addPipe(P3(B.x, B_H, 0), P3(B.x, OH, 0), 0.055);
    addCollar(A.x, OH, 0);
    addCollar(B.x, OH, 0);

    // Additional overhead laterals (south side): adds visual weight and coverage
    addPipe(P3(A.x, OH, -4), P3(B.x, OH, -4), 0.052);
    addPipe(P3(A.x, OH,  4), P3(B.x, OH,  4), 0.052);
    // Lateral drops from overhead to ring level
    addPipe(P3(-3, OH, -4), P3(-3, A_H, -4), 0.048);
    addPipe(P3(-3, OH,  4), P3(-3, A_H,  4), 0.048);

    // ═══════════════════════════════════════════════════════════════
    // 5. STANCHION ROWS along south header — every 8m for visual realism
    // ═══════════════════════════════════════════════════════════════
    [-30, -22, -10, -2, 6, 20].forEach(x => {
      addPost(x, -22, 1.4); // lightweight marker posts along south ring main
    });

    S.add(nozzleGroup);
    this.sprayRingGroup = nozzleGroup;
  }

  // ── Hydrant operating nut / pentagon wrench socket ──────
  // A visible pentagonal cap + T-bar handle on top of each interactive hydrant.
  // Registered as a valve wheel so fx.spinValve() rotates it during connect_hose step.
  _buildHydrantHandle(hydrantPos, topHeight = 0.70) {
    const group = new THREE.Group();

    const capMat = new THREE.MeshStandardMaterial({
      color: 0xcc2200, roughness: 0.35, metalness: 0.8, emissive: new THREE.Color(0x1a0000),
    });
    const chromeMat = new THREE.MeshStandardMaterial({
      color: 0xaaaaaa, roughness: 0.2, metalness: 0.95,
    });

    // Pentagonal operating nut (approximated as short cylinder)
    const nut = new THREE.Mesh(new THREE.CylinderGeometry(0.055, 0.06, 0.07, 5), capMat);
    nut.position.set(hydrantPos.x, topHeight, hydrantPos.z);
    this.scene.scene.add(nut);
    group.add(nut);

    // T-bar wrench arms (simulate the hydrant wrench already attached)
    const armGeo = new THREE.BoxGeometry(0.32, 0.025, 0.025);
    const arm1 = new THREE.Mesh(armGeo, chromeMat);
    arm1.position.set(0, topHeight + 0.045, 0);
    const arm2 = new THREE.Mesh(armGeo, chromeMat);
    arm2.rotation.y = Math.PI / 2;
    arm2.position.set(0, topHeight + 0.045, 0);

    // Group them together so the whole thing rotates as one valve wheel
    const wheelGroup = new THREE.Group();
    wheelGroup.add(arm1, arm2);
    wheelGroup.position.set(hydrantPos.x, 0, hydrantPos.z);
    wheelGroup.userData.wheelGroup = wheelGroup; // self-reference for fx registration
    this.scene.scene.add(wheelGroup);
    group.add(wheelGroup);

    group.userData.wheelGroup = wheelGroup;
    group.position.set(hydrantPos.x, 0, hydrantPos.z);
    this.scene.scene.add(group);
    return group;
  }

  _createScorchDecals() {
    const loader = new THREE.TextureLoader();
    const scorchTextures = [scorch1(), scorch2(), scorch3()];
    const placements = [
      { pos: new THREE.Vector3(POSITIONS.TANK_A.x, 0.08, POSITIONS.TANK_A.z),      scale: 14, rot: 0,           tex: 0 },
      { pos: new THREE.Vector3(POSITIONS.TANK_A.x + 4, 0.07, POSITIONS.TANK_A.z - 3), scale: 8,  rot: 0.8,        tex: 1 },
      { pos: new THREE.Vector3(POSITIONS.TANK_A.x - 3, 0.07, POSITIONS.TANK_A.z + 5), scale: 6,  rot: -0.5,       tex: 2 },
      { pos: new THREE.Vector3(POSITIONS.TANK_A.x,     0.07, POSITIONS.TANK_A.z + 7), scale: 7,  rot: 1.2,        tex: 0 },
    ];

    this._scorchDecals = [];
    placements.forEach(({ pos, scale, rot, tex }) => {
      const geo = new THREE.PlaneGeometry(scale, scale);
      geo.rotateX(-Math.PI / 2);
      const mat = new THREE.MeshBasicMaterial({
        map: scorchTextures[tex],
        transparent: true,
        opacity: 0,
        depthWrite: false,
        blending: THREE.MultiplyBlending,
      });
      const mesh = new THREE.Mesh(geo, mat);
      mesh.rotation.y = rot;
      mesh.position.copy(pos);
      this.scene.scene.add(mesh);
      this._scorchDecals.push(mesh);
    });
  }

  _fadeInScorchDecals() {
    if (!this._scorchDecals) return;
    let opacity = 0;
    const tick = () => {
      opacity = Math.min(0.85, opacity + 0.004);
      this._scorchDecals.forEach((d, i) => {
        d.material.opacity = opacity * (0.7 + i * 0.08);
      });
      if (opacity < 0.85) requestAnimationFrame(tick);
    };
    tick();
  }

  _createMEFG(pos) {
    const group = new THREE.Group();
    const bodyMat = new THREE.MeshStandardMaterial({ color: 0xcc4400, roughness: 0.5, metalness: 0.4 });
    const frameMat = new THREE.MeshStandardMaterial({ color: 0x333333, roughness: 0.4, metalness: 0.7 });
    // Trolley frame
    const frame = new THREE.Mesh(new THREE.BoxGeometry(0.8, 0.6, 1.2), frameMat);
    frame.position.y = 0.3;
    frame.castShadow = true;
    group.add(frame);
    // Generator body (cylinder)
    const body = new THREE.Mesh(new THREE.CylinderGeometry(0.25, 0.25, 0.9, 8), bodyMat);
    body.position.y = 0.8;
    body.rotation.z = Math.PI / 2;
    body.castShadow = true;
    group.add(body);
    // Nozzle cone
    const nozzle = new THREE.Mesh(new THREE.ConeGeometry(0.15, 0.4, 6), bodyMat);
    nozzle.position.set(0, 0.8, 0.7);
    nozzle.rotation.x = Math.PI / 2;
    group.add(nozzle);
    // Wheels
    const wheelMat = new THREE.MeshStandardMaterial({ color: 0x111111, roughness: 0.8 });
    for (const xOff of [-0.35, 0.35]) {
      const wheel = new THREE.Mesh(new THREE.CylinderGeometry(0.12, 0.12, 0.06, 8), wheelMat);
      wheel.position.set(xOff, 0.12, -0.4);
      wheel.rotation.x = Math.PI / 2;
      group.add(wheel);
    }
    group.position.copy(pos);
    this.scene.scene.add(group);
    return group;
  }

  _createTrigger(pos, data, radius = 2.5) {
    const mesh = new THREE.Mesh(
      new THREE.SphereGeometry(radius, 8, 6),
      new THREE.MeshBasicMaterial({ visible: false })
    );
    mesh.position.copy(pos);
    this.scene.scene.add(mesh);
    this.interaction.register(mesh, data);
    return mesh;
  }

  _createFirefighter(position, rotY = 0) {
    this.npcManager?.spawn(position, rotY, 2.5);
  }

  _createHose(from, to, color = 0xcc2222) {
    const midZ = (from.z + to.z) / 2;
    const midX = (from.x + to.x) / 2;
    const points = [
      new THREE.Vector3(from.x, 0.15, from.z),
      new THREE.Vector3(from.x + (midX - from.x) * 0.3, 0.08, from.z + (midZ - from.z) * 0.4),
      new THREE.Vector3(midX, 0.05, midZ),
      new THREE.Vector3(to.x - (midX - to.x) * 0.3, 0.08, to.z - (midZ - to.z) * 0.4),
      new THREE.Vector3(to.x, 0.15, to.z),
    ];
    const curve = new THREE.CatmullRomCurve3(points);
    const geo = new THREE.TubeGeometry(curve, 24, 0.04, 6, false);
    const mat = new THREE.MeshStandardMaterial({ color, roughness: 0.6 });
    const mesh = new THREE.Mesh(geo, mat);
    mesh.castShadow = true;
    mesh.visible = false;
    this.scene.scene.add(mesh);
    this.hoses.push(mesh);
    return mesh;
  }

  // ── Collisions ─────────────────────────────────────────

  _setupCollisions() {
    const ht = 0.3; // half thickness
    const wallH = 1.8;
    // Dyke: cx=-5, cz=0, width=70 (x: -40..30), depth=50 (z: -25..25)
    // Each wall has 2 x 5m gaps, splitting it into 3 segments.
    // Gap centres on horizontal walls (N/S): x ≈ -17 and x ≈ 7
    // Gap centres on vertical walls   (W/E): z ≈ -8  and z ≈ 8

    // North wall (z = -25)
    this.collision.addBox({ x: -29.75, y: wallH, z: -25 }, { x: 10.25, y: wallH, z: ht }, 'N1');
    this.collision.addBox({ x: -5,     y: wallH, z: -25 }, { x:  9.5,  y: wallH, z: ht }, 'N2');
    this.collision.addBox({ x:  19.75, y: wallH, z: -25 }, { x: 10.25, y: wallH, z: ht }, 'N3');

    // South wall (z = 25)
    this.collision.addBox({ x: -29.75, y: wallH, z: 25 }, { x: 10.25, y: wallH, z: ht }, 'S1');
    this.collision.addBox({ x: -5,     y: wallH, z: 25 }, { x:  9.5,  y: wallH, z: ht }, 'S2');
    this.collision.addBox({ x:  19.75, y: wallH, z: 25 }, { x: 10.25, y: wallH, z: ht }, 'S3');

    // West wall (x = -40)
    this.collision.addBox({ x: -40, y: wallH, z: -17.75 }, { x: ht, y: wallH, z: 7.25 }, 'W1');
    this.collision.addBox({ x: -40, y: wallH, z:   0    }, { x: ht, y: wallH, z: 5.5  }, 'W2');
    this.collision.addBox({ x: -40, y: wallH, z:  17.75 }, { x: ht, y: wallH, z: 7.25 }, 'W3');

    // East wall (x = 30)
    this.collision.addBox({ x: 30, y: wallH, z: -17.75 }, { x: ht, y: wallH, z: 7.25 }, 'E1');
    this.collision.addBox({ x: 30, y: wallH, z:   0    }, { x: ht, y: wallH, z: 5.5  }, 'E2');
    this.collision.addBox({ x: 30, y: wallH, z:  17.75 }, { x: ht, y: wallH, z: 7.25 }, 'E3');

    this.collision.addCylinder(POSITIONS.TANK_A, 5.5);
    this.collision.addCylinder(POSITIONS.TANK_B, 5.5);

    this.collision.addBox({ x: 25, y: 3, z: 42 }, { x: 3, y: 3, z: 2 }, 'shed');

    // East enclosure tanks
    this.collision.addCylinder({ x: 50, z: -8 }, 4);
    this.collision.addCylinder({ x: 60, z: 8 }, 3.5);
    // East enclosure walls
    this.collision.addBox({ x: 55, y: 1.5, z: -18 }, { x: 15, y: 1.5, z: 0.25 });
    this.collision.addBox({ x: 55, y: 1.5, z: 18 }, { x: 15, y: 1.5, z: 0.25 });
    this.collision.addBox({ x: 40, y: 1.5, z: 0 }, { x: 0.25, y: 1.5, z: 18 });
    this.collision.addBox({ x: 70, y: 1.5, z: 0 }, { x: 0.25, y: 1.5, z: 18 });

    // West enclosure tanks
    this.collision.addCylinder({ x: -55, z: -42 }, 4);
    this.collision.addCylinder({ x: -62, z: -32 }, 3.5);
    // West enclosure walls
    this.collision.addBox({ x: -58, y: 1.5, z: -53 }, { x: 13, y: 1.5, z: 0.25 });
    this.collision.addBox({ x: -58, y: 1.5, z: -23 }, { x: 13, y: 1.5, z: 0.25 });
    this.collision.addBox({ x: -71, y: 1.5, z: -38 }, { x: 0.25, y: 1.5, z: 15 });
    this.collision.addBox({ x: -45, y: 1.5, z: -38 }, { x: 0.25, y: 1.5, z: 15 });

    // Bollards
    [[-40, 26], [-40, 34], [30, 26], [30, 34],
     [-15, 26], [-15, 34], [7, 26], [7, 34],
     [32, 30], [38, 30], [32, 55], [38, 55]]
      .forEach(([x, z]) => this.collision.addCylinder({ x, z }, 0.15));

    this.player.collisionSystem = this.collision;
  }

  // ── Equipment ──────────────────────────────────────────

  _setupEquipment() {
    this.equipment.createProceduralRadio();
    this.equipment.createProceduralNozzle();
  }

  // ── Interactions ───────────────────────────────────────

  _setupInteractables() {
    // Side-effect table: actions to fire when specific steps complete
    this._stepSideEffects = {
      close_roof_drain: {
        notification: 'ROOF DRAIN VALVE CLOSED',
        narration: { speaker: 'OPERATOR', text: 'Roof drain closed. Now close the Dyke Valve to ensure containment of oil inside the dyke area. Head to the west wall of the bund.' },
        valveGroup: this.roofDrainValve,
        valveDirection: 'cw',
        fn: () => {
          this.water.stopPoolGrowth();
          this.worldAnims.animateEmissivePulse(this.roofDrainValve, 0x44ff44, 1.5);
        },
      },
      close_dyke_valve: {
        notification: 'DYKE VALVE CLOSED — CONTAINMENT ACTIVE',
        narration: { speaker: 'OPERATOR', text: 'Dyke containment sealed. Oil retained inside dyke area. Head to the manifold to stop all receipt/dispense/transfer operations and isolate Tank 101-A.' },
        valveGroup: this.dykeValve,
        valveDirection: 'cw',
        fn: () => {
          this.worldAnims.animateEmissivePulse(this.dykeValve, 0x44ff44, 1.5);
        },
      },
      isolate_manifold: {
        notification: 'OPERATIONS STOPPED — TANK ISOLATED AT MANIFOLD',
        narration: { speaker: 'OPERATOR', text: 'All operations stopped. Tank 101-A isolated at manifold. Now inform Fire & Safety at 333/444/3576 or VHF Channel 8. Run to the control station and grab the emergency radio.' },
        valveGroup: this.manifoldWheel,
        valveDirection: 'cw',
        fn: () => {
          if (this.valve1) this.worldAnims.animateEmissivePulse(this.valve1, 0x44ff44, 1.5);
        },
      },
      open_cooling_valve: {
        notification: 'COOLING WATER ISOLATION VALVE OPENED — TANK 101-B',
        narration: { speaker: 'OPERATOR', text: 'Cooling water active on Tank 101-B. Water shielding from heat radiation operational. Now coordinate product transfer from the affected tank. Use the radio — press R.' },
        valveGroup: this.coolingValve,
        valveDirection: 'ccw',
        fn: () => {
          this.fx.activateSpray();
          this.water.startCooling();
          this.worldAnims.animateEmissivePulse(this.coolingValve, 0x4488ff, 1.5);
        },
      },
      start_product_transfer: {
        notification: 'PRODUCT TRANSFER INITIATED — TANK 101-A',
        narration: { speaker: 'CONTROL ROOM', text: 'Product transfer from Tank 101-A authorized in consultation with senior operation personnel. Receiving tank has sufficient ullage. Operations response complete — await first turnout.' },
      },
      position_tender_1: {
        notification: 'FIRE TENDER POSITIONED AT H-28',
        narration: { speaker: 'SIC', text: 'Tender parked at Hydrant H-28. Crew connecting two 15m hose lines. Hydrant H-27 used for foam to HVLRM. Open the hydrant supply valve next.' },
      },
      connect_hose_1: {
        notification: 'HYDRANT H-28 — WATER FLOWING',
        narration: { speaker: 'SIC', text: 'Water supply active. JRCP connected to HVLRM 10/12 to supply finished foam on top of the tank. Now open isolation valves for water spray on Tank 101-B.' },
        fn: () => {
          // Animated hose extending from hydrant to truck
          this.worldAnims.animateHoseExtend(
            new THREE.Vector3(POSITIONS.HYDRANT_H28.x, 0.8, POSITIONS.HYDRANT_H28.z),
            new THREE.Vector3(POSITIONS.FIRE_TRUCK_1.x, 0.5, POSITIONS.FIRE_TRUCK_1.z),
            2.5, 0xcc2222
          );
          if (this.hoseModelH28) this.worldAnims.animatePopIn(this.hoseModelH28, 0.8);
          // Monitor pops in and pivots toward tank
          if (this.monitorH28) {
            this.worldAnims.animatePopIn(this.monitorH28, 0.6);
            this.worldAnims.animatePivotToFace(this.monitorH28, POSITIONS.TANK_A, 1.5);
          }
          this.water.startFoamJet('jet_h28');
          this.water.growFoamBlanket(0.4);
          this.fire.setIntensity(0.7);
        },
      },
      open_spray_101b: {
        notification: 'ISOLATION VALVES OPEN — WATER SPRAY ACTIVE ON 101-B',
        narration: { speaker: 'SIC', text: 'Water spray system active on Tank 101-B. Monitoring temperature. SIC will contact control room for 2nd turnout with HEFG & trolley-mounted foam monitor. Press R, Channel 8.' },
        fn: () => {
          this.fx.activateSpray();
          if (this.sprayRingGroup) {
            this.sprayRingGroup.traverse(m => {
              if (m.isMesh && m.material.emissive) {
                m.material.emissive.setHex(0x003366);
                m.material.emissiveIntensity = 0.6;
              }
            });
          }
        },
      },
      position_tender_2: {
        notification: '2ND TENDER POSITIONED AT H-20',
        narration: { speaker: 'SIC', text: 'Second tender parked close to Hydrant 12/H-20 along Road 12. HEFG and trolley-mounted foam monitor deployed. Open the supply valve and connect hoses.' },
      },
      connect_hose_2: {
        notification: 'HYDRANT H-20 — WATER FLOWING',
        narration: { speaker: 'SIC', text: 'Water active. JRCP connected to HVLRM 12/04 to supply finished foam on top of tank. MEFG at Roads 10 & 12 supplying foam to dyke area. SIC will request foam nurser — press R.' },
        fn: () => {
          this.worldAnims.animateHoseExtend(
            new THREE.Vector3(POSITIONS.HYDRANT_H20.x, 0.8, POSITIONS.HYDRANT_H20.z),
            new THREE.Vector3(POSITIONS.FIRE_TRUCK_2.x, 0.5, POSITIONS.FIRE_TRUCK_2.z),
            2.5, 0x2244aa
          );
          if (this.hoseModelH20) this.worldAnims.animatePopIn(this.hoseModelH20, 0.8);
          if (this.monitorH20) {
            this.worldAnims.animatePopIn(this.monitorH20, 0.6);
            this.worldAnims.animatePivotToFace(this.monitorH20, POSITIONS.TANK_A, 1.5);
          }
          this.water.startFoamJet('jet_h20');
          this.water.growFoamBlanket(0.8);
          this.fire.setIntensity(0.35);
        },
      },
      check_boilover: {
        notification: 'INSPECTION COMPLETE: Paint discoloration at 4m — boil-over risk LOW',
      },
    };

    // Map stepIds to their 3D valve groups for live rotation sync
    this._stepToValve = {
      close_roof_drain: this.roofDrainValve,
      close_dyke_valve: this.dykeValve,
      isolate_manifold: this.manifoldWheel,
      open_cooling_valve: this.coolingValve,
      connect_hose_1: this.hydrantH28Wheel || null,
      connect_hose_2: this.hydrantH20Wheel || null,
    };

    // ── Direct valve grab mode ───────────────────────────────────────────
    // When a rotate step activates, the panel hides and the player grabs
    // the 3D valve directly with the mouse.

    this.actionPanel.onRotateStepStart = (direction, rotations, stepId) => {
      const valveGroup = this._stepToValve[stepId];
      const entry = valveGroup
        ? this.fx.valveWheels.find(v => v.group === valveGroup)
        : null;

      let accAngle = 0;
      const spinSign = direction === 'ccw' ? 1 : -1;

      // Grab drag uses clientX delta — cursor must be VISIBLE, so release pointer lock
      document.exitPointerLock();

      this.player.grabMode    = true;
      this.player._grabDown   = false;
      this.player._grabPrevX  = null;
      // Levers rotate Z (arm tips upward, quarter-turn).  Wheels rotate Y (spin freely).
      const isLever = entry?.mode === 'lever';

      this.player.onGrabDelta = (dx) => {
        // 0.018 rad/px — comfortable drag sensitivity
        const delta = Math.abs(dx) * 0.018;
        if (delta === 0) return;

        // Rotate 3D handle on the correct axis
        if (entry?.wheel) {
          if (isLever) {
            // Lever: always advances from 0 → π/2 on Z regardless of drag direction.
            // 'cw' means arm tips upward (positive Z) — no sign inversion needed.
            entry.wheel.rotation.z = Math.min(Math.PI / 2, entry.wheel.rotation.z + delta);
          } else {
            // Wheel: spinSign drives the visual CW/CCW direction freely — NO floor clamp.
            // CW steps (spinSign=-1): right-drag decreases Y → visual CW from player's view.
            // CCW steps (spinSign=+1): right-drag increases Y → visual CCW.
            entry.wheel.rotation.y += spinSign * (dx > 0 ? 1 : -1) * delta;
          }
        }

        accAngle += delta;
        this.actionPanel.accumulateDrag(accAngle);
      };
    };

    this.actionPanel.onRotateStepEnd = () => {
      this.player.grabMode    = false;
      this.player.onGrabDelta = null;
      this.player._grabDown   = false;
      this.player._grabPrevX  = null;
      // After grab, next step is a choice panel — cursor stays free (no lock needed)
    };

    // ActionPanel cancel handler (ESC) — reset _panelOpen so user can re-trigger
    this.actionPanel.onCancel = (stepId) => {
      for (const item of this.interaction.interactables) {
        if (item.data.stepId === stepId) item.data._panelOpen = false;
      }
      this.canvas.requestPointerLock();
    };

    // ActionPanel completion handler
    this.actionPanel.onComplete = (stepId) => {
      const fx = this._stepSideEffects[stepId];
      if (!fx) return;
      // Mark the interaction data as completed
      for (const item of this.interaction.interactables) {
        if (item.data.stepId === stepId) item.data.completed = true;
      }
      if (fx.notification) this.ui.showNotification(fx.notification);
      if (fx.narration) this.ui.showNarration(fx.narration.speaker, fx.narration.text, 8000);
      if (fx.valveGroup) this.fx.spinValve(fx.valveGroup, fx.valveDirection || 'cw');
      if (fx.fn) fx.fn();
      this.scoring.recordStep(stepId);
      this.scenario.completeStep(stepId);
      this.canvas.requestPointerLock();
    };

    // All physical interactions are SIMPLE clicks that open the ActionPanel
    this.interaction.register(this.roofDrainValve, {
      type: InteractionType.SIMPLE,
      stepId: 'close_roof_drain', prompt: 'ROOF DRAIN VALVE', hint: 'Click to operate',
    });

    this.interaction.register(this.dykeValve, {
      type: InteractionType.SIMPLE,
      stepId: 'close_dyke_valve', prompt: 'DYKE CONTAINMENT VALVE', hint: 'Click to operate',
    });

    if (this.valve1) {
      this.interaction.register(this.valve1, {
        type: InteractionType.SIMPLE,
        stepId: 'isolate_manifold', prompt: 'MANIFOLD ISOLATION VALVE', hint: 'Click to operate',
      });
    }

    this._createTrigger(new THREE.Vector3(25, 1.1, 42), {
      type: InteractionType.PICKUP,
      stepId: 'alert_fire_safety', prompt: 'EMERGENCY RADIO', hint: 'Click to pick up radio',
      notification: 'RADIO ACQUIRED',
      equipItem: 'radio',
    });

    this.interaction.register(this.coolingValve, {
      type: InteractionType.SIMPLE,
      stepId: 'open_cooling_valve', prompt: 'COOLING WATER — TANK 101-B', hint: 'Click to operate',
    });

    // Triggers AT the hydrant positions (not on the road where trucks park)
    this._createTrigger(new THREE.Vector3(POSITIONS.HYDRANT_H28.x, 1, POSITIONS.HYDRANT_H28.z), {
      type: InteractionType.SIMPLE,
      stepId: 'position_tender_1', prompt: 'HYDRANT H-28 — DIRECT FIRE TENDER', hint: 'Click to begin',
    });

    this._createTrigger(new THREE.Vector3(POSITIONS.HYDRANT_H28.x, 1, POSITIONS.HYDRANT_H28.z + 1), {
      type: InteractionType.SIMPLE,
      stepId: 'connect_hose_1', prompt: 'HYDRANT H-28 — OPEN SUPPLY', hint: 'Click to begin',
    });

    // Spray ring trigger — at the valve post near Tank 101-B (visible object)
    this._createTrigger(new THREE.Vector3(POSITIONS.COOLING_VALVE.x + 3, 1, POSITIONS.COOLING_VALVE.z), {
      type: InteractionType.SIMPLE,
      stepId: 'open_spray_101b', prompt: 'TANK 101-B SPRAY RING', hint: 'Click to inspect',
    });

    this._createTrigger(new THREE.Vector3(POSITIONS.HYDRANT_H20.x, 1, POSITIONS.HYDRANT_H20.z), {
      type: InteractionType.SIMPLE,
      stepId: 'position_tender_2', prompt: 'HYDRANT H-20 — DIRECT 2ND TENDER', hint: 'Click to begin',
    });

    this._createTrigger(new THREE.Vector3(POSITIONS.HYDRANT_H20.x + 1, 1, POSITIONS.HYDRANT_H20.z), {
      type: InteractionType.SIMPLE,
      stepId: 'connect_hose_2', prompt: 'HYDRANT H-20 — OPEN SUPPLY', hint: 'Click to begin',
    });

    // Boilover inspection — trigger zone south of Tank 101-A, outside the collision cylinder (r=6.5)
    this._createTrigger(new THREE.Vector3(POSITIONS.TANK_A.x, 1.5, POSITIONS.TANK_A.z + 10), {
      type: InteractionType.SIMPLE,
      stepId: 'check_boilover', prompt: 'INSPECT TANK SHELL', hint: 'Click to inspect',
    }, 4);
  }

  // ── Audio ──────────────────────────────────────────────

  _setupAudio() {
    this.audio.createSound('fire_alarm', this.loader.getBuffer('fire_alarm'), { loop: true, volume: 0.3 });
    this.audio.createSound('evacuation_alarm', this.loader.getBuffer('evacuation_alarm'), { loop: true, volume: 0.2 });
    this.audio.createSound('fire_burning', this.loader.getBuffer('fire_burning'), { loop: true, volume: 0.5 });
    this.audio.createSound('radio_static', this.loader.getBuffer('radio_static'), { loop: false, volume: 0.25 });
    this.audio.createSound('valve_turn', this.loader.getBuffer('valve_turn'), { loop: false, volume: 0.4 });
    this.audio.createSound('truck_siren', this.loader.getBuffer('truck_siren'), { loop: false, volume: 0.5 });
    this.audio.createSound('valve_steam', this.loader.getBuffer('valve_steam'), { loop: false, volume: 0.3 });
    this.audio.createSound('valve_grind', this.loader.getBuffer('valve_grind'), { loop: false, volume: 0.2 });
  }

  // ── Fire & scenario ────────────────────────────────────

  _setupFire() {
    // y=6: plane base starts inside the tank sphere so the GLB geometry
    // naturally occludes the fire base — fire appears to erupt from the opening
    this.fire = new FireEffect(this.scene.scene, new THREE.Vector3(-18, 6, 0), 7);

    this._heatOverlay = document.getElementById('heat-overlay');

    this.scenario.onFireStart = () => {
      this.fire.start();
      this.fx.setFireActive(true);
      this.water.startPool();
      this._fadeInScorchDecals();

      // Screen shake on fire eruption
      const canvas = document.getElementById('viewport');
      canvas.classList.add('screen-shake');
      setTimeout(() => canvas.classList.remove('screen-shake'), 700);
    };

    this.scenario.onComplete = (score) => {
      this.fire.stop();
      this.fx.setFireActive(false);
      this.tts.speak('Simulation complete. Well done, operator. Review your performance score on screen.');
      this.scene.setFireActive(false);

      // Enhanced scoring with leaderboard
      const gradeData = this.scoring.getGrade();
      this.scoring.saveToLeaderboard('Operator');
      score.rows.push({ label: 'SCORE', value: `${gradeData.score}/100` });
      score.rows.push({ label: 'GRADE', value: gradeData.grade });

      this.ui.showScore(score);
      this.player.disable();
      this.waypoints.clearActive();
      this.saveSystem.clear();
      document.exitPointerLock();

      // GSAP score reveal
      gsap.from('#score-screen', { opacity: 0, y: 30, duration: 0.8, ease: 'power2.out' });
    };

    this.scenario.onStepActivated = (stepId) => this._onStepActivated(stepId);

    const DUCK_SOUNDS = ['fire_alarm', 'evacuation_alarm', 'fire_burning'];
    this.ui.onNarrationStart = () => this.audio.duck(DUCK_SOUNDS, 0.05, 0.35);
    this.ui.onNarrationEnd   = () => this.audio.unduck(DUCK_SOUNDS, 0.6);

    this.scenario.onPhaseChange = (phase) => {
      if (phase === 'FIRST_TURNOUT' && this.fireTruck1) {
        this._startTruckDriveIn(this.fireTruck1, TRUCK1_START, POSITIONS.FIRE_TRUCK_1, Math.PI / 2, () => {
          this._spawnNPCs('h28');
        });
      }
      if (phase === 'SECOND_TURNOUT' && this.fireTruck2) {
        this._startTruckDriveIn(this.fireTruck2, TRUCK2_START, POSITIONS.FIRE_TRUCK_2, -Math.PI / 2, () => {
          this._spawnNPCs('h20');
        });
      }
    };

    this.scenario.onSimpleComplete = (data) => {
      // Hose system interactions — bypass normal panel/step flow
      if (data.hoseAction === 'pickup') {
        data._panelOpen = false;
        if (this.hoseSystem && this.hoseSystem.getState() === 'idle') {
          this.hoseSystem.pickup();
          this.ui.showNotification('HOSE PICKED UP — Walk to hydrant H-28 to connect', 4000);
          data.completed = true;
        }
        return;
      }
      if (data.hoseAction === 'hydrant') {
        data._panelOpen = false;
        if (!this.hoseSystem) return;
        const st = this.hoseSystem.getState();
        if (st === 'carrying') {
          this.hoseSystem.attach(POSITIONS.HYDRANT_H28);
          this.ui.showNotification('HOSE CONNECTED — Click hydrant again to pressurize', 4000);
        } else if (st === 'attached') {
          this.hoseSystem.charge();
          this.ui.showNotification('HOSE PRESSURIZED — Hold CLICK to spray, aim at fire', 5000);
          data.completed = true;
        }
        return;
      }

      if (data.equipItem === 'radio') {
        this.equipment.equip('radio');
        this.ui.addEquipSlot('radio', 'RADIO');
        if (this.radioObj) this.radioObj.visible = false;

        this.radioPanel.setEquipped(true);

        this.radioPanel.onTransmit = (msg) => {
          this.scenario.handleRadioMessage(msg);
          setTimeout(() => {
            const updated = this.scenario.getAvailableRadioMessages();
            if (updated.length > 0) {
              this.radioPanel.setMessages(updated[0].stepId, updated);
            }
          }, 2500);
        };

        this.radioPanel.onClose = () => {
          this.canvas.requestPointerLock();
        };

        setTimeout(() => {
          const msgs = this.scenario.getAvailableRadioMessages();
          if (msgs.length > 0) {
            this.radioPanel.open(msgs[0].stepId, msgs);
          }
        }, 800);
        return;
      }

      // Route all other interactions to ActionPanel modal
      if (data.stepId && this.actionPanel.has(data.stepId)) {
        this.actionPanel.open(data.stepId);
      } else {
        if (data.onComplete) data.onComplete();
        if (data.stepId) this.scenario.completeStep(data.stepId);
      }
    };

    document.getElementById('score-restart').addEventListener('click', () => {
      window.location.reload();
    });
  }

  // ── Hose System ──────────────────────────────────────────

  _setupHoseSystem() {
    this.hoseSystem = new HoseSystem(this.scene.scene, this.scene.camera, this.fire);

    this.hoseSystem.onStateChange = (state) => {
      this._updateHoseHUD(state);
    };

    this.hoseSystem.onFireExtinguished = () => {
      this.ui.showNotification('FIRE EXTINGUISHED — FOAM BLANKET APPLIED', 5000);
      this.fire.stop();
      this.scene.setFireActive(false);
      this.scene.setAlarmActive(false);
    };

    // Build a visible hose rack near the nozzle area (south of dyke)
    this._buildHoseRack(POSITIONS.NOZZLE_AREA);

    // Register hose rack as interactable
    const hoseRackTrigger = new THREE.Mesh(
      new THREE.BoxGeometry(2, 2, 2),
      new THREE.MeshBasicMaterial({ visible: false })
    );
    hoseRackTrigger.position.copy(POSITIONS.NOZZLE_AREA);
    hoseRackTrigger.position.y = 1;
    this.scene.scene.add(hoseRackTrigger);
    this.interaction.register(hoseRackTrigger, {
      type: 'simple',
      prompt: 'FIRE HOSE',
      hint: 'Click to pick up hose',
      hoseAction: 'pickup',
    });

    // Register hydrant H-28 as hose attachment point
    const hydrantTrigger = new THREE.Mesh(
      new THREE.BoxGeometry(2, 2, 2),
      new THREE.MeshBasicMaterial({ visible: false })
    );
    hydrantTrigger.position.copy(POSITIONS.HYDRANT_H28);
    hydrantTrigger.position.y = 1;
    this.scene.scene.add(hydrantTrigger);
    this._hoseHydrantData = {
      type: 'simple',
      prompt: 'HYDRANT H-28',
      hint: 'Click to connect/pressurize',
      hoseAction: 'hydrant',
    };
    this.interaction.register(hydrantTrigger, this._hoseHydrantData);

    // Mouse controls for spray
    this.canvas.addEventListener('mousedown', (e) => {
      if (e.button !== 0) return;
      if (this.hoseSystem.getState() === 'charged') {
        this.hoseSystem.startSpraying();
      }
    });
    this.canvas.addEventListener('mouseup', () => {
      if (this.hoseSystem.getState() === 'spraying') {
        this.hoseSystem.stopSpraying();
      }
    });
  }

  _buildHoseRack(position) {
    const frameMat = new THREE.MeshStandardMaterial({ color: 0xcc2222, roughness: 0.5, metalness: 0.6 });
    const hoseMat = new THREE.MeshStandardMaterial({ color: 0xcc4422, roughness: 0.7 });

    // Frame box
    const frame = new THREE.Mesh(new THREE.BoxGeometry(1.2, 1.0, 0.3), frameMat);
    frame.position.set(position.x, 1.2, position.z);
    frame.castShadow = true;
    this.scene.scene.add(frame);

    // Coiled hose (torus)
    const coil = new THREE.Mesh(new THREE.TorusGeometry(0.3, 0.04, 8, 20), hoseMat);
    coil.position.set(position.x, 1.2, position.z + 0.18);
    coil.rotation.y = Math.PI / 2;
    this.scene.scene.add(coil);

    // Label
    const labelMat = new THREE.MeshStandardMaterial({
      color: 0xffffff, emissive: 0xffccaa, emissiveIntensity: 0.15,
    });
    const label = new THREE.Mesh(new THREE.BoxGeometry(1.0, 0.15, 0.02), labelMat);
    label.position.set(position.x, 1.8, position.z + 0.16);
    this.scene.scene.add(label);
  }

  _updateHoseHUD(state) {
    let hud = document.getElementById('hose-hud');
    if (!hud) {
      hud = document.createElement('div');
      hud.id = 'hose-hud';
      hud.style.cssText = `
        position:fixed; bottom:80px; left:50%; transform:translateX(-50%);
        background:rgba(0,0,0,0.7); color:#ffcc66; padding:8px 20px;
        font-family:monospace; font-size:13px; letter-spacing:1px;
        border:1px solid rgba(255,170,68,0.3); border-radius:4px;
        pointer-events:none; z-index:100; text-align:center;
        transition: opacity 0.3s;
      `;
      document.body.appendChild(hud);
    }

    const prompt = this.hoseSystem.getPrompt();
    if (!prompt) {
      hud.style.opacity = '0';
      return;
    }
    hud.style.opacity = '1';
    hud.innerHTML = `<span style="color:#ff8844">${prompt.label}</span> — ${prompt.hint}`;
  }

  // ── Truck drive-in ─────────────────────────────────────

  _startTruckDriveIn(truck, from, to, _unusedRotY, onArrival = null) {
    if (!truck) return;

    const groundY = truck.position.y;
    truck.position.set(from.x, groundY, from.z);
    // Auto-face direction of travel — atan2(dx, dz) gives Y rotation toward target
    const dx = to.x - from.x;
    const dz = to.z - from.z;
    truck.rotation.y = Math.atan2(dx, dz);
    truck.visible = true;

    // Headlight: mounted at cab height (local Y 1.5 ≈ real-world 3m+), aims forward in local space
    const headlight = new THREE.SpotLight(0xffffdd, 12, 120, Math.PI / 8, 0.4, 1.2);
    headlight.position.set(0, 1.5, 3.0);   // forward-of-centre, at cab roof height
    headlight.target.position.set(0, -0.5, 20); // aim slightly down and far ahead (local space)
    truck.add(headlight);
    truck.add(headlight.target);

    this.fx.createTruckLights(truck, from.x < 0 ? 'left' : 'right');

    this.audio.play('truck_siren');

    this.truckAnims.push({
      truck,
      from: new THREE.Vector3(from.x, groundY, from.z),
      to: new THREE.Vector3(to.x, groundY, to.z),
      elapsed: 0,
      duration: TRUCK_DRIVE_DURATION,
      headlight,
      done: false,
      onArrival,
    });
  }

  // ── NPC spawning ───────────────────────────────────────

  _spawnNPCs(group) {
    if (!this.npcManager) return;
    if (group === 'h28') {
      // Hose operator — runs from truck to hydrant, then kneels to connect
      this.npcManager.spawnRunTo(
        new THREE.Vector3(POSITIONS.FIRE_TRUCK_1.x, 0, POSITIONS.FIRE_TRUCK_1.z),
        new THREE.Vector3(POSITIONS.HYDRANT_H28.x + 1, 0, POSITIONS.HYDRANT_H28.z),
        'kneel', 'HOSE_OP_1'
      );
      // Nozzle operator — runs from truck to monitor position, stands idle aiming
      this.npcManager.spawnRunTo(
        new THREE.Vector3(POSITIONS.FIRE_TRUCK_1.x + 2, 0, POSITIONS.FIRE_TRUCK_1.z),
        new THREE.Vector3(-14, 0, 29),
        'idle', 'NOZZLE_OP_1'
      );
      // Driver stays at truck, patrols around it
      this.npcManager.spawn(
        new THREE.Vector3(POSITIONS.FIRE_TRUCK_1.x - 2, 0, POSITIONS.FIRE_TRUCK_1.z + 1),
        Math.PI * 0.5, 1.5, { role: 'DRIVER_1' }
      );
      // SIC arrives and kneels pointing at the fire
      this.npcManager.spawnRunTo(
        new THREE.Vector3(POSITIONS.FIRE_TRUCK_1.x - 4, 0, POSITIONS.FIRE_TRUCK_1.z - 2),
        new THREE.Vector3(-18, 0, 20),
        'kneel', 'SIC'
      );
    } else if (group === 'h20') {
      // Hose operator 2 — runs from truck 2 to hydrant H-20
      this.npcManager.spawnRunTo(
        new THREE.Vector3(POSITIONS.FIRE_TRUCK_2.x, 0, POSITIONS.FIRE_TRUCK_2.z),
        new THREE.Vector3(POSITIONS.HYDRANT_H20.x + 1, 0, POSITIONS.HYDRANT_H20.z),
        'kneel', 'HOSE_OP_2'
      );
      // Nozzle operator 2 — runs to HVLRM position
      this.npcManager.spawnRunTo(
        new THREE.Vector3(POSITIONS.FIRE_TRUCK_2.x - 2, 0, POSITIONS.FIRE_TRUCK_2.z),
        new THREE.Vector3(19, 0, 54),
        'idle', 'NOZZLE_OP_2'
      );
      // HEFG operator — runs to MEFG position
      this.npcManager.spawnRunTo(
        new THREE.Vector3(POSITIONS.FIRE_TRUCK_2.x + 2, 0, POSITIONS.FIRE_TRUCK_2.z),
        new THREE.Vector3(7, 0, 56),
        'kneel', 'HEFG_OP'
      );
    }
  }

  // ── Effects ────────────────────────────────────────────

  _setupEffects() {
    this.fx.createAlarmBeacons([
      new THREE.Vector3(-40, 2.5, 25),
      new THREE.Vector3(30, 2.5, 25),
      new THREE.Vector3(-40, 2.5, -25),
      new THREE.Vector3(30, 2.5, -25),
      new THREE.Vector3(0, 10.5, 30),
      new THREE.Vector3(0, 10.5, 55),
    ]);

    this.fx.createWaterSpray(POSITIONS.TANK_B, 8.0);
    this.fx.createDustParticles();

    // Visible spray ring structure on Tank 101-B — always present
    this._buildDelugeSystem();

    this.fx.registerValveWheel(this.roofDrainValve);
    this.fx.registerValveWheel(this.dykeValve);
    this.fx.registerValveWheel(this.coolingValve);
    if (this.manifoldWheel) this.fx.registerValveWheel(this.manifoldWheel);
    if (this.hydrantH28Wheel) this.fx.registerValveWheel(this.hydrantH28Wheel);
    if (this.hydrantH20Wheel) this.fx.registerValveWheel(this.hydrantH20Wheel);

    // Ground scorch decals under Tank 101-A (fade in when fire starts)
    this._createScorchDecals();

    // Cooling water cascade on Tank 101-B
    this.water.createCoolingCascade(POSITIONS.TANK_B, 5.5, 10);
    this.water.createSteamWisps(POSITIONS.TANK_B, 5.5);

    // Foam jets from HVLRM monitors to Tank 101-A roof
    const tankTopA = new THREE.Vector3(POSITIONS.TANK_A.x, 12, POSITIONS.TANK_A.z);
    this.water.createFoamJet(new THREE.Vector3(-14, 0, 29), tankTopA, 'jet_h28');
    this.water.createFoamJet(new THREE.Vector3(19, 0, 54), tankTopA, 'jet_h20');

    // Foam blanket on Tank 101-A top
    this.water.createFoamBlanket(POSITIONS.TANK_A, 8, 12);

    // Product pool inside dyke — grows until roof drain is closed
    this.water.createProductPool(new THREE.Vector3(-18, 0, 0), 12);
  }

  // ── Minimap & waypoints ────────────────────────────────

  _setupMinimap() {
    this.minimap.addLandmark(POSITIONS.TANK_A, 'tank_fire', 'Tank 101-A');
    this.minimap.addLandmark(POSITIONS.TANK_B, 'tank', 'Tank 101-B');
    this.minimap.addLandmark(POSITIONS.HYDRANT_H28, 'hydrant', 'H-28');
    this.minimap.addLandmark(POSITIONS.HYDRANT_H27, 'hydrant', 'H-27');
    this.minimap.addLandmark(POSITIONS.HYDRANT_H20, 'hydrant', 'H-20');
    this.minimap.addLandmark(POSITIONS.ROOF_DRAIN, 'valve', 'Roof Drain');
    this.minimap.addLandmark(POSITIONS.DYKE_VALVE, 'valve', 'Dyke Valve');
    this.minimap.addLandmark(POSITIONS.COOLING_VALVE, 'valve', 'Cooling');
    this.minimap.addLandmark(POSITIONS.MANIFOLD, 'valve', 'Manifold');
    this.minimap.addLandmark(POSITIONS.RADIO, 'radio', 'Radio');
    this.minimap.addLandmark(POSITIONS.CONTROL, 'control', 'Control');
    this.minimap.addLandmark(new THREE.Vector3(50, 0, -8), 'tank', 'TT-FR-104C');
    this.minimap.addLandmark(new THREE.Vector3(60, 0, 8), 'tank', 'TT-FR-102A');
  }

  _setupWaypoints() {
    this.waypoints.register('close_roof_drain', POSITIONS.ROOF_DRAIN, 'ROOF DRAIN VALVE');
    this.waypoints.register('close_dyke_valve', POSITIONS.DYKE_VALVE, 'DYKE VALVE');
    this.waypoints.register('isolate_manifold', POSITIONS.MANIFOLD, 'MANIFOLD ISOLATION');
    this.waypoints.register('alert_fire_safety', POSITIONS.RADIO, 'EMERGENCY RADIO');
    this.waypoints.register('report_tank_data', POSITIONS.RADIO, 'RADIO: REPORT DATA');
    this.waypoints.register('open_cooling_valve', POSITIONS.COOLING_VALVE, 'COOLING VALVE 101-B');
    this.waypoints.register('start_product_transfer', POSITIONS.RADIO, 'RADIO: PRODUCT TRANSFER');
    this.waypoints.register('position_tender_1', POSITIONS.HYDRANT_H28, 'HYDRANT H-28');
    this.waypoints.register('connect_hose_1', POSITIONS.HYDRANT_H28, 'H-28 SUPPLY VALVE');
    this.waypoints.register('open_spray_101b', new THREE.Vector3(POSITIONS.COOLING_VALVE.x + 3, 1, POSITIONS.COOLING_VALVE.z), 'SPRAY RING 101-B');
    this.waypoints.register('request_2nd_turnout', POSITIONS.RADIO, 'RADIO: 2ND TURNOUT');
    this.waypoints.register('position_tender_2', POSITIONS.HYDRANT_H20, 'HYDRANT H-20');
    this.waypoints.register('connect_hose_2', POSITIONS.HYDRANT_H20, 'H-20 SUPPLY VALVE');
    this.waypoints.register('request_foam', POSITIONS.RADIO, 'RADIO: FOAM NURSER');
    this.waypoints.register('check_boilover', new THREE.Vector3(POSITIONS.TANK_A.x, 1.5, POSITIONS.TANK_A.z + 10), 'INSPECT TANK SHELL');
  }

  _onStepActivated(stepId) {
    this.waypoints.setActive(stepId);
    const wp = this.waypoints.waypoints.get(stepId);
    if (wp) this.minimap.setObjective(wp.worldPos, wp.label);
  }

  // ── Start ──────────────────────────────────────────────

  _bindStart() {
    const startScreen = document.getElementById('start-screen');
    const handler = () => {
      startScreen.removeEventListener('click', handler);

      // GSAP fade-out transition
      gsap.to(startScreen, {
        opacity: 0,
        duration: 0.6,
        onComplete: () => {
          this.ui.hideStart();
          startScreen.style.opacity = '1';
        }
      });

      this.ui.showHud();
      this.interaction.enable();
      this.audio.resumeContext();
      this.scoring.start();
      if (this.spatialAudio) this.spatialAudio.start();
      this._startLoop();

      this._playIntroCutscene(() => {
        this.scenario.start();
      });
    };
    startScreen.addEventListener('click', handler);

    document.addEventListener('keydown', (e) => {
      if (e.code === 'KeyR' && this.equipment.hasItem('radio') && !this.radioPanel.visible && !this.actionPanel.visible) {
        const msgs = this.scenario.getAvailableRadioMessages();
        const stepId = msgs.length > 0 ? msgs[0].stepId : this.scenario.phase;
        this.radioPanel.open(stepId || 'report_tank_data', msgs);
      }
    });

    // Re-acquire pointer lock on canvas click when no UI panel is open
    // (handles cases where lock was lost to a browser prompt or focus change)
    this.canvas.addEventListener('click', () => {
      if (!document.pointerLockElement
          && !this.actionPanel.visible
          && !this.radioPanel.visible) {
        this.canvas.requestPointerLock();
      }
    });
  }

  // ── Game loop ──────────────────────────────────────────

  _startLoop() {
    if (this.running) return;
    this.running = true;
    this.clock.start();
    this._loop();
  }

  _loop() {
    if (!this.running) return;
    requestAnimationFrame(() => this._loop());

    const delta = Math.min(this.clock.getDelta(), 0.05);
    const elapsed = this.clock.getElapsedTime();

    // Core systems
    if (!this.cutscene.active) this.player.update(delta);
    this.cutscene.update();
    this.scenario.update(delta);
    this.scene.update(elapsed);
    this.fire.update(delta, this.player.camera);
    this.fx.update(delta);
    this.water.update(delta);
    this.worldAnims.update(delta);
    this.minimap.update();
    this.waypoints.update(delta, this.player.position);
    this.equipment.update(delta, this.player.isMoving);
    if (this.npcManager) this.npcManager.update(delta);

    // New game systems
    this.dayNight.update(delta);
    this.weather.update(delta);
    this.lod.update();
    if (this.spatialAudio) this.spatialAudio.update(delta, this.player.position);
    if (this.hoseSystem) this.hoseSystem.update(delta, this.player.position, POSITIONS.TANK_A);

    this._updateTruckAnims(delta);
    this._updateHeatProximity();

    // Live hose HUD update
    if (this.hoseSystem) {
      const hs = this.hoseSystem.getState();
      if (hs === 'spraying' || hs === 'charged') {
        this._updateHoseHUD(hs);
      }
      // Update hydrant prompt dynamically
      if (this._hoseHydrantData) {
        if (hs === 'carrying') {
          this._hoseHydrantData.prompt = 'HYDRANT H-28 — CONNECT HOSE';
          this._hoseHydrantData.hint = 'Click to attach coupling';
        } else if (hs === 'attached') {
          this._hoseHydrantData.prompt = 'HYDRANT H-28 — PRESSURIZE';
          this._hoseHydrantData.hint = 'Click to turn valve';
        }
      }
    }

    const target = this.interaction.update(delta);

    // Don't show prompts when a panel is open
    if (this.actionPanel.visible || this.radioPanel.visible) {
      this.ui.hideInteractPrompt();
      this.ui.setCrosshairActive(false);
    } else if (target && !target.completed) {
      this.ui.showInteractPrompt(target.prompt || 'INTERACT', target.hint || 'Click to interact');
      this.ui.setCrosshairActive(true);
    } else {
      this.ui.hideInteractPrompt();
      this.ui.setCrosshairActive(false);
    }

    if (this.scenario.radioActive && this.equipment.hasItem('radio') && !this.actionPanel.visible) {
      const msgs = this.scenario.getAvailableRadioMessages();
      const msgKey = msgs.map(m => m.stepId).join(',');
      if (msgs.length > 0 && this._lastRadioMsgKey !== msgKey) {
        this._lastRadioMsgKey = msgKey;
        // Auto-open radio panel when a new radio step becomes active
        if (!this.radioPanel.visible) {
          this.radioPanel.setMessages(msgs[0].stepId, msgs);
          this.radioPanel.open(msgs[0].stepId, msgs);
        } else {
          this.radioPanel.setMessages(msgs[0].stepId, msgs);
        }
      }
    }

    this.scene.render();
  }

  _updateHeatProximity() {
    if (!this._heatOverlay || !this.scenario.fireStarted) return;
    const dx = this.player.position.x - POSITIONS.TANK_A.x;
    const dz = this.player.position.z - POSITIONS.TANK_A.z;
    const dist = Math.sqrt(dx * dx + dz * dz);
    // Intensity ramps from 0 at 25m to full at 8m
    const t = 1 - Math.max(0, Math.min(1, (dist - 8) / 17));
    this._heatOverlay.style.opacity = (t * 0.6).toFixed(2);
    // Timer urgency — pulse when close to fire
    const timerEl = document.getElementById('timer');
    if (timerEl) {
      if (t > 0.3) timerEl.classList.add('urgent');
      else timerEl.classList.remove('urgent');
    }
  }

  _updateTruckAnims(delta) {
    for (const anim of this.truckAnims) {
      if (anim.done) continue;
      anim.elapsed += delta;
      const t = Math.min(1, anim.elapsed / anim.duration);

      const ease = t < 0.5 ? 2 * t * t : 1 - Math.pow(-2 * t + 2, 2) / 2;
      anim.truck.position.lerpVectors(anim.from, anim.to, ease);

      // Truck suspension bounce near arrival
      if (t > 0.85 && t < 1) {
        const bounce = Math.sin((t - 0.85) / 0.15 * Math.PI * 4) * 0.08 * (1 - t);
        anim.truck.position.y = anim.to.y + bounce;
      }

      if (t >= 1) {
        anim.done = true;
        anim.truck.position.y = anim.to.y;
        this.audio.fadeOut('truck_siren', 1.5);
        if (anim.headlight) {
          anim.truck.remove(anim.headlight.target);
          anim.truck.remove(anim.headlight);
          anim.headlight.dispose();
        }
        this.fx.removeTruckLights(anim.truck);
        if (anim.onArrival) anim.onArrival();
      }
    }
  }
}

const app = new App();
app.init().catch(err => {
  console.error('Init failed:', err);
  const status = document.getElementById('loading-status');
  if (status) status.textContent = 'ERROR: ' + err.message;
});
