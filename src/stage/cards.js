import * as THREE from "three";

import { CARD_ASPECT, SUITS, cardBackTexture, cardEdgeTexture, cardFaceTexture, hashString } from "./textures.js";

export const CARD_WIDTH = 0.62;
export const CARD_HEIGHT = CARD_WIDTH / CARD_ASPECT;
const CARD_DEPTH = 0.013;
const CORNER = CARD_WIDTH * 0.075;
const FACE_UP = -Math.PI / 2;

// The simulator only tracks blackjack values, so a ten is rendered as one of
// 10/J/Q/K. The choice is hashed from the hand id, so replaying a hand always
// shows the same physical cards.
const TEN_LABELS = ["10", "J", "Q", "K"];

export function faceOf(rank, seedKey) {
  const seed = hashString(seedKey);
  const suit = SUITS[seed % 4];
  if (rank === 11) return { label: "A", suit };
  if (rank === 10) return { label: TEN_LABELS[(seed >>> 3) % 4], suit };
  return { label: String(rank), suit };
}

function roundedCardShape() {
  const halfWidth = CARD_WIDTH / 2;
  const halfHeight = CARD_HEIGHT / 2;
  const shape = new THREE.Shape();
  shape.moveTo(-halfWidth + CORNER, -halfHeight);
  shape.lineTo(halfWidth - CORNER, -halfHeight);
  shape.quadraticCurveTo(halfWidth, -halfHeight, halfWidth, -halfHeight + CORNER);
  shape.lineTo(halfWidth, halfHeight - CORNER);
  shape.quadraticCurveTo(halfWidth, halfHeight, halfWidth - CORNER, halfHeight);
  shape.lineTo(-halfWidth + CORNER, halfHeight);
  shape.quadraticCurveTo(-halfWidth, halfHeight, -halfWidth, halfHeight - CORNER);
  shape.lineTo(-halfWidth, -halfHeight + CORNER);
  shape.quadraticCurveTo(-halfWidth, -halfHeight, -halfWidth + CORNER, -halfHeight);
  return shape;
}

function faceGeometry(mirrored) {
  const geometry = new THREE.ShapeGeometry(roundedCardShape(), 10);
  const uv = geometry.attributes.uv;
  for (let index = 0; index < uv.count; index += 1) {
    const u = (uv.getX(index) + CARD_WIDTH / 2) / CARD_WIDTH;
    const v = (uv.getY(index) + CARD_HEIGHT / 2) / CARD_HEIGHT;
    uv.setXY(index, mirrored ? 1 - u : u, v);
  }
  uv.needsUpdate = true;
  if (mirrored) geometry.rotateY(Math.PI);
  return geometry;
}

const easeOut = (value) => 1 - Math.pow(1 - value, 3);

/**
 * Owns every card mesh on the felt plus the deal, flip and discard motion.
 * Layouts are reconciled, so an unchanged prefix of a hand keeps its meshes and
 * only genuinely new cards fly in from the shoe.
 */
export class CardTable {
  constructor(parent, { shoeOrigin, discardOrigin, reducedMotion = false, shadows = true }) {
    this.parent = parent;
    this.shoeOrigin = shoeOrigin;
    this.discardOrigin = discardOrigin;
    this.reducedMotion = reducedMotion;
    this.shadows = shadows;
    this.faceCache = new Map();
    this.frontGeometry = faceGeometry(false);
    this.backGeometry = faceGeometry(true);
    this.coreGeometry = new THREE.ExtrudeGeometry(roundedCardShape(), {
      depth: CARD_DEPTH, bevelEnabled: false, curveSegments: 10,
    });
    this.coreGeometry.translate(0, 0, -CARD_DEPTH / 2);
    this.coreMaterial = new THREE.MeshStandardMaterial({ map: cardEdgeTexture(), color: 0xe8e2d4, roughness: 0.62 });
    this.backMaterial = new THREE.MeshStandardMaterial({ map: cardBackTexture(), roughness: 0.5, metalness: 0.02 });
    this.rows = new Map();
    this.retired = new Set();
  }

  faceMaterial(label, suit) {
    const key = `${label}:${suit}`;
    if (!this.faceCache.has(key)) {
      this.faceCache.set(key, new THREE.MeshStandardMaterial({
        map: cardFaceTexture(label, suit), roughness: 0.48, metalness: 0.02,
      }));
    }
    return this.faceCache.get(key);
  }

  createCard(spec) {
    const card = new THREE.Group();
    const core = new THREE.Mesh(this.coreGeometry, this.coreMaterial);
    core.castShadow = this.shadows;
    const front = new THREE.Mesh(this.frontGeometry, this.faceMaterial(spec.label, spec.suit));
    front.position.z = CARD_DEPTH / 2 + 0.0007;
    const back = new THREE.Mesh(this.backGeometry, this.backMaterial);
    back.position.z = -CARD_DEPTH / 2 - 0.0007;
    card.add(core, front, back);
    card.userData = {
      label: spec.label, suit: spec.suit, placeholder: Boolean(spec.placeholder),
      front, hidden: true, flip: 1, t: this.reducedMotion ? 1 : 0, delay: 0,
      from: new THREE.Vector3(this.shoeOrigin[0], 0.3, this.shoeOrigin[1]),
      to: new THREE.Vector3(this.shoeOrigin[0], 0.3, this.shoeOrigin[1]),
      tilt: 0, spin: Math.random() * 0.7 - 0.35,
    };
    card.position.copy(card.userData.from);
    card.rotation.set(FACE_UP + Math.PI, card.userData.spin, 0);
    this.parent.add(card);
    return card;
  }

