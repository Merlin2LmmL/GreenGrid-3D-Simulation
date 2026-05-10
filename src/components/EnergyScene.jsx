import { Sky, Stars, Clouds as DreiClouds, Cloud as DreiCloud } from '@react-three/drei';
import { useMemo, useRef } from 'react';
import { useFrame } from '@react-three/fiber';
import * as THREE from 'three';
import House from './House';
import TradeParticles from './TradeParticles';
import InstancedRoads from './InstancedRoads';
import InstancedHouses from './InstancedHouses';
import InstancedSolarPanels from './InstancedSolarPanels';
import InstancedWindowLights from './InstancedWindowLights';
import { useEnergyStore } from '../store/useEnergyStore';
const ROAD_EXTENSION = 2.4;
const DASH_EDGE_MARGIN = 1.3;
const INTERSECTION_TRIM = 0.8;
const DASH_LENGTH = 1.2;
const DASH_GAP = 0.72;
const DASH_PERIOD = DASH_LENGTH + DASH_GAP;
const DASH_WIDTH = 0.18;
const DASH_HEIGHT = 0.04;

const RAIN_VERTEX_SHADER = `
  uniform float uTime;
  attribute float aSpeed;
  attribute vec3 aInitialPos;

  void main() {
    vec3 pos = aInitialPos;
    float yOffset = mod(uTime * aSpeed * 10.0, 40.0);
    pos.y -= yOffset;
    if (pos.y < 0.0) pos.y += 40.0;
    vec4 mvPosition = modelViewMatrix * vec4(pos, 1.0);
    gl_PointSize = 0.15 * (300.0 / -mvPosition.z);
    gl_Position = projectionMatrix * mvPosition;
  }
`;

const RAIN_FRAGMENT_SHADER = `
  void main() {
    gl_FragColor = vec4(0.506, 0.831, 0.98, 0.6);
  }
`;

function Rain() {
  const count = 600;
  const [positions, speeds] = useMemo(() => {
    const pos = new Float32Array(count * 3);
    const spd = new Float32Array(count);
    for (let i = 0; i < count; i++) {
      pos[i * 3] = (Math.random() - 0.5) * 60;
      pos[i * 3 + 1] = Math.random() * 40;
      pos[i * 3 + 2] = (Math.random() - 0.5) * 60;
      spd[i] = 0.2 + Math.random() * 0.3;
    }
    return [pos, spd];
  }, []);

  const uniforms = useMemo(() => ({ uTime: { value: 0 } }), []);
  useFrame((state) => {
    uniforms.uTime.value = state.clock.elapsedTime;
  });

  return (
    <points>
      <bufferGeometry>
        <bufferAttribute attach="attributes-position" count={count} array={positions} itemSize={3} />
        <bufferAttribute attach="attributes-aInitialPos" count={count} array={positions} itemSize={3} />
        <bufferAttribute attach="attributes-aSpeed" count={count} array={speeds} itemSize={1} />
      </bufferGeometry>
      <shaderMaterial uniforms={uniforms} vertexShader={RAIN_VERTEX_SHADER} fragmentShader={RAIN_FRAGMENT_SHADER} transparent />
    </points>
  );
}
function Clouds() {
  const weatherIntensity = useEnergyStore((s) => s.weatherIntensity);
  const cloudGroup = useRef();

  const cloudData = useMemo(() => {
    const data = [];
    const rng = (i) => {
      let x = Math.sin(i + 456) * 10000;
      return x - Math.floor(x);
    };

    // Reduced cloud count for performance, but using instanced DreiClouds
    for (let i = 0; i < 20; i++) {
      data.push({
        id: i,
        position: [
          (rng(i * 3) - 0.5) * 250,
          15 + rng(i * 3 + 1) * 15,
          (rng(i * 3 + 2) - 0.5) * 250
        ],
        speed: 0.1 + rng(i * 7) * 0.2,
        width: 30 + rng(i * 8) * 60,
        depth: 0.5 + rng(i * 9) * 2.5,
        segments: 6, // Reduced segments for performance
        baseOpacity: 0.1 + rng(i * 11) * 0.3,
        driftSpeed: (rng(i * 12) - 0.5) * 0.04,
        threshold: rng(i * 13)
      });
    }
    return data;
  }, []);

  useFrame((state) => {
    if (!cloudGroup.current) return;
    const t = state.clock.getElapsedTime();
    cloudGroup.current.position.x = Math.sin(t * 0.01) * 8;
    cloudGroup.current.position.z = Math.cos(t * 0.01) * 8;
  });

  const cloudColor = useMemo(() => {
    const r = 250 - weatherIntensity * 160;
    const g = 250 - weatherIntensity * 140;
    const b = 250 - weatherIntensity * 120;
    return new THREE.Color(`rgb(${Math.floor(r)},${Math.floor(g)},${Math.floor(b)})`);
  }, [weatherIntensity]);

  return (
    <group ref={cloudGroup}>
      <DreiClouds material={THREE.MeshLambertMaterial}>
        {cloudData.map((cloud) => {
          const isVisible = weatherIntensity > cloud.threshold * 0.8;
          if (!isVisible) return null;
          const opacityMultiplier = 0.4 + weatherIntensity * 1.2;

          return (
            <DreiCloud
              key={cloud.id}
              position={cloud.position}
              opacity={cloud.baseOpacity * opacityMultiplier}
              speed={cloud.speed}
              width={cloud.width}
              depth={cloud.depth}
              segments={cloud.segments}
              color={cloudColor}
            />
          );
        })}
      </DreiClouds>
    </group>
  );
}

