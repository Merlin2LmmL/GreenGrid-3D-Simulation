import { create } from 'zustand';
import { getModelConfig } from '../config/houseModels';

// Initial constants (now used as defaults or range bases)
const DEFAULT_TICK_MS = 200;
const DEFAULT_SIM_MINUTES_PER_TICK = 5;
const DEFAULT_SEED = 3;
const DEFAULT_SOLAR_HOUSE_RATIO = 0.65;
const DEFAULT_SOLAR_BATTERY_RATIO = 0.85;
const DEFAULT_NO_SOLAR_BATTERY_RATIO = 0.25;

const BASE_STREET_SEGMENT_MIN = 16;
const BASE_STREET_SEGMENT_MAX = 20;
const BASE_MIN_HOUSES = 30;
const BASE_MAX_HOUSES = 60;

const STREET_HALF_WIDTH = 2.4;
const MIN_HOUSE_DISTANCE = 10.0;
const HOUSE_ROAD_CLEARANCE = 3;

// ── Trade system constants ────────────────────────────────────────────────────
// Max concurrent buy-side trades a buyer may hold at once
const MAX_ACTIVE_BUY_TRADES = 3;

// Max concurrent sell-side trades a seller may commit to at once
const MAX_SELL_TRADES = 4;

// Battery level (% of capacity) the buyer tries to guarantee at sunrise
const BATTERY_THRESHOLD_RATIO = 0.20;

// How many simulated hours a seller can provide zero surplus before a trade is abolished
const TRADE_MAX_IDLE_HOURS = 0.5;

// How long (real ms) an unmatched buy order waits before being discarded
// 8 ticks = ~2 sim hours
const BUY_ORDER_EXPIRY_REAL_MS = DEFAULT_TICK_MS * 8;

// Minimum gap (Wh) worth placing a buy order for
const MIN_ORDER_WH = 80;

// Minimum seller surplus (W) required to be considered eligible
const MIN_SELLER_SURPLUS_W = 20;

// Multiplier applied to order sizes so trades stay live long enough to show
// meaningful progress in the UI
const ORDER_VOLUME_MULTIPLIER = 3;

// Average household baseline consumption in watts.
// Center value around which individual household demand is symmetrically distributed.
const AVG_BASE_CONSUMPTION = 2200;

// Maximum deviation from average consumption in watts (± range).
// Final load is uniformly shifted within [mean - divergence, mean + divergence].
const AVG_BASE_CONSUMPTION_DIVERGENCE = 500;

// Multiplicative scaling factor for peak PV output under ideal conditions.
// Represents how much stronger solar generation is compared to baseline load.
const AVG_PEAK_SOLAR_FACTOR = 5;

// Symmetric variability applied to peak solar output (± factor).
// Models differences in panel quality, orientation, and local shading conditions.
const AVG_PEAK_SOLAR_DIVERGENCE_FACTOR = 1;

// Battery capacity (kWh) for households equipped with solar.
// Higher baseline reflects typical co-installation with PV systems.
const AVG_BATTERY_CAPACITY_SOLAR = 40;

// Maximum deviation in battery size for solar-equipped households (± kWh).
// Produces a uniform range of [10, 15] kWh around the mean.
const AVG_BATTERY_CAPACITY_SOLAR_DIVERGENCE = 3;

// Battery capacity (kWh) for households without solar installations.
// Lower baseline reflects retrofit or standalone storage systems.
const AVG_BATTERY_CAPACITY_NON_SOLAR = 15;

// Maximum deviation in battery size for non-solar households (± kWh).
// Produces a uniform range of [8, 12] kWh around the mean.
const AVG_BATTERY_CAPACITY_NON_SOLAR_DIVERGENCE = 2;


// Seeded random for deterministic model selection
const seededRandom = (seed) => {
  let x = Math.sin(seed) * 10000;
  return x - Math.floor(x);
};

const clamp = (value, min, max) => Math.min(max, Math.max(min, value));