  setFace(card, spec) {
    card.userData.label = spec.label;
    card.userData.suit = spec.suit;
    card.userData.placeholder = Boolean(spec.placeholder);
    card.userData.front.material = this.faceMaterial(spec.label, spec.suit);
  }

  moveTo(card, spec, delay) {
    const destination = new THREE.Vector3(...spec.position);
    if (card.userData.to.distanceTo(destination) > 0.002 || card.userData.t < 1) {
      card.userData.from = card.position.clone();
      card.userData.to = destination;
      card.userData.t = this.reducedMotion ? 1 : 0;
      card.userData.delay = this.reducedMotion ? 0 : delay;
    }
    card.userData.tilt = spec.tilt;
    card.userData.hidden = Boolean(spec.hidden);
  }

  layout(rows) {
    const seen = new Set();
    for (const row of rows) {
      seen.add(row.key);
      const previous = this.rows.get(row.key);
      const signature = `${row.slot}|${row.cards.map((card) => `${card.label}${card.suit}${card.hidden ? "*" : ""}`).join(",")}`;
      if (previous?.signature === signature) continue;
      const kept = previous?.cards ?? [];
      const cards = [];
      row.cards.forEach((spec, index) => {
        const existing = kept[index];
        const sameFace = existing && existing.userData.label === spec.label && existing.userData.suit === spec.suit;
        const revealing = existing && existing.userData.placeholder && !spec.placeholder;
        let card = existing;
        if (!existing || (!sameFace && !revealing)) {
          if (existing) this.retire(existing);
          card = this.createCard(spec);
        } else if (revealing) {
          this.setFace(card, spec);
        }
        this.moveTo(card, spec, index * 0.1);
        cards.push(card);
      });
      for (let index = row.cards.length; index < kept.length; index += 1) this.retire(kept[index]);
      this.rows.set(row.key, { cards, signature });
    }
    for (const [key, row] of [...this.rows]) {
      if (seen.has(key)) continue;
      row.cards.forEach((card) => this.retire(card));
      this.rows.delete(key);
    }
  }

  retire(card) {
    if (this.reducedMotion) {
      this.disposeCard(card);
      return;
    }
    this.retired.add(card);
    card.userData.from = card.position.clone();
    card.userData.to = new THREE.Vector3(this.discardOrigin[0], 0.06, this.discardOrigin[1]);
    card.userData.t = 0;
    card.userData.delay = 0;
    card.userData.hidden = true;
    card.userData.tilt = -0.3;
    card.userData.lifetime = 1.1;
  }

  disposeCard(card) {
    this.retired.delete(card);
    card.removeFromParent();
  }

  advance(card, delta) {
    const data = card.userData;
    if (data.delay > 0) {
      data.delay -= delta;
      return;
    }
    data.t = Math.min(1, data.t + delta * 2.1);
    const eased = easeOut(data.t);
    card.position.lerpVectors(data.from, data.to, eased);
    card.position.y = data.from.y + (data.to.y - data.from.y) * eased + Math.sin(eased * Math.PI) * 0.2;

    const flipTarget = data.hidden ? 1 : 0;
    const step = Math.min(delta * 3.6, Math.abs(flipTarget - data.flip));
    data.flip += Math.sign(flipTarget - data.flip) * step;
    card.rotation.x = FACE_UP + data.flip * Math.PI;
    card.rotation.y += (0 - card.rotation.y) * Math.min(1, delta * 5);
    card.rotation.z += (data.tilt - card.rotation.z) * Math.min(1, delta * 6);
  }

  update(delta) {
    for (const row of this.rows.values()) {
      for (const card of row.cards) this.advance(card, delta);
    }
    for (const card of [...this.retired]) {
      this.advance(card, delta);
      card.userData.lifetime -= delta;
      if (card.userData.lifetime <= 0) this.disposeCard(card);
    }
  }

  /** Regenerates cached faces once the webfont is available. */
  refreshFaces() {
    for (const [key, material] of this.faceCache) {
      const [label, suit] = key.split(":");
      const previous = material.map;
      material.map = cardFaceTexture(label, suit);
      material.needsUpdate = true;
      previous?.dispose();
    }
    const previousBack = this.backMaterial.map;
    this.backMaterial.map = cardBackTexture();
    this.backMaterial.needsUpdate = true;
    previousBack?.dispose();
  }
}

/** Overlapping fan used for the dealer row and for each player hand. */
export function fanPositions(count, centerX, zLine) {
  const spread = CARD_WIDTH * 0.7;
  const offset = ((count - 1) * spread) / 2;
  return Array.from({ length: count }, (_, index) => ({
    position: [centerX + index * spread - offset, 0.006 + index * 0.004, zLine + index * 0.05],
    tilt: (index - (count - 1) / 2) * 0.05,
  }));
}