export default function EnergyScene() {
  const houses = useEnergyStore((s) => s.houses);
  const roads = useEnergyStore((s) => s.roads);
  const trades = useEnergyStore((s) => s.trades);
  const debug = useEnergyStore((s) => s.DEBUG);

  const timeHours = useEnergyStore((s) => s.timeHours);
  const weather = useEnergyStore((s) => s.weather);

  const housesById = useMemo(
    () => new Map(houses.map((h) => [h.id, h])),
    [houses]
  );

  // Find junctions where multiple roads meet so we can blend dash patterns
  const junctions = useMemo(() => {
    const m = new Map();

    function keyFor(pos) {
      return `${pos[0].toFixed(3)}_${pos[2].toFixed(3)}`;
    }

    roads.forEach((r) => {
      const sk = keyFor(r.start);
      const ek = keyFor(r.end);

      if (!m.has(sk)) m.set(sk, { pos: r.start, entries: [] });
      m.get(sk).entries.push({ road: r, which: 'start' });

      if (!m.has(ek)) m.set(ek, { pos: r.end, entries: [] });
      m.get(ek).entries.push({ road: r, which: 'end' });
    });

    return Array.from(m.values()).filter((j) => j.entries.length > 1);
  }, [roads]);

  // ── Environment Logic ───────────────────────────────────────────────────
  const sunPosition = useMemo(() => {
    // Sun moves along an arc. Sunrise at 6:00, Sunset at 18:00.
    // We offset the angle so 12:00 is straight up.
    const normalizedTime = (timeHours - 6) / 12; // 0 at 6am, 1 at 6pm
    const angle = normalizedTime * Math.PI;
    const radius = 50;
    const x = -Math.cos(angle) * radius;
    const y = Math.sin(angle) * radius; // Peaks at midday
    const z = -20; 
    return [x, y, z];
  }, [timeHours]);

  const weatherIntensity = useEnergyStore((s) => s.weatherIntensity);

  // Smooth daylight factor (0 to 1) based on sun height
  // Ramps from -0.2 (twilight) to 0.2 (early morning)
  const sunHeight = sunPosition[1] / 50; // -1 to 1
  const daylightFactor = useMemo(() => THREE.MathUtils.smoothstep(sunHeight, -0.2, 0.2), [sunHeight]);

  const ambientIntensity = 0.04 + (daylightFactor * (0.56 - weatherIntensity * 0.3));
  const directIntensity = daylightFactor * (1.6 - weatherIntensity * 1.1);

  const sunColor = useMemo(() => {
    const nightColor = new THREE.Color('#1a237e');
    const dayColor = new THREE.Color();
    const r = 255 - weatherIntensity * 79;
    const g = 249 - weatherIntensity * 59;
    const b = 196 + weatherIntensity * 1;
    dayColor.setRGB(r / 255, g / 255, b / 255);
    
    return new THREE.Color().copy(nightColor).lerp(dayColor, daylightFactor);
  }, [daylightFactor, weatherIntensity]);

  const groundColor = useMemo(() => {
    const nightGround = new THREE.Color('#1a2a1a');
    const dayGround = new THREE.Color('#2e7d32');
    return new THREE.Color().copy(nightGround).lerp(dayGround, daylightFactor);
  }, [daylightFactor]);

  const citySize = useEnergyStore((s) => s.mapSettings.citySize);
  const groundSize = useMemo(() => {
    const avgSegLen = useEnergyStore.getState().getAverageStreetLength();
    // We scale with a factor of 8.0 to provide generous padding for the 5-7 grid nodes
    return avgSegLen * 8.0;
  }, [citySize]);

  return (
    <>
      <Sky
        distance={450000}
        sunPosition={sunPosition}
        inclination={0}
        azimuth={0.25}
        turbidity={0.5 + weatherIntensity * 12}
        rayleigh={1 + weatherIntensity * 2.5}
      />

      <Stars 
        radius={100} 
        depth={50} 
        count={2500} 
        factor={THREE.MathUtils.smoothstep(1 - daylightFactor, 0.8, 1.0) * 4} 
        saturation={0} 
        fade 
        speed={0.5} 
      />

      <ambientLight intensity={ambientIntensity} color={sunColor} />

      <directionalLight
        castShadow
        intensity={directIntensity}
        position={sunPosition}
        color={sunColor}
        shadow-mapSize-width={1024}
        shadow-mapSize-height={1024}
        shadow-camera-near={1}
        shadow-camera-far={100}
        shadow-camera-left={-35}
        shadow-camera-right={35}
        shadow-camera-top={35}
        shadow-camera-bottom={-35}
      />

      {weatherIntensity === 1.0 && <Rain />}
      {weatherIntensity > 0 && <Clouds />}

      {/* Ground */}
      <mesh
        receiveShadow
        rotation={[-Math.PI / 2, 0, 0]}
        position={[0, -0.01, 0]}
      >
        <planeGeometry args={[groundSize, groundSize]} />
        <meshLambertMaterial
          color={groundColor}
        />
      </mesh>

      {/* Optimzed Roads */}
      <InstancedRoads roads={roads} junctions={junctions} />

      {/* Optimized House Geometry */}
      <InstancedHouses houses={houses} />
      <InstancedSolarPanels houses={houses} />
      <InstancedWindowLights houses={houses} />

      {/* House Overlays (Labels, Interaction, Individual Lights) */}
      {houses.map((house) => (
        <House
          key={house.id}
          house={house}
        />
      ))}

      {/* Electricity trade arcs */}
      <TradeParticles
        trades={trades}
        housesById={housesById}
        roads={roads}
      />
    </>
  );
}
