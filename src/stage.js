import * as THREE from "three";
import { OrbitControls } from "three/addons/controls/OrbitControls.js";
import { RoomEnvironment } from "three/addons/environments/RoomEnvironment.js";

import { CARD_HEIGHT, CardTable, faceOf, fanPositions } from "./stage/cards.js";
import { Fly } from "./stage/fly.js";
import { TABLE, Table } from "./stage/table.js";

const HAND_SPACING = 1.44;

function backdropTexture() {
  const canvas = document.createElement("canvas");
  canvas.width = 4;
  canvas.height = 256;
  const context = canvas.getContext("2d");
  const gradient = context.createLinearGradient(0, 0, 0, 256);
  gradient.addColorStop(0, "#05070a");
  gradient.addColorStop(0.42, "#0d1116");
  gradient.addColorStop(0.72, "#151a20");
  gradient.addColorStop(1, "#080a0c");
  context.fillStyle = gradient;
  context.fillRect(0, 0, 4, 256);
  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  return texture;
}

/**
 * The live table. Owns the camera, lighting and every physical object, and
 * exposes screen-space anchors so the HTML overlay can label the real card rows
 * instead of guessing at percentages.
 */
export class BlackjackStage {
  constructor(canvas) {
    this.canvas = canvas;
    this.host = canvas.parentElement;
    this.reducedMotion = matchMedia("(prefers-reduced-motion: reduce)").matches;
    this.shadows = !this.reducedMotion;
    this.clock = new THREE.Clock();
    this.width = 1;
    this.height = 1;
    this.mood = "idle";
    this.rowAnchors = new Map();

    this.scene = new THREE.Scene();
    this.scene.fog = new THREE.FogExp2(0x080a0d, 0.026);

    this.camera = new THREE.PerspectiveCamera(34, 1, 0.1, 90);
    this.camera.position.set(2.35, 5.15, 6.9);

    this.renderer = new THREE.WebGLRenderer({ canvas, antialias: true, powerPreference: "high-performance" });
    this.renderer.setPixelRatio(Math.min(devicePixelRatio, 1.8));
    this.renderer.outputColorSpace = THREE.SRGBColorSpace;
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
    this.renderer.toneMappingExposure = 1.12;
    this.renderer.shadowMap.enabled = this.shadows;
    this.renderer.shadowMap.type = THREE.PCFSoftShadowMap;

    const environment = new THREE.PMREMGenerator(this.renderer);
    this.scene.environment = environment.fromScene(new RoomEnvironment()).texture;
    this.scene.environmentIntensity = 0.3;
    environment.dispose();

    this.controls = new OrbitControls(this.camera, canvas);
    this.controls.target.set(0.05, 0.1, 0.35);
    this.controls.enableDamping = true;
    this.controls.dampingFactor = 0.08;
    this.controls.enablePan = false;
    this.controls.minDistance = 3.4;
    this.controls.maxDistance = 12;
    this.controls.minPolarAngle = 0.36;
    this.controls.maxPolarAngle = 1.22;
    this.controls.rotateSpeed = 0.7;
    this.controls.addEventListener("start", () => { this.userMoved = true; });

    this.buildBackdrop();
    this.buildLighting();

    this.table = new Table(this.scene, { shadows: this.shadows });
    this.cards = new CardTable(this.scene, {
      shoeOrigin: [TABLE.shoe[0] + 0.34, TABLE.shoe[1] + 0.5],
      discardOrigin: TABLE.tray,
      reducedMotion: this.reducedMotion,
      shadows: this.shadows,
    });
    this.fly = new Fly(this.scene, { reducedMotion: this.reducedMotion, shadows: this.shadows });
    this.fly.place(TABLE.seatSpot[0], TABLE.seatSpot[1], 0.3);
    this.buildFocusRing();
    this.table.setWager(10_000);

    this.observer = new ResizeObserver(() => this.resize());
    this.observer.observe(this.host);
    this.resize();

    document.fonts?.ready.then(() => this.refreshAssets()).catch(() => {});
    this.renderer.setAnimationLoop(() => this.frame());
  }

