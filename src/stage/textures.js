import * as THREE from "three";

// Every asset on the table is drawn here at print resolution instead of being
// shipped as a binary. Deterministic seeds keep grain, wear and card faces
// identical between reloads and between replays of the same hand.

const TAU = Math.PI * 2;
const FALLBACK_SANS = "'Inter Variable', Inter, system-ui, -apple-system, 'Segoe UI', sans-serif";

export const CARD_ASPECT = 0.716;
export const SUITS = ["spade", "heart", "diamond", "club"];
export const SUIT_INK = { spade: "#14171c", club: "#14171c", heart: "#b02a3a", diamond: "#b02a3a" };

function mulberry32(seed) {
  let state = seed >>> 0;
  return () => {
    state = (state + 0x6d2b79f5) >>> 0;
    let value = Math.imul(state ^ (state >>> 15), 1 | state);
    value = (value + Math.imul(value ^ (value >>> 7), 61 | value)) ^ value;
    return ((value ^ (value >>> 14)) >>> 0) / 4294967296;
  };
}

export function hashString(value) {
  let hash = 2166136261;
  for (let index = 0; index < value.length; index += 1) {
    hash ^= value.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }
  return hash >>> 0;
}

function surface(width, height) {
  const canvas = document.createElement("canvas");
  canvas.width = width;
  canvas.height = height;
  const context = canvas.getContext("2d");
  context.textBaseline = "alphabetic";
  return { canvas, context };
}

function finish(canvas, { color = true, anisotropy = 8, repeat } = {}) {
  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = color ? THREE.SRGBColorSpace : THREE.NoColorSpace;
  texture.anisotropy = anisotropy;
  texture.generateMipmaps = true;
  texture.minFilter = THREE.LinearMipmapLinearFilter;
  if (repeat) {
    texture.wrapS = THREE.RepeatWrapping;
    texture.wrapT = THREE.RepeatWrapping;
    texture.repeat.set(repeat[0], repeat[1]);
  }
  return texture;
}

function roundedRect(context, x, y, width, height, radius) {
  context.beginPath();
  context.moveTo(x + radius, y);
  context.arcTo(x + width, y, x + width, y + height, radius);
  context.arcTo(x + width, y + height, x, y + height, radius);
  context.arcTo(x, y + height, x, y, radius);
  context.arcTo(x, y, x + width, y, radius);
  context.closePath();
}

// Suit glyphs are drawn as paths so the deck never depends on a font shipping
// the playing-card code points. Each path fits a unit box centred on the origin.
function suitPath(context, suit) {
  context.beginPath();
  if (suit === "heart") {
    context.moveTo(0, 0.42);
    context.bezierCurveTo(-0.62, -0.12, -0.34, -0.58, 0, -0.24);
    context.bezierCurveTo(0.34, -0.58, 0.62, -0.12, 0, 0.42);
    context.closePath();
    return;
  }
  if (suit === "diamond") {
    context.moveTo(0, -0.5);
    context.quadraticCurveTo(0.11, -0.17, 0.35, 0);
    context.quadraticCurveTo(0.11, 0.17, 0, 0.5);
    context.quadraticCurveTo(-0.11, 0.17, -0.35, 0);
    context.quadraticCurveTo(-0.11, -0.17, 0, -0.5);
    context.closePath();
    return;
  }
  if (suit === "spade") {
    context.moveTo(0, -0.47);
    context.bezierCurveTo(-0.60, 0.05, -0.34, 0.52, 0, 0.21);
    context.bezierCurveTo(0.34, 0.52, 0.60, 0.05, 0, -0.47);
    context.closePath();
    context.moveTo(-0.19, 0.5);
    context.quadraticCurveTo(-0.035, 0.42, -0.025, 0.15);
    context.lineTo(0.025, 0.15);
    context.quadraticCurveTo(0.035, 0.42, 0.19, 0.5);
    context.closePath();
    return;
  }
  const lobe = 0.212;
  context.arc(0, -0.24, lobe, 0, TAU);
  context.closePath();
  context.moveTo(-0.25 + lobe, 0.14);
  context.arc(-0.25, 0.14, lobe, 0, TAU);
  context.closePath();
  context.moveTo(0.25 + lobe, 0.14);
  context.arc(0.25, 0.14, lobe, 0, TAU);
  context.closePath();
  context.moveTo(-0.2, 0.5);
  context.quadraticCurveTo(-0.045, 0.42, -0.032, 0.06);
  context.lineTo(0.032, 0.06);
  context.quadraticCurveTo(0.045, 0.42, 0.2, 0.5);
  context.closePath();
}

