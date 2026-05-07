import { Html, useGLTF, Billboard } from '@react-three/drei';
import { useMemo, useState, useEffect, useRef, useCallback } from 'react';
import { useFrame } from '@react-three/fiber';
import { LinearFilter, LinearMipmapLinearFilter } from 'three';
import { useEnergyStore } from '../store/useEnergyStore';
import { solarPanelModelPath } from '../config/houseModels';

const formatNumber = (value) => Math.round(value).toLocaleString('de-DE');

const LOD_NEAR_DISTANCE = 55;
const LOD_FAR_DISTANCE = 95;
// Only re-check LOD every N frames — saves ~90% of distance calculations
const LOD_CHECK_INTERVAL = 12;

const HOUSE_MODELS = [1, 2, 3, 4, 5, 6].map((i) => `/assets/models/houses/house${i}.glb`);
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
  const minFilter = textureQuality === 'low' ? LinearFilter : LinearMipmapLinearFilter;
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
        tex.magFilter = LinearFilter;
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

// ─── House detail (rendered geometry) ────────────────────────────────────────

function HouseDetail({
  house,
  position,
  modelPath,
  showPanels,
  showDebugDetails,
  showLabel,
  labelScaleRef,
  rotation,
  offset,
  finalScale,
  solarPanels,
  panelModelPath,
  DEBUG,
  streetMarkerPosition,
  textureQuality,
}) {
  const [isHovered, setIsHovered] = useState(false);

  const gltf = useGLTF(modelPath);

  // ✅ Clone scene ONCE — textureQuality is NOT a dependency here
  const clonedScene = useMemo(() => {
    if (!gltf?.scene) return null;
    return cloneSceneWithMaterials(gltf.scene);
  }, [gltf]);

  // ✅ Texture quality is applied by mutation, no re-clone needed
  useEffect(() => {
    applyTextureQuality(clonedScene, textureQuality);
  }, [clonedScene, textureQuality]);

  const panelGltf = useGLTF(panelModelPath);
  const panelScene = showPanels ? panelGltf?.scene || null : null;

  // ✅ Panel texture quality follows the same pattern
  useEffect(() => {
    if (!panelGltf?.scene || !showPanels) return;
    applyTextureQuality(panelGltf.scene, textureQuality);
  }, [panelGltf, showPanels, textureQuality]);

  useEffect(() => {
    if (!DEBUG || !clonedScene || !showDebugDetails) return;
    clonedScene.traverse((child) => {
      if (child.material) {
        child.material.opacity = isHovered ? 0.3 : 1.0;
        child.material.transparent = true;
        child.material.needsUpdate = true;
      }
    });
  }, [isHovered, clonedScene, DEBUG, showDebugDetails]);

  // Label scale is driven by a ref updated in the parent useFrame — no state needed
  const [labelScaleState, setLabelScaleState] = useState(1.0);
  useEffect(() => {
    if (!showLabel) return;
    // Sync ref value into state once on mount so the label renders correctly
    setLabelScaleState(labelScaleRef.current);
  }, [showLabel]); // eslint-disable-line

  // Update label scale from the ref every frame when label is visible
  useFrame(() => {
    if (!showLabel) return;
    const next = labelScaleRef.current;
    setLabelScaleState((prev) => (Math.abs(prev - next) > 0.01 ? next : prev));
  });

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

      <group rotation={rotation}>
        <group position={[offset.x, offset.y, offset.z]}>
          {clonedScene ? (
            <primitive
              object={clonedScene}
              castShadow
              receiveShadow
              scale={finalScale}
              onPointerEnter={showDebugDetails ? () => setIsHovered(true) : undefined}
              onPointerLeave={showDebugDetails ? () => setIsHovered(false) : undefined}
            />
          ) : (
            <mesh
              castShadow
              receiveShadow
              position={[0, 1.2, 0]}
              onPointerEnter={showDebugDetails ? () => setIsHovered(true) : undefined}
              onPointerLeave={showDebugDetails ? () => setIsHovered(false) : undefined}
            >
              <boxGeometry args={[3.1, 2.4, 2.8]} />
              <meshStandardMaterial color="#f1efe5" roughness={0.65} />
            </mesh>
          )}

          {showPanels &&
            solarPanels.map((attachment, index) => (
              <SolarPanelAttachment
                key={`${house.id}-solar-panel-${index}`}
                attachment={attachment}
                panelScene={panelScene}
              />
            ))}
        </group>
      </group>

      {showLabel && (
        <Billboard position={[0, 4.45, 0]} scale={labelScaleState}>
          <Html center distanceFactor={20} occlude={false} zIndexRange={[0, 0]} style={{ pointerEvents: 'none' }}>
            <div className="min-w-[170px] rounded-lg border border-cyan-200/30 bg-slate-900/85 p-2 text-[11px] text-cyan-50 shadow-xl">
              <div className="mb-1 font-semibold tracking-wide text-cyan-100">{house.name}</div>
              {DEBUG && isHovered && (
                <div className="mb-1 border-b border-cyan-200/20 pb-1 text-[9px] text-cyan-300">
                  <div>🔧 house{house.modelIndex}.glb</div>
                  <div>Scale: {house.customScale?.toFixed(2) || '1.00'}</div>
                  <div>Rotation: {(house.customRotation || 0).toFixed(3)} rad</div>
                  <div>
                    Offset: ({offset.x.toFixed(2)}, {offset.y.toFixed(2)}, {offset.z.toFixed(2)})
                  </div>
                </div>
              )}
              <div>Verbrauch: {formatNumber(house.consumption)} W</div>
              <div>Produktion: {formatNumber(house.production)} W</div>
              <div>
                Batterie: {house.batteryLevel.toFixed(2).replace('.', ',')} /{' '}
                {house.batteryCapacity.toFixed(1).replace('.', ',')} kWh
              </div>
              <div>
                Kumulativ: {house.cumulativeBalance >= 0 ? '+' : ''}
                {house.cumulativeBalance.toFixed(2).replace('.', ',')} €
              </div>
              {(house.buyOrders?.length > 0 || house.sellOrders?.length > 0) && (
                <div className="mt-1 border-t border-cyan-200/20 pt-1 text-yellow-300">
                  {house.buyOrders?.length > 0 && <div>🛒 Kauforder: {house.buyOrders.length}</div>}
                  {house.sellOrders?.length > 0 && <div>📦 Verkauforder: {house.sellOrders.length}</div>}
              </div>
              )}
            </div>
          </Html>
        </Billboard>
      )}
    </group>
  );
}

