import * as THREE from "three";
import { OrbitControls } from "three/addons/controls/OrbitControls.js";
import "./style.css";

const canvas = document.querySelector("#brain-canvas");
const viewport = document.querySelector(".viewport");
const statusEl = document.querySelector("#load-status");
const legendEl = document.querySelector("#legend");
const selectionEl = document.querySelector("#selection");

const palette = [
  new THREE.Color(0.89, 0.55, 0.14),
  new THREE.Color(0.14, 0.66, 0.76),
  new THREE.Color(0.91, 0.25, 0.22),
  new THREE.Color(0.61, 0.34, 0.86),
  new THREE.Color(0.25, 0.75, 0.38),
  new THREE.Color(0.48, 0.53, 0.61),
  new THREE.Color(0.24, 0.27, 0.32),
];

const scene = new THREE.Scene();
scene.fog = new THREE.FogExp2(0x08090b, 1.45);
const camera = new THREE.PerspectiveCamera(34, 1, 0.01, 20);
camera.position.set(0.1, 0.1, 1.65);

const renderer = new THREE.WebGLRenderer({ canvas, antialias: true, alpha: false });
renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
renderer.setClearColor(0x08090b, 1);
renderer.outputColorSpace = THREE.SRGBColorSpace;

const controls = new OrbitControls(camera, canvas);
controls.enableDamping = true;
controls.dampingFactor = 0.055;
controls.minDistance = 0.45;
controls.maxDistance = 4;

const model = new THREE.Group();
model.rotation.set(-0.18, -0.3, -0.08);
scene.add(model);

let metadata;
let groups = [];
let autoDrift = !window.matchMedia("(prefers-reduced-motion: reduce)").matches;
let userInteracting = false;

function resetView() {
  camera.position.set(0.1, 0.1, 1.65);
  controls.target.set(0, 0, 0);
  model.rotation.set(-0.18, -0.3, -0.08);
  controls.update();
}

function resize() {
  const { width, height } = viewport.getBoundingClientRect();
  renderer.setSize(width, height, false);
  camera.aspect = width / Math.max(height, 1);
  camera.updateProjectionMatrix();
}

function readRecord(view, offset) {
  return {
    x: view.getFloat32(offset, true),
    y: view.getFloat32(offset + 4, true),
    z: view.getFloat32(offset + 8, true),
    body: view.getUint32(offset + 12, true),
    category: view.getUint8(offset + 16),
    classIndex: view.getUint8(offset + 17),
    superclassIndex: view.getUint8(offset + 18),
    sideIndex: view.getUint8(offset + 19),
    typeIndex: view.getUint16(offset + 20, true),
  };
}

function makeCloud(records, categoryIndex) {
  const positions = new Float32Array(records.length * 3);
  const neuronData = new Array(records.length);
  records.forEach((record, index) => {
    positions[index * 3] = record.x;
    positions[index * 3 + 1] = -record.z;
    positions[index * 3 + 2] = record.y;
    neuronData[index] = record;
  });

  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute("position", new THREE.BufferAttribute(positions, 3));
  const material = new THREE.PointsMaterial({
    color: palette[categoryIndex],
    size: categoryIndex === 0 ? 0.006 : 0.0032,
    sizeAttenuation: true,
    transparent: true,
    opacity: categoryIndex === 6 ? 0.24 : 0.72,
    depthWrite: false,
    blending: THREE.AdditiveBlending,
  });
  const points = new THREE.Points(geometry, material);
  points.userData = { categoryIndex, neuronData };
  model.add(points);
  return points;
}

function renderLegend() {
  legendEl.innerHTML = metadata.categories.map((item, index) => `
    <button class="legend-row is-active" type="button" data-category="${index}" aria-pressed="true">
      <span class="swatch swatch-${index}"></span>
      <span class="legend-copy"><strong>${item.label}</strong><small>${item.plain}</small></span>
      <span class="count">${item.count.toLocaleString()}</span>
    </button>
  `).join("");

  legendEl.addEventListener("click", (event) => {
    const button = event.target.closest("button[data-category]");
    if (!button) return;
    const index = Number(button.dataset.category);
    groups[index].visible = !groups[index].visible;
    button.classList.toggle("is-active", groups[index].visible);
    button.setAttribute("aria-pressed", String(groups[index].visible));
  });
}