function drawSuit(context, suit, x, y, size, { flipped = false, ink } = {}) {
  context.save();
  context.translate(x, y);
  context.scale(size, flipped ? -size : size);
  context.fillStyle = ink ?? SUIT_INK[suit];
  suitPath(context, suit);
  context.fill();
  context.restore();
}

// Standard pip layouts, expressed in the fraction of the pip field each pip
// occupies. Negative rows are printed upside down exactly as on a real deck.
const PIP_LAYOUTS = {
  2: [[0.5, 0], [0.5, 1]],
  3: [[0.5, 0], [0.5, 0.5], [0.5, 1]],
  4: [[0, 0], [1, 0], [0, 1], [1, 1]],
  5: [[0, 0], [1, 0], [0.5, 0.5], [0, 1], [1, 1]],
  6: [[0, 0], [1, 0], [0, 0.5], [1, 0.5], [0, 1], [1, 1]],
  7: [[0, 0], [1, 0], [0.5, 0.25], [0, 0.5], [1, 0.5], [0, 1], [1, 1]],
  8: [[0, 0], [1, 0], [0.5, 0.25], [0, 0.5], [1, 0.5], [0.5, 0.75], [0, 1], [1, 1]],
  9: [[0, 0], [1, 0], [0, 0.34], [1, 0.34], [0.5, 0.5], [0, 0.67], [1, 0.67], [0, 1], [1, 1]],
  10: [[0, 0], [1, 0], [0.5, 0.18], [0, 0.34], [1, 0.34], [0, 0.67], [1, 0.67], [0.5, 0.82], [0, 1], [1, 1]],
};

function guilloche(context, centerX, centerY, radius, ink, seed) {
  const random = mulberry32(seed);
  context.save();
  context.strokeStyle = ink;
  context.lineWidth = 1.15;
  for (let ring = 0; ring < 7; ring += 1) {
    const lobes = 5 + ring;
    const amplitude = radius * (0.09 + random() * 0.05);
    const base = radius * (0.34 + ring * 0.094);
    context.beginPath();
    for (let step = 0; step <= 260; step += 1) {
      const angle = (step / 260) * TAU;
      const distance = base + Math.sin(angle * lobes + ring) * amplitude;
      const x = centerX + Math.cos(angle) * distance;
      const y = centerY + Math.sin(angle) * distance;
      if (step === 0) context.moveTo(x, y);
      else context.lineTo(x, y);
    }
    context.stroke();
  }
  context.restore();
}

function paperGrain(context, width, height, seed, strength) {
  const random = mulberry32(seed);
  context.save();
  for (let index = 0; index < (width * height) / 220; index += 1) {
    const level = random();
    context.fillStyle = level > 0.5
      ? `rgba(255,255,255,${strength * 1.5})`
      : `rgba(60,52,40,${strength})`;
    context.fillRect(random() * width, random() * height, 1.6, 1.6);
  }
  context.restore();
}

