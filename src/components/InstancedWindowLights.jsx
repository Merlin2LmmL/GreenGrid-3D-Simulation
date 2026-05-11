import { useMemo, useRef, useLayoutEffect } from 'react';
import * as THREE from 'three';
import { useFrame } from '@react-three/fiber';
import { useEnergyStore } from '../store/useEnergyStore';

export default function InstancedWindowLights({ houses }) {
  const meshRef = useRef();
  const timeHours = useEnergyStore((state) => state.timeHours);

  const nightFactor = useMemo(() => {
    const sunHeight = Math.sin(((timeHours - 6) / 12) * Math.PI);
    return 1 - THREE.MathUtils.smoothstep(sunHeight, -0.2, 0.1);
  }, [timeHours]);

  const { matrices, noiseOffsets } = useMemo(() => {
    const mats = [];
    const offsets = [];
    houses.forEach((house) => {
      const [x, y, z] = house.position;
      const matrix = new THREE.Matrix4();
      matrix.setPosition(x, y + 0.15, z);
      mats.push(matrix);
      offsets.push(Math.random() * 100);
    });
    return { matrices: mats, noiseOffsets: new Float32Array(offsets) };
  }, [houses]);

  const uniforms = useRef({
    uTime: { value: 0 },
    uNightFactor: { value: 0 }
  });

  useLayoutEffect(() => {
    if (meshRef.current) {
      matrices.forEach((m, i) => meshRef.current.setMatrixAt(i, m));
      meshRef.current.instanceMatrix.needsUpdate = true;
    }
  }, [matrices]);

  useFrame((state) => {
    if (!meshRef.current) return;
    uniforms.current.uTime.value = state.clock.elapsedTime;
    uniforms.current.uNightFactor.value = nightFactor;
    
    // Toggle visibility based on night factor
    meshRef.current.visible = nightFactor > 0;
  });

  // Avoid creating an instancedMesh with zero instances
  if (!houses || houses.length === 0) return null;

  return (
    <instancedMesh
      key={`lights-${houses.length}`}
      ref={meshRef}
      args={[null, null, houses.length]}
      frustumCulled={true}
    >
      <boxGeometry args={[0.3, 0.3, 0.3]}>
        <instancedBufferAttribute
          attach="attributes-aNoiseOffset"
          args={[noiseOffsets, 1]}
        />
      </boxGeometry>
      <meshStandardMaterial
        color="#fff176"
        emissive="#fff176"
        emissiveIntensity={8}
        toneMapped={false}
        transparent
        onBeforeCompile={(shader) => {
          shader.uniforms.uTime = uniforms.current.uTime;
          shader.uniforms.uNightFactor = uniforms.current.uNightFactor;

          shader.vertexShader = `
            attribute float aNoiseOffset;
            varying float vFlicker;
            varying float vNightFactor;
            ${shader.vertexShader}
          `.replace(
            '#include <begin_vertex>',
            `
            #include <begin_vertex>
            float t = uTime + aNoiseOffset;
            vFlicker = sin(t * 1.5) * 0.2 + sin(t * 4.0) * 0.1 + 1.2;
            vNightFactor = uNightFactor;
            `
          );

          shader.fragmentShader = `
            varying float vFlicker;
            varying float vNightFactor;
            ${shader.fragmentShader}
          `.replace(
            '#include <emissivemap_fragment>',
            `
            #include <emissivemap_fragment>
            totalEmissiveRadiance *= vFlicker;
            diffuseColor.a *= vNightFactor;
            `
          );
        }}
      />
    </instancedMesh>
  );
}
