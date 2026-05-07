import { useFrame } from '@react-three/fiber';
import { useMemo, useRef } from 'react';
import { CatmullRomCurve3, Color, Vector3 } from 'three';

function ParticleTrail({ start, end, phase = 0 }) {
  const ref = useRef();

  const curve = useMemo(() => {
    const dx = end[0] - start[0];
    const dz = end[2] - start[2];
    const distance = Math.hypot(dx, dz);
    const lift = Math.min(7, 1.2 + distance * 0.07);

    const points = [
      new Vector3(start[0], 1.9, start[2]),
      new Vector3(start[0] + dx * 0.33, 1.0 + lift, start[2] + dz * 0.33),
      new Vector3(start[0] + dx * 0.66, 1.0 + lift, start[2] + dz * 0.66),
      new Vector3(end[0], 1.9, end[2]),
    ];
    return new CatmullRomCurve3(points, false, 'catmullrom', 0.5);
  }, [start, end]);

  useFrame((state) => {
    if (!ref.current) return;
    const t = (state.clock.elapsedTime * 0.25 + phase) % 1;
    const pos = curve.getPointAt(t);
    ref.current.position.copy(pos);
  });

  return (
    <mesh ref={ref} castShadow>
      <sphereGeometry args={[0.22, 20, 20]} />
      <meshStandardMaterial color={new Color('#ffd54a')} emissive={new Color('#d9a617')} emissiveIntensity={0.7} />
    </mesh>
  );
}

export default function TradeParticles({ trades, housesById }) {
  if (trades.length === 0) {
    return null;
  }

  return (
    <group>
      {trades.map((trade, index) => {
        const seller = housesById.get(trade.sellerId);
        const buyer = housesById.get(trade.buyerId);

        if (!seller || !buyer) {
          return null;
        }

        return (
          <ParticleTrail
            key={trade.id}
            start={seller.position}
            end={buyer.position}
            phase={(index * 0.17) % 1}
          />
        );
      })}
    </group>
  );
}
