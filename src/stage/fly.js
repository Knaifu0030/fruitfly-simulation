import * as THREE from "three";

import { flyBodyTexture, flyEyeTexture, wingAlphaTexture } from "./textures.js";

// A stylised but anatomically ordered Drosophila: three tagmata, two wings, six
// three-jointed legs, large compound eyes. Proportions are exaggerated enough to
// read at table scale without inventing anatomy the animal does not have.

function segment(from, to, radiusStart, radiusEnd, material, shadows) {
  const direction = new THREE.Vector3().subVectors(to, from);
  const length = direction.length();
  const geometry = new THREE.CylinderGeometry(radiusStart, radiusEnd, length, 7, 1);
  geometry.translate(0, length / 2, 0);
  const mesh = new THREE.Mesh(geometry, material);
  mesh.position.copy(from);
  mesh.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), direction.normalize());
  mesh.castShadow = shadows;
  return mesh;
}

function wingShape() {
  const shape = new THREE.Shape();
  shape.moveTo(0, 0);
  shape.bezierCurveTo(0.13, -0.10, 0.22, -0.52, 0.10, -0.82);
  shape.bezierCurveTo(0.02, -0.96, -0.05, -0.91, -0.07, -0.70);
  shape.bezierCurveTo(-0.10, -0.42, -0.07, -0.14, 0, 0);
  return shape;
}

function wingGeometry() {
  const geometry = new THREE.ShapeGeometry(wingShape(), 24);
  const uv = geometry.attributes.uv;
  for (let index = 0; index < uv.count; index += 1) {
    const x = uv.getX(index);
    const y = uv.getY(index);
    uv.setXY(index, Math.min(1, -y / 0.96), (x + 0.1) / 0.34);
  }
  uv.needsUpdate = true;
  geometry.rotateX(-Math.PI / 2);
  return geometry;
}

export class Fly {
  constructor(parent, { reducedMotion = false, shadows = true } = {}) {
    this.reducedMotion = reducedMotion;
    this.shadows = shadows;
    this.mood = "idle";
    this.moodClock = 0;
    this.buzz = 0;
    this.group = new THREE.Group();
    this.group.scale.setScalar(0.95);
    parent.add(this.group);

    this.chitin = new THREE.MeshStandardMaterial({
      color: 0x2a1e15, roughness: 0.36, metalness: 0.16, envMapIntensity: 1.3,
    });
    this.shell = new THREE.MeshStandardMaterial({
      map: flyBodyTexture(), roughness: 0.42, metalness: 0.1, envMapIntensity: 1.1,
    });
    this.eyeMaterial = new THREE.MeshStandardMaterial({
      map: flyEyeTexture(), roughness: 0.2, metalness: 0.12,
      envMapIntensity: 2.2, emissive: 0x300707, emissiveIntensity: 0.22,
    });
    this.wingMaterial = new THREE.MeshStandardMaterial({
      color: 0xeaf6fa, alphaMap: wingAlphaTexture(), transparent: true, opacity: 1,
      roughness: 0.08, metalness: 0.55, envMapIntensity: 3.2,
      emissive: 0x25333a, emissiveIntensity: 0.5,
      side: THREE.DoubleSide, depthWrite: false,
    });

    this.buildBody();
    this.buildWings();
    this.buildLegs();
  }

  buildBody() {
    this.body = new THREE.Group();
    this.group.add(this.body);

    const abdomen = new THREE.Mesh(new THREE.SphereGeometry(0.24, 40, 28), this.shell);
    abdomen.position.set(0, 0.32, 0.24);
    abdomen.scale.set(0.98, 0.86, 1.2);
    abdomen.rotation.x = -0.2;
    abdomen.castShadow = this.shadows;

    const thorax = new THREE.Mesh(new THREE.SphereGeometry(0.24, 40, 28), this.chitin);
    thorax.position.set(0, 0.4, -0.1);
    thorax.scale.set(1, 0.95, 1.08);
    thorax.castShadow = this.shadows;

    this.head = new THREE.Group();
    this.head.position.set(0, 0.55, -0.4);
    const skull = new THREE.Mesh(new THREE.SphereGeometry(0.165, 36, 24), this.chitin);
    skull.scale.set(1.04, 1, 0.92);
    skull.castShadow = this.shadows;
    this.head.add(skull);

    for (const side of [-1, 1]) {
      // Compound eyes wrap the head rather than sitting on it as separate balls.
      const eye = new THREE.Mesh(new THREE.SphereGeometry(0.138, 40, 28), this.eyeMaterial);
      eye.position.set(side * 0.098, 0.016, -0.012);
      eye.scale.set(0.92, 1.16, 1.04);
      eye.rotation.z = side * 0.24;
      this.head.add(eye);

      const antenna = segment(
        new THREE.Vector3(side * 0.055, -0.03, -0.14),
        new THREE.Vector3(side * 0.085, -0.13, -0.2),
        0.014, 0.008, this.chitin, false,
      );
      const arista = new THREE.Mesh(new THREE.SphereGeometry(0.026, 12, 10), this.chitin);
      arista.position.set(side * 0.088, -0.145, -0.208);
      arista.scale.set(0.8, 1.5, 0.8);
      this.head.add(antenna, arista);
    }

    const proboscis = new THREE.Mesh(new THREE.CapsuleGeometry(0.042, 0.06, 6, 12), this.chitin);
    proboscis.position.set(0, -0.115, -0.075);
    proboscis.rotation.x = 0.5;
    this.head.add(proboscis);

    this.body.add(abdomen, thorax, this.head);

    // Thoracic bristles, the giveaway detail on a real fruit fly.
    for (const [x, y, z, lean] of [
      [-0.11, 0.58, -0.02, 0.5], [0.11, 0.58, -0.02, 0.5],
      [-0.16, 0.52, 0.06, 0.8], [0.16, 0.52, 0.06, 0.8],
      [-0.05, 0.6, -0.14, 0.3], [0.05, 0.6, -0.14, 0.3],
    ]) {
      const bristle = new THREE.Mesh(new THREE.ConeGeometry(0.011, 0.13, 6), this.chitin);
      bristle.position.set(x, y, z);
      bristle.rotation.set(-lean, 0, x * 1.6);
      this.body.add(bristle);
    }
  }