export function cardFaceTexture(label, suit) {
  const width = 720;
  const height = Math.round(width / CARD_ASPECT);
  const { canvas, context } = surface(width, height);
  const inset = 14;
  const ink = SUIT_INK[suit];

  roundedRect(context, inset, inset, width - inset * 2, height - inset * 2, 54);
  context.save();
  context.clip();
  const wash = context.createLinearGradient(0, 0, width, height);
  wash.addColorStop(0, "#fdfcf8");
  wash.addColorStop(0.55, "#f6f3ea");
  wash.addColorStop(1, "#ebe6da");
  context.fillStyle = wash;
  context.fillRect(0, 0, width, height);
  paperGrain(context, width, height, hashString(`face:${label}:${suit}`), 0.05);

  context.strokeStyle = "rgba(24,26,32,0.13)";
  context.lineWidth = 3;
  roundedRect(context, 30, 30, width - 60, height - 60, 40);
  context.stroke();

  const isCourt = label === "J" || label === "Q" || label === "K";
  const isAce = label === "A";
  const pipCount = Number(label);

  if (isAce) {
    guilloche(context, width / 2, height / 2, 250, "rgba(24,26,32,0.05)", hashString(`ace:${suit}`));
    context.save();
    context.strokeStyle = "rgba(24,26,32,0.18)";
    context.lineWidth = 3.5;
    context.beginPath();
    context.arc(width / 2, height / 2, 214, 0, TAU);
    context.stroke();
    context.restore();
    drawSuit(context, suit, width / 2, height / 2, 300);
  } else if (isCourt) {
    guilloche(context, width / 2, height / 2, 262, "rgba(24,26,32,0.055)", hashString(`court:${label}:${suit}`));
    context.save();
    context.strokeStyle = "rgba(24,26,32,0.16)";
    context.lineWidth = 3;
    roundedRect(context, 92, 150, width - 184, height - 300, 26);
    context.stroke();
    context.restore();
    context.save();
    context.fillStyle = ink;
    context.font = `600 300px ${FALLBACK_SANS}`;
    context.textAlign = "center";
    context.fillText(label, width / 2, height / 2 + 108);
    context.restore();
    drawSuit(context, suit, width / 2, 250, 108);
    drawSuit(context, suit, width / 2, height - 250, 108, { flipped: true });
  } else {
    const layout = PIP_LAYOUTS[pipCount] ?? [];
    const fieldLeft = width * 0.29;
    const fieldRight = width * 0.71;
    const fieldTop = height * 0.19;
    const fieldBottom = height * 0.81;
    const pipSize = pipCount >= 9 ? 108 : 128;
    for (const [column, row] of layout) {
      const x = fieldLeft + (fieldRight - fieldLeft) * column;
      const y = fieldTop + (fieldBottom - fieldTop) * row;
      drawSuit(context, suit, x, y, pipSize, { flipped: row > 0.5 });
    }
  }

  // Corner index, printed on both opposite corners like a real deck.
  for (const flipped of [false, true]) {
    context.save();
    context.translate(width / 2, height / 2);
    if (flipped) context.rotate(Math.PI);
    context.translate(-width / 2, -height / 2);
    context.fillStyle = ink;
    context.textAlign = "center";
    context.font = `650 ${label === "10" ? 92 : 104}px ${FALLBACK_SANS}`;
    context.fillText(label, 88, 152);
    drawSuit(context, suit, 88, 208, 66);
    context.restore();
  }
  context.restore();
  return finish(canvas, { anisotropy: 16 });
}

