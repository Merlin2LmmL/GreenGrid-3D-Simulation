import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig({
  // Relative base fixes Pages white-screens by avoiding hardcoded absolute asset URLs.
  base: './',
  plugins: [react()],
  assetsInclude: ['**/*.gltf', '**/*.glb'],
});
