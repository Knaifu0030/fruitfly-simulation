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
  constructor(canvas, labels, plot) {
    this.canvas = canvas;
    this.labels = labels;
    this.plot = plot;
    this.scene = new THREE.Scene();
    this.camera = new THREE.PerspectiveCamera(34, 1, 0.01, 10);
    this.camera.position.z = 1.65;
    this.renderer = new THREE.WebGLRenderer({ canvas, antialias: true, alpha: true });
    this.renderer.setPixelRatio(Math.min(devicePixelRatio, 1.6));
    this.clouds = [];
    this.populations = [];
    this.history = new Map();
    this.representatives = new Map();
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
      const bodies = Array.from({ length: 7 }, () => []);
      for (let offset = 0; offset < buffer.byteLength; offset += metadata.record_bytes) {
        const category = view.getUint8(offset + 16);
        buckets[category].push(
          view.getFloat32(offset, true), -view.getFloat32(offset + 8, true), view.getFloat32(offset + 4, true),
        );
        if (bodies[category].length < 4) bodies[category].push(view.getUint32(offset + 12, true));
      }
      this.representatives.set("learning", bodies[0]);
      this.representatives.set("perception", bodies[1]);
      this.representatives.set("choice", [...bodies[2], ...bodies[3]].slice(0, 4));
      this.representatives.set("working", bodies[5]);
      this.representatives.set("appetitive", bodies[0]);
      this.representatives.set("aversive", bodies[0]);
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

  update(frame) {
    const populations = frame.populations ?? [];
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
    this.labels.innerHTML = active.map((item) => `<button type="button" data-population="${item.key}"><i style="--level:${item.activity}"></i><span><b>${item.label}</b><small>${item.technical} / ${Math.round(item.activity * 100)}%</small></span></button>`).join("");
    for (const item of populations) {
      const samples = this.history.get(item.key) ?? [];
      samples.push(item.activity);
      if (samples.length > 80) samples.shift();
      this.history.set(item.key, samples);
    }
    this.drawPlot();
    this.showPhase(frame);
  }

  showPhase(frame) {
    const readable = String(frame.phase ?? "model_update").replaceAll("_", " ");
    document.querySelector("#stimulus-phase").textContent = readable;
    const stimulus = frame.stimulus ?? {};
    document.querySelector("#stimulus-detail").textContent = stimulus.reward !== undefined
      ? `${stimulus.teaching_signal} teaching signal from reward ${Number(stimulus.reward).toFixed(1)}`
      : `Player ${stimulus.hand_total ?? "-"} vs dealer ${stimulus.dealer_upcard ?? "-"}; candidate action ${stimulus.action ?? "-"}`;
    const activeKeys = new Set(frame.pathway ?? []);
    document.querySelectorAll("#stimulus-flow li").forEach((item) => {
      item.classList.toggle("active", activeKeys.has(item.dataset.key));
    });
    const delta = Number(frame.plasticity_delta ?? 0);
    document.querySelector("#plasticity-readout").innerHTML = `<strong>KC-to-MBON plasticity:</strong> ${Number(frame.plasticity ?? 0).toFixed(5)} (${delta >= 0 ? "+" : ""}${delta.toFixed(5)} this outcome).`;
  }

  inspect(key) {
    const item = this.populations.find((population) => population.key === key);
    if (!item) return;
    const bodies = this.representatives.get(key) ?? [];
    document.querySelector("#neuron-inspector").innerHTML = `
      <div><dt>Accessible role</dt><dd>${item.label}</dd></div>
      <div><dt>Neuron class / proxy</dt><dd>${item.technical}</dd></div>
      <div><dt>Current aggregate</dt><dd>${item.activity.toFixed(4)}</dd></div>
      <div><dt>Representative MaleCNS body IDs</dt><dd>${bodies.join(", ") || "not mapped"}</dd></div>
      <div><dt>Evidence</dt><dd>${item.evidence}</dd></div>
      <div><dt>Interpretation</dt><dd>Aggregate value applied to a selected anatomical population; not a single-neuron recording.</dd></div>`;
  }

  drawPlot() {
    const width = this.plot.clientWidth;
    const height = this.plot.clientHeight;
    const ratio = Math.min(devicePixelRatio, 2);
    this.plot.width = width * ratio;
    this.plot.height = height * ratio;
    const context = this.plot.getContext("2d");
    context.scale(ratio, ratio);
    context.clearRect(0, 0, width, height);
    context.strokeStyle = "#28352e";
    context.beginPath(); context.moveTo(0, height - 1); context.lineTo(width, height - 1); context.stroke();
    for (const [key, samples] of this.history) {
      if (samples.length < 2) continue;
      const color = COLORS[key] ?? COLORS.working;
      context.strokeStyle = `#${color.getHexString()}`;
      context.lineWidth = 1.5;
      context.beginPath();
      samples.forEach((value, index) => {
        const x = index / 79 * width;
        const y = height - value * (height - 4) - 2;
        if (index === 0) context.moveTo(x, y); else context.lineTo(x, y);
      });
      context.stroke();
    }
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