export function cardBackTexture() {
  const width = 720;
  const height = Math.round(width / CARD_ASPECT);
  const { canvas, context } = surface(width, height);
  const inset = 14;
  roundedRect(context, inset, inset, width - inset * 2, height - inset * 2, 54);
  context.save();
  context.clip();
  context.fillStyle = "#f4f1e8";
  context.fillRect(0, 0, width, height);

  roundedRect(context, 34, 34, width - 68, height - 68, 38);
  const field = context.createLinearGradient(0, 0, width, height);
  field.addColorStop(0, "#5d1421");
  field.addColorStop(0.5, "#7a1a2a");
  field.addColorStop(1, "#4a0f1a");
  context.fillStyle = field;
  context.fill();

  context.save();
  roundedRect(context, 34, 34, width - 68, height - 68, 38);
  context.clip();
  context.strokeStyle = "rgba(226,186,120,0.30)";
  context.lineWidth = 2;
  for (let offset = -height; offset < width + height; offset += 26) {
    context.beginPath();
    context.moveTo(offset, 0);
    context.lineTo(offset + height, height);
    context.stroke();
    context.beginPath();
    context.moveTo(offset, height);
    context.lineTo(offset + height, 0);
    context.stroke();
  }
  guilloche(context, width / 2, height / 2, 300, "rgba(240,206,146,0.22)", 991);
  context.restore();

  // House emblem: a stylised fly, matching the site wordmark.
  context.save();
  context.translate(width / 2, height / 2);
  context.fillStyle = "rgba(20,6,10,0.42)";
  context.beginPath();
  context.ellipse(0, 0, 132, 176, 0, 0, TAU);
  context.fill();
  context.strokeStyle = "rgba(238,204,142,0.85)";
  context.lineWidth = 3.5;
  context.beginPath();
  context.ellipse(0, 0, 132, 176, 0, 0, TAU);
  context.stroke();
  context.strokeStyle = "rgba(238,204,142,0.45)";
  context.lineWidth = 1.6;
  context.beginPath();
  context.ellipse(0, 0, 116, 158, 0, 0, TAU);
  context.stroke();

  context.fillStyle = "rgba(240,208,148,0.92)";
  for (const side of [-1, 1]) {
    context.save();
    context.rotate(side * 0.46);
    context.beginPath();
    context.ellipse(side * 52, -18, 26, 78, side * 0.3, 0, TAU);
    context.fill();
    context.restore();
  }
  context.beginPath();
  context.ellipse(0, 24, 24, 62, 0, 0, TAU);
  context.fill();
  context.beginPath();
  context.arc(0, -50, 26, 0, TAU);
  context.fill();
  context.restore();
  context.restore();
  return finish(canvas, { anisotropy: 16 });
}

export function cardEdgeTexture() {
  const { canvas, context } = surface(8, 64);
  const gradient = context.createLinearGradient(0, 0, 0, 64);
  gradient.addColorStop(0, "#efeade");
  gradient.addColorStop(0.5, "#d9d2c1");
  gradient.addColorStop(1, "#efeade");
  context.fillStyle = gradient;
  context.fillRect(0, 0, 8, 64);
  return finish(canvas);
}

/**
 * Sets text along an arc that bulges toward the dealer, the way a real layout is
 * printed. The arc centre sits on the dealer side, so glyphs are placed below it
 * in canvas space and each one is counter-rotated to sit on the tangent.
 */
function arcText(context, text, centerX, centerY, radius, size, ink, { letterSpacing = 0.014 } = {}) {
  context.save();
  context.fillStyle = ink;
  context.font = `600 ${size}px ${FALLBACK_SANS}`;
  context.textAlign = "center";
  context.textBaseline = "alphabetic";
  const widths = [...text].map((glyph) => context.measureText(glyph).width);
  const gap = letterSpacing * radius;
  const total = widths.reduce((sum, value) => sum + value, 0) + gap * (text.length - 1);
  let travelled = -total / 2;
  for (let index = 0; index < text.length; index += 1) {
    const glyphAngle = (travelled + widths[index] / 2) / radius;
    context.save();
    context.translate(centerX + Math.sin(glyphAngle) * radius, centerY + Math.cos(glyphAngle) * radius);
    context.rotate(-glyphAngle);
    context.fillText(text[index], 0, 0);
    context.restore();
    travelled += widths[index] + gap;
  }
  context.restore();
}

/**
 * Felt is drawn in table space so the printed layout lines up with where cards
 * and chips are actually placed. `project` maps table (x, z) to canvas pixels.
 */
