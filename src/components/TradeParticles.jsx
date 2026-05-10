import { useFrame } from '@react-three/fiber';
import { useMemo, useRef, useEffect, useState, memo } from 'react';
import * as THREE from 'three';
import { useEnergyStore } from '../store/useEnergyStore';

// ── Road-graph pathfinding ───────────────────────────────────────────────────

/**
 * Build an adjacency list from the roads array.
 * Each node is identified by a string key derived from its 3D position.
 * Edges store the positions of both endpoints for path reconstruction.
 */
function buildRoadGraph(roads) {
  const keyFor = (pos) => `${pos[0].toFixed(2)}_${pos[2].toFixed(2)}`;

  const adjacency = new Map(); // key → [{ neighborKey, neighborPos, distance }]
  const keyToPos = new Map();

  for (const road of roads) {
    const sk = keyFor(road.start);
    const ek = keyFor(road.end);

    keyToPos.set(sk, road.start);
    keyToPos.set(ek, road.end);

    if (!adjacency.has(sk)) adjacency.set(sk, []);
    if (!adjacency.has(ek)) adjacency.set(ek, []);

    const dx = road.end[0] - road.start[0];
    const dz = road.end[2] - road.start[2];
    const dist = Math.hypot(dx, dz);

    adjacency.get(sk).push({ neighborKey: ek, neighborPos: road.end, distance: dist, roadId: road.id });
    adjacency.get(ek).push({ neighborKey: sk, neighborPos: road.start, distance: dist, roadId: road.id });
  }

  return { adjacency, keyToPos, keyFor };
}

/**
 * Find the road node (intersection) closest to a given [x, 0, z] position.
 */
function findClosestNode(pos, keyToPos) {
  let bestKey = null;
  let bestDist = Infinity;
  for (const [key, nodePos] of keyToPos) {
    const dx = pos[0] - nodePos[0];
    const dz = pos[2] - nodePos[2];
    const dist = Math.hypot(dx, dz);
    if (dist < bestDist) {
      bestDist = dist;
      bestKey = key;
    }
  }
  return bestKey;
}

/**
 * BFS shortest path (unweighted hop-count for simplicity — roads are similar lengths).
 */
function bfsPath(adjacency, startKey, endKey) {
  if (startKey === endKey) return [startKey];

  const visited = new Set([startKey]);
  const parent = new Map();
  const queue = [startKey];

  while (queue.length > 0) {
    const current = queue.shift();
    const neighbors = adjacency.get(current) || [];
    for (const { neighborKey } of neighbors) {
      if (visited.has(neighborKey)) continue;
      visited.add(neighborKey);
      parent.set(neighborKey, current);
      if (neighborKey === endKey) {
        // reconstruct
        const path = [endKey];
        let cur = endKey;
        while (parent.has(cur)) {
          cur = parent.get(cur);
          path.unshift(cur);
        }
        return path;
      }
      queue.push(neighborKey);
    }
  }

  // No path found — fallback to direct connection
  return [startKey, endKey];
}

/**
 * Build a full waypoint path: sellerPos → sellerStreet → [road nodes] → buyerStreet → buyerPos
 * All waypoints are [x, y, z] arrays with y set to road level.
 */
