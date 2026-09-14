import * as THREE from "three";

import {
  CHIP_DENOMINATIONS,
  cardBackTexture,
  chipEdgeTexture,
  chipFaceTexture,
  chipStack,
  feltTexture,
  floorTexture,
  leatherRoughness,
  leatherTexture,
} from "./textures.js";

// Table geometry in world units. The felt surface sits at y = 0 so anything
// placed on it uses plain (x, z) coordinates. Negative z is the dealer side.
export const TABLE = {
  halfWidth: 3.1,
  dealerEdge: -1.6,
  playerApex: 2.6,
  notchDepth: 0.4,
  thickness: 0.5,
  railWidth: 0.44,
  dealerCards: -0.6,
  playerCards: 0.62,
  playerCenter: 0.55,
  betSpot: [1.62, 1.16],
  seatSpot: [-1.05, 1.45],
  shoe: [-1.92, -0.48],
  tray: [1.95, -0.48],
};

const FELT_MARKS = {
  arcCenter: [0, TABLE.dealerEdge - 0.4],
  arcRules: [1.52, 2.3],
  payoutLine: "BLACKJACK PAYS 3 TO 2",
  payoutRadius: 1.78,
  ruleLine: "DEALER MUST STAND ON ALL 17s",
  ruleRadius: 2.14,
  betSpot: TABLE.betSpot,
  betRadius: 0.42,
  seatSpot: TABLE.seatSpot,
  wordmark: [0, -1.16],
  disclaimer: [0, 1.94],
  disclaimerLine: "SIX DECKS · SIMULATED PLAY · NO CASH VALUE",
};

/**
 * Table outline as a 2D shape. Shape y maps to world -z once the geometry is
 * laid flat, so dealer-side coordinates are positive inside this function.
 */
function outline(inflate = 0) {
  const halfWidth = TABLE.halfWidth + inflate;
  const dealerEdge = -TABLE.dealerEdge + inflate;
  const playerApex = -TABLE.playerApex - inflate;
  const centerY = (halfWidth ** 2 + dealerEdge ** 2 - playerApex ** 2) / (2 * (dealerEdge - playerApex));
  const radius = centerY - playerApex;
  const start = Math.atan2(dealerEdge - centerY, halfWidth);
  const end = Math.atan2(dealerEdge - centerY, -halfWidth) - Math.PI * 2;

  const shape = new THREE.Shape();
  shape.moveTo(halfWidth, dealerEdge);
  shape.absarc(0, centerY, radius, start, end, true);
  // Shallow notch so the dealer stands inside the table instead of behind a wall.
  shape.quadraticCurveTo(0, dealerEdge - TABLE.notchDepth, halfWidth, dealerEdge);
  return shape;
}

function layFlat(geometry) {
  geometry.rotateX(-Math.PI / 2);
  return geometry;
}

/**
 * A bevelled extrusion grows past its nominal depth at both ends, so stacking
 * order cannot be reasoned about from the depth alone. Pin the measured top face
 * instead; otherwise the slab covers the printed felt and the dealt cards.
 */
function alignTop(geometry, topY) {
  geometry.computeBoundingBox();
  geometry.translate(0, topY - geometry.boundingBox.max.y, 0);
  return geometry;
}

// ShapeGeometry emits raw shape coordinates as UVs, so remap them onto the
// printed felt artwork, which is drawn in the same table space.
function normalizeShapeUv(geometry, bounds) {
  const uv = geometry.attributes.uv;
  const spanX = bounds.maxX - bounds.minX;
  const spanZ = bounds.maxZ - bounds.minZ;
  for (let index = 0; index < uv.count; index += 1) {
    const worldX = uv.getX(index);
    const worldZ = -uv.getY(index);
    uv.setXY(index, (worldX - bounds.minX) / spanX, 1 - (worldZ - bounds.minZ) / spanZ);
  }
  uv.needsUpdate = true;
}

export class Table {
  constructor(scene, { shadows = true } = {}) {
    this.scene = scene;
    this.shadows = shadows;
    this.chipMaterials = new Map();
    this.group = new THREE.Group();
    this.group.position.y = -TABLE.thickness;
    scene.add(this.group);

    this.bounds = {
      minX: -TABLE.halfWidth,
      maxX: TABLE.halfWidth,
      minZ: TABLE.dealerEdge,
      maxZ: TABLE.playerApex,
    };

    this.buildRoom();
    this.buildTable();
    this.buildFurniture();

    this.chipStack = new THREE.Group();
    this.chipStack.position.set(TABLE.betSpot[0], TABLE.thickness + 0.006, TABLE.betSpot[1]);
    this.group.add(this.chipStack);
  }

