// Bot navigation: a breadth-first shortest path over the map's waypoint graph,
// plus a line-of-sight test against the world's shootables.
import * as THREE from 'three';

export function createNav(map) {
  const { waypoints, adjacency } = map;
  const raycaster = new THREE.Raycaster();
  const origin = new THREE.Vector3();
  const direction = new THREE.Vector3();

  function nearestWaypoint(x, z) {
    let best = 0;
    let bestDist = Infinity;
    for (let i = 0; i < waypoints.length; i += 1) {
      const dx = waypoints[i].x - x;
      const dz = waypoints[i].z - z;
      const d = dx * dx + dz * dz;
      if (d < bestDist) { bestDist = d; best = i; }
    }
    return best;
  }

  // BFS shortest path of waypoint indices from `from` to `to`.
  function findPath(from, to) {
    if (from === to) return [to];
    const prev = new Array(waypoints.length).fill(-1);
    const queue = [from];
    prev[from] = from;
    while (queue.length > 0) {
      const node = queue.shift();
      for (const next of adjacency[node]) {
        if (prev[next] !== -1) continue;
        prev[next] = node;
        if (next === to) {
          const path = [to];
          let cur = to;
          while (cur !== from) {
            cur = prev[cur];
            path.unshift(cur);
          }
          return path;
        }
        queue.push(next);
      }
    }
    return [to];
  }

  // True when nothing solid stands between the two eye points.
  function hasLineOfSight(from, to, shootables) {
    direction.subVectors(to, from);
    const distance = direction.length();
    if (distance < 0.001) return true;
    direction.normalize();
    origin.copy(from);
    raycaster.set(origin, direction);
    raycaster.far = distance - 0.4;
    const hits = raycaster.intersectObjects(shootables, false);
    return hits.length === 0;
  }

  return { nearestWaypoint, findPath, hasLineOfSight, waypoints };
}