function buildTradePath(seller, buyer, roadGraph) {
  const { adjacency, keyToPos, keyFor } = roadGraph;

  const sellerStreet = seller.streetPoint;
  const buyerStreet = buyer.streetPoint;

  // Find closest graph nodes to each street point
  const sellerNodeKey = findClosestNode(sellerStreet, keyToPos);
  const buyerNodeKey = findClosestNode(buyerStreet, keyToPos);

  if (!sellerNodeKey || !buyerNodeKey) {
    // Fallback: direct line
    return [
      [seller.position[0], 0.15, seller.position[2]],
      [sellerStreet[0], 0.15, sellerStreet[2]],
      [buyerStreet[0], 0.15, buyerStreet[2]],
      [buyer.position[0], 0.15, buyer.position[2]],
    ];
  }

  const pathKeys = bfsPath(adjacency, sellerNodeKey, buyerNodeKey);
  const roadWaypoints = pathKeys.map((key) => {
    const pos = keyToPos.get(key);
    return [pos[0], 0.15, pos[2]];
  });

  // Build full path: house → street → road nodes → street → house
  const waypoints = [
    [seller.position[0], 0.15, seller.position[2]],
    [sellerStreet[0], 0.15, sellerStreet[2]],
    ...roadWaypoints,
    [buyerStreet[0], 0.15, buyerStreet[2]],
    [buyer.position[0], 0.15, buyer.position[2]],
  ];

  // Remove consecutive duplicates (e.g. street point = closest node)
  const deduped = [waypoints[0]];
  for (let i = 1; i < waypoints.length; i++) {
    const prev = deduped[deduped.length - 1];
    const cur = waypoints[i];
    if (Math.hypot(cur[0] - prev[0], cur[2] - prev[2]) > 0.5) {
      deduped.push(cur);
    }
  }

  return deduped.length >= 2 ? deduped : waypoints;
}

// ── Electricity spark shader ─────────────────────────────────────────────────

const SPARK_VERTEX_SHADER = `
  attribute float aProgress;
  attribute float aRandom;
  attribute float aBranchOffset;

  uniform float uTime;
  uniform float uHeadProgress;
  uniform float uTrailLength;

  varying float vAlpha;
  varying float vRandom;

  void main() {
    // How far behind the head this particle is (0 = at head, 1 = end of trail)
    float distBehind = uHeadProgress - aProgress;

    // Wrap-around for looping
    if (distBehind < 0.0) distBehind += 1.0;

    // Only show particles that are within the trail
    float visibility = 1.0 - smoothstep(0.0, uTrailLength, distBehind);

    // Brightness peaks near the head
    float headProximity = 1.0 - smoothstep(0.0, uTrailLength * 0.3, distBehind);

    vAlpha = visibility * (0.3 + headProximity * 0.7);
    vRandom = aRandom;

    // Jitter perpendicular to path for electric crackle effect
    float jitterAmount = (1.0 - headProximity) * 0.25 + 0.05;
    float jitterX = sin(aProgress * 47.0 + uTime * 12.0 + aRandom * 100.0) * jitterAmount;
    float jitterY = cos(aProgress * 31.0 + uTime * 15.0 + aRandom * 73.0) * jitterAmount * 0.7;
    float jitterZ = sin(aProgress * 63.0 + uTime * 10.0 + aRandom * 51.0) * jitterAmount;

    // Branch sparks fly further out
    float branchJitter = aBranchOffset * sin(uTime * 20.0 + aRandom * 200.0) * 0.4;

    vec3 displaced = position + vec3(jitterX + branchJitter, jitterY + abs(branchJitter) * 0.5, jitterZ + branchJitter);

    vec4 mvPosition = modelViewMatrix * vec4(displaced, 1.0);

    // Size: larger near head, smaller in trail
    float baseSize = mix(2.5, 6.0, headProximity);
    gl_PointSize = baseSize * (200.0 / -mvPosition.z);

    gl_Position = projectionMatrix * mvPosition;
  }
`;

const SPARK_FRAGMENT_SHADER = `
  varying float vAlpha;
  varying float vRandom;

  uniform vec3 uColorCore;
  uniform vec3 uColorGlow;
  uniform float uTime;

  void main() {
    // Circular point with soft glow
    vec2 center = gl_PointCoord - vec2(0.5);
    float dist = length(center);
    if (dist > 0.5) discard;

    // Inner core is white-hot, outer glow is colored
    float core = smoothstep(0.3, 0.0, dist);
    float glow = smoothstep(0.5, 0.1, dist);

    vec3 color = mix(uColorGlow, uColorCore, core);

    // Flicker
    float flicker = 0.7 + 0.3 * sin(uTime * 30.0 + vRandom * 100.0);

    float alpha = vAlpha * glow * flicker;

    gl_FragColor = vec4(color, alpha);
  }
`;

