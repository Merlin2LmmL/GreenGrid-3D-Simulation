import { useMemo, useRef, useLayoutEffect } from 'react';
import * as THREE from 'three';

const DASH_WIDTH = 0.18;
const DASH_HEIGHT = 0.04;
const DASH_LENGTH = 1.2;
const DASH_GAP = 0.72;
const DASH_PERIOD = DASH_LENGTH + DASH_GAP;
const DASH_EDGE_MARGIN = 1.3;
const INTERSECTION_TRIM = 0.8;
const ROAD_EXTENSION = 2.4;

export default function InstancedRoads({ roads, junctions }) {
  const asphaltRef = useRef();
  const dashesRef = useRef();
  const lastRoadCountRef = useRef(0);

  // Create matrices for all roads and dashes
  const { asphaltMatrices, dashMatrices } = useMemo(() => {
    const aMatrices = [];
    const dMatrices = [];

    roads.forEach((road) => {
      const [sx, , sz] = road.start;
      const [ex, , ez] = road.end;

      const dx = ex - sx;
      const dz = ez - sz;
      const length = Math.hypot(dx, dz);

      if (length < 0.001) return;

      const dirX = dx / length;
      const dirZ = dz / length;
      const angle = Math.atan2(dx, dz);

      const extLength = length + ROAD_EXTENSION * 2;
      const centerX = sx + (dx / 2);
      const centerZ = sz + (dz / 2);

      // Asphalt matrix
      const matrix = new THREE.Matrix4();
      matrix.makeRotationY(angle);
      matrix.scale(new THREE.Vector3(road.width, 0.06, extLength));
      matrix.setPosition(centerX, 0.03, centerZ);
      aMatrices.push(matrix);

      // Dash matrices
      const dashStart = road.connectedStart ? INTERSECTION_TRIM : DASH_EDGE_MARGIN;
      const dashEnd = road.connectedEnd ? length - INTERSECTION_TRIM : length - DASH_EDGE_MARGIN;
      const usableLength = dashEnd - dashStart;

      if (usableLength > 0) {
        let localZ = dashStart + DASH_GAP / 2 + DASH_LENGTH / 2;
        while (localZ + DASH_LENGTH / 2 <= dashEnd + 1e-6) {
          const wx = sx + dirX * localZ;
          const wz = sz + dirZ * localZ;

          const dMatrix = new THREE.Matrix4();
          dMatrix.makeRotationY(angle);
          dMatrix.scale(new THREE.Vector3(DASH_WIDTH, DASH_HEIGHT, DASH_LENGTH));
          dMatrix.setPosition(wx, 0.065, wz);
          dMatrices.push(dMatrix);

          localZ += DASH_PERIOD;
        }
      }
    });

    // Add junction connectors
    junctions.forEach((junc) => {
      const [jx, , jz] = junc.pos;
      junc.entries.forEach((entry) => {
        const r = entry.road;
        const [rsx, , rsz] = r.start;
        const [rex, , rez] = r.end;
        const rdx = rex - rsx;
        const rdz = rez - rsz;
        const rlen = Math.hypot(rdx, rdz) || 1;
        const dirX = rdx / rlen;
        const dirZ = rdz / rlen;
        const angle = Math.atan2(rdx, rdz);

        const dashStart = r.connectedStart ? INTERSECTION_TRIM : DASH_EDGE_MARGIN;
        const dashEnd = r.connectedEnd ? rlen - INTERSECTION_TRIM : rlen - DASH_EDGE_MARGIN;

        let localZs = [];
        if (dashEnd - dashStart > 0) {
          let lz = dashStart + DASH_GAP / 2 + DASH_LENGTH / 2;
          while (lz + DASH_LENGTH / 2 <= dashEnd + 1e-6) {
            localZs.push(lz);
            lz += DASH_PERIOD;
          }
        }

        const touchesIntersection = localZs.some((c) => {
          if (entry.which === 'start') return c - DASH_LENGTH / 2 <= dashStart + 0.001;
          return c + DASH_LENGTH / 2 >= dashEnd - 0.001;
        });

        if (touchesIntersection) return;

        const offsetAlong = entry.which === 'start' ? INTERSECTION_TRIM * 0.5 : -INTERSECTION_TRIM * 0.5;
        const localX = jx + dirX * offsetAlong;
        const localZ = jz + dirZ * offsetAlong;

        const crowdFactor = Math.max(1, junc.entries.length);
        const rectLength = INTERSECTION_TRIM * Math.max(0.8, 1.2 - (crowdFactor - 2) * 0.15);

        const dMatrix = new THREE.Matrix4();
        dMatrix.makeRotationY(angle);
        dMatrix.scale(new THREE.Vector3(DASH_WIDTH + 0.001, DASH_HEIGHT + 0.001, rectLength));
        dMatrix.setPosition(localX, 0.066, localZ);
        dMatrices.push(dMatrix);
      });
    });

    return { asphaltMatrices: aMatrices, dashMatrices: dMatrices };
  }, [roads, junctions]);

  useLayoutEffect(() => {
    if (asphaltRef.current) {
      asphaltMatrices.forEach((matrix, i) => asphaltRef.current.setMatrixAt(i, matrix));
      asphaltRef.current.instanceMatrix.needsUpdate = true;
    }
    if (dashesRef.current) {
      dashMatrices.forEach((matrix, i) => dashesRef.current.setMatrixAt(i, matrix));
      dashesRef.current.instanceMatrix.needsUpdate = true;
    }
  }, [asphaltMatrices, dashMatrices]);

  return (
    <group>
      {asphaltMatrices.length > 0 && (
        <instancedMesh ref={asphaltRef} args={[null, null, asphaltMatrices.length]} receiveShadow>
          <boxGeometry args={[1, 1, 1]} />
          <meshStandardMaterial color="#3d4148" roughness={0.9} metalness={0.1} />
        </instancedMesh>
      )}
      {dashMatrices.length > 0 && (
        <instancedMesh ref={dashesRef} args={[null, null, dashMatrices.length]} renderOrder={20}>
          <boxGeometry args={[1, 1, 1]} />
          <meshStandardMaterial color="#f5f5f5" roughness={0.5} metalness={0.1} />
        </instancedMesh>
      )}
    </group>
  );
}
