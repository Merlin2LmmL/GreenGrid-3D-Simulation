import { useMemo, useRef, useLayoutEffect, memo } from 'react';
import * as THREE from 'three';
import { useGLTF } from '@react-three/drei';
import { solarPanelModelPath } from '../config/houseModels';

const PanelMeshInstances = memo(function PanelMeshInstances({ meshData, matrices }) {
  const meshRef = useRef();
  useLayoutEffect(() => {
    if (meshRef.current && matrices.length > 0) {
      matrices.forEach((matrix, i) => {
        const m = new THREE.Matrix4().multiplyMatrices(matrix, meshRef.current.userData.localMatrix);
        meshRef.current.setMatrixAt(i, m);
      });
      meshRef.current.instanceMatrix.needsUpdate = true;
    }
  }, [matrices]);

  // Avoid rendering instancedMesh with zero instances
  if (!matrices || matrices.length === 0) return null;

  return (
    <instancedMesh
      ref={meshRef}
      args={[meshData.geometry, meshData.material, matrices.length]}
      userData={{ localMatrix: meshData.localMatrix }}
      castShadow
      receiveShadow
    />
  );
});

export default function InstancedSolarPanels({ houses }) {
  const { scene } = useGLTF(solarPanelModelPath);

  const meshData = useMemo(() => {
    const data = [];
    scene.traverse((child) => {
      if (child.isMesh) {
        data.push({
          geometry: child.geometry,
          material: child.material,
          localMatrix: child.matrixWorld.clone()
        });
      }
    });
    return data;
  }, [scene]);

  const matrices = useMemo(() => {
    const mats = [];
    houses.forEach((house) => {
      if (!house.hasSolar || !house.solarPanels) return;

      const [hx, hy, hz] = house.position;
      const houseRotationY = (house.streetFacingRotation || 0) + Math.PI / -2 + (house.customRotation || 0);
      const houseOffset = house.offset || { x: 0, y: 0, z: 0 };

      // 1. Create the house's world transform
      const houseBaseMatrix = new THREE.Matrix4();
      houseBaseMatrix.makeRotationY(houseRotationY);
      houseBaseMatrix.setPosition(hx, hy, hz);

      // 2. Create the house's internal offset transform
      // NOTE: Solar panels are siblings of the scaled house model, so we only apply house offset/rotation.
      const houseOffsetMatrix = new THREE.Matrix4();
      houseOffsetMatrix.makeTranslation(houseOffset.x, houseOffset.y, houseOffset.z);

      // 3. Combined parent matrix for panels
      const parentMatrix = new THREE.Matrix4().multiplyMatrices(houseBaseMatrix, houseOffsetMatrix);

      house.solarPanels.forEach((panel) => {
        const offset = panel.offset || { x: 0, y: 0, z: 0 };
        const scale = panel.scale ?? 1;
        
        let rotation = panel.rotation || { x: 0, y: 0, z: 0 };
        if (panel.rotationDeg) {
          rotation = {
            x: (panel.rotationDeg.x || 0) * Math.PI / 180,
            y: (panel.rotationDeg.y || 0) * Math.PI / 180,
            z: (panel.rotationDeg.z || 0) * Math.PI / 180,
          };
        }

        const panelMatrix = new THREE.Matrix4();
        const R = new THREE.Matrix4().makeRotationFromEuler(new THREE.Euler(rotation.x, rotation.y, rotation.z, 'YXZ'));
        const T = new THREE.Matrix4().makeTranslation(offset.x, offset.y, offset.z);
        const S = new THREE.Matrix4().makeScale(scale, scale, scale);

        panelMatrix.multiplyMatrices(T, R).multiply(S);

        const worldMatrix = new THREE.Matrix4().multiplyMatrices(parentMatrix, panelMatrix);
        mats.push(worldMatrix);
      });
    });
    return mats;
  }, [houses]);

  if (meshData.length === 0 || matrices.length === 0) return null;

  return (
    <group>
      {meshData.map((data, idx) => (
        <PanelMeshInstances 
          key={`${idx}-${matrices.length}`}
          meshData={data} 
          matrices={matrices} 
        />
      ))}
    </group>
  );
}