// ── Single electricity arc component ─────────────────────────────────────────

const PARTICLES_PER_ARC = 180;
const BRANCH_PARTICLES = 40;
const TOTAL_PARTICLES = PARTICLES_PER_ARC + BRANCH_PARTICLES;

const ElectricityArc = memo(function ElectricityArc({ waypoints, colorIndex = 0, tickMs = 200 }) {
  const meshRef = useRef();
  const uniformsRef = useRef();

  // Build CatmullRom curve through waypoints for smooth path matching
  const curve = useMemo(() => {
    const pts = waypoints.map(
      (wp) => new THREE.Vector3(wp[0], (wp[1] || 0.15), wp[2])
    );
    return new THREE.CatmullRomCurve3(pts, false, 'catmullrom', 0.3);
  }, [waypoints]);

  // Create geometry buffers
  const geometry = useMemo(() => {
    const geo = new THREE.BufferGeometry();
    const positions = new Float32Array(TOTAL_PARTICLES * 3);
    const progress = new Float32Array(TOTAL_PARTICLES);
    const randoms = new Float32Array(TOTAL_PARTICLES);
    const branchOffsets = new Float32Array(TOTAL_PARTICLES);

    const tempPos = new THREE.Vector3();

    // Main arc particles — distributed along the path curve
    for (let i = 0; i < PARTICLES_PER_ARC; i++) {
      const t = i / PARTICLES_PER_ARC;
      curve.getPointAt(t, tempPos);
      positions[i * 3] = tempPos.x;
      positions[i * 3 + 1] = tempPos.y;
      positions[i * 3 + 2] = tempPos.z;
      progress[i] = t;
      randoms[i] = Math.random();
      branchOffsets[i] = 0;
    }

    // Branch / spark particles — cluster around random points for forking effect
    for (let i = 0; i < BRANCH_PARTICLES; i++) {
      const idx = PARTICLES_PER_ARC + i;
      const t = Math.random();
      curve.getPointAt(t, tempPos);
      positions[idx * 3] = tempPos.x;
      positions[idx * 3 + 1] = tempPos.y;
      positions[idx * 3 + 2] = tempPos.z;
      progress[idx] = t;
      randoms[idx] = Math.random();
      branchOffsets[idx] = (Math.random() - 0.5) * 2; // ±1 fork direction
    }

    geo.setAttribute('position', new THREE.BufferAttribute(positions, 3));
    geo.setAttribute('aProgress', new THREE.BufferAttribute(progress, 1));
    geo.setAttribute('aRandom', new THREE.BufferAttribute(randoms, 1));
    geo.setAttribute('aBranchOffset', new THREE.BufferAttribute(branchOffsets, 1));

    return geo;
  }, [curve]);

  // Color palettes for visual variety between trades
  const colors = useMemo(() => {
    const palettes = [
      { core: new THREE.Color('#ffffff'), glow: new THREE.Color('#4fc3f7') }, // Electric blue
      { core: new THREE.Color('#fff9c4'), glow: new THREE.Color('#ffb74d') }, // Warm amber
      { core: new THREE.Color('#e0f7fa'), glow: new THREE.Color('#00e5ff') }, // Cyan
      { core: new THREE.Color('#f3e5f5'), glow: new THREE.Color('#ce93d8') }, // Purple
      { core: new THREE.Color('#ffffff'), glow: new THREE.Color('#69f0ae') }, // Green
    ];
    return palettes[colorIndex % palettes.length];
  }, [colorIndex]);

  // Shader uniforms
  const uniforms = useMemo(() => ({
    uTime: { value: 0 },
    uHeadProgress: { value: 0 },
    uTrailLength: { value: 0.18 },
    uColorCore: { value: colors.core },
    uColorGlow: { value: colors.glow },
  }), [colors]);

  useEffect(() => {
    uniformsRef.current = uniforms;
  }, [uniforms]);

  useEffect(() => {
    return () => {
      geometry.dispose();
    };
  }, [geometry]);

  // Animate every frame
  useFrame((state) => {
    if (!uniformsRef.current) return;

    const t = state.clock.elapsedTime;
    const u = uniformsRef.current;

    u.uTime.value = t;

    // Travel time = tickMs so one full traversal completes within one tick
    const travelTime = Math.max(0.4, (tickMs / 1000) * 0.85);
    u.uHeadProgress.value = (t / travelTime) % 1.0;
  });

  return (
    <points ref={meshRef} geometry={geometry} frustumCulled={false}>
      <shaderMaterial
        uniforms={uniforms}
        vertexShader={SPARK_VERTEX_SHADER}
        fragmentShader={SPARK_FRAGMENT_SHADER}
        transparent
        depthWrite={false}
        blending={THREE.AdditiveBlending}
      />
    </points>
  );
});

