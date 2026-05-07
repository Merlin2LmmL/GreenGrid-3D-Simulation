import { Canvas } from '@react-three/fiber';
import { OrbitControls } from '@react-three/drei';
import { useEffect } from 'react';
import EnergyScene from './components/EnergyScene';
import Dashboard from './components/Dashboard';
import { useEnergyStore } from './store/useEnergyStore';

export default function App() {
  const tick = useEnergyStore((state) => state.tick);
  const tickMs = useEnergyStore((state) => state.tickMs);
  const toggleHouseLabels = useEnergyStore((state) => state.toggleHouseLabels);

  useEffect(() => {
    tick();
    const id = setInterval(() => {
      tick();
    }, tickMs);

    return () => clearInterval(id);
  }, [tick, tickMs]);

  useEffect(() => {
    const handleKeyDown = (event) => {
      if (event.repeat || event.key.toLowerCase() !== 'h') {
        return;
      }

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

      event.preventDefault();
      toggleHouseLabels();
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
      >
        <EnergyScene />
        <OrbitControls
          makeDefault
          minDistance={12}
          maxDistance={100}
          maxPolarAngle={Math.PI / 2.03}
          target={[0, 2, 0]}
        />
      </Canvas>

      <Dashboard />
    </div>
  );
}