  buildBackdrop() {
    const backdrop = new THREE.Mesh(
      new THREE.SphereGeometry(30, 24, 18),
      new THREE.MeshBasicMaterial({ map: backdropTexture(), side: THREE.BackSide, fog: false }),
    );
    this.scene.add(backdrop);
  }

  buildLighting() {
    this.scene.add(new THREE.HemisphereLight(0x2b3b47, 0x100c08, 0.7));

    // Pendant key light hanging over the layout, wide enough to light the whole
    // playing area rather than a single hot pool.
    const key = new THREE.SpotLight(0xffd9ab, 150, 14, 0.95, 0.75, 1.6);
    key.position.set(-0.4, 4.6, 0.9);
    key.target.position.set(0.1, 0, 0.35);
    key.castShadow = this.shadows;
    key.shadow.mapSize.set(1024, 1024);
    key.shadow.camera.near = 1.2;
    key.shadow.camera.far = 11;
    key.shadow.bias = -0.0008;
    key.shadow.normalBias = 0.024;
    this.scene.add(key, key.target);
    this.keyLight = key;

    const fill = new THREE.SpotLight(0xa7d6ea, 60, 18, 1.05, 0.95, 1.5);
    fill.position.set(3.6, 3.9, -3.2);
    fill.target.position.set(0, 0, -0.3);
    this.scene.add(fill, fill.target);

    const rim = new THREE.PointLight(0xffb066, 9, 6.5, 2);
    rim.position.set(-2.5, 1.2, 2.6);
    this.scene.add(rim);

    const seatGlow = new THREE.PointLight(0xfff0d2, 3.2, 3.2, 2);
    seatGlow.position.set(TABLE.seatSpot[0] - 0.5, 0.75, TABLE.seatSpot[1] + 0.3);
    this.scene.add(seatGlow);
  }

  buildFocusRing() {
    const geometry = new THREE.RingGeometry(0.72, 0.755, 64);
    geometry.rotateX(-Math.PI / 2);
    this.focusRing = new THREE.Mesh(geometry, new THREE.MeshBasicMaterial({
      color: 0xf0b458, transparent: true, opacity: 0, depthWrite: false,
    }));
    this.focusRing.position.set(TABLE.playerCenter, 0.004, TABLE.playerCards);
    this.focusRing.scale.set(1.35, 1, 0.82);
    this.scene.add(this.focusRing);
  }

  /**
   * @param {object} state
   * @param {string} state.handId       identity used to seed suits deterministically
   * @param {number[]} state.dealer     dealer ranks that are public
   * @param {boolean} state.dealerHidden whether a face-down hole card is in play
   * @param {number[][]} state.hands    one entry per player hand
   * @param {number} state.activeIndex  which player hand the agent is acting on
   */
  showHand({ handId = "hand", dealer = [], dealerHidden = false, hands = [], activeIndex = 0 }) {
    const rows = [];
    this.rowAnchors.clear();

    const dealerCards = dealer.map((rank, index) => ({ rank, index }));
    if (dealerHidden) dealerCards.push({ rank: null, index: dealerCards.length });
    if (dealerCards.length) {
      rows.push(this.buildRow("dealer", handId, dealerCards, 0, TABLE.dealerCards));
    }

    const visible = hands.filter((cards) => cards?.length);
    const offset = ((visible.length - 1) * HAND_SPACING) / 2;
    visible.forEach((cards, index) => {
      const centerX = TABLE.playerCenter + index * HAND_SPACING - offset;
      rows.push(this.buildRow(`hand-${index}`, handId, cards.map((rank, position) => ({ rank, index: position })), centerX, TABLE.playerCards));
    });

    this.cards.layout(rows);
    this.activeAnchor = this.rowAnchors.get(`hand-${Math.min(activeIndex, Math.max(0, visible.length - 1))}`);
    if (this.activeAnchor && visible.length > 1) {
      this.focusRing.position.x = this.activeAnchor.x;
      this.focusTarget = 0.34;
    } else {
      this.focusTarget = 0;
    }
  }

