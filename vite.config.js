import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig({
  base: '/GreenGrid-3D-Simulation/',
  plugins: [react()],
  assetsInclude: ['**/*.gltf', '**/*.glb'],
});