function showNeuron(record) {
  const category = metadata.categories[record.category];
  const className = metadata.dictionaries.classes[record.classIndex] || "Not assigned";
  const superclass = metadata.dictionaries.superclasses[record.superclassIndex] || "Not assigned";
  const type = metadata.dictionaries.types[record.typeIndex] || "Not assigned";
  const side = metadata.dictionaries.sides[record.sideIndex] || "Not assigned";
  selectionEl.innerHTML = `
    <div class="selection-header">
      <span class="swatch swatch-${record.category}"></span>
      <span>${category.label}</span>
      <code>Body ${record.body}</code>
    </div>
    <h3>${type === "Not assigned" ? category.label : type}</h3>
    <p>${category.plain}</p>
    <dl>
      <div><dt>Scientific class</dt><dd>${className}</dd></div>
      <div><dt>Network role</dt><dd>${superclass}</dd></div>
      <div><dt>Side</dt><dd>${side}</dd></div>
      <div><dt>Evidence</dt><dd><span class="evidence-dot"></span> MaleCNS annotation</dd></div>
    </dl>
  `;
}

const raycaster = new THREE.Raycaster();
raycaster.params.Points.threshold = 0.009;
const pointer = new THREE.Vector2();

canvas.addEventListener("pointerdown", () => { userInteracting = true; });
canvas.addEventListener("pointerup", (event) => {
  const rect = canvas.getBoundingClientRect();
  pointer.x = ((event.clientX - rect.left) / rect.width) * 2 - 1;
  pointer.y = -((event.clientY - rect.top) / rect.height) * 2 + 1;
  raycaster.setFromCamera(pointer, camera);
  const hits = raycaster.intersectObjects(groups.filter((group) => group.visible), false);
  if (hits.length) showNeuron(hits[0].object.userData.neuronData[hits[0].index]);
  window.setTimeout(() => { userInteracting = false; }, 1200);
});

document.querySelector("#reset-view").addEventListener("click", resetView);
document.querySelector("#motion-toggle").addEventListener("click", (event) => {
  autoDrift = !autoDrift;
  event.currentTarget.textContent = autoDrift ? "Drift on" : "Drift off";
  event.currentTarget.setAttribute("aria-pressed", String(autoDrift));
});
document.querySelector("#show-all").addEventListener("click", () => {
  groups.forEach((group) => { group.visible = true; });
  document.querySelectorAll(".legend-row").forEach((button) => {
    button.classList.add("is-active");
    button.setAttribute("aria-pressed", "true");
  });
});

async function load() {
  const [metaResponse, binaryResponse] = await Promise.all([
    fetch("/data/brain-metadata.json"),
    fetch("/data/brain-somas.bin"),
  ]);
  if (!metaResponse.ok || !binaryResponse.ok) throw new Error("Anatomy files could not be loaded.");
  metadata = await metaResponse.json();
  const buffer = await binaryResponse.arrayBuffer();
  const view = new DataView(buffer);
  const recordsByCategory = metadata.categories.map(() => []);
  for (let offset = 0; offset < buffer.byteLength; offset += metadata.record_bytes) {
    const record = readRecord(view, offset);
    recordsByCategory[record.category].push(record);
  }
  groups = recordsByCategory.map(makeCloud);
  renderLegend();
  statusEl.textContent = `${metadata.visible_somas.toLocaleString()} traced somas`;
}

function animate() {
  requestAnimationFrame(animate);
  if (autoDrift && !userInteracting) model.rotation.y += 0.00034;
  controls.update();
  renderer.render(scene, camera);
}

new ResizeObserver(resize).observe(viewport);
resize();
animate();
load().catch((error) => {
  statusEl.textContent = error.message;
  document.querySelector(".status").classList.add("is-error");
});