const createRng = (seed) => {
  let state = (seed >>> 0) || 1;
  return () => {
    state += 0x6d2b79f5;
    let t = state;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
};

const randomInt = (rng, min, max) => Math.floor(rng() * (max - min + 1)) + min;

const shuffle = (items, rng) => {
  const array = [...items];
  for (let i = array.length - 1; i > 0; i -= 1) {
    const j = Math.floor(rng() * (i + 1));
    [array[i], array[j]] = [array[j], array[i]];
  }
  return array;
};

const edgeKey = (a, b) => (a < b ? `${a}-${b}` : `${b}-${a}`);

const distance2D = (a, b) => {
  const dx = a.x - b.x;
  const dz = a.z - b.z;
  return Math.hypot(dx, dz);
};

const pointToSegmentDistance2D = (point, segmentStart, segmentEnd) => {
  const vx = segmentEnd[0] - segmentStart[0];
  const vz = segmentEnd[2] - segmentStart[2];
  const wx = point.x - segmentStart[0];
  const wz = point.z - segmentStart[2];
  const segmentLenSq = vx * vx + vz * vz;

  if (segmentLenSq < 1e-9) {
    return Math.hypot(wx, wz);
  }

  const t = Math.max(0, Math.min(1, (wx * vx + wz * vz) / segmentLenSq));
  const px = segmentStart[0] + vx * t;
  const pz = segmentStart[2] + vz * t;
  return Math.hypot(point.x - px, point.z - pz);
};

const createGridCoordinates = (segmentCount, rng, settings) => {
  const sizeScale = settings.citySize || 1.0;
  const segMin = BASE_STREET_SEGMENT_MIN * sizeScale;
  const segMax = BASE_STREET_SEGMENT_MAX * sizeScale;

  const segments = Array.from(
    { length: segmentCount },
    () => segMin + rng() * (segMax - segMin)
  );
  const total = segments.reduce((sum, value) => sum + value, 0);
  const origin = -total / 2;

  const coords = [origin];
  let acc = origin;
  for (const segment of segments) {
    acc += segment;
    coords.push(acc);
  }

  return coords;
};

const createCityLayout = (settings) => {
  const seed = settings.seed ?? DEFAULT_SEED;
  const rng = createRng(seed);

  const sizeScale = settings.citySize || 1.0;
  const minH = Math.floor(BASE_MIN_HOUSES * sizeScale);
  const maxH = Math.floor(BASE_MAX_HOUSES * sizeScale);
  const houseCount = randomInt(rng, minH, maxH);

  // Grid size also scales slightly with city size
  const baseDim = Math.floor(5 + (sizeScale - 1) * 3);
  const cols = randomInt(rng, baseDim, baseDim + 2);
  const rows = randomInt(rng, baseDim, baseDim + 2);

  const xCoords = createGridCoordinates(cols - 1, rng, settings);
  const zCoords = createGridCoordinates(rows - 1, rng, settings);

  const toIndex = (row, col) => row * cols + col;

  const nodes = [];
  for (let row = 0; row < rows; row += 1) {
    for (let col = 0; col < cols; col += 1) {
      nodes.push({ id: toIndex(row, col), x: xCoords[col], z: zCoords[row] });
    }
  }

  const potentialEdges = [];
  const nodeNeighbors = new Map();
  for (let i = 0; i < nodes.length; i += 1) {
    nodeNeighbors.set(i, []);
  }

  for (let row = 0; row < rows; row += 1) {
    for (let col = 0; col < cols; col += 1) {
      const current = toIndex(row, col);

      if (col + 1 < cols) {
        const right = toIndex(row, col + 1);
        potentialEdges.push([current, right]);
        nodeNeighbors.get(current).push(right);
        nodeNeighbors.get(right).push(current);
      }

      if (row + 1 < rows) {
        const bottom = toIndex(row + 1, col);
        potentialEdges.push([current, bottom]);
        nodeNeighbors.get(current).push(bottom);
        nodeNeighbors.get(bottom).push(current);
      }
    }
  }

  // Build a random spanning tree first, so every intersection is reachable.
  const selectedEdges = new Set();
  const visited = new Set([0]);
  const stack = [0];

  while (stack.length > 0) {
    const current = stack[stack.length - 1];
    const neighbors = shuffle(nodeNeighbors.get(current), rng).filter((n) => !visited.has(n));

    if (neighbors.length === 0) {
      stack.pop();
      continue;
    }

    const next = neighbors[0];
    visited.add(next);
    stack.push(next);
    selectedEdges.add(edgeKey(current, next));
  }

  // Add extra roads for a denser city texture while keeping deterministic seed behavior.
  for (const [a, b] of potentialEdges) {
    const key = edgeKey(a, b);
    if (!selectedEdges.has(key) && rng() < 0.22) {
      selectedEdges.add(key);
    }
  }

  const roads = Array.from(selectedEdges).map((key, index) => {
    const [a, b] = key.split('-').map(Number);
    const start = nodes[a];
    const end = nodes[b];
    return {
      id: `road-${index}`,
      start: [start.x, 0, start.z],
      end: [end.x, 0, end.z],
      width: STREET_HALF_WIDTH * 2,
      startNode: a,
      endNode: b,
    };
  });

  const nodeDegree = new Map(nodes.map((node) => [node.id, 0]));
  for (const [a, b] of selectedEdges) {
    nodeDegree.set(a, (nodeDegree.get(a) || 0) + 1);
    nodeDegree.set(b, (nodeDegree.get(b) || 0) + 1);
  }

  for (const road of roads) {
    road.connectedStart = (nodeDegree.get(road.startNode) || 0) > 1;
    road.connectedEnd = (nodeDegree.get(road.endNode) || 0) > 1;
  }

  const hasRoadClearance = (candidate, roadsToCheck) => {
    for (const road of roadsToCheck) {
      const distToRoad = pointToSegmentDistance2D(candidate, road.start, road.end);
      const minAllowedDistance = road.width * 0.5 + HOUSE_ROAD_CLEARANCE;
      if (distToRoad < minAllowedDistance) {
        return false;
      }
    }
    return true;
  };

  const lotCandidates = [];
  for (const road of roads) {
    const [sx, , sz] = road.start;
    const [ex, , ez] = road.end;
    const dx = ex - sx;
    const dz = ez - sz;
    const length = Math.hypot(dx, dz);

    if (length < 0.001) {
      continue;
    }

    const dirX = dx / length;
    const dirZ = dz / length;
    const perpX = -dirZ;
    const perpZ = dirX;
    const slotsPerSide = Math.max(3, Math.floor(length / 10));

    for (let i = 1; i <= slotsPerSide; i += 1) {
      const t = i / (slotsPerSide + 1);
      const baseX = sx + dx * t;
      const baseZ = sz + dz * t;
      const lotId = `${road.id}-slot-${i}`;

      for (const side of [-1, 1]) {
        const setback = STREET_HALF_WIDTH + 3.6;
        const alongJitter = (rng() - 0.5) * 0.7;
        const sideJitter = (rng() - 0.5) * 0.45;
        const houseX = baseX + dirX * alongJitter + perpX * side * (setback + sideJitter);
        const houseZ = baseZ + dirZ * alongJitter + perpZ * side * (setback + sideJitter);
        const facingRotation = Math.atan2(-perpX * side, -perpZ * side);
        const candidate = {
          x: houseX,
          z: houseZ,
          streetPoint: [baseX, 0, baseZ],
          streetFacingRotation: facingRotation,
          streetId: road.id,
          lotId,
          lotSide: side,
        };

        if (hasRoadClearance(candidate, roads)) {
          lotCandidates.push(candidate);
        }
      }
    }
  }

  const pickLotsWithSpacing = (minDistance) => {
    const chosen = [];
    for (const lot of shuffle(lotCandidates, rng)) {
      const hasConflict = chosen.some((picked) => {
        if (lot.streetLotId === picked.streetLotId && lot.streetLotSide !== picked.streetLotSide) {
          return false;
        }

        return distance2D(lot, picked) < minDistance;
      });
      if (!hasConflict) {
        chosen.push(lot);
      }
      if (chosen.length >= houseCount) {
        break;
      }
    }
    return chosen;
  };

  let chosenLots = pickLotsWithSpacing(MIN_HOUSE_DISTANCE * sizeScale);

  const houses = chosenLots.map((lot, index) => {
    const modelIndex = Math.floor(seededRandom(index + seed) * 6) + 1;
    const modelParams = getModelConfig(modelIndex);
    const hasSolar = rng() < (settings.solarRatio ?? DEFAULT_SOLAR_HOUSE_RATIO);
    const solarPanels = hasSolar ? modelParams.solarPanels : [];

    // Probability ratios from settings
    const solarBatteryProb = settings.solarBatteryRatio ?? DEFAULT_SOLAR_BATTERY_RATIO;
    const noSolarBatteryProb = settings.noSolarBatteryRatio ?? DEFAULT_NO_SOLAR_BATTERY_RATIO;

    const hasBattery = hasSolar ? rng() < solarBatteryProb : rng() < noSolarBatteryProb;

    const baseConsumption = AVG_BASE_CONSUMPTION + (rng() * 2 - 1) * AVG_BASE_CONSUMPTION_DIVERGENCE;
    const pvPeak = hasSolar ? baseConsumption * (AVG_PEAK_SOLAR_FACTOR + (rng() * 2 - 1) * AVG_PEAK_SOLAR_DIVERGENCE_FACTOR) : 0;
    const batteryCapacity = hasBattery
      ? (hasSolar
        ? AVG_BATTERY_CAPACITY_SOLAR + (rng() * 2 - 1) * AVG_BATTERY_CAPACITY_SOLAR_DIVERGENCE
        : AVG_BATTERY_CAPACITY_NON_SOLAR + (rng() * 2 - 1) * AVG_BATTERY_CAPACITY_NON_SOLAR_DIVERGENCE)
      : 0;
    const batteryLevel = hasBattery ? batteryCapacity * (hasSolar ? (0.3 + rng() * 0.4) : (0.55 + rng() * 0.25)) : 0; // Solar starts 30-70%, non-solar 55-80%

    return {
      id: index,
      name: `Haus ${String(index + 1).padStart(2, '0')}`,
      position: [lot.x, 0, lot.z],
      streetPoint: lot.streetPoint,
      streetFacingRotation: lot.streetFacingRotation,
      streetId: lot.streetId,
      streetLotId: lot.lotId,
      streetLotSide: lot.lotSide,
      consumption: 0,
      production: 0,
      batteryLevel,
      batteryCapacity,
      balance: 100,
      cumulativeBalance: 0,
      baseConsumption,
      pvPeak,
      importW: 0,
      exportW: 0,
      hasSolar,
      hasBattery,
      buyOrders: [],
      sellOrders: [],
      modelIndex,
      customScale: modelParams.customScale,
      customRotation: modelParams.customRotation,
      offset: modelParams.offset,
      solarPanels: solarPanels.map((panel) => ({
        ...panel,
        offset: panel.offset ? { ...panel.offset } : { x: 0, y: 0, z: 0 },
        rotation: panel.rotation ? { ...panel.rotation } : { x: 0, y: 0, z: 0 },
      })),
      solarPanelModelPath: modelParams.solarPanelModelPath,
    };
  });

  return { houses, roads };
};

const INITIAL_SETTINGS = {
  seed: DEFAULT_SEED,
  citySize: 1.0,
  solarRatio: DEFAULT_SOLAR_HOUSE_RATIO,
  solarBatteryRatio: DEFAULT_SOLAR_BATTERY_RATIO,
  noSolarBatteryRatio: DEFAULT_NO_SOLAR_BATTERY_RATIO,
  maxWeatherIntensity: 1.0,
};

const initialCity = createCityLayout(INITIAL_SETTINGS);

const dayLightFactor = (timeHours) => {
  // 06:00 bis 18:00 ist Tag. Davor und danach gibt es keine PV-Produktion.
  if (timeHours < 6 || timeHours > 18) {
    return 0;
  }

  const normalized = (timeHours - 6) / 12;
  return Math.sin(Math.PI * normalized);
};

const consumptionCurveFactor = (timeHours) => {
  // Consumption is lower at night (0-6h, 18-24h) and higher during day
  // Night: ~0.5, Morning peak (7-9h): ~1.2, Midday (11-14h): ~0.9, Evening (17-19h): ~1.1
  if (timeHours < 6 || timeHours >= 22) {
    return 0.5; // Night: low consumption
  }
  if (timeHours >= 6 && timeHours < 9) {
    // Morning ramp up: 0.5 -> 1.2
    return 0.5 + (timeHours - 6) / 3 * 0.7;
  }
  if (timeHours >= 9 && timeHours < 14) {
    // Midday dip: 1.2 -> 0.9
    return 1.2 - (timeHours - 9) / 5 * 0.3;
  }
  if (timeHours >= 14 && timeHours < 17) {
    // Afternoon stable: 0.9
    return 0.9;
  }
  if (timeHours >= 17 && timeHours < 19) {
    // Evening peak: 0.9 -> 1.1
    return 0.9 + (timeHours - 17) / 2 * 0.2;
  }
  if (timeHours >= 19 && timeHours < 22) {
    // Late evening decline: 1.1 -> 0.5
    return 1.1 - (timeHours - 19) / 3 * 0.6;
  }
  return 0.8;
};

const pickMarketPrice = (gridDependency) => {
  // Base price is slightly higher to reward local production
  const base = 0.22;
  return base + gridDependency * 0.28;
};

// ── Hours until next sunrise (06:00) ─────────────────────────────────────────
// Returns 0 during daytime (06:00–18:00) — buy trigger is night-only.
const hoursUntilNextSunrise = (timeHours) => {
  if (timeHours >= 6 && timeHours < 18) return 0; // daytime
  if (timeHours >= 18) return 24 - timeHours + 6; // evening → next morning
  return 6 - timeHours; // after midnight → this morning
};

const tickSimulation = (state) => {
  // Guard against invalid state during transitions
  if (!state || !state.houses || !Array.isArray(state.houses)) {
    return state; // Return unchanged state if invalid
  }
  if (!Number.isFinite(state.simMinutesPerTick)) {
    return state;
  }
  
  // Validate houses have required properties (they might be regenerating)
  if (state.houses.some(h => 
    !h || 
    typeof h.position !== 'object' || h.position.length !== 3 ||
    typeof h.baseConsumption !== 'number' ||
    typeof h.pvPeak !== 'number'
  )) {
    return state;
  }
  
  const now = Date.now();
  const tickHours = state.simMinutesPerTick / 60;
  const nextTime = (state.timeHours + tickHours) % 24;
  const daysPassed = state.timeHours + tickHours >= 24 ? 1 : 0;
  const nextDayCount = (state.dayCount || 0) + daysPassed;

  // ── Weather Logic ────────────────────────────────────────────────────────
  let { weatherIntensity = 0, targetWeatherIntensity = 0 } = state;
  const seed = state.mapSettings?.seed ?? DEFAULT_SEED;
  const weatherSeed = seed + nextDayCount * 100 + Math.floor(nextTime * 10);
  const weatherRng = createRng(weatherSeed);

  // Change target weather much less frequently (e.g., 1.5% chance per tick)
  if (weatherRng() < 0.015) {
    const roll = weatherRng();
    const maxWeather = state.mapSettings?.maxWeatherIntensity ?? 1.0;
    targetWeatherIntensity = Math.floor(roll * 5) / 4 * maxWeather;
  }

  // Smoothly interpolate current intensity towards target
  // Gradual shift (0.02 units per tick) prevents abrupt jumps in lighting or production
  if (Math.abs(weatherIntensity - targetWeatherIntensity) > 0.005) {
    const delta = targetWeatherIntensity > weatherIntensity ? 0.02 : -0.02;
    weatherIntensity = clamp(weatherIntensity + delta, 0, 1);
  } else {
    weatherIntensity = targetWeatherIntensity;
  }

  // Less aggressive weather factor: Rain (1.0) now only reduces production to 55% (was 15%)
  const weatherFactor = 1.0 - (weatherIntensity * 0.45);

  // ── Enhanced Solar Noise Logic ──────────────────────────────────────────
  const globalT = nextTime + nextDayCount * 24;
  // Multi-frequency noise to break the obvious sinus pattern of the daily cycle.
  // Combines three octaves: slow drift (8h), medium patches (2h), and faster shifts (30m).
  const atmosphericNoise =
    0.88 +
    Math.sin(globalT * 0.4) * 0.12 +
    Math.sin(globalT * 1.5) * 0.08 +
    Math.sin(globalT * 4.0) * 0.04;

  const daylight = dayLightFactor(nextTime);
  const consumptionFactor = consumptionCurveFactor(nextTime);

  // ── Step 1: Update house physics ──────────────────────────────────────────
  const prevBatteryLevels = new Map((state.houses || []).map((h) => [h.id, h.batteryLevel || 0]));

  const rng = createRng(seed + Math.floor(state.timeHours * 100));

  const updatedHouses = state.houses.map((house) => {
    const demandNoise = 0.85 + rng() * 0.3;
    // Increased local solar noise (panel-specific jitter)
    const localSolarNoise = 0.7 + rng() * 0.6;
    const isDaytime = daylight > 0;

    const consumption = house.baseConsumption * consumptionFactor * demandNoise;
    // Combine base curve with global atmospheric drift and local jitter
    const production = house.pvPeak * daylight * localSolarNoise * atmosphericNoise * 1.5 * weatherFactor;
    const netKWh = (production - consumption) * tickHours / 1000;

    let batteryLevel = house.batteryLevel;
    let exportKWh = 0;
    let importKWh = 0;

    const reserveKWh = house.hasBattery
      ? house.batteryCapacity * BATTERY_THRESHOLD_RATIO
      : 0;

    // Battery-only homes try to charge during the day when prices are low,
    // but only when the battery still has headroom.
    const daytimeChargeNeeded = house.batteryCapacity - batteryLevel;
    const daytimeChargeW =
      !house.hasSolar && house.hasBattery && isDaytime && daytimeChargeNeeded > 0.001
        ? Math.min(1200, 450 + house.baseConsumption * 0.22)
        : 0;

    // PRE-BATTERY CALCULATION for trade readiness:
    // We store the "gross" grid need before battery discharge so Step 2 (Trades)
    // can fulfill this need with P2P energy instead of draining the battery.
    const grossImportKWh = netKWh < 0 ? Math.abs(netKWh) : 0;

    if (netKWh >= 0) {
      // Surplus: fill battery to 100% first, then export the remainder.
      const chargeKWh = Math.min(house.batteryCapacity - batteryLevel, netKWh);
      batteryLevel += chargeKWh;
      exportKWh = netKWh - chargeKWh;
      importKWh = 0;
    } else {
      // Deficit: discharge battery to cover demand, then import the rest
      const demandKWh = Math.abs(netKWh);
      // Only use battery for what TRADES cannot cover? No, let's keep it simple:
      // Discharge battery, but Step 2 will let Trades "refund" this or replace the import.
      const dischargeKWh = Math.min(batteryLevel - reserveKWh, demandKWh);
      const dischargeEffective = Math.max(0, dischargeKWh);
      batteryLevel -= dischargeEffective;
      importKWh = demandKWh - dischargeEffective;
    }

    if (daytimeChargeW > 0) {
      const daytimeChargeKWh = (daytimeChargeW * tickHours) / 1000;
      importKWh += daytimeChargeKWh;
      batteryLevel = Math.min(house.batteryCapacity, batteryLevel + daytimeChargeKWh);
    }

    const pvSurplusW = (exportKWh * 1000) / tickHours;

    // Battery selling logic: identify spare power while keeping enough for the night
    const hoursToMorning = hoursUntilNextSunrise(nextTime);
    const estimatedNightlyNeedWh = house.hasBattery
      ? house.baseConsumption * 0.7 * hoursToMorning
      : 0;

    // Be more aggressive if battery is full
    const isFull = batteryLevel >= house.batteryCapacity * 0.95;
    const safetyReserveWh = house.batteryCapacity * 1000 * (isFull ? 0.1 : BATTERY_THRESHOLD_RATIO);

    const batterySpareWh = house.hasBattery
      ? Math.max(0, (batteryLevel * 1000) - (estimatedNightlyNeedWh * 0.8) - safetyReserveWh)
      : 0;

    const batterySpareW = Math.min(5000, batterySpareWh / tickHours);
    const totalExportW = pvSurplusW + batterySpareW;

    return {
      ...house,
      consumption,
      production,
      batteryLevel: clamp(batteryLevel, 0, house.batteryCapacity),
      importW: (importKWh * 1000) / tickHours,
      grossImportW: (grossImportKWh * 1000) / tickHours, // Store for Step 2
      exportW: totalExportW,
      pvSurplusW,
      // buyOrders / sellOrders are rebuilt from scratch each tick (see Step 7)
      buyOrders: [],
      sellOrders: [],
    };
  });

  const totalDemand = updatedHouses.reduce((sum, h) => sum + h.consumption, 0);
  const totalProduction = updatedHouses.reduce((sum, h) => sum + h.production, 0);

  // Working mutable copies so trade delivery can reduce importW / exportW
  const houseMap = new Map(updatedHouses.map((h) => [h.id, { ...h }]));

  // ── Step 2: Process active trades ─────────────────────────────────────────
  // Count how many buyers each seller is committed to (for pro-rata split)
  const sellerBuyerCount = new Map();
  for (const trade of (state.trades || [])) {
    sellerBuyerCount.set(
      trade.sellerId,
      (sellerBuyerCount.get(trade.sellerId) || 0) + 1,
    );
  }

  const buyerTradeCount = new Map(); // active trades per buyer after this tick
  const sellerTradeCount = new Map(); // active trades per seller after this tick
  const nextTrades = [];

  // Pre-calculate seller shares to avoid pro-rata degradation inside the loop
  const sellerSurplusPool = new Map(updatedHouses.map(h => [h.id, h.exportW]));

  const settlements = [];
  let localTradeWh = 0;
  let settledMoney = 0;

  for (const trade of (state.trades || [])) {
    const seller = houseMap.get(trade.sellerId);
    const buyer = houseMap.get(trade.buyerId);

    if (!seller || !buyer) continue;

    // ── Buyer cancellation ──────────────────────────────────────────────────
    const hoursToMorning = hoursUntilNextSunrise(nextTime);
    if (buyer.hasBattery && hoursToMorning > 0) {
      const thresholdWh = buyer.batteryCapacity * BATTERY_THRESHOLD_RATIO * 1000;
      const projectedWh = buyer.batteryLevel * 1000 - buyer.baseConsumption * hoursToMorning;
      // Much more relaxed: only cancel if we have DOUBLE the needed buffer
      if (projectedWh >= thresholdWh * 2.5) continue;
    } else if (!buyer.hasBattery && buyer.consumption <= 0) {
      continue;
    }

    // ── Seller surplus check ────────────────────────────────────────────────
    // Greedy pool approach: each trade tries to take what it needs from the remaining pool
    const availablePoolW = sellerSurplusPool.get(trade.sellerId) || 0;

    // Delivery: Buyers with active trades use grossImportW (before battery) to ensure trade progress
    const buyerNeedW = buyer.hasBattery ? buyer.grossImportW : buyer.importW;
    const deliveryW = Math.max(0, Math.min(availablePoolW, buyerNeedW));
    const maxFromTrade = trade.remainingWh / tickHours;
    const actualDeliveryW = Math.min(deliveryW, maxFromTrade);
    const actualDeliveryWh = actualDeliveryW * tickHours;

    // ── Idle logic: Discard trades that don't transfer energy for a while ─────
    let idleTicks = trade.idleTicks || 0;
    if (actualDeliveryWh <= 0.001) {
      idleTicks += 1;
    } else {
      idleTicks = 0;
    }

    const maxIdleTicks = Math.ceil(TRADE_MAX_IDLE_HOURS / tickHours);
    if (idleTicks >= maxIdleTicks) {
      continue;
    }

    if (actualDeliveryWh > 0.001) {
      // If delivery exceeds what PV alone could provide, take the rest from the battery
      const pvDeliveryW = Math.min(actualDeliveryW, seller.pvSurplusW || 0);
      const batteryDeliveryW = Math.max(0, actualDeliveryW - pvDeliveryW);

      if (batteryDeliveryW > 0.001) {
        const batteryDeliveryWh = batteryDeliveryW * tickHours;
        seller.batteryLevel = Math.max(0, seller.batteryLevel - (batteryDeliveryWh / 1000));
      }

      // Reduce seller's available pool and buyer's grid import need
      sellerSurplusPool.set(trade.sellerId, Math.max(0, availablePoolW - actualDeliveryW));
      buyer.importW = Math.max(0, buyer.importW - actualDeliveryW);
      buyer.grossImportW = Math.max(0, (buyer.grossImportW || 0) - actualDeliveryW);
      localTradeWh += actualDeliveryWh;

      settlements.push({
        sellerId: trade.sellerId,
        buyerId: trade.buyerId,
        transferWh: actualDeliveryWh,
        pricePerKWh: trade.pricePerKWh,
      });
    }

    const newRemaining = trade.remainingWh - actualDeliveryWh;
    if (newRemaining <= 0.001) continue; // fulfilled → delete trade

    // Trade survives into next tick
    const updatedTrade = {
      ...trade,
      remainingWh: newRemaining,
      lastDeliveryW: actualDeliveryW, // for dashboard display
      idleTicks,
    };
    nextTrades.push(updatedTrade);
    buyerTradeCount.set(trade.buyerId, (buyerTradeCount.get(trade.buyerId) || 0) + 1);
    sellerTradeCount.set(trade.sellerId, (sellerTradeCount.get(trade.sellerId) || 0) + 1);
  }

  // ── Step 3: Filter stale open buy orders ──────────────────────────────────
  const survivingOpenOrders = (state.openBuyOrders || []).filter((order) => {
    if (now >= order.expiresAt) return false; // real-time expiry
    const buyer = houseMap.get(order.buyerId);
    if (!buyer) return false;

    // Cancel if buyer no longer needs energy (conditions improved)
    const hoursToMorning = hoursUntilNextSunrise(nextTime);
    if (hoursToMorning <= 0 && buyer.hasBattery) return false; // daytime — not needed for battery houses
    if (buyer.hasBattery) {
      const thresholdWh = buyer.batteryCapacity * BATTERY_THRESHOLD_RATIO * 1000;
      const projectedWh = buyer.batteryLevel * 1000 - buyer.baseConsumption * hoursToMorning;
      if (projectedWh >= thresholdWh * 1.5) return false;
    } else {
      // Non-battery house: keep order alive while they're still importing from grid
      if (buyer.importW <= 0) return false;
    }

    return true;
  });

  // ── Step 4: Generate new buy orders ──────────────────────────────────────
  // A house places a buy order when:
  //   • It has a battery
  //   • It's nighttime (sun is down or setting)
  //   • Projected battery at sunrise < threshold
  //   • It doesn't already have a pending order or enough active trades
  const openBuyOrders = [...survivingOpenOrders];

  for (const house of houseMap.values()) {
    if ((buyerTradeCount.get(house.id) || 0) >= MAX_ACTIVE_BUY_TRADES) continue;
    if (openBuyOrders.some((o) => o.buyerId === house.id)) continue;

    const approxGridDep = totalDemand > 0
      ? updatedHouses.reduce((s, h) => s + h.importW, 0) / totalDemand
      : 0.5;
    const lockedPricePerKWh = pickMarketPrice(approxGridDep);

    if (house.hasBattery) {
      // Battery houses: buy at night when projected battery will fall below threshold.
      // Order is scaled up so the trade lives long enough to show meaningful progress.
      const hoursToMorning = hoursUntilNextSunrise(nextTime);
      if (hoursToMorning <= 0) continue; // daytime, no need to plan

      const thresholdWh = house.batteryCapacity * BATTERY_THRESHOLD_RATIO * 1000;
      const projectedWh = house.batteryLevel * 1000 - house.baseConsumption * hoursToMorning;

      if (projectedWh >= thresholdWh) continue; // sufficient

      const gapWh = (thresholdWh - projectedWh) * ORDER_VOLUME_MULTIPLIER;
      if (gapWh < MIN_ORDER_WH) continue;

      openBuyOrders.push({
        id: `buyorder-${house.id}-${now}-${Math.random().toString(16).slice(2)}`,
        buyerId: house.id,
        energyWh: gapWh,
        pricePerKWh: lockedPricePerKWh,
        createdAt: now,
        expiresAt: now + BUY_ORDER_EXPIRY_REAL_MS,
      });
    } else {
      // Non-battery houses: buy whenever they're importing from the grid.
      // Scale up the order so the trade covers ~ORDER_VOLUME_MULTIPLIER ticks worth
      // of import, giving the progress bar something meaningful to display.
      const importWh = house.importW * tickHours * ORDER_VOLUME_MULTIPLIER;
      if (importWh < MIN_ORDER_WH) continue;

      openBuyOrders.push({
        id: `buyorder-${house.id}-${now}-${Math.random().toString(16).slice(2)}`,
        buyerId: house.id,
        energyWh: importWh,
        pricePerKWh: lockedPricePerKWh,
        createdAt: now,
        expiresAt: now + BUY_ORDER_EXPIRY_REAL_MS,
      });
    }
  }

  // ── Step 5: Match open buy orders to sellers ──────────────────────────────
  const matchedOrderIds = new Set();

  for (const order of openBuyOrders) {
    const currentBuyerTrades = buyerTradeCount.get(order.buyerId) || 0;
    if (currentBuyerTrades >= MAX_ACTIVE_BUY_TRADES) continue;

    // Eligible sellers: must have real surplus OR spare battery beyond 2× own nightly need
    const hoursToMorning = hoursUntilNextSunrise(nextTime);
    const eligibleSellers = Array.from(houseMap.values())
      .filter((seller) => {
        if (seller.id === order.buyerId) return false;
        if ((sellerTradeCount.get(seller.id) || 0) >= MAX_SELL_TRADES) return false;

        const hasSurplus = seller.exportW >= MIN_SELLER_SURPLUS_W;
        const ownNightlyNeedWh = seller.hasBattery
          ? seller.baseConsumption * hoursToMorning
          : 0;
        const thresholdWh = seller.batteryCapacity * BATTERY_THRESHOLD_RATIO * 1000;
        const hasSpareStorage =
          seller.hasBattery &&
          seller.batteryLevel * 1000 > ownNightlyNeedWh + thresholdWh;

        return hasSurplus || hasSpareStorage;
      })
    if (eligibleSellers.length === 0) continue; // no match this tick

    // Fair distribution: Pick a random seller from the top 5 candidates
    // (instead of always picking the absolute highest producer)
    const topCandidates = eligibleSellers.slice(0, 5);
    const seller = topCandidates[Math.floor(Math.random() * topCandidates.length)];

    nextTrades.push({
      id: `trade-${seller.id}-${order.buyerId}-${now}-${Math.random().toString(16).slice(2)}`,
      sellerId: seller.id,
      buyerId: order.buyerId,
      totalWh: order.energyWh,
      remainingWh: order.energyWh,
      pricePerKWh: order.pricePerKWh, // €/kWh, locked from the buy order
      lastDeliveryW: 0,
      idleTicks: 0,
    });

    buyerTradeCount.set(order.buyerId, (buyerTradeCount.get(order.buyerId) || 0) + 1);
    sellerTradeCount.set(seller.id, (sellerTradeCount.get(seller.id) || 0) + 1);

    // Also update sellerBuyerCount so subsequent matches in the same loop
    // see the correct pro-rata denominator (though deliveries are next tick)
    sellerBuyerCount.set(seller.id, (sellerBuyerCount.get(seller.id) || 0) + 1);

    matchedOrderIds.add(order.id);
  }

  // Orders that were matched are consumed; the rest persist to next tick
  const remainingOpenOrders = openBuyOrders.filter((o) => !matchedOrderIds.has(o.id));

  // ── Step 6: Settle payments and grid costs ────────────────────────────────
  const totalGridImportW = Math.max(
    0,
    Array.from(houseMap.values()).reduce((s, h) => s + (h.importW || 0), 0),
  );
  const gridDependency = totalDemand > 0 ? totalGridImportW / totalDemand : 0;
  const marketPrice = pickMarketPrice(gridDependency);

  // P2P settlements (pay the locked price per trade, not market price)
  for (const settlement of settlements) {
    const seller = houseMap.get(settlement.sellerId);
    const buyer = houseMap.get(settlement.buyerId);
    const energyKWh = settlement.transferWh / 1000;
    const pricePerKWh = settlement.pricePerKWh ?? marketPrice;
    const value = energyKWh * pricePerKWh;

    if (seller) {
      seller.cumulativeBalance += value;
      seller.balance = (seller.balance || 0) + value;
      settledMoney += value;
    }
    if (buyer) {
      buyer.cumulativeBalance -= value;
      buyer.balance = (buyer.balance || 0) - value;
      settledMoney -= value;
    }
  }

  // Grid costs for energy still imported from the grid (at live market price)
  let gridRevenue = 0;
  for (const house of houseMap.values()) {
    if (house.importW > 0) {
      const gridKWh = (house.importW * tickHours) / 1000;
      const cost = gridKWh * marketPrice;
      house.cumulativeBalance -= cost;
      house.balance = (house.balance || 0) - cost;
      gridRevenue += cost;
    }
  }

  // Grid income for energy exported to the grid (feed-in tariff)
  // This ensures solar houses get paid even if their surplus wasn't matched with a P2P trade.
  const feedInTariff = marketPrice * 0.65; // Grid pays ~65% of current market price
  for (const house of houseMap.values()) {
    if (house.exportW > 0) {
      const gridKWh = (house.exportW * tickHours) / 1000;
      const income = gridKWh * feedInTariff;
      house.cumulativeBalance += income;
      house.balance = (house.balance || 0) + income;
    }
  }


  // ── Step 7: Rebuild buyOrders / sellOrders for dashboard + label display ──────────
  // Both arrays now reflect *active matched trades* so labels and dashboard can show
  // kWh delivered, kWh total, trading partner, and locked price.
  const houses = Array.from(houseMap.values());
  houses.forEach((house) => {
    house.buyOrders = nextTrades
      .filter((t) => t.buyerId === house.id)
      .map((t) => ({
        totalWh: t.totalWh,
        remainingWh: t.remainingWh,
        usedWh: t.totalWh - t.remainingWh,
        sellerId: t.sellerId,
        pricePerKWh: t.pricePerKWh,
      }));
    house.sellOrders = nextTrades
      .filter((t) => t.sellerId === house.id)
      .map((t) => ({
        totalWh: t.totalWh,
        remainingWh: t.remainingWh,
        usedWh: t.totalWh - t.remainingWh,
        buyerId: t.buyerId,
        pricePerKWh: t.pricePerKWh,
      }));
  });

  // ── Step 8: History and totals ────────────────────────────────────────────
  const totalLocalTrade = localTradeWh / tickHours;
  const totalBatteryDelta = houses.reduce(
    (s, h) => s + ((h.batteryLevel || 0) - (prevBatteryLevels.get(h.id) || 0)),
    0,
  );
  const totalCumulativeBalance = houses.reduce((s, h) => s + h.cumulativeBalance, 0);

  const elapsedHours = nextDayCount * 24 + nextTime;
  const nextHistoryEntry = {
    timeHours: nextTime,
    elapsedHours,
    totalCumulativeBalance,
    demandW: totalDemand,
    productionW: totalProduction,
    marketPrice,
    localTradeW: totalLocalTrade,
    gridRevenue,
    settledMoney,
    totalBatteryDelta,
  };

  return {
    houses,
    trades: nextTrades,
    openBuyOrders: remainingOpenOrders,
    timeHours: nextTime,
    history: [...(state.history || []).slice(-3000), nextHistoryEntry],
    totals: {
      demandW: totalDemand,
      productionW: totalProduction,
      localTradeW: totalLocalTrade,
      gridDependency,
      marketPrice,
      gridRevenue,
      settledMoney,
      totalBatteryDelta,
    },
    weatherIntensity,
    targetWeatherIntensity,
    weatherFactor,
    dayCount: nextDayCount,
  };
};

const formatClock = (timeHours) => {
  const hours = Math.floor(timeHours);
  const minutes = Math.floor((timeHours - hours) * 60);
  return `${String(hours).padStart(2, '0')}:${String(minutes).padStart(2, '0')}`;
};

export const useEnergyStore = create((set, get) => ({
  // Global debug flag - set to true to show debug info
  DEBUG: false,
  // When debugging, hide labels by default; toggle with `H` to reveal
  showHouseLabels: true,

  houses: initialCity.houses,
  roads: initialCity.roads,
  trades: [],
  openBuyOrders: [],
  history: [],
  timeHours: 7,
  totals: {
    demandW: 0,
    productionW: 0,
    localTradeW: 0,
    gridDependency: 0,
    marketPrice: 0.18,
  },
  weatherIntensity: 0,
  targetWeatherIntensity: 0,
  weatherFactor: 1.0,
  dayCount: 0,
  tickMs: DEFAULT_TICK_MS,
  simMinutesPerTick: DEFAULT_SIM_MINUTES_PER_TICK,
  historySpan: 2, // Default view window for graphs (hours)
  isPaused: false,
  labelScale: 1.0,

  mapSettings: INITIAL_SETTINGS,

  tick: () => {
    if (get().isPaused) return;
    try {
      const state = get();
      // Ensure all required fields exist before ticking
      if (!state.houses || !Array.isArray(state.houses)) return;
      if (!state.simMinutesPerTick || !Number.isFinite(state.simMinutesPerTick)) return;
      set((s) => tickSimulation(s));
    } catch (error) {
      console.error('Tick error:', error);
      // Silently catch—don't crash the app, just skip this tick
    }
  },

  toggleHouseLabels: () => {
    set((state) => ({
      showHouseLabels: !state.showHouseLabels,
    }));
  },

  reset: () => {
    const wasPaused = get().isPaused;
    set((state) => ({ ...state, isPaused: true }));

    const city = createCityLayout(get().mapSettings);
    set((state) => ({
      ...state,
      houses: city.houses,
      roads: city.roads,
      trades: [],
      openBuyOrders: [],
      history: [],
      timeHours: 7,
      dayCount: 0,
      isPaused: wasPaused,
    }));
  },

  setSeed: (seed) => {
    const numericSeed = Number(seed);
    if (!Number.isFinite(numericSeed)) return;
    get().updateMapSettings({ seed: numericSeed });
  },

  getClockLabel: () => formatClock(get().timeHours),

  setTickMs: (val) => set({ tickMs: val }),
  setSimMinutesPerTick: (val) => set({ simMinutesPerTick: val }),
  setHistorySpan: (val) => set({ historySpan: val }),
  setLabelScale: (val) => set({ labelScale: val }),
  togglePaused: () => set((s) => ({ isPaused: !s.isPaused })),
  toggleDebug: () => set((s) => ({ DEBUG: !s.DEBUG })),

  updateMapSettings: (newSettings) => {
    // Temporarily pause to avoid tick() running mid-regeneration
    const wasPaused = get().isPaused;
    set((state) => ({ ...state, isPaused: true }));

    // Regenerate city synchronously (safer than async)
    const updatedSettings = { ...get().mapSettings, ...newSettings };
    const city = createCityLayout(updatedSettings);

    // Update store with new city, then resume
    set((state) => ({
      ...state,
      mapSettings: updatedSettings,
      houses: city.houses,
      roads: city.roads,
      trades: [],
      openBuyOrders: [],
      history: [],
      timeHours: 7,
      dayCount: 0,
      isPaused: wasPaused, // Resume to previous state
    }));
  },

  getAverageStreetLength: () => {
    const settings = get().mapSettings;
    const sizeScale = settings.citySize || 1.0;
    return (BASE_STREET_SEGMENT_MIN + BASE_STREET_SEGMENT_MAX) / 2 * sizeScale;
  }
}));
