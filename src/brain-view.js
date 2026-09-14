import * as THREE from "three";

// Anatomical categories in the order the build script writes them into the
// binary. Base colours match the generated metadata so the specimen reads as
// anatomy before any simulated activity is applied.
const CATEGORY_BASE = [
  { key: "learning", color: 0xf2b84b, weight: 0.34 },
  { key: "sensory", color: 0x53c7d6, weight: 0.9 },
  { key: "motor", color: 0xee6b63, weight: 0.5 },
  { key: "descending", color: 0xc88cf2, weight: 0.44 },
  { key: "ascending", color: 0x78d98b, weight: 0.4 },
  { key: "processing", color: 0x7f8b99, weight: 0.5, dense: true },
  { key: "other", color: 0x68717e, weight: 0.2 },
];

// Which model population drives each anatomical bucket.
const DRIVEN_BY = ["learning", "perception", "choice", "choice", "working", "working", "working"];

const POPULATION_COLORS = {
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
    this.camera = new THREE.PerspectiveCamera(32, 1, 0.01, 20);
    this.camera.position.set(0, 0, 1.7);
    this.renderer = new THREE.WebGLRenderer({ canvas, antialias: true, alpha: true });
    this.renderer.setPixelRatio(Math.min(devicePixelRatio, 1.75));
    this.renderer.outputColorSpace = THREE.SRGBColorSpace;

    // pivot spins; model carries the recentering offset so the spin stays on axis.
    this.pivot = new THREE.Group();
    this.model = new THREE.Group();
    this.pivot.add(this.model);
    this.pivot.rotation.x = -0.12;
    this.scene.add(this.pivot);

    this.clouds = [];
    this.populations = [];
    this.history = new Map();
    this.representatives = new Map();
    this.reducedMotion = matchMedia("(prefers-reduced-motion: reduce)").matches;
    new ResizeObserver(() => this.resize()).observe(canvas.parentElement);
    this.resize();
    this.load();
    this.renderer.setAnimationLoop(() => this.frame());
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
      const buckets = Array.from({ length: CATEGORY_BASE.length }, () => []);
      const bodies = Array.from({ length: CATEGORY_BASE.length }, () => []);
      for (let offset = 0; offset < buffer.byteLength; offset += metadata.record_bytes) {
        const category = Math.min(view.getUint8(offset + 16), CATEGORY_BASE.length - 1);
        buckets[category].push(
          view.getFloat32(offset, true), -view.getFloat32(offset + 8, true), view.getFloat32(offset + 4, true),
        );
        if (bodies[category].length < 4) bodies[category].push(view.getUint32(offset + 12, true));
      }
      this.representatives.set("learning", bodies[0]);
      this.representatives.set("perception", bodies[1].length ? bodies[1] : bodies[5]);
      this.representatives.set("choice", [...bodies[2], ...bodies[3]].slice(0, 4));
      this.representatives.set("working", bodies[5]);
      this.representatives.set("appetitive", bodies[0]);
      this.representatives.set("aversive", bodies[0]);
      buckets.forEach((positions, index) => this.addCloud(positions, index));
      this.setCaption(`${(metadata.visible_somas ?? 0).toLocaleString("en-IN")} soma positions / ${metadata.dataset ?? "MaleCNS"}`);
    } catch {
      // Placeholder specimen so the panel is never blank before the build runs.
      const positions = [];
      for (let index = 0; index < 26_000; index += 1) {
        const angle = Math.random() * Math.PI * 2;
        const radius = Math.pow(Math.random(), 0.65) * 0.24;
        const lobe = index % 3 === 0 ? -0.3 : 0.16;
        positions.push(
          (index % 2 ? -0.13 : 0.13) + Math.cos(angle) * radius,
          lobe + Math.sin(angle) * radius * (index % 3 === 0 ? 1.9 : 0.8),
          (Math.random() - 0.5) * 0.18,
        );
      }
      this.addCloud(positions, 5);
      this.setCaption("Generated anatomy unavailable / placeholder specimen");
    }
    this.fitCamera();
  }

  setCaption(text) {
    const caption = document.querySelector("#brain-caption");
    if (caption) caption.textContent = text;
  }

  addCloud(positions, index) {
    if (!positions.length) return;
    const base = CATEGORY_BASE[index];
    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute("position", new THREE.Float32BufferAttribute(positions, 3));
    // The intrinsic-processing bucket holds 131k of the 140k somata. Additive
    // blending saturates it into a white blob, so that one uses normal blending
    // and only the small functional populations get the additive glow.
    const material = new THREE.PointsMaterial({
      color: base.color, size: 0.0028, sizeAttenuation: true, transparent: true,
      opacity: base.weight * 0.5, depthWrite: false,
      blending: base.dense ? THREE.NormalBlending : THREE.AdditiveBlending,
    });
    const cloud = new THREE.Points(geometry, material);
    cloud.userData = { category: index, base };
    this.model.add(cloud);
    this.clouds.push(cloud);
  }

  fitCamera() {
    if (!this.clouds.length) return;
    if (!this.fitBox) {
      // Measured once from local geometry so the idle spin cannot drift the fit.
      this.fitBox = new THREE.Box3();
      for (const cloud of this.clouds) {
        cloud.geometry.computeBoundingBox();
        this.fitBox.union(cloud.geometry.boundingBox);
      }
      this.model.position.copy(this.fitBox.getCenter(new THREE.Vector3()).negate());
    }
    const size = this.fitBox.getSize(new THREE.Vector3());
    const halfFov = THREE.MathUtils.degToRad(this.camera.fov) / 2;
    const byHeight = size.y / 2 / Math.tan(halfFov);
    const byWidth = size.x / 2 / (Math.tan(halfFov) * this.camera.aspect);
    this.camera.position.z = Math.max(byHeight, byWidth) * 1.14 + size.z / 2;
    this.camera.updateProjectionMatrix();
  }

  update(frame) {
    const populations = frame.populations ?? [];
    this.populations = populations;
    const lookup = Object.fromEntries(populations.map((item) => [item.key, item]));
    for (const cloud of this.clouds) {
      const population = lookup[DRIVEN_BY[cloud.userData.category]];
      if (!population) continue;
      const { base } = cloud.userData;
      const target = POPULATION_COLORS[population.key] ?? POPULATION_COLORS.working;
      cloud.material.color.lerpColors(new THREE.Color(base.color), target, 0.4 + population.activity * 0.35);
      cloud.material.opacity = base.weight * (0.4 + population.activity * 0.6);
      cloud.material.size = base.dense ? 0.0022 : 0.0026 + population.activity * 0.0024;
    }

    const active = [...populations].sort((a, b) => b.activity - a.activity).slice(0, 4);
    this.labels.innerHTML = active.map((item) => {
      const tint = POPULATION_COLORS[item.key] ?? POPULATION_COLORS.working;
      return `<button type="button" data-population="${item.key}" style="--tint:#${tint.getHexString()}">
        <i style="--level:${item.activity.toFixed(3)}"></i>
        <span><b>${item.label}</b><small>${item.technical} / ${Math.round(item.activity * 100)}%</small></span>
      </button>`;
    }).join("");

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
      <div><dt>Population size</dt><dd>${(item.neuron_count ?? 0).toLocaleString("en-IN")} neurons</dd></div>
      <div><dt>Current aggregate</dt><dd>${item.activity.toFixed(4)}</dd></div>
      <div><dt>Representative MaleCNS body IDs</dt><dd>${bodies.join(", ") || "not mapped"}</dd></div>
      <div><dt>Evidence class</dt><dd>${item.evidence ?? "declared model aggregate"}</dd></div>
      <div><dt>Interpretation</dt><dd>Aggregate value applied to a selected anatomical population; not a single-neuron recording.</dd></div>`;
  }

  drawPlot() {
    const width = this.plot.clientWidth;
    const height = this.plot.clientHeight;
    if (!width || !height) return;
    const ratio = Math.min(devicePixelRatio, 2);
    this.plot.width = width * ratio;
    this.plot.height = height * ratio;
    const context = this.plot.getContext("2d");
    context.scale(ratio, ratio);
    context.clearRect(0, 0, width, height);
    context.strokeStyle = "rgba(255,255,255,0.08)";
    context.lineWidth = 1;
    for (const fraction of [0, 0.5, 1]) {
      const y = Math.round(height - fraction * (height - 2)) - 0.5;
      context.beginPath();
      context.moveTo(0, y);
      context.lineTo(width, y);
      context.stroke();
    }
    for (const [key, samples] of this.history) {
      if (samples.length < 2) continue;
      const color = POPULATION_COLORS[key] ?? POPULATION_COLORS.working;
      context.strokeStyle = `#${color.getHexString()}`;
      context.lineWidth = 1.5;
      context.lineJoin = "round";
      context.beginPath();
      samples.forEach((value, index) => {
        const x = (index / 79) * width;
        const y = height - value * (height - 5) - 2;
        if (index === 0) context.moveTo(x, y);
        else context.lineTo(x, y);
      });
      context.stroke();
    }
  }

  resize() {
    const rect = this.canvas.getBoundingClientRect();
    const width = Math.max(1, Math.round(rect.width));
    const height = Math.max(1, Math.round(rect.height));
    this.renderer.setSize(width, height, false);
    this.camera.aspect = width / height;
    this.camera.updateProjectionMatrix();
    if (this.clouds.length) this.fitCamera();
  }

  frame() {
    if (!this.reducedMotion) this.pivot.rotation.y += 0.0022;
    this.renderer.render(this.scene, this.camera);
  }
}
