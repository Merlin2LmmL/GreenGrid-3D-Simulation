import { Html, useGLTF } from '@react-three/drei';
import { useMemo, useState, useEffect, useRef, useCallback } from 'react';
import { useFrame } from '@react-three/fiber';
import * as THREE from 'three';
import { useEnergyStore } from '../store/useEnergyStore';
import { solarPanelModelPath } from '../config/houseModels';

const formatNumber = (value) => Math.round(value).toLocaleString('de-DE');

const LOD_NEAR_DISTANCE = 55;
const LOD_FAR_DISTANCE = 95;
// Only re-check LOD every N frames — saves ~90% of distance calculations
const LOD_CHECK_INTERVAL = 15;

const HOUSE_MODELS = [1, 2, 3, 4, 5, 6].map(
  (i) => `${import.meta.env.BASE_URL}assets/models/houses/house${i}.glb`,
);
HOUSE_MODELS.forEach((path) => useGLTF.preload(path));
useGLTF.preload(solarPanelModelPath);

// ─── Helpers ────────────────────────────────────────────────────────────────

const toVector3 = (value, fallback = { x: 0, y: 0, z: 0 }) => {
  if (Array.isArray(value)) {
    return {
      x: value[0] ?? fallback.x,
      y: value[1] ?? fallback.y,
      z: value[2] ?? fallback.z,
    };
  }
  return {
    x: value?.x ?? fallback.x,
    y: value?.y ?? fallback.y,
    z: value?.z ?? fallback.z,
  };
};

const cloneTexture = (texture) => {
  if (!texture) return null;
  const cloned = texture.clone();
  cloned.needsUpdate = true;
  return cloned;
};

const cloneMaterialWithTextures = (material) => {
  const cloned = material.clone();
  ['map', 'normalMap', 'roughnessMap', 'metalnessMap', 'aoMap', 'emissiveMap'].forEach((key) => {
    if (cloned[key]) cloned[key] = cloneTexture(cloned[key]);
  });
  return cloned;
};

const cloneSceneWithMaterials = (scene) => {
  if (!scene) return null;
  const cloned = scene.clone();
  cloned.traverse((child) => {
    if (!child.material) return;
    if (Array.isArray(child.material)) {
      child.material = child.material.map(cloneMaterialWithTextures);
    } else {
      child.material = cloneMaterialWithTextures(child.material);
    }
  });
  return cloned;
};

/**
 * Mutates existing texture parameters — does NOT re-clone anything.
 * This is the only thing LOD should do to textures.
 */
const applyTextureQuality = (scene, textureQuality) => {
  if (!scene) return;
  const anisotropy = textureQuality === 'high' ? 8 : textureQuality === 'medium' ? 2 : 1;
  const minFilter = textureQuality === 'low' ? THREE.LinearFilter : THREE.LinearMipmapLinearFilter;
  scene.traverse((child) => {
    if (!child.material) return;
    const materials = Array.isArray(child.material) ? child.material : [child.material];
    materials.forEach((mat) => {
      ['map', 'normalMap', 'roughnessMap', 'metalnessMap', 'aoMap', 'emissiveMap'].forEach((key) => {
        const tex = mat[key];
        if (!tex) return;
        if (tex.anisotropy === anisotropy && tex.minFilter === minFilter) return; // already correct
        tex.anisotropy = anisotropy;
        tex.minFilter = minFilter;
        tex.magFilter = THREE.LinearFilter;
        tex.needsUpdate = true;
      });
    });
  });
};

// ─── Solar panel attachment ──────────────────────────────────────────────────

function SolarPanelAttachment({ attachment, panelScene }) {
  // Clone panel scene once; parent applies texture quality to it
  const clonedScene = useMemo(() => {
    if (!panelScene) return null;
    return cloneSceneWithMaterials(panelScene);
  }, [panelScene]);

  const offset = toVector3(attachment.offset, { x: 0, y: 0, z: 0 });
  let rotation = toVector3(attachment.rotation, { x: 0, y: 0, z: 0 });
  if (attachment.rotationDeg) {
    const deg = toVector3(attachment.rotationDeg, { x: 0, y: 0, z: 0 });
    rotation = {
      x: (deg.x * Math.PI) / 180,
      y: (deg.y * Math.PI) / 180,
      z: (deg.z * Math.PI) / 180,
    };
  }
  const scale = attachment.scale ?? 1;
  const { y: yaw = 0, x: tilt = 0, z: roll = 0 } = rotation;

  return (
    <group position={[offset.x, offset.y, offset.z]}>
      <group rotation={[0, yaw, 0]}>
        <group rotation={[tilt, 0, roll]} scale={scale}>
          {clonedScene ? (
            <primitive object={clonedScene} castShadow receiveShadow />
          ) : (
            <mesh castShadow receiveShadow>
              <boxGeometry args={[1.4, 0.08, 0.9]} />
              <meshStandardMaterial color="#1d2b36" roughness={0.35} metalness={0.2} />
            </mesh>
          )}
        </group>
      </group>
    </group>
  );
}
function HouseLight({ timeHours, position }) {
  const lightRef = useRef();

  const nightFactor = useMemo(() => {
    const sunHeight = Math.sin(((timeHours - 6) / 12) * Math.PI);
    return 1 - THREE.MathUtils.smoothstep(sunHeight, -0.2, 0.1);
  }, [timeHours]);

  useFrame(({ clock }) => {
    if (!lightRef.current) return;

    if (nightFactor <= 0) {
      lightRef.current.intensity = 0;
      return;
    }

    // Use clock.elapsedTime for better performance (no Date.now() call)
    const t = clock.elapsedTime;
    const flicker = Math.sin(t * 1.5) * 0.2 + Math.sin(t * 4) * 0.1;
    const intensity = (1.2 + flicker) * nightFactor;

    lightRef.current.intensity = intensity * 4;
  });

  return (
    <pointLight
      ref={lightRef}
      position={[0, 0.15, 0]}
      distance={12}
      decay={0.8}
      color="#fff176"
      castShadow={false}
    />
  );
}

