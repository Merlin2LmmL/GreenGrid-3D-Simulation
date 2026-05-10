import { useMemo, useRef, useLayoutEffect } from 'react';
import * as THREE from 'three';
import { useGLTF } from '@react-three/drei';

const HOUSE_MODELS = [1, 2, 3, 4, 5, 6].map(
  (i) => `${import.meta.env.BASE_URL}assets/models/houses/house${i}.glb`,
);

function ModelInstances({ modelPath, houses }) {
  const { scene } = useGLTF(modelPath);
  
  // Find all meshes in the model
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

  const instancedMeshesRef = useRef([]);

  const matrices = useMemo(() => {
    return houses.map((house) => {
      const [x, y, z] = house.position;
      const rotationY = (house.streetFacingRotation || 0) + Math.PI / -2 + (house.customRotation || 0);
      const scale = house.customScale || 1.0;
      const offset = house.offset || { x: 0, y: 0, z: 0 };

      const matrix = new THREE.Matrix4();
      
      // 1. Rotation and position
      matrix.makeRotationY(rotationY);
      matrix.setPosition(x, y, z);

      // 2. Local offset and scale (applied in house space)
      const localMatrix = new THREE.Matrix4();
      localMatrix.makeTranslation(offset.x, offset.y, offset.z);
      localMatrix.scale(new THREE.Vector3(scale, scale, scale));

      return new THREE.Matrix4().multiplyMatrices(matrix, localMatrix);
    });
  }, [houses]);

  useLayoutEffect(() => {
    instancedMeshesRef.current.forEach((im) => {
      if (im) {
        matrices.forEach((matrix, i) => {
          // Multiply house world matrix by the mesh's local matrix in the GLTF scene
          // im.userData.localMatrix is the matrix of the mesh relative to GLTF scene root
          const m = new THREE.Matrix4().multiplyMatrices(matrix, im.userData.localMatrix);
          im.setMatrixAt(i, m);
        });
        im.instanceMatrix.needsUpdate = true;
      }
    });
  }, [matrices]);

  return (
    <group>
      {meshData.map((data, idx) => (
        <instancedMesh
          key={idx}
          ref={(el) => (instancedMeshesRef.current[idx] = el)}
          args={[data.geometry, data.material, houses.length]}
          userData={{ localMatrix: data.localMatrix }}
          castShadow
          receiveShadow
        />
      ))}
    </group>
  );
}

export default function InstancedHouses({ houses }) {
  // Group houses by model index
  const groupedHouses = useMemo(() => {
    const groups = {};
    houses.forEach((house) => {
      const idx = house.modelIndex;
      if (!groups[idx]) groups[idx] = [];
      groups[idx].push(house);
    });
    return groups;
  }, [houses]);

  return (
    <group>
      {Object.entries(groupedHouses).map(([modelIndex, housesInGroup]) => (
        <ModelInstances
          key={modelIndex}
          modelPath={HOUSE_MODELS[modelIndex - 1]}
          houses={housesInGroup}
        />
      ))}
    </group>
  );
}