export function feltTexture(bounds, marks) {
  const pixelsPerUnit = 168;
  const width = Math.round((bounds.maxX - bounds.minX) * pixelsPerUnit);
  const height = Math.round((bounds.maxZ - bounds.minZ) * pixelsPerUnit);
  const { canvas, context } = surface(width, height);
  const project = (x, z) => [
    ((x - bounds.minX) / (bounds.maxX - bounds.minX)) * width,
    ((z - bounds.minZ) / (bounds.maxZ - bounds.minZ)) * height,
  ];
  const scale = (units) => units * pixelsPerUnit;

  const base = context.createRadialGradient(width / 2, height * 0.4, 0, width / 2, height * 0.4, height * 1.2);
  base.addColorStop(0, "#1d6349");
  base.addColorStop(0.55, "#144936");
  base.addColorStop(1, "#0d3325");
  context.fillStyle = base;
  context.fillRect(0, 0, width, height);

  // Woven fibre: short strokes in both weft directions rather than pixel noise.
  const random = mulberry32(20260914);
  context.lineWidth = 1;
  for (let index = 0; index < width * height * 0.02; index += 1) {
    const x = random() * width;
    const y = random() * height;
    const light = random() > 0.5;
    context.strokeStyle = light ? "rgba(190,236,206,0.045)" : "rgba(4,20,14,0.075)";
    context.beginPath();
    context.moveTo(x, y);
    context.lineTo(x + (random() > 0.5 ? 3 : -3), y + (random() > 0.5 ? 1 : -1));
    context.stroke();
  }

  // Print sizes are expressed against the table unit so the layout keeps its
  // proportions if the texture resolution changes.
  const ink = "rgba(243,231,201,0.92)";
  const fineInk = "rgba(243,231,201,0.5)";
  const [arcX, arcY] = project(marks.arcCenter[0], marks.arcCenter[1]);

  context.save();
  context.strokeStyle = fineInk;
  context.lineWidth = scale(0.022);
  for (const radius of marks.arcRules) {
    context.beginPath();
    context.arc(arcX, arcY, scale(radius), Math.PI * 0.13, Math.PI * 0.87);
    context.stroke();
  }
  context.restore();

  arcText(context, marks.payoutLine, arcX, arcY, scale(marks.payoutRadius), scale(0.216), ink);
  arcText(context, marks.ruleLine, arcX, arcY, scale(marks.ruleRadius), scale(0.152), "rgba(243,231,201,0.7)");

  // Betting spot for the chip stack.
  const [betX, betY] = project(marks.betSpot[0], marks.betSpot[1]);
  context.save();
  context.strokeStyle = "rgba(243,231,201,0.7)";
  context.lineWidth = scale(0.034);
  context.beginPath();
  context.arc(betX, betY, scale(marks.betRadius), 0, TAU);
  context.stroke();
  context.strokeStyle = "rgba(243,231,201,0.3)";
  context.lineWidth = scale(0.017);
  context.beginPath();
  context.arc(betX, betY, scale(marks.betRadius - 0.07), 0, TAU);
  context.stroke();
  context.restore();

  // Seat marker for the fly, so the player position reads as a real seat.
  const [seatX, seatY] = project(marks.seatSpot[0], marks.seatSpot[1]);
  context.save();
  context.strokeStyle = "rgba(243,231,201,0.3)";
  context.lineWidth = scale(0.022);
  context.setLineDash([scale(0.08), scale(0.07)]);
  context.beginPath();
  context.arc(seatX, seatY, scale(marks.betRadius * 1.32), 0, TAU);
  context.stroke();
  context.restore();

  const [markX, markY] = project(marks.wordmark[0], marks.wordmark[1]);
  context.save();
  context.fillStyle = "rgba(243,231,201,0.42)";
  context.textAlign = "center";
  context.font = `600 ${scale(0.1)}px ${FALLBACK_SANS}`;
  context.letterSpacing = `${scale(0.036)}px`;
  context.fillText("FRUITFLY BLACKJACK LAB", markX, markY);
  context.restore();

  const [noteX, noteY] = project(marks.disclaimer[0], marks.disclaimer[1]);
  context.save();
  context.fillStyle = "rgba(243,231,201,0.5)";
  context.textAlign = "center";
  context.font = `600 ${scale(0.092)}px ${FALLBACK_SANS}`;
  context.letterSpacing = `${scale(0.028)}px`;
  context.fillText(marks.disclaimerLine, noteX, noteY);
  context.restore();

  // Gentle edge shading so the felt does not read as flat vector art.
  const edge = context.createRadialGradient(width / 2, height * 0.44, height * 0.5, width / 2, height * 0.44, height * 1.05);
  edge.addColorStop(0, "rgba(0,0,0,0)");
  edge.addColorStop(1, "rgba(0,0,0,0.3)");
  context.fillStyle = edge;
  context.fillRect(0, 0, width, height);

  return finish(canvas, { anisotropy: 16 });
}

