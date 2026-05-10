/**
 * House Model Configuration
 * Define custom visual parameters for specific house models
 */

export const solarPanelModelPath = `${import.meta.env.BASE_URL}assets/models/solar_panel/solar_panel.glb`;

const degrees = Math.PI / 180

export const modelConfig = {
  1: {
    customScale: 5.0,
    customRotation: 0,
    offset: { x: 1, y: 3, z: 0 },
    solarPanels: [
      {
        offset: { x: 0.15, y: 2.45, z: 1.25 },
        rotation: { x: -3.5 * degrees, y: 0, z: 0 },
        scale: 0.5,
      },
      {
        offset: { x: -3.2, y: 0.99, z: 0.8 },
        rotation: { x: -3.5 * degrees, y: 0, z: 0 },
        scale: 0.3,
      },
      {
        offset: { x: -3.2, y: 0.35, z: 1.8 },
        rotation: { x: -3.5 * degrees, y: 0, z: 0 },
        scale: 0.3,
      },
      {
        offset: { x: -3.2, y: 0.99, z: -0.8 },
        rotation: { x: -3.5 * degrees, y: Math.PI, z: 0 },
        scale: 0.3,
      },
      {
        offset: { x: -3.2, y: 0.37, z: -1.8 },
        rotation: { x: -3.5 * degrees, y: Math.PI, z: 0 },
        scale: 0.3,
      }
    ],
  },
  2: {
    customScale: 1.0,
    customRotation: 0,
    offset: { x: 0, y: 0, z: 0 },
    solarPanels: [
      {
        offset: { x: -1.2, y: 3.4, z: 0.0 },
        rotation: { x: 2.0 * degrees, y: -90 * degrees, z: 0 },
        scale: 0.75,
      },
      {
        offset: { x: 1.2, y: 3.5, z: 0.15 },
        rotation: { x: 3.5 * degrees, y: 90 * degrees, z: 0 },
        scale: 0.7,
      }
    ],
  },
  3: {
    customScale: 1.75,
    customRotation: Math.PI / 2,
    offset: { x: 0, y: 0, z: 0 },
    solarPanels: [
      {
        offset: { x: 2.2, y: 2.5, z: 0.0 },
        rotation: { x: 18 * degrees, y: 90 * degrees, z: 0 },
        scale: 0.75,
      },
      {
        offset: { x: -0.75, y: 3.0, z: 0.8 },
        rotation: { x: 16 * degrees, y: 0, z: 0 },
        scale: 0.65,
      },
      {
        offset: { x: -0.75, y: 3.0, z: -0.8 },
        rotation: { x: 16 * degrees, y: 180 * degrees, z: 0 },
        scale: 0.65,
      },
      {
        offset: { x: 0.47, y: 3.02, z: 0.0 },
        rotation: { x: 18 * degrees, y: -90 * degrees, z: 0 },
        scale: 0.64,
      }
    ],
  },
  4: {
    customScale: 0.06,
    customRotation: -100 * degrees,
    offset: { x: -9.2, y: 0, z: -2 },
    solarPanels: [
      {
        offset: { x: 9.45, y: 3.25, z: 2.15 },
        rotation: { x: 14.5 * degrees, y: 10 * degrees, z: 0 },
        scale: 0.95,
      },
      {
        offset: { x: 8.4, y: 3.9, z: 0.7 },
        rotation: { x: 14.5 * degrees, y: 190 * degrees, z: 0 },
        scale: 0.70,
      }
    ],
  },
  5: {
    customScale: 1.0,
    customRotation: Math.PI / 2,
    offset: { x: 0, y: 0, z: 0 },
    solarPanels: [
      {
        offset: { x: -0.5, y: 3.6, z: -1.37 },
        rotation: { x: 3 * degrees, y: 180 * degrees, z: 0 },
        scale: 0.75,
      },
      {
        offset: { x: -0.65, y: 3.8, z: 1.2 },
        rotation: { x: 3 * degrees, y: 0, z: 0 },
        scale: 0.7,
      }
    ],
  },
  6: {
    customScale: 3.5,
    customRotation: Math.PI / 2,
    offset: { x: 1, y: 0, z: 0 },
    solarPanels: [
      {
        offset: { x: 1.6, y: 2.9, z: 3.4 },
        rotation: { x: 14 * degrees, y: 0, z: 0 },
        scale: 0.3,
      },
      {
        offset: { x: 1.6, y: 3.2, z: 2.1 },
        rotation: { x: 14 * degrees, y: 0, z: 0 },
        scale: 0.3,
      },
      {
        offset: { x: -4.52, y: 2.9, z: 3.4 },
        rotation: { x: 14 * degrees, y: 0, z: 0 },
        scale: 0.3,
      },
      {
        offset: { x: -4.52, y: 3.2, z: 2.1 },
        rotation: { x: 14 * degrees, y: 0, z: 0 },
        scale: 0.3,
      },
      {
        offset: { x: 0.45, y: 3.5, z: 0.5 },
        rotation: { x: 7 * degrees, y: 0, z: 0 },
        scale: 0.65,
      },
      {
        offset: { x: -3.37, y: 3.5, z: 0.5 },
        rotation: { x: 7 * degrees, y: 0, z: 0 },
        scale: 0.65,
      },
      ,
      {
        offset: { x: 0.45, y: 3.5, z: -1.8 },
        rotation: { x: 9 * degrees, y: 180 * degrees, z: 0 },
        scale: 0.6,
      },
      {
        offset: { x: -3.37, y: 3.5, z: -1.8 },
        rotation: { x: 9 * degrees, y: 180 * degrees, z: 0 },
        scale: 0.6,
      }
    ],
  },
};

/**
 * Get model configuration
 * @param {number} modelIndex - Model number (1-6)
 * @returns {object} Configuration with customScale, customRotation, and offset
 */
export const getModelConfig = (modelIndex) => {
  const config = modelConfig[modelIndex] || {};
  const solarPanels = Array.isArray(config.solarPanels)
    ? config.solarPanels.map((panel) => ({
        ...panel,
        offset: panel.offset ? { ...panel.offset } : { x: 0, y: 0, z: 0 },
        rotation: panel.rotation ? { ...panel.rotation } : { x: 0, y: 0, z: 0 },
      }))
    : defaultSolarPanelConfig;

  return {
    customScale: config.customScale ?? 1.0,
    customRotation: config.customRotation ?? 0,
    offset: config.offset ?? { x: 0, y: 0, z: 0 },
    solarPanels,
    solarPanelModelPath: config.solarPanelModelPath ?? solarPanelModelPath,
  };
};