  buildRoom() {
    const floor = new THREE.Mesh(
      new THREE.PlaneGeometry(80, 80),
      new THREE.MeshStandardMaterial({ map: floorTexture(), color: 0x1e2126, roughness: 0.78, metalness: 0.08 }),
    );
    floor.rotation.x = -Math.PI / 2;
    floor.position.y = -2.4;
    floor.receiveShadow = this.shadows;
    this.group.add(floor);
  }

  buildTable() {
    const feltShape = new THREE.Shape(outline().getPoints(200));
    const surfaceGeometry = layFlat(new THREE.ShapeGeometry(feltShape));
    normalizeShapeUv(surfaceGeometry, this.bounds);
    this.feltMaterial = new THREE.MeshStandardMaterial({
      map: feltTexture(this.bounds, FELT_MARKS), roughness: 0.97, metalness: 0,
    });
    const feltMesh = new THREE.Mesh(surfaceGeometry, this.feltMaterial);
    feltMesh.position.y = TABLE.thickness + 0.002;
    feltMesh.receiveShadow = this.shadows;
    this.group.add(feltMesh);

    const slab = alignTop(layFlat(new THREE.ExtrudeGeometry(outline(0.01), {
      depth: TABLE.thickness, bevelEnabled: true, bevelThickness: 0.05, bevelSize: 0.06, bevelSegments: 3, curveSegments: 96,
    })), TABLE.thickness - 0.004);
    const body = new THREE.Mesh(slab, new THREE.MeshStandardMaterial({ color: 0x0c1712, roughness: 0.72, metalness: 0.06 }));
    body.receiveShadow = this.shadows;
    this.group.add(body);

    const railShape = new THREE.Shape(outline(TABLE.railWidth).getPoints(200));
    railShape.holes.push(new THREE.Path(outline(-0.03).getPoints(200)));
    const railGeometry = alignTop(layFlat(new THREE.ExtrudeGeometry(railShape, {
      depth: TABLE.thickness, bevelEnabled: true, bevelThickness: 0.09, bevelSize: 0.11, bevelSegments: 5, curveSegments: 96,
    })), TABLE.thickness + 0.15);
    const rail = new THREE.Mesh(railGeometry, new THREE.MeshStandardMaterial({
      map: leatherTexture(), roughnessMap: leatherRoughness(),
      roughness: 0.62, metalness: 0.08, envMapIntensity: 1,
    }));
    rail.castShadow = this.shadows;
    rail.receiveShadow = this.shadows;
    this.group.add(rail);

    const pedestalGeometry = layFlat(new THREE.ExtrudeGeometry(outline(TABLE.railWidth - 0.06), {
      depth: 2.4, bevelEnabled: false, curveSegments: 64,
    }));
    const pedestal = new THREE.Mesh(pedestalGeometry, new THREE.MeshStandardMaterial({ color: 0x131010, roughness: 0.88 }));
    pedestal.position.y = -2.4;
    pedestal.scale.set(0.88, 1, 0.88);
    this.group.add(pedestal);
  }

  /**
   * The dealer's chip float. Chips stand on edge in five rows, so only the edge
   * material is ever visible and each row can be a single instanced draw.
   */
  buildChipRack() {
    const rack = new THREE.Group();
    rack.position.set(0, TABLE.thickness, TABLE.dealerEdge + 0.36);
    const shell = new THREE.Mesh(
      new THREE.BoxGeometry(1.7, 0.09, 0.34),
      new THREE.MeshStandardMaterial({ color: 0x2c313a, roughness: 0.28, metalness: 0.66, envMapIntensity: 1.5 }),
    );
    shell.position.y = 0.045;
    shell.castShadow = this.shadows;
    rack.add(shell);

    const geometry = new THREE.CylinderGeometry(0.1, 0.1, 0.03, 22, 1, false);
    geometry.rotateZ(Math.PI / 2);
    CHIP_DENOMINATIONS.slice(1, 6).forEach((chip, row) => {
      const material = new THREE.MeshStandardMaterial({ map: chipEdgeTexture(chip), roughness: 0.48, metalness: 0.06 });
      const instances = new THREE.InstancedMesh(geometry, material, 7);
      const matrix = new THREE.Matrix4();
      for (let index = 0; index < 7; index += 1) {
        matrix.setPosition(-0.66 + row * 0.33, 0.14, -0.105 + index * 0.035);
        instances.setMatrixAt(index, matrix);
      }
      instances.instanceMatrix.needsUpdate = true;
      rack.add(instances);
    });
    this.group.add(rack);
  }

