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

  useEffect(() => {
    tick();
    const id = setInterval(() => {
      tick();
    }, tickMs);

    return () => clearInterval(id);
  }, [tick, tickMs]);

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
        gl={{ antialias: true }}
        dpr={[1, 1.5]}
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