export function leatherTexture() {
  const size = 1024;
  const { canvas, context } = surface(size, size);
  context.fillStyle = "#6b4331";
  context.fillRect(0, 0, size, size);
  const random = mulberry32(4242);
  for (let index = 0; index < 5200; index += 1) {
    const x = random() * size;
    const y = random() * size;
    const radius = 6 + random() * 26;
    context.strokeStyle = random() > 0.5 ? "rgba(154,110,80,0.28)" : "rgba(34,18,12,0.3)";
    context.lineWidth = 1.6 + random() * 2.2;
    context.beginPath();
    context.arc(x, y, radius, random() * TAU, random() * TAU + 1.6);
    context.stroke();
  }
  // No directional sheen: the rail is tiled, and a gradient would print the
  // tile seams straight onto the leather.
  for (let index = 0; index < 2600; index += 1) {
    context.fillStyle = random() > 0.5 ? "rgba(214,168,126,0.12)" : "rgba(26,13,8,0.16)";
    context.beginPath();
    context.arc(random() * size, random() * size, 1.5 + random() * 4, 0, TAU);
    context.fill();
  }
  return finish(canvas, { repeat: [7, 7] });
}

export function leatherRoughness() {
  const size = 512;
  const { canvas, context } = surface(size, size);
  context.fillStyle = "#9a9a9a";
  context.fillRect(0, 0, size, size);
  const random = mulberry32(77);
  for (let index = 0; index < 9000; index += 1) {
    const level = 120 + Math.round(random() * 110);
    context.fillStyle = `rgb(${level},${level},${level})`;
    context.beginPath();
    context.arc(random() * size, random() * size, 2 + random() * 7, 0, TAU);
    context.fill();
  }
  return finish(canvas, { color: false, repeat: [4, 4] });
}

export const CHIP_DENOMINATIONS = [
  { value: 500_000, label: "5,000", body: "#c2570f", accent: "#f6e3cf" },
  { value: 100_000, label: "1,000", body: "#c9a227", accent: "#2b220a" },
  { value: 50_000, label: "500", body: "#5b3f92", accent: "#efe8fb" },
  { value: 10_000, label: "100", body: "#191c22", accent: "#f2f0ea" },
  { value: 2_500, label: "25", body: "#1f6f4a", accent: "#eaf7ef" },
  { value: 500, label: "5", body: "#a32531", accent: "#fbeced" },
];

/**
 * Picks a denomination mix that reads as a real stack: start from the largest
 * chip that appears at least three times, then fill down. A flat ₹100 wager
 * becomes four green ₹25s rather than one lonely chip.
 */
export function chipStack(paise, limit = 13) {
  const base = CHIP_DENOMINATIONS.find((chip) => Math.floor(paise / chip.value) >= 3)
    ?? CHIP_DENOMINATIONS.at(-1);
  const usable = CHIP_DENOMINATIONS.slice(CHIP_DENOMINATIONS.indexOf(base));
  const chips = [];
  let remaining = Math.max(0, Math.round(paise));
  for (const chip of usable) {
    while (remaining >= chip.value && chips.length < limit) {
      chips.push(chip);
      remaining -= chip.value;
    }
  }
  if (!chips.length && paise > 0) chips.push(CHIP_DENOMINATIONS.at(-1));
  return chips;
}