// ─── House detail (rendered geometry) ────────────────────────────────────────

function HouseDetail({
  house,
  position,
  showDebugDetails,
  showLabel,
  rotation,
  offset,
  DEBUG,
  streetMarkerPosition,
  timeHours,
  userScale,
}) {
  const [isHovered, setIsHovered] = useState(false);

  // No longer needed to update scale every frame manually as distanceFactor 
  // on the Html component handles distance scaling, and the Billboard's 
  // scale prop handles the user-defined scale from the dashboard.

  return (
    <group position={position}>
      {showDebugDetails && (
        <mesh position={[0, 0.15, 0]}>
          <boxGeometry args={[0.3, 0.3, 0.3]} />
          <meshStandardMaterial color="#ff0000" emissive="#ff0000" />
        </mesh>
      )}
      {showDebugDetails && isHovered && streetMarkerPosition && (
        <mesh position={streetMarkerPosition} rotation={[-Math.PI / 2, 0, 0]} renderOrder={50}>
          <planeGeometry args={[1.1, 1.1]} />
          <meshBasicMaterial color="#2196f3" depthTest={false} toneMapped={false} />
        </mesh>
      )}

      {/* 
          We only keep the light here. 
          If we have too many houses, we might want to cull these lights by distance too.
      */}
      <HouseLight timeHours={timeHours} position={position} />

      {/* Interaction target for labels/debug - invisible but catches events */}
      <mesh
        position={[0, 1.2, 0]}
        onPointerEnter={showDebugDetails ? () => setIsHovered(true) : undefined}
        onPointerLeave={showDebugDetails ? () => setIsHovered(false) : undefined}
        visible={false}
      >
        <boxGeometry args={[3.5, 2.5, 3.5]} />
      </mesh>

      {showLabel && (
        <group position={[0, 4.45, 0]}>
          <Html
            center
            distanceFactor={20}
            occlude={false}
            zIndexRange={[900, 0]}
            style={{ pointerEvents: 'none' }}
          >
            <div 
              className="min-w-[170px] rounded-lg border border-cyan-200/30 bg-slate-900/85 p-2 text-[11px] text-cyan-50 shadow-xl"
              style={{ transform: `scale(${userScale})`, transformOrigin: 'bottom center' }}
            >
              <div className="mb-1 font-semibold tracking-wide text-cyan-100">{house.name}</div>
              {DEBUG && isHovered && (
                <div className="mb-1 border-b border-cyan-200/20 pb-1 text-[9px] text-cyan-300">
                  <div>🔧 house{house.modelIndex}.glb</div>
                  <div>Scale: {house.customScale?.toFixed(2) || '1.00'}</div>
                  <div>Rotation: {(house.customRotation || 0).toFixed(3)} rad</div>
                </div>
              )}
              <div>Verbrauch: {formatNumber(house.consumption)} W</div>
              <div>Produktion: {formatNumber(house.production)} W</div>
              {house.hasBattery && (
                <div>
                  Batterie: {house.batteryLevel.toFixed(2).replace('.', ',')} /{' '}
                  {house.batteryCapacity.toFixed(1).replace('.', ',')} kWh
                </div>
              )}
              <div>
                Kumulativ: {house.cumulativeBalance >= 0 ? '+' : ''}
                {house.cumulativeBalance.toFixed(2).replace('.', ',')} €
              </div>
              {(house.buyOrders?.length > 0 || house.sellOrders?.length > 0) && (
                <div className="mt-1 border-t border-cyan-200/20 pt-1 space-y-1">
                  {house.sellOrders?.map((t, i) => {
                    const pct = t.totalWh > 0 ? Math.min(100, (t.usedWh / t.totalWh) * 100) : 0;
                    return (
                      <div key={`sell-${i}`}>
                        <div className="flex justify-between text-emerald-300 text-[9px] mb-0.5">
                          <span>📤 → Haus {String(t.buyerId + 1).padStart(2, '0')}</span>
                          <span>{t.pricePerKWh.toFixed(3).replace('.', ',')} €/kWh</span>
                        </div>
                        <div className="flex items-center gap-1">
                          <div className="flex-1 h-1.5 rounded-full bg-slate-700 overflow-hidden">
                            <div
                              className="h-full rounded-full bg-emerald-400 transition-all duration-500"
                              style={{ width: `${pct}%` }}
                            />
                          </div>
                          <span className="text-emerald-200 text-[9px] tabular-nums whitespace-nowrap">
                            {(t.usedWh / 1000).toFixed(2).replace('.', ',')} / {(t.totalWh / 1000).toFixed(2).replace('.', ',')} kWh
                          </span>
                        </div>
                      </div>
                    );
                  })}
                  {house.buyOrders?.map((t, i) => {
                    const pct = t.totalWh > 0 ? Math.min(100, (t.usedWh / t.totalWh) * 100) : 0;
                    return (
                      <div key={`buy-${i}`}>
                        <div className="flex justify-between text-yellow-300 text-[9px] mb-0.5">
                          <span>📥 ← Haus {String(t.sellerId + 1).padStart(2, '0')}</span>
                          <span>{t.pricePerKWh.toFixed(3).replace('.', ',')} €/kWh</span>
                        </div>
                        <div className="flex items-center gap-1">
                          <div className="flex-1 h-1.5 rounded-full bg-slate-700 overflow-hidden">
                            <div
                              className="h-full rounded-full bg-yellow-400 transition-all duration-500"
                              style={{ width: `${pct}%` }}
                            />
                          </div>
                          <span className="text-yellow-200 text-[9px] tabular-nums whitespace-nowrap">
                            {(t.usedWh / 1000).toFixed(2).replace('.', ',')} / {(t.totalWh / 1000).toFixed(2).replace('.', ',')} kWh
                          </span>
                        </div>
                      </div>
                    );
                  })}
                </div>
              )}
            </div>
          </Html>
        </group>
      )}
    </group>
  );
}