  buildWings() {
    const geometry = wingGeometry();
    this.wings = [];
    for (const side of [-1, 1]) {
      const root = new THREE.Group();
      root.position.set(side * 0.075, 0.545, -0.06);
      root.scale.set(side, 1, 1);
      root.rotation.set(-0.17, 0.22, 0);
      const wing = new THREE.Mesh(geometry, this.wingMaterial);
      root.add(wing);
      this.body.add(root);
      this.wings.push(root);
    }
  }

  buildLegs() {
    const joints = [
      [[0.14, 0.34, -0.26], [0.36, 0.14, -0.52], [0.34, 0.03, -0.72], [0.29, 0.0, -0.8]],
      [[0.18, 0.34, -0.04], [0.52, 0.16, 0.02], [0.56, 0.03, -0.14], [0.54, 0.0, -0.24]],
      [[0.17, 0.32, 0.14], [0.48, 0.2, 0.38], [0.5, 0.03, 0.55], [0.46, 0.0, 0.62]],
    ];
    const radii = [[0.03, 0.019], [0.019, 0.012], [0.012, 0.007]];
    this.forelegs = [];
    for (const side of [-1, 1]) {
      joints.forEach((leg, legIndex) => {
        const limb = new THREE.Group();
        const points = leg.map(([x, y, z]) => new THREE.Vector3(x * side, y, z));
        for (let index = 0; index < points.length - 1; index += 1) {
          // Legs stay out of the shadow pass; six three-jointed limbs would
          // otherwise triple the casters for detail nobody can see in shadow.
          limb.add(segment(points[index], points[index + 1], radii[index][0], radii[index][1], this.chitin, false));
          if (index < points.length - 2) {
            const joint = new THREE.Mesh(new THREE.SphereGeometry(radii[index][1] * 1.35, 10, 8), this.chitin);
            joint.position.copy(points[index + 1]);
            limb.add(joint);
          }
        }
        this.body.add(limb);
        if (legIndex === 0) this.forelegs.push(limb);
      });
    }
  }

  place(x, z, facing = 0) {
    this.group.position.set(x, 0, z);
    this.group.rotation.y = facing;
  }

  setMood(mood) {
    if (mood === this.mood) return;
    this.mood = mood;
    this.moodClock = 0;
    if (mood === "win" || mood === "blackjack") this.buzz = 1;
  }

  update(delta, time) {
    this.moodClock += delta;
    if (this.reducedMotion) return;
    const breath = Math.sin(time * 1.9);
    const settle = Math.min(1, this.moodClock * 2.4);

    const lift = this.mood === "win" || this.mood === "blackjack"
      ? Math.max(0, Math.sin(this.moodClock * 7.5)) * 0.09 * (1 - settle * 0.55)
      : this.mood === "loss" ? -0.026 * settle : 0;
    this.body.position.y = lift + breath * 0.006;

    // Head orientation carries the state: leaning in while deciding, down on a loss.
    const pitch = this.mood === "thinking" ? 0.2 + Math.sin(time * 1.3) * 0.05
      : this.mood === "loss" ? 0.3 : this.mood === "win" || this.mood === "blackjack" ? -0.16 : 0.07;
    const yaw = this.mood === "thinking" ? Math.sin(time * 0.8) * 0.16 : 0;
    this.head.rotation.x += (pitch - this.head.rotation.x) * Math.min(1, delta * 3.2);
    this.head.rotation.y += (yaw - this.head.rotation.y) * Math.min(1, delta * 2.4);

    this.buzz = Math.max(0, this.buzz - delta * 1.1);
    this.wings.forEach((wing, index) => {
      const side = index === 0 ? -1 : 1;
      const flutter = this.buzz > 0 ? Math.sin(time * 42) * 0.5 * this.buzz : Math.sin(time * 1.4 + index) * 0.015;
      wing.rotation.z = flutter;
      wing.rotation.y = 0.22 + side * 0 + flutter * 0.25;
    });

    // Forelegs tap the felt while the policy is deliberating.
    const tap = this.mood === "thinking" ? Math.max(0, Math.sin(time * 5.5)) * 0.11 : 0;
    this.forelegs.forEach((leg, index) => {
      leg.rotation.x = -tap * (index === 0 ? 1 : 0.7);
    });
  }
}
