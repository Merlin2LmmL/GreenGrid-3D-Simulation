import { Sky } from '@react-three/drei';
import { useMemo } from 'react';
import House from './House';
import TradeParticles from './TradeParticles';
import { useEnergyStore } from '../store/useEnergyStore';

const ROAD_EXTENSION = 2.4;

const DASH_EDGE_MARGIN = 1.3;
const INTERSECTION_TRIM = 0.8;

const DASH_LENGTH = 1.2;
const DASH_GAP = 0.72;
const DASH_PERIOD = DASH_LENGTH + DASH_GAP;

const DASH_WIDTH = 0.18;
const DASH_HEIGHT = 0.04;

export default function EnergyScene() {
  const houses = useEnergyStore((s) => s.houses);
  const roads = useEnergyStore((s) => s.roads);
  const trades = useEnergyStore((s) => s.trades);

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

  return (
    <>
      <Sky
        distance={320}
        sunPosition={[12, 16, -15]}
        inclination={0.45}
        azimuth={0.2}
        turbidity={10}
        rayleigh={1.7}
      />

      <ambientLight intensity={0.35} />

      <directionalLight
        castShadow
        intensity={1.35}
        position={[14, 18, 7]}
        shadow-mapSize-width={2048}
        shadow-mapSize-height={2048}
        shadow-camera-near={1}
        shadow-camera-far={80}
        shadow-camera-left={-30}
        shadow-camera-right={30}
        shadow-camera-top={30}
        shadow-camera-bottom={-30}
      />

      {/* Ground */}
      <mesh
        receiveShadow
        rotation={[-Math.PI / 2, 0, 0]}
        position={[0, -0.01, 0]}
      >
        <planeGeometry args={[120, 120]} />
        <meshStandardMaterial
          color="#2e7d32"
          roughness={0.96}
        />
      </mesh>

      {/* Roads */}
      {roads.map((road) => {
        const [sx, , sz] = road.start;
        const [ex, , ez] = road.end;

        const dx = ex - sx;
        const dz = ez - sz;

        const length = Math.hypot(dx, dz);

        if (length < 0.001) return null;

        const dirX = dx / length;
        const dirZ = dz / length;

        const angle = Math.atan2(dx, dz);

        // Extend asphalt into intersections
        const extStartX = sx - dirX * ROAD_EXTENSION;
        const extStartZ = sz - dirZ * ROAD_EXTENSION;

        const extEndX = ex + dirX * ROAD_EXTENSION;
        const extEndZ = ez + dirZ * ROAD_EXTENSION;

        const extLength = length + ROAD_EXTENSION * 2;

        const centerX = (extStartX + extEndX) / 2;
        const centerZ = (extStartZ + extEndZ) / 2;

        // Trim dashes uniformly near connected intersections
        const dashStart = road.connectedStart
          ? INTERSECTION_TRIM
          : DASH_EDGE_MARGIN;

        const dashEnd = road.connectedEnd
          ? length - INTERSECTION_TRIM
          : length - DASH_EDGE_MARGIN;

        // Generate dash centers so each road starts/ends with a gap
        const usableLength = dashEnd - dashStart;
        const dashCenters = [];

        if (usableLength > 0) {
          // Start pattern with a half-gap so there's a gap at the road start
          let localZ = dashStart + DASH_GAP / 2 + DASH_LENGTH / 2;

          // Push centers while dash fully fits inside the trimmed span
          while (localZ + DASH_LENGTH / 2 <= dashEnd + 1e-6) {
            dashCenters.push(localZ);
            localZ += DASH_PERIOD;
          }
        }
        return (
          <group key={road.id}>
            {/* Asphalt */}
            <mesh
              receiveShadow
              position={[centerX, 0.03, centerZ]}
              rotation={[0, angle, 0]}
            >
              <boxGeometry
                args={[road.width, 0.06, extLength]}
              />

              <meshStandardMaterial
                color="#3d4148"
                roughness={0.9}
                metalness={0.1}
              />
            </mesh>

            {/* Center dashes (aligned globally to avoid seams) */}
            {dashCenters.map((localZ, i) => {
              const wx = sx + dirX * localZ;
              const wz = sz + dirZ * localZ;

              return (
                <mesh
                  key={`${road.id}-dash-${i}`}
                  position={[wx, 0.065, wz]}
                  rotation={[0, angle, 0]}
                  renderOrder={20}
                >
                  <boxGeometry
                    args={[DASH_WIDTH, DASH_HEIGHT, DASH_LENGTH]}
                  />

                  <meshBasicMaterial
                    color="#f5f5f5"
                    depthWrite={false}
                    toneMapped={false}
                  />
                </mesh>
              );
            })}
          </group>
        );
      })}

      {/* Junction connectors to blend dash patterns at intersections */}
      {junctions.map((junc, idx) => {
        const [jx, , jz] = junc.pos;

        return (
          <group key={`junction-${idx}`} position={[jx, 0, jz]}>
            {junc.entries.map((entry, eidx) => {
              const r = entry.road;
              const [rsx, , rsz] = r.start;
              const [rex, , rez] = r.end;

              const rdx = rex - rsx;
              const rdz = rez - rsz;
              const rlen = Math.hypot(rdx, rdz) || 1;
              const dirX = rdx / rlen;
              const dirZ = rdz / rlen;

              // Angle used elsewhere for road rotation (note: atan2(dx, dz))
              const angle = Math.atan2(rdx, rdz);

              // Compute trimmed dash span for this road (same logic as road render)
              const dashStart = r.connectedStart ? INTERSECTION_TRIM : DASH_EDGE_MARGIN;
              const dashEnd = r.connectedEnd ? rlen - INTERSECTION_TRIM : rlen - DASH_EDGE_MARGIN;

              const dashCenters = [];
              if (dashEnd - dashStart > 0) {
                let localZ = dashStart + DASH_GAP / 2 + DASH_LENGTH / 2;
                while (localZ + DASH_LENGTH / 2 <= dashEnd + 1e-6) {
                  dashCenters.push(localZ);
                  localZ += DASH_PERIOD;
                }
              }

              // Determine whether a dash touches the trimmed intersection area; if so, skip connector
              const touchesIntersection = dashCenters.some((c) => {
                // distance from trimmed edge (start or end) depending on which end this junction is
                if (entry.which === 'start') {
                  return c - DASH_LENGTH / 2 <= dashStart + 0.001;
                }
                // end
                return c + DASH_LENGTH / 2 >= dashEnd - 0.001;
              });

              if (touchesIntersection) return null;

              // Place a short oriented rectangle along each incoming road to cover the trimmed dash gap.
              const offsetAlong = entry.which === 'start' ? INTERSECTION_TRIM * 0.5 : -INTERSECTION_TRIM * 0.5;
              const localX = dirX * offsetAlong;
              const localZ = dirZ * offsetAlong;

              // Shrink connector length as junction gets crowded
              const crowdFactor = Math.max(1, junc.entries.length);
              const rectLength = INTERSECTION_TRIM * Math.max(0.8, 1.2 - (crowdFactor - 2) * 0.15);

              // Match lateral thickness exactly to dash width so connectors align visually
              const rectWidth = DASH_WIDTH + 0.001;

              return (
                <mesh
                  key={`junction-${idx}-entry-${eidx}`}
                  position={[localX, 0.066, localZ]}
                  rotation={[0, angle, 0]}
                  renderOrder={20}
                >
                  <boxGeometry args={[rectWidth, DASH_HEIGHT + 0.001, rectLength]} />
                  <meshBasicMaterial color="#f5f5f5" depthWrite={false} toneMapped={false} />
                </mesh>
              );
            })}
          </group>
        );
      })}

      {/* Houses */}
      {houses.map((house) => (
        <House
          key={house.id}
          house={house}
        />
      ))}

      {/* Energy particles */}
      <TradeParticles
        trades={trades}
        housesById={housesById}
  disableParticles={true}
      />
    </>
  );
}