// ─── Main export ─────────────────────────────────────────────────────────────

export default function House({ house }) {
  const [x, y, z] = house.position;
  const DEBUG = useEnergyStore((state) => state.DEBUG);
  const showHouseLabels = useEnergyStore((state) => state.showHouseLabels);
  const timeHours = useEnergyStore((state) => state.timeHours);

  // Use a ref for the frame counter — no re-render cost
  const frameRef = useRef(0);

  // lodLevelRef drives state; state only updates when level actually changes
  const lodLevelRef = useRef(0);
  const [lodLevel, setLodLevel] = useState(0);

  const storeLabelScale = useEnergyStore((state) => state.labelScale);

  useFrame(({ camera }) => {
    const dx = camera.position.x - x;
    const dy = camera.position.y - (y + 4.45);
    const dz = camera.position.z - z;
    const dist = Math.sqrt(dx * dx + dy * dy + dz * dz);

    // ── Label scale ──────────────────────────────────────────────────────────
    // Removed manual distance scaling as it conflicts with Html distanceFactor
    // and causes exponential scaling bugs.

    // ── LOD (throttled) ─────────────────────────────────────────────────────
    frameRef.current += 1;
    if (frameRef.current % LOD_CHECK_INTERVAL !== 0) return;

    const distToHouse = Math.sqrt(
      (camera.position.x - x) ** 2 +
      (camera.position.y - y) ** 2 +
      (camera.position.z - z) ** 2,
    );

    const next =
      distToHouse < LOD_NEAR_DISTANCE ? 0 : distToHouse < LOD_FAR_DISTANCE ? 1 : 2;

    if (lodLevelRef.current !== next) {
      lodLevelRef.current = next;
      setLodLevel(next);
    }
  });

  const rotation = useMemo(
    () => [0, (house.streetFacingRotation || 0) + Math.PI / -2 + (house.customRotation || 0), 0],
    [house.streetFacingRotation, house.customRotation],
  );

  const offset = house.offset || { x: 0, y: 0, z: 0 };

  const streetMarkerPosition = useMemo(() => {
    const sp = house.streetPoint;
    if (!Array.isArray(sp) || sp.length !== 3) return null;
    return [sp[0] - x, 0.16, sp[2] - z];
  }, [house.streetPoint, x, z]);

  const showLabel = showHouseLabels && lodLevel < 2;
  const showDebugDetails = DEBUG && lodLevel === 0;

  return (
    <HouseDetail
      house={house}
      position={[x, y, z]}
      showDebugDetails={showDebugDetails}
      showLabel={showLabel}
      rotation={rotation}
      offset={offset}
      DEBUG={DEBUG}
      streetMarkerPosition={streetMarkerPosition}
      timeHours={timeHours}
      userScale={storeLabelScale}
    />
  );
}
