// DUSTLINE — Site 7: a desert-industrial compound at dusk. Two bomb sites (A west,
// B east), three lanes (A-long, mid, B-long), crates and containers for cover, a
// raised mid platform. Everything is boxes and cylinders with flat colours — no
// models, no textures, no network. Builds the colliders, the shootables, the bot
// waypoint graph, the site zones and the spawn points.
import * as THREE from 'three';
import { PALETTE } from './palette.js';

// Waypoint nodes the bots walk: [x, z]. Edges are listed as index pairs.
const WAYPOINTS = [
  [0, 18], [-5, 18], [5, 18], // 0-2 attacker spawn
  [0, 12], [0, 6], [0, 0], [-8.5, -6], [0, -12], // 3-7 mid (6 routes around the platform)
  [-14, 16], [-22, 12], [-23, 4], [-22, -4], [-20, -10], // 8-12 A-long
  [14, 16], [22, 12], [23, 4], [22, -4], [20, -10], // 13-17 B-long
  [-10, 2], [-12, -6], [10, 2], [12, -6], // 18-21 connectors
  [-17, -12], [-14, -14], [17, -12], [14, -14], // 22-25 sites
  [-4, -18], [4, -18], [0, -16], [-10, -14], [10, -14], // 26-30 defender spawn
];
const EDGES = [
  [0, 1], [0, 2], [0, 3], [1, 8], [2, 13],
  [3, 4], [4, 5], [5, 6], [6, 7], [7, 28],
  [8, 9], [9, 10], [10, 11], [11, 12], [12, 22],
  [13, 14], [14, 15], [15, 16], [16, 17], [17, 24],
  [4, 18], [18, 19], [19, 22], [5, 20], [20, 21], [21, 24],
  [22, 23], [24, 25], [23, 29], [25, 30], [26, 28], [27, 28],
  [28, 29], [28, 30], [7, 29], [7, 30], [19, 29], [21, 30],
  [3, 18], [3, 20], [12, 23], [17, 25], [6, 19], [6, 21],
];

