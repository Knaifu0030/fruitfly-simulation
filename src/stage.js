import * as THREE from "three";
import { OrbitControls } from "three/addons/controls/OrbitControls.js";

const SUITS = ["S", "H", "D", "C"];
const rankLabel = (rank) => rank === 11 ? "A" : rank === 10 ? "10" : String(rank);

function cardTexture(rank, suitIndex) {
  const canvas = document.createElement("canvas");
  canvas.width = 256;
  canvas.height = 360;
  const context = canvas.getContext("2d");
  context.fillStyle = "#f4f2eb";
  context.fillRect(0, 0, 256, 360);
  context.strokeStyle = "#b9b5aa";
  context.lineWidth = 5;
  context.strokeRect(4, 4, 248, 352);
  const suit = SUITS[suitIndex % SUITS.length];
  context.fillStyle = suit === "H" || suit === "D" ? "#a72c2c" : "#161616";
  context.font = "700 52px system-ui";
  context.fillText(rankLabel(rank), 20, 62);
  context.font = "82px serif";
  context.textAlign = "center";
  context.fillText(suit, 128, 212);
  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  return texture;
}

export class BlackjackStage {
  constructor(canvas) {
    this.canvas = canvas;
    this.scene = new THREE.Scene();
    this.scene.background = new THREE.Color(0x070806);
    this.scene.fog = new THREE.FogExp2(0x070806, 0.055);
    this.camera = new THREE.PerspectiveCamera(38, 1, 0.1, 100);
    this.camera.position.set(0, 8.2, 10.5);
    this.renderer = new THREE.WebGLRenderer({ canvas, antialias: true });
    this.renderer.setPixelRatio(Math.min(devicePixelRatio, 2));
    this.renderer.outputColorSpace = THREE.SRGBColorSpace;
    this.renderer.shadowMap.enabled = true;
    this.controls = new OrbitControls(this.camera, canvas);
    this.controls.target.set(0, 0.2, 0);
    this.controls.enableDamping = true;
    this.controls.minDistance = 7;
    this.controls.maxDistance = 18;
    this.cards = [];
    this.mood = "idle";
    this.reducedMotion = matchMedia("(prefers-reduced-motion: reduce)").matches;
    this.buildWorld();
    new ResizeObserver(() => this.resize()).observe(canvas.parentElement);
    this.resize();
    this.tick(0);
  }