// ── Glowing path trail shader ────────────────────────────────────────────────

const PATH_VERTEX_SHADER = `
  uniform float uTime;
  uniform float uHeadProgress;
  varying float vProgress;
  varying vec2 vUv;

  void main() {
    vUv = uv;
    // Use the x UV coordinate as progress along the tube (0→1)
    vProgress = uv.x;
    gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
  }
`;

const PATH_FRAGMENT_SHADER = `
  uniform float uTime;
  uniform float uHeadProgress;
  uniform vec3 uColor;
  uniform float uTrailLength;
  varying float vProgress;
  varying vec2 vUv;

  void main() {
    // Distance behind the head
    float distBehind = uHeadProgress - vProgress;
    if (distBehind < 0.0) distBehind += 1.0;

    // Trail visibility
    float trail = 1.0 - smoothstep(0.0, uTrailLength, distBehind);

    // Hot core near the head
    float headGlow = 1.0 - smoothstep(0.0, uTrailLength * 0.15, distBehind);

    // Edge glow — brighter in center of tube cross-section
    float edgeDist = abs(vUv.y - 0.5) * 2.0;
    float edgeGlow = smoothstep(1.0, 0.2, edgeDist);

    // Electric flicker
    float flicker = 0.75 + 0.25 * sin(uTime * 18.0 + vProgress * 40.0);
    float crackle = 0.85 + 0.15 * sin(uTime * 45.0 + vProgress * 120.0);

    // Combine: white-hot core near head, colored glow behind
    vec3 coreColor = mix(uColor, vec3(1.0), headGlow * 0.8);
    float alpha = trail * edgeGlow * flicker * crackle * 0.85;

    // Ambient base glow along the full path (very subtle)
    float ambientGlow = edgeGlow * 0.06 * flicker;
    alpha = max(alpha, ambientGlow);

    gl_FragColor = vec4(coreColor, alpha);
  }
`;

const ElectricityPathGlow = memo(function ElectricityPathGlow({ waypoints, colorIndex = 0, tickMs = 200 }) {
  const meshRef = useRef();
  const uniformsRef = useRef();

  const glowColor = useMemo(() => {
    const palettes = [
      new THREE.Color('#4fc3f7'),
      new THREE.Color('#ffb74d'),
      new THREE.Color('#00e5ff'),
      new THREE.Color('#ce93d8'),
      new THREE.Color('#69f0ae'),
    ];
    return palettes[colorIndex % palettes.length];
  }, [colorIndex]);

  // Build CatmullRom curve through waypoints for smooth tube
  const { curve, totalLength } = useMemo(() => {
    const pts = waypoints.map(
      (wp) => new THREE.Vector3(wp[0], (wp[1] || 0.15) + 0.06, wp[2])
    );
    const c = new THREE.CatmullRomCurve3(pts, false, 'catmullrom', 0.3);
    return { curve: c, totalLength: c.getLength() };
  }, [waypoints]);

  const tubeGeometry = useMemo(() => {
    const segments = Math.max(32, Math.floor(totalLength * 3));
    return new THREE.TubeGeometry(curve, segments, 0.12, 6, false);
  }, [curve, totalLength]);

  const uniforms = useMemo(() => ({
    uTime: { value: 0 },
    uHeadProgress: { value: 0 },
    uColor: { value: glowColor },
    uTrailLength: { value: 0.22 },
  }), [glowColor]);

  useEffect(() => {
    uniformsRef.current = uniforms;
  }, [uniforms]);

  useEffect(() => {
    return () => {
      tubeGeometry.dispose();
    };
  }, [tubeGeometry]);

  useFrame((state) => {
    if (!uniformsRef.current) return;
    const t = state.clock.elapsedTime;
    const u = uniformsRef.current;
    u.uTime.value = t;
    // Match spark traversal timing
    const travelTime = Math.max(0.4, (tickMs / 1000) * 0.85);
    u.uHeadProgress.value = (t / travelTime) % 1.0;
  });

  return (
    <mesh ref={meshRef} geometry={tubeGeometry} frustumCulled={false}>
      <shaderMaterial
        uniforms={uniforms}
        vertexShader={PATH_VERTEX_SHADER}
        fragmentShader={PATH_FRAGMENT_SHADER}
        transparent
        depthWrite={false}
        blending={THREE.AdditiveBlending}
        side={THREE.DoubleSide}
      />
    </mesh>
  );
});