export function chipFaceTexture(chip) {
  const size = 512;
  const { canvas, context } = surface(size, size);
  const center = size / 2;
  context.clearRect(0, 0, size, size);
  context.save();
  context.beginPath();
  context.arc(center, center, center, 0, TAU);
  context.clip();

  context.fillStyle = chip.body;
  context.fillRect(0, 0, size, size);

  // Edge spots.
  context.save();
  context.translate(center, center);
  context.fillStyle = chip.accent;
  for (let index = 0; index < 8; index += 1) {
    context.save();
    context.rotate((index / 8) * TAU);
    context.beginPath();
    context.moveTo(-34, -center);
    context.lineTo(34, -center);
    context.lineTo(26, -center + 62);
    context.lineTo(-26, -center + 62);
    context.closePath();
    context.fill();
    context.restore();
  }
  context.restore();

  context.strokeStyle = "rgba(255,255,255,0.34)";
  context.lineWidth = 7;
  context.beginPath();
  context.arc(center, center, center - 74, 0, TAU);
  context.stroke();
  context.strokeStyle = "rgba(0,0,0,0.30)";
  context.lineWidth = 3;
  context.beginPath();
  context.arc(center, center, center - 92, 0, TAU);
  context.stroke();

  const inlay = context.createRadialGradient(center, center - 40, 10, center, center, center - 96);
  inlay.addColorStop(0, "rgba(255,255,255,0.16)");
  inlay.addColorStop(1, "rgba(0,0,0,0.24)");
  context.fillStyle = inlay;
  context.beginPath();
  context.arc(center, center, center - 96, 0, TAU);
  context.fill();

  context.fillStyle = chip.accent;
  context.textAlign = "center";
  context.font = `700 128px ${FALLBACK_SANS}`;
  context.fillText(chip.label, center, center + 30);
  context.font = `600 40px ${FALLBACK_SANS}`;
  context.globalAlpha = 0.78;
  context.fillText("SIM INR", center, center + 96);
  context.restore();
  return finish(canvas, { anisotropy: 8 });
}

export function chipEdgeTexture(chip) {
  const { canvas, context } = surface(256, 32);
  context.fillStyle = chip.body;
  context.fillRect(0, 0, 256, 32);
  context.fillStyle = chip.accent;
  for (let index = 0; index < 16; index += 1) {
    if (index % 2 === 0) context.fillRect(index * 16, 0, 9, 32);
  }
  const shade = context.createLinearGradient(0, 0, 0, 32);
  shade.addColorStop(0, "rgba(0,0,0,0.42)");
  shade.addColorStop(0.5, "rgba(255,255,255,0.12)");
  shade.addColorStop(1, "rgba(0,0,0,0.46)");
  context.fillStyle = shade;
  context.fillRect(0, 0, 256, 32);
  return finish(canvas);
}

export function flyBodyTexture() {
  const { canvas, context } = surface(512, 512);
  const base = context.createLinearGradient(0, 0, 0, 512);
  base.addColorStop(0, "#7a4a16");
  base.addColorStop(0.35, "#9a6320");
  base.addColorStop(1, "#3d2409");
  context.fillStyle = base;
  context.fillRect(0, 0, 512, 512);
  // Tergite bands run around the abdomen.
  context.fillStyle = "rgba(22,14,6,0.86)";
  for (let index = 0; index < 5; index += 1) {
    const y = 120 + index * 74;
    context.beginPath();
    context.ellipse(256, y, 300, 20 + index * 3.5, 0, 0, TAU);
    context.fill();
  }
  const random = mulberry32(8181);
  for (let index = 0; index < 5200; index += 1) {
    context.fillStyle = random() > 0.5 ? "rgba(255,220,160,0.05)" : "rgba(0,0,0,0.07)";
    context.fillRect(random() * 512, random() * 512, 2, 2);
  }
  return finish(canvas);
}