  buildWorld() {
    this.scene.add(new THREE.HemisphereLight(0xcbd9cb, 0x17110b, 1.2));
    const key = new THREE.SpotLight(0xf1c66d, 90, 40, Math.PI / 5, 0.55);
    key.position.set(-4, 10, 7);
    key.castShadow = true;
    this.scene.add(key);
    const rim = new THREE.PointLight(0x45bac8, 18, 20);
    rim.position.set(5, 4, -3);
    this.scene.add(rim);

    const table = new THREE.Mesh(
      new THREE.CylinderGeometry(6.4, 6.4, 0.45, 64, 1, false, 0, Math.PI),
      new THREE.MeshStandardMaterial({ color: 0x16392b, roughness: 0.76, metalness: 0.05 }),
    );
    table.position.set(0, -0.35, 1.1);
    table.rotation.y = Math.PI / 2;
    table.receiveShadow = true;
    this.scene.add(table);
    const rail = new THREE.Mesh(
      new THREE.TorusGeometry(6.42, 0.24, 12, 80, Math.PI),
      new THREE.MeshStandardMaterial({ color: 0x3a2416, roughness: 0.42 }),
    );
    rail.position.set(0, -0.12, 1.1);
    rail.rotation.set(Math.PI / 2, 0, Math.PI / 2);
    this.scene.add(rail);

    this.fly = new THREE.Group();
    const dark = new THREE.MeshStandardMaterial({ color: 0x181410, roughness: 0.48 });
    const amber = new THREE.MeshStandardMaterial({ color: 0x9b641f, roughness: 0.5 });
    const wing = new THREE.MeshPhysicalMaterial({ color: 0xa8d8d6, transparent: true, opacity: 0.34, roughness: 0.2 });
    const abdomen = new THREE.Mesh(new THREE.SphereGeometry(0.46, 24, 16), amber);
    abdomen.scale.set(1, 1.7, 0.88);
    const thorax = new THREE.Mesh(new THREE.SphereGeometry(0.48, 24, 16), dark);
    thorax.position.y = 0.72;
    const head = new THREE.Mesh(new THREE.SphereGeometry(0.39, 24, 16), dark);
    head.position.y = 1.32;
    this.fly.add(abdomen, thorax, head);
    for (const side of [-1, 1]) {
      const eye = new THREE.Mesh(new THREE.SphereGeometry(0.2, 18, 12), new THREE.MeshStandardMaterial({ color: 0x8f211e, emissive: 0x3a0605 }));
      eye.position.set(side * 0.3, 1.42, 0.12);
      this.fly.add(eye);
      const wingMesh = new THREE.Mesh(new THREE.SphereGeometry(0.42, 18, 10), wing);
      wingMesh.scale.set(0.52, 1.65, 0.09);
      wingMesh.position.set(side * 0.48, 0.62, -0.08);
      wingMesh.rotation.z = side * 0.5;
      this.fly.add(wingMesh);
      for (let leg = 0; leg < 3; leg += 1) {
        const geometry = new THREE.CylinderGeometry(0.025, 0.018, 1.25, 8);
        const limb = new THREE.Mesh(geometry, dark);
        limb.position.set(side * (0.52 + leg * 0.08), 0.45 - leg * 0.25, 0.22 + leg * 0.16);
        limb.rotation.z = side * (0.7 + leg * 0.17);
        this.fly.add(limb);
      }
    }
    this.fly.scale.setScalar(1.05);
    this.fly.position.set(0, 0.2, 3.9);
    this.fly.rotation.x = -0.18;
    this.scene.add(this.fly);
  }

  setHand(playerCards = [], dealerCards = []) {
    this.cards.forEach((card) => {
      this.scene.remove(card);
      card.geometry.dispose();
      card.material.map?.dispose();
      card.material.dispose();
    });
    this.cards = [];
    const add = (rank, index, dealer) => {
      const card = new THREE.Mesh(
        new THREE.PlaneGeometry(0.82, 1.14),
        new THREE.MeshStandardMaterial({ map: cardTexture(rank, index), roughness: 0.72 }),
      );
      const spread = dealer ? 1.05 : 0.92;
      card.position.set((index - (dealerCards.length - 1) / 2) * spread, 0.05, dealer ? -1.55 : 1.55);
      card.rotation.set(-Math.PI / 2, 0, (index - 1) * 0.04);
      card.scale.setScalar(this.reducedMotion ? 1 : 0.01);
      card.userData.birth = performance.now() + index * 100;
      this.scene.add(card);
      this.cards.push(card);
    };
    dealerCards.forEach((rank, index) => add(rank, index, true));
    playerCards.forEach((rank, index) => add(rank, index, false));
  }

  setMood(mood) {
    this.mood = mood;
  }

  resize() {
    const rect = this.canvas.parentElement.getBoundingClientRect();
    this.renderer.setSize(rect.width, rect.height, false);
    this.camera.aspect = rect.width / Math.max(1, rect.height);
    this.camera.updateProjectionMatrix();
  }

  tick(time) {
    requestAnimationFrame((next) => this.tick(next));
    const pulse = Math.sin(time * 0.004);
    if (!this.reducedMotion) {
      const moodLift = this.mood === "win" ? 0.16 : this.mood === "loss" ? -0.07 : 0;
      this.fly.position.y = 0.2 + pulse * 0.025 + moodLift;
      this.fly.rotation.z = this.mood === "thinking" ? pulse * 0.035 : 0;
      for (const card of this.cards) {
        const progress = Math.max(0, Math.min(1, (time - card.userData.birth) / 360));
        const eased = 1 - Math.pow(1 - progress, 4);
        card.scale.setScalar(eased);
      }
    }
    this.controls.update();
    this.renderer.render(this.scene, this.camera);
  }
}