export function createMap(scene) {
  const group = new THREE.Group();
  scene.add(group);

  const materials = {};
  const defs = {
    canvas: { color: PALETTE.canvas, roughness: 1 },
    surface: { color: PALETTE.surface, roughness: 0.95 },
    hairline: { color: PALETTE.hairline, roughness: 0.9 },
    sand: { color: PALETTE.sand, roughness: 1 },
    rust: { color: PALETTE.rust, roughness: 0.8 },
    teal: { color: PALETTE.teal, roughness: 0.7 },
    accent: { color: PALETTE.accent, roughness: 0.6 },
    ink: { color: PALETTE.ink, roughness: 0.6 },
  };
  for (const [name, def] of Object.entries(defs)) {
    materials[name] = new THREE.MeshStandardMaterial({ color: new THREE.Color(def.color), roughness: def.roughness, metalness: 0.02 });
  }

  const colliders = [];
  const shootables = [];

  function box(w, h, d, x, y, z, mat, collide = true) {
    const mesh = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), materials[mat]);
    mesh.position.set(x, y, z);
    mesh.castShadow = true;
    mesh.receiveShadow = true;
    group.add(mesh);
    if (collide) colliders.push(new THREE.Box3().setFromObject(mesh));
    shootables.push(mesh);
    return mesh;
  }

  function cylinder(rTop, rBottom, h, x, y, z, mat, collide = true) {
    const mesh = new THREE.Mesh(new THREE.CylinderGeometry(rTop, rBottom, h, 14), materials[mat]);
    mesh.position.set(x, y, z);
    mesh.castShadow = true;
    mesh.receiveShadow = true;
    group.add(mesh);
    if (collide) colliders.push(new THREE.Box3().setFromObject(mesh));
    shootables.push(mesh);
    return mesh;
  }

  // Ground: packed sand with a darker service apron at each site.
  box(56.8, 0.4, 44.8, 0, -0.2, 0, 'sand');
  box(14, 0.06, 12, -19, 0.03, -13, 'hairline', false);
  box(14, 0.06, 12, 19, 0.03, -13, 'hairline', false);
  box(10, 0.06, 8, 0, 0.03, 18, 'hairline', false);

  // Perimeter walls, 5 m high, open to the dusk sky.
  box(0.6, 5, 44.8, -28.2, 2.5, 0, 'surface');
  box(0.6, 5, 44.8, 28.2, 2.5, 0, 'surface');
  box(56.8, 5, 0.6, 0, 2.5, -22.2, 'surface');
  box(56.8, 5, 0.6, 0, 2.5, 22.2, 'surface');
  // Rust hazard stripe along the top of the north wall.
  box(56.8, 0.35, 0.7, 0, 4.9, -22.2, 'rust', false);

  // Mid: double doors at z=0 (two pillars, a 3 m gap), raised platform at (0,-6).
  box(1.4, 3.4, 1.4, -3.2, 1.7, 0, 'surface');
  box(1.4, 3.4, 1.4, 3.2, 1.7, 0, 'surface');
  box(8, 0.5, 6, 0, 0.25, -6, 'hairline');
  box(6, 1, 2, 0, 0.5, -2.4, 'hairline'); // step up to the platform
  box(0.9, 2.2, 0.9, -6.5, 1.1, -6, 'rust');
  box(0.9, 2.2, 0.9, 6.5, 1.1, -6, 'rust');

  // A-long: crates and a container forming corners down the west lane.
  box(1.2, 1.1, 1.2, -24, 0.55, 8, 'hairline');
  box(1.2, 1.1, 1.2, -22.6, 0.55, 8, 'hairline');
  box(2.4, 1.1, 1.2, -23.2, 0.55, 0, 'hairline');
  box(6, 2.6, 2.4, -24, 1.3, -7, 'rust');
  box(1.2, 1.1, 1.2, -19, 0.55, -4, 'hairline');
  box(1.2, 2.2, 1.2, -25, 1.1, -13, 'hairline');

  // B-long: mirrored cover on the east lane.
  box(1.2, 1.1, 1.2, 24, 0.55, 8, 'hairline');
  box(1.2, 1.1, 1.2, 22.6, 0.55, 8, 'hairline');
  box(2.4, 1.1, 1.2, 23.2, 0.55, 0, 'hairline');
  box(6, 2.6, 2.4, 24, 1.3, -7, 'teal');
  box(1.2, 1.1, 1.2, 19, 0.55, -4, 'hairline');
  box(1.2, 2.2, 1.2, 25, 1.1, -13, 'hairline');

  // Site A: container stack + crates around the plant zone.
  box(6, 2.6, 2.4, -22, 1.3, -16, 'rust');
  box(2.4, 1.1, 2.4, -15, 0.55, -10, 'hairline');
  box(1.2, 1.1, 1.2, -23, 0.55, -10, 'hairline');
  box(1.2, 1.1, 1.2, -16, 0.55, -17, 'hairline');
  cylinder(0.7, 0.7, 1.5, -13.5, 0.75, -12, 'rust');
  cylinder(0.7, 0.7, 1.5, -24.5, 0.75, -17.5, 'hairline');

  // Site B: mirrored plant zone.
  box(6, 2.6, 2.4, 22, 1.3, -16, 'teal');
  box(2.4, 1.1, 2.4, 15, 0.55, -10, 'hairline');
  box(1.2, 1.1, 1.2, 23, 0.55, -10, 'hairline');
  box(1.2, 1.1, 1.2, 16, 0.55, -17, 'hairline');
  cylinder(0.7, 0.7, 1.5, 13.5, 0.75, -12, 'teal');
  cylinder(0.7, 0.7, 1.5, 24.5, 0.75, -17.5, 'hairline');

  // Centre cover: a container pair and crates so mid is not a shooting gallery.
  box(4.8, 2.4, 2.2, -8, 1.2, 6, 'surface');
  box(4.8, 2.4, 2.2, 8, 1.2, -1, 'surface');
  box(1.2, 1.1, 1.2, -5, 0.55, 10, 'hairline');
  box(1.2, 1.1, 1.2, 5, 0.55, -10, 'hairline');

  // Site markers: a painted letter plate and a beacon pole at each site.
  function siteMarker(x, z, letter, mat) {
    const plate = new THREE.Mesh(new THREE.BoxGeometry(2.2, 2.2, 0.12), materials[mat]);
    plate.position.set(x, 3.4, -21.6);
    plate.castShadow = true;
    group.add(plate);
    shootables.push(plate);
    const pole = new THREE.Mesh(new THREE.CylinderGeometry(0.09, 0.09, 3.4, 8), materials.ink);
    pole.position.set(x + 4.5, 1.7, z + 3);
    group.add(pole);
    const lamp = new THREE.Mesh(
      new THREE.SphereGeometry(0.22, 10, 8),
      new THREE.MeshBasicMaterial({ color: new THREE.Color(PALETTE[mat]) }),
    );
    lamp.position.set(x + 4.5, 3.5, z + 3);
    group.add(lamp);
    const light = new THREE.PointLight(new THREE.Color(PALETTE[mat]), 6, 14);
    light.position.set(x + 4.5, 3.5, z + 3);
    scene.add(light);
  }
  siteMarker(-19, -13, 'A', 'rust');
  siteMarker(19, -13, 'B', 'teal');

  // Dusk light: a low amber sun from the west, a cool fill, and a warm sky dome.
  const sky = new THREE.HemisphereLight(new THREE.Color('#8a7a5e'), new THREE.Color(PALETTE.canvas), 0.85);
  scene.add(sky);
  const sun = new THREE.DirectionalLight(new THREE.Color('#ffb45e'), 2.4);
  sun.position.set(-30, 16, 12);
  sun.target.position.set(0, 0, -4);
  sun.castShadow = true;
  sun.shadow.mapSize.set(2048, 2048);
  sun.shadow.camera.left = -32;
  sun.shadow.camera.right = 32;
  sun.shadow.camera.top = 32;
  sun.shadow.camera.bottom = -32;
  sun.shadow.camera.far = 90;
  sun.shadow.bias = -0.0006;
  scene.add(sun, sun.target);
  const fill = new THREE.DirectionalLight(new THREE.Color('#7a86a8'), 0.5);
  fill.position.set(18, 12, -14);
  scene.add(fill);

  const waypoints = WAYPOINTS.map(([x, z]) => ({ x, z }));
  const adjacency = waypoints.map(() => []);
  for (const [a, b] of EDGES) {
    adjacency[a].push(b);
    adjacency[b].push(a);
  }

  return {
    colliders,
    shootables,
    group,
    waypoints,
    adjacency,
    sites: {
      A: { name: 'A', center: { x: -19, z: -13 }, radius: 5 },
      B: { name: 'B', center: { x: 19, z: -13 }, radius: 5 },
    },
    spawns: {
      attackers: [
        { x: -4, z: 18, yaw: 0 }, { x: 0, z: 19, yaw: 0 }, { x: 4, z: 18, yaw: 0 },
      ],
      defenders: [
        { x: -4, z: -18, yaw: Math.PI }, { x: 0, z: -19, yaw: Math.PI },
        { x: 4, z: -18, yaw: Math.PI }, { x: -8, z: -16, yaw: Math.PI },
      ],
    },
  };
}