  buildRow(key, handId, cards, centerX, zLine) {
    const fan = fanPositions(cards.length, centerX, zLine);
    this.rowAnchors.set(key, { x: centerX, z: zLine, count: cards.length });
    return {
      key,
      slot: `${centerX.toFixed(2)}:${zLine.toFixed(2)}`,
      cards: cards.map((card, index) => {
        const hidden = card.rank == null;
        const face = hidden ? { label: "10", suit: "spade" } : faceOf(card.rank, `${handId}:${key}:${index}:${card.rank}`);
        return { ...face, ...fan[index], hidden, placeholder: hidden };
      }),
    };
  }

  setMood(mood) {
    this.mood = mood;
    this.fly.setMood(mood);
  }

  setWager(paise) {
    this.table.setWager(paise);
  }

  setShoeProgress(fraction) {
    this.table.setShoeProgress(fraction);
  }

  /** Screen-space label anchors, in CSS pixels relative to the canvas. */
  anchors() {
    const result = {};
    for (const [key, anchor] of this.rowAnchors) {
      const dealer = key === "dealer";
      // Sit the label just outside its row, clear of the fly's seat.
      const depth = dealer ? -CARD_HEIGHT * 0.78 : CARD_HEIGHT * 0.9;
      const sideways = dealer ? 0 : 0.34;
      const point = new THREE.Vector3(anchor.x + sideways, 0.05, anchor.z + depth).project(this.camera);
      result[key] = {
        x: (point.x * 0.5 + 0.5) * this.width,
        y: (-point.y * 0.5 + 0.5) * this.height,
        onScreen: Math.abs(point.x) < 1.1 && Math.abs(point.y) < 1.1,
      };
    }
    return result;
  }

  resize() {
    const rect = this.host.getBoundingClientRect();
    this.width = Math.max(1, Math.round(rect.width));
    this.height = Math.max(1, Math.round(rect.height));
    this.renderer.setSize(this.width, this.height, false);
    this.camera.aspect = this.width / this.height;
    this.camera.updateProjectionMatrix();
    this.frameCamera();
  }

  /**
   * Places the camera so a fixed slice of the layout fills the frame whatever
   * the panel shape is. Narrow panels get a closer, steeper shot instead of a
   * wide one padded out with empty room. Skipped once the viewer has orbited.
   */
  frameCamera() {
    if (this.userMoved) return;
    const tall = this.camera.aspect < 1;
    const wanted = this.width < 700 ? 4.4 : this.width < 1150 ? 6 : 7.2;
    const halfFov = THREE.MathUtils.degToRad(this.camera.fov) / 2;
    const distance = THREE.MathUtils.clamp(wanted / (2 * Math.tan(halfFov) * this.camera.aspect), 4.2, 11.5);
    const azimuth = 0.335;
    const elevation = tall ? 0.86 : 0.62;
    const target = this.controls.target;
    this.camera.position.set(
      target.x + Math.sin(azimuth) * Math.cos(elevation) * distance,
      target.y + Math.sin(elevation) * distance,
      target.z + Math.cos(azimuth) * Math.cos(elevation) * distance,
    );
    this.camera.lookAt(target);
    this.controls.update();
  }

  refreshAssets() {
    this.table.refreshFelt();
    this.cards.refreshFaces();
  }

  frame() {
    // Generous clamp: on a slow first frame or a background tab the animation
    // should still make real progress rather than crawl behind the event stream.
    const delta = Math.min(0.2, this.clock.getDelta());
    const time = this.clock.elapsedTime;
    this.cards.update(delta);
    this.fly.update(delta, time);
    if (this.focusRing) {
      const target = this.focusTarget ?? 0;
      this.focusRing.material.opacity += (target - this.focusRing.material.opacity) * Math.min(1, delta * 4);
      if (this.activeAnchor) {
        this.focusRing.position.x += (this.activeAnchor.x - this.focusRing.position.x) * Math.min(1, delta * 6);
      }
    }
    if (!this.reducedMotion) {
      this.keyLight.intensity = 150 + Math.sin(time * 0.7) * 3;
    }
    this.controls.update();
    this.renderer.render(this.scene, this.camera);
    this.onFrame?.();
  }
}
