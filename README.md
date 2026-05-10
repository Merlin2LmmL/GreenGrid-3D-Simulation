# GreenGrid 3D Simulation

GreenGrid is a real-time 3D simulation of a decentralized neighborhood energy network.  
The app visualizes houses, local production/consumption, battery behavior, and peer-to-peer trade flows.

## Tech Stack

- **Vite** for bundling and local development
- **React** for UI and composition
- **React Three Fiber + Drei** for 3D scene rendering
- **Three.js** for low-level graphics primitives
- **Zustand** for simulation and UI state
- **Tailwind CSS** for dashboard and overlay styling

## Repository Structure

```text
.
├── public/assets/models/            # Static GLB assets (houses, solar panel)
├── src/
│   ├── components/
│   │   ├── EnergyScene.jsx          # Main scene composition (environment, roads, houses, effects)
│   │   ├── InstancedHouses.jsx      # Batched house mesh rendering
│   │   ├── InstancedSolarPanels.jsx # Batched solar panel rendering
│   │   ├── InstancedRoads.jsx       # Road mesh generation + rendering
│   │   ├── InstancedWindowLights.jsx# Night window lights
│   │   ├── TradeParticles.jsx       # Energy trade animation arcs
│   │   ├── House.jsx                # House label/debug overlays and interactions
│   │   └── Dashboard.jsx            # HUD controls and simulation settings
│   ├── config/houseModels.js        # Per-model transform + solar panel placement config
│   ├── store/useEnergyStore.js      # Core simulation logic, state, actions
│   ├── utils/seededRandom.js        # Deterministic random helper
│   ├── App.jsx                      # Canvas + UI shell and global key handling
│   ├── main.jsx                     # React entry point
│   └── index.css                    # Global styles
├── .github/workflows/deploy-pages.yml # GitHub Pages build/deploy pipeline
├── vite.config.js                   # Build config and Pages base path
└── package.json
```

## Runtime Architecture

### 1. Simulation state (single source of truth)

`useEnergyStore` contains:
- map generation and house metadata
- production/consumption and weather factors
- battery and trading state
- simulation clock and tick cadence
- UI toggles used by scene and dashboard

### 2. Tick lifecycle

`App.jsx` drives periodic updates via `tick()` from the store.  
Each tick recalculates house-level values and updates trade data consumed by visualization components.

### 3. Rendering model

The 3D layer is split between:
- **instanced components** for scalable rendering of repeated geometry (houses, roads, panels, lights)
- **interactive overlays** (`House.jsx`) for labels/debug and fine-grained interactions
- **effects/environment** (`EnergyScene.jsx`) for day/night cycle, weather, rain/cloud/stars, and lighting

## Data + Config Boundaries

- **Behavioral logic**: `src/store/useEnergyStore.js`
- **Visual model transforms**: `src/config/houseModels.js`
- **Scene composition/orchestration**: `src/components/EnergyScene.jsx`
- **User controls and display values**: `src/components/Dashboard.jsx`

When extending the project, keep these boundaries intact to avoid coupling simulation math with rendering details.

## Controls and Interaction

- Orbit camera is enabled by default.
- Keyboard shortcuts:
  - `H` toggles house labels
  - `D` toggles debug mode
- Dashboard controls modify simulation settings from Zustand state.

## Build and Deployment Notes

- `vite.config.js` defines `base: '/GreenGrid-3D-Simulation/'` for GitHub Pages hosting.
- Static model URLs are expected to resolve relative to `import.meta.env.BASE_URL`.
- GitHub Pages deployment is handled by `.github/workflows/deploy-pages.yml` and publishes `dist/`.

## Local Development Commands

```bash
npm install
npm run dev
npm run build
npm run preview
```