// ── Main export ──────────────────────────────────────────────────────────────

// Minimum delivery threshold (W) for a trade to show visuals
const MIN_VISIBLE_DELIVERY_W = 10;

// Simple stable hash for strings
const getHash = (str) => {
  let hash = 0;
  for (let i = 0; i < str.length; i++) {
    hash = (hash << 5) - hash + str.charCodeAt(i);
    hash |= 0;
  }
  return Math.abs(hash);
};

export default function TradeParticles({ trades, housesById, roads }) {
  const tickMs = useEnergyStore((s) => s.tickMs);

  // Cache paths so we don't recreate arrays (and thus heavy TubeGeometries) every tick
  const pathCache = useRef(new Map());

  // Build road graph once (memo on roads reference)
  const roadGraph = useMemo(() => {
    if (!roads || roads.length === 0) return null;
    return buildRoadGraph(roads);
  }, [roads]);

  // Compute visible trades: only those actively delivering energy
  const tradePaths = useMemo(() => {
    if (!roadGraph || !trades) return [];

    const activePaths = [];
    const currentTradeIds = new Set();

    for (const trade of trades) {
      if ((trade.lastDeliveryW || 0) < MIN_VISIBLE_DELIVERY_W) continue;
      currentTradeIds.add(trade.id);

      let cached = pathCache.current.get(trade.id);

      if (!cached) {
        const seller = housesById.get(trade.sellerId);
        const buyer = housesById.get(trade.buyerId);
        if (!seller || !buyer) continue;

        const path = buildTradePath(seller, buyer, roadGraph);

        // Calculate path length to avoid degenerate paths
        let totalLen = 0;
        for (let i = 0; i < path.length - 1; i++) {
          const a = path[i];
          const b = path[i + 1];
          totalLen += Math.sqrt((b[0] - a[0]) ** 2 + (b[2] - a[2]) ** 2);
        }

        if (totalLen < 0.5) continue;

        cached = { path, hash: getHash(trade.id) };
        pathCache.current.set(trade.id, cached);
      }

      activePaths.push({ trade, ...cached });
    }

    // Cleanup cache for removed/finished trades
    for (const key of pathCache.current.keys()) {
      if (!currentTradeIds.has(key)) {
        pathCache.current.delete(key);
      }
    }

    return activePaths;
  }, [trades, housesById, roadGraph]);

  if (tradePaths.length === 0) return null;

  return (
    <group>
      {tradePaths.map(({ trade, path, hash }) => (
        <group key={trade.id}>
          <ElectricityArc
            waypoints={path}
            colorIndex={hash}
            tickMs={tickMs}
          />
          <ElectricityPathGlow
            waypoints={path}
            colorIndex={hash}
            tickMs={tickMs}
          />
        </group>
      ))}
    </group>
  );
}