  buildFurniture() {
    this.buildChipRack();
    const acrylic = new THREE.MeshStandardMaterial({
      color: 0x1b2027, roughness: 0.12, metalness: 0.2, transparent: true, opacity: 0.66, envMapIntensity: 1.6,
    });
    const shoe = new THREE.Group();
    shoe.position.set(TABLE.shoe[0], TABLE.thickness, TABLE.shoe[1]);
    shoe.rotation.y = 0.34;
    const housing = new THREE.Mesh(new THREE.BoxGeometry(0.66, 0.34, 0.84), acrylic);
    housing.position.y = 0.17;
    housing.castShadow = this.shadows;
    const deck = new THREE.Mesh(
      new THREE.BoxGeometry(0.52, 0.22, 0.68),
      new THREE.MeshStandardMaterial({ color: 0x6e1826, roughness: 0.6 }),
    );
    deck.position.set(0, 0.12, -0.03);
    const lip = new THREE.Mesh(
      new THREE.BoxGeometry(0.68, 0.06, 0.19),
      new THREE.MeshStandardMaterial({ color: 0x333a44, roughness: 0.3, metalness: 0.65 }),
    );
    lip.position.set(0, 0.03, 0.48);
    shoe.add(housing, deck, lip);
    this.group.add(shoe);

    const tray = new THREE.Group();
    tray.position.set(TABLE.tray[0], TABLE.thickness, TABLE.tray[1]);
    tray.rotation.y = -0.34;
    // Base plate rather than a solid block, so the growing pile stays visible.
    const trayBody = new THREE.Mesh(
      new THREE.BoxGeometry(0.74, 0.06, 0.88),
      new THREE.MeshStandardMaterial({ color: 0x262b32, roughness: 0.34, metalness: 0.42 }),
    );
    trayBody.position.y = 0.03;
    trayBody.castShadow = this.shadows;
    // Played cards read as a stack of cream edges with a face-down card on top.
    const edge = new THREE.MeshStandardMaterial({ color: 0xded7c6, roughness: 0.7 });
    const top = new THREE.MeshStandardMaterial({ map: cardBackTexture(), roughness: 0.5 });
    this.discardPile = new THREE.Mesh(
      new THREE.BoxGeometry(0.58, 0.04, 0.72),
      [edge, edge, top, edge, edge, edge],
    );
    this.discardPile.position.y = 0.08;
    tray.add(trayBody, this.discardPile);
    this.group.add(tray);
  }

  /** The discard pile grows through the shoe, matching the cards-dealt counter. */
  setShoeProgress(fraction) {
    const clamped = Math.max(0, Math.min(1, fraction));
    this.discardPile.scale.y = 0.5 + clamped * 5.5;
    this.discardPile.position.y = 0.07 + clamped * 0.11;
  }

  /** Lays a chip stack on the betting spot that adds up to the simulated wager. */
  setWager(paise) {
    if (this.wagerPaise === paise) return;
    this.wagerPaise = paise;
    this.chipStack.clear();
    chipStack(paise).forEach((chip, index) => {
      const mesh = this.chipMesh(chip);
      const drift = (index % 3 - 1) * 0.006;
      mesh.position.set(drift, 0.02 + index * 0.037, drift * 0.8);
      mesh.rotation.y = index * 0.62;
      this.chipStack.add(mesh);
    });
  }

  chipMesh(chip) {
    if (!this.chipMaterials.has(chip.label)) {
      const face = new THREE.MeshStandardMaterial({
        map: chipFaceTexture(chip), roughness: 0.38, metalness: 0.04, envMapIntensity: 1.1,
      });
      const edge = new THREE.MeshStandardMaterial({ map: chipEdgeTexture(chip), roughness: 0.52 });
      this.chipMaterials.set(chip.label, [edge, face, face]);
    }
    const mesh = new THREE.Mesh(
      new THREE.CylinderGeometry(0.19, 0.19, 0.036, 40, 1, false),
      this.chipMaterials.get(chip.label),
    );
    mesh.castShadow = this.shadows;
    return mesh;
  }

  /** Redraws the printed felt once webfonts have loaded. */
  refreshFelt() {
    const previous = this.feltMaterial.map;
    this.feltMaterial.map = feltTexture(this.bounds, FELT_MARKS);
    this.feltMaterial.needsUpdate = true;
    previous?.dispose();
  }
}