// ─── Main export ─────────────────────────────────────────────────────────────

export default function House({ house }) {
  const [x, y, z] = house.position;
  const DEBUG = useEnergyStore((state) => state.DEBUG);
  const showHouseLabels = useEnergyStore((state) => state.showHouseLabels);

  // ✅ Use a ref for the frame counter — no re-render cost
  const frameRef = useRef(0);

  // ✅ lodLevelRef drives state; state only updates when level actually changes
  const lodLevelRef = useRef(0);
  const [lodLevel, setLodLevel] = useState(0);

  // ✅ labelScale lives in a ref, updated every frame — consumed by HouseDetail
  const labelScaleRef = useRef(1.0);

  useFrame(({ camera }) => {
    // ── Label scale (update every frame, no state) ──────────────────────────
    const dx = camera.position.x - x;
    const dy = camera.position.y - (y + 4.45);
    const dz = camera.position.z - z;
    const dist = Math.sqrt(dx * dx + dy * dy + dz * dz);
    labelScaleRef.current = Math.max(2.4, Math.sqrt(dist / 15));

    // ── LOD (throttled) ─────────────────────────────────────────────────────
    frameRef.current += 1;
    if (frameRef.current % LOD_CHECK_INTERVAL !== 0) return;

    // Reuse dx/dy/dz from above (same camera position)
    const distToHouse = Math.sqrt(
      (camera.position.x - x) ** 2 +
      (camera.position.y - y) ** 2 +
      (camera.position.z - z) ** 2,
    );

    const next =
      distToHouse < LOD_NEAR_DISTANCE ? 0 : distToHouse < LOD_FAR_DISTANCE ? 1 : 2;

    if (lodLevelRef.current !== next) {
      lodLevelRef.current = next;
      setLodLevel(next); // Only re-renders when level truly changes
    }
  });

  const modelPath = useMemo(() => {
    const idx = Math.max(0, Math.min(house.modelIndex - 1, HOUSE_MODELS.length - 1));
    return HOUSE_MODELS[idx];
  }, [house.modelIndex]);

  const rotation = useMemo(
    () => [0, (house.streetFacingRotation || 0) + Math.PI / -2 + (house.customRotation || 0), 0],
    [house.streetFacingRotation, house.customRotation],
  );

  const offset = house.offset || { x: 0, y: 0, z: 0 };
  const finalScale = house.customScale || 1.0;
  const solarPanels = Array.isArray(house.solarPanels) ? house.solarPanels : [];
  const panelModelPath = house.solarPanelModelPath || solarPanelModelPath;

  const streetMarkerPosition = useMemo(() => {
    const sp = house.streetPoint;
    if (!Array.isArray(sp) || sp.length !== 3) return null;
    return [sp[0] - x, 0.16, sp[2] - z];
  }, [house.streetPoint, x, z]);

  // textureQuality derived from lodLevel — only changes on actual LOD transitions
  const textureQuality = lodLevel === 0 ? 'high' : lodLevel === 1 ? 'medium' : 'low';
  const showLabel = showHouseLabels && lodLevel < 2;
  const showDebugDetails = DEBUG && lodLevel === 0;

  return (
    <HouseDetail
      house={house}
      position={[x, y, z]}
      modelPath={modelPath}
      showPanels={true}
      showDebugDetails={showDebugDetails}
      showLabel={showLabel}
      labelScaleRef={labelScaleRef}
      rotation={rotation}
      offset={offset}
      finalScale={finalScale}
      solarPanels={solarPanels}
      panelModelPath={panelModelPath}
      DEBUG={DEBUG}
      streetMarkerPosition={streetMarkerPosition}
      textureQuality={textureQuality}
    />
  );
}