export function flyEyeTexture() {
  const size = 512;
  const { canvas, context } = surface(size, size);
  context.fillStyle = "#8e1b18";
  context.fillRect(0, 0, size, size);
  const radius = 9;
  const stepX = radius * 1.72;
  const stepY = radius * 1.5;
  for (let row = 0; row * stepY < size + stepY; row += 1) {
    for (let column = 0; column * stepX < size + stepX; column += 1) {
      const x = column * stepX + (row % 2 ? stepX / 2 : 0);
      const y = row * stepY;
      const facet = context.createRadialGradient(x - 2.5, y - 2.5, 0.5, x, y, radius);
      facet.addColorStop(0, "#d9524a");
      facet.addColorStop(0.6, "#a3211d");
      facet.addColorStop(1, "#5c0d0c");
      context.fillStyle = facet;
      context.beginPath();
      for (let corner = 0; corner < 6; corner += 1) {
        const angle = (corner / 6) * TAU + Math.PI / 6;
        const px = x + Math.cos(angle) * radius * 0.94;
        const py = y + Math.sin(angle) * radius * 0.94;
        if (corner === 0) context.moveTo(px, py);
        else context.lineTo(px, py);
      }
      context.closePath();
      context.fill();
    }
  }
  return finish(canvas, { anisotropy: 8 });
}

export function wingAlphaTexture() {
  const width = 512;
  const height = 256;
  const { canvas, context } = surface(width, height);
  context.fillStyle = "#2b2b2b";
  context.fillRect(0, 0, width, height);
  context.strokeStyle = "#d6d6d6";
  context.lineCap = "round";
  const veins = [
    [[6, 128], [150, 96], [330, 88], [500, 108]],
    [[6, 132], [160, 132], [340, 140], [500, 152]],
    [[10, 138], [150, 168], [320, 188], [470, 196]],
    [[14, 142], [120, 196], [230, 224], [330, 232]],
  ];
  for (const path of veins) {
    context.lineWidth = 5;
    context.beginPath();
    context.moveTo(path[0][0], path[0][1]);
    for (let index = 1; index < path.length; index += 1) context.lineTo(path[index][0], path[index][1]);
    context.stroke();
  }
  context.lineWidth = 3;
  for (const [start, end] of [[[196, 100], [188, 172]], [[300, 92], [312, 182]], [[404, 100], [418, 168]]]) {
    context.beginPath();
    context.moveTo(start[0], start[1]);
    context.lineTo(end[0], end[1]);
    context.stroke();
  }
  const fade = context.createLinearGradient(0, 0, width, 0);
  fade.addColorStop(0, "rgba(120,120,120,0.55)");
  fade.addColorStop(0.7, "rgba(0,0,0,0)");
  context.fillStyle = fade;
  context.fillRect(0, 0, width, height);
  return finish(canvas, { color: false });
}

export function floorTexture() {
  const size = 1024;
  const { canvas, context } = surface(size, size);
  context.fillStyle = "#0a0b0c";
  context.fillRect(0, 0, size, size);
  const random = mulberry32(555);
  for (let index = 0; index < 24_000; index += 1) {
    const level = random() * 0.05;
    context.fillStyle = `rgba(180,190,200,${level})`;
    context.fillRect(random() * size, random() * size, 2, 2);
  }
  for (let index = 0; index < 90; index += 1) {
    context.strokeStyle = "rgba(150,120,90,0.035)";
    context.lineWidth = 1 + random() * 2;
    const y = random() * size;
    context.beginPath();
    context.moveTo(0, y);
    context.bezierCurveTo(size * 0.3, y + random() * 30 - 15, size * 0.7, y + random() * 30 - 15, size, y);
    context.stroke();
  }
  return finish(canvas, { repeat: [3, 3] });
}
