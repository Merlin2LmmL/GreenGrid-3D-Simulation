import { Canvas } from '@react-three/fiber';
import { OrbitControls } from '@react-three/drei';
import { useEffect } from 'react';
import EnergyScene from './components/EnergyScene';
import Dashboard, { DebugToolbar, SettingsMenu } from './components/Dashboard';
import { useEnergyStore } from './store/useEnergyStore';

export default function App() {
  const tick = useEnergyStore((state) => state.tick);
  const tickMs = useEnergyStore((state) => state.tickMs);
  const toggleHouseLabels = useEnergyStore((state) => state.toggleHouseLabels);
  const toggleDebug = useEnergyStore((state) => state.toggleDebug);
  const debug = useEnergyStore((state) => state.DEBUG);

  // Detect mobile device for canvas optimization
  const isMobile = /Android|webOS|iPhone|iPad|iPod|BlackBerry|IEMobile|Opera Mini/i.test(navigator.userAgent);
  const dpr = isMobile ? Math.min(window.devicePixelRatio, 1.5) : window.devicePixelRatio;

  useEffect(() => {
    // Call the store tick directly via getState so the interval
    // is stable across store updates (avoids tick function identity
    // causing the effect to rerun and briefly stop updates).
    useEnergyStore.getState().tick();
    const id = setInterval(() => {
      useEnergyStore.getState().tick();
    }, tickMs);

    return () => clearInterval(id);
  }, [tickMs]);

  useEffect(() => {
    const handleKeyDown = (event) => {
      const target = event.target;
      const isTypingField =
        target instanceof HTMLElement &&
        (target.tagName === 'INPUT' ||
          target.tagName === 'TEXTAREA' ||
          target.tagName === 'SELECT' ||
          target.isContentEditable);

      if (isTypingField) {
        return;
      }

      if (event.key.toLowerCase() === 'h') {
        event.preventDefault();
        toggleHouseLabels();
      } else if (event.key.toLowerCase() === 'd') {
        event.preventDefault();
        toggleDebug();
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [toggleHouseLabels]);

  return (
    <div className="canvas-wrap">
      <Canvas
        shadows
        camera={{ position: [20, 15, 26], fov: 52 }}
        gl={{ antialias: !isMobile, dpr, powerPreference: 'high-performance' }}
        dpr={dpr}
      >
        <EnergyScene />
        <OrbitControls
          makeDefault
          minDistance={12}
          maxDistance={200}
          maxPolarAngle={Math.PI / 2.03}
          target={[0, 2, 0]}
        />
      </Canvas>

      <Dashboard />
      <SettingsMenu />
      <DebugToolbar debug={debug} toggleDebug={toggleDebug} />
    </div>
  );
}
