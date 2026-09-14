import * as THREE from "three";

const COLORS = {
  perception: new THREE.Color(0.14, 0.66, 0.76),
  working: new THREE.Color(0.54, 0.43, 0.82),
  choice: new THREE.Color(0.76, 0.35, 0.84),
  learning: new THREE.Color(0.89, 0.55, 0.14),
  appetitive: new THREE.Color(0.35, 0.82, 0.42),
  aversive: new THREE.Color(0.91, 0.25, 0.22),
};

export class BrainView {
  constructor(canvas, labels) {
    this.canvas = canvas;
    this.labels = labels;
    this.scene = new THREE.Scene();
    this.camera = new THREE.PerspectiveCamera(34, 1, 0.01, 10);
    this.camera.position.z = 1.65;
    this.renderer = new THREE.WebGLRenderer({ canvas, antialias: true, alpha: true });
    this.renderer.setPixelRatio(Math.min(devicePixelRatio, 1.6));
    this.clouds = [];
    this.populations = [];
    this.reducedMotion = matchMedia("(prefers-reduced-motion: reduce)").matches;
    new ResizeObserver(() => this.resize()).observe(canvas.parentElement);
    this.resize();
    this.load();
    this.tick();
  }

  async load() {
    try {
      const [metadataResponse, binaryResponse] = await Promise.all([
        fetch("/data/brain-metadata.json"),
        fetch("/data/brain-somas.bin"),
      ]);
      if (!metadataResponse.ok || !binaryResponse.ok) throw new Error("generated anatomy unavailable");
      const metadata = await metadataResponse.json();
      const buffer = await binaryResponse.arrayBuffer();
      const view = new DataView(buffer);
      const buckets = Array.from({ length: 7 }, () => []);
      for (let offset = 0; offset < buffer.byteLength; offset += metadata.record_bytes) {
        buckets[view.getUint8(offset + 16)].push(
          view.getFloat32(offset, true), -view.getFloat32(offset + 8, true), view.getFloat32(offset + 4, true),
        );
      }
      buckets.forEach((positions, index) => this.addCloud(positions, index));
    } catch {
      const positions = [];
      for (let i = 0; i < 28_000; i += 1) {
        const side = i % 2 ? -1 : 1;
        const angle = Math.random() * Math.PI * 2;
        const radius = Math.pow(Math.random(), 0.65) * 0.46;
        positions.push(side * 0.26 + Math.cos(angle) * radius, Math.sin(angle) * radius * 0.58, (Math.random() - 0.5) * 0.28);
      }
      this.addCloud(positions, 5);
    }
  }

  addCloud(positions, index) {
    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute("position", new THREE.Float32BufferAttribute(positions, 3));
    const material = new THREE.PointsMaterial({ color: 0x8b94a4, size: 0.004, transparent: true, opacity: index === 5 ? 0.38 : 0.14, depthWrite: false, blending: THREE.AdditiveBlending });
    const cloud = new THREE.Points(geometry, material);
    cloud.userData.category = index;
    this.scene.add(cloud);
    this.clouds.push(cloud);
  }

  update(populations) {
    this.populations = populations;
    const lookup = Object.fromEntries(populations.map((item) => [item.key, item]));
    const mappings = [lookup.learning, lookup.perception, lookup.choice, lookup.choice, lookup.working, lookup.working, lookup.working];
    this.clouds.forEach((cloud, index) => {
      const population = mappings[index];
      if (!population) return;
      const color = COLORS[population.key] || COLORS.working;
      cloud.material.color.lerp(color, 0.72);
      cloud.material.opacity = 0.15 + population.activity * 0.75;
      cloud.material.size = 0.003 + population.activity * 0.004;
    });
    const active = [...populations].sort((a, b) => b.activity - a.activity).slice(0, 3);
    this.labels.innerHTML = active.map((item) => `<div><i style="--level:${item.activity}"></i><span><b>${item.label}</b><small>${item.technical} / ${Math.round(item.activity * 100)}%</small></span></div>`).join("");
  }

  resize() {
    const rect = this.canvas.getBoundingClientRect();
    this.renderer.setSize(rect.width, rect.height, false);
    this.camera.aspect = rect.width / Math.max(1, rect.height);
    this.camera.updateProjectionMatrix();
  }

  tick() {
    requestAnimationFrame(() => this.tick());
    if (!this.reducedMotion) this.scene.rotation.y += 0.0005;
    this.renderer.render(this.scene, this.camera);
  }
}
