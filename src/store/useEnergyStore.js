import { create } from 'zustand';
import { getModelConfig } from '../config/houseModels';

// Real-time tick length (ms) and simulation mapping.
// We simulate one tick per second, and each tick represents 5 simulated minutes.
const TICK_MS = 1000; // 1 second per tick in real time
const SIM_MINUTES_PER_TICK = 5; // each tick represents 5 minutes of simulated time
const TICK_HOURS = SIM_MINUTES_PER_TICK / 60; // hours represented per tick
const SEED = 1;
const MIN_HOUSES = 80;
const MAX_HOUSES = 100;
const STREET_HALF_WIDTH = 2.4;
const MIN_HOUSE_DISTANCE = 10.0;
const STREET_SEGMENT_MIN = 10;
const STREET_SEGMENT_MAX = 16;
const HOUSE_ROAD_CLEARANCE = 3;
const SOLAR_HOUSE_RATIO = 0.85;
// Number of ticks an order should cover (increases Wh per order so trades span multiple ticks)
const ORDER_TICKS = 24;

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

const createGridCoordinates = (segmentCount, rng) => {
  const segments = Array.from(
    { length: segmentCount },
    () => STREET_SEGMENT_MIN + rng() * (STREET_SEGMENT_MAX - STREET_SEGMENT_MIN)
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

const createCityLayout = (seed) => {
  const rng = createRng(seed);
  const houseCount = randomInt(rng, MIN_HOUSES, MAX_HOUSES);
  const cols = randomInt(rng, 5, 7);
  const rows = randomInt(rng, 5, 7);

  const xCoords = createGridCoordinates(cols - 1, rng);
  const zCoords = createGridCoordinates(rows - 1, rng);

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

  let chosenLots = pickLotsWithSpacing(MIN_HOUSE_DISTANCE);

  const houses = chosenLots.map((lot, index) => {
    const modelIndex = Math.floor(seededRandom(index + seed) * 6) + 1;
    const modelParams = getModelConfig(modelIndex);
    const hasSolar = rng() < SOLAR_HOUSE_RATIO;
    const solarPanels = hasSolar ? modelParams.solarPanels : [];
    
    // 60% of solar homes and 20% of non-solar homes get batteries
    const hasBattery = hasSolar ? rng() < 0.6 : rng() < 0.2;
    
    // Keep households in a realistic range, but make solar homes clearly net-positive at peak
    const baseConsumption = 1800 + rng() * 1200; // 1800-3000W base load
    const pvPeak = hasSolar ? baseConsumption * (2.4 + rng() * 0.9) : 0; // Peak solar is ~2.4-3.3x consumption
    const batteryCapacity = hasBattery ? (hasSolar ? 10 + rng() * 5 : 8 + rng() * 4) : 0; // 10-15 kWh solar, 8-12 kWh non-solar
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

const initialCity = createCityLayout(SEED);

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
  // Hohe Netzabhängigkeit treibt den Preis hoch.
  const base = 0.18;
  return base + gridDependency * 0.22;
};

const makeTrade = (seller, buyer, powerW, price) => ({
  id: `${seller.id}-${buyer.id}-${Date.now()}-${Math.random().toString(16).slice(2)}`,
  sellerId: seller.id,
  buyerId: buyer.id,
  powerW,
  price,
  createdAt: Date.now(),
});

const tickSimulation = (state) => {
  const nextTime = (state.timeHours + 0.25) % 24;
  const daylight = dayLightFactor(nextTime);
  const consumptionFactor = consumptionCurveFactor(nextTime);
  const updatedHouses = state.houses.map((house) => {
    const demandNoise = 0.92 + Math.random() * 0.18;
    const solarNoise = 0.88 + Math.random() * 0.24;
    const isDaytime = daylight > 0;

    const consumption = house.baseConsumption * consumptionFactor * demandNoise;
    const production = house.pvPeak * daylight * solarNoise;
    const netKWh = (production - consumption) * TICK_HOURS / 1000;

    let batteryLevel = house.batteryLevel;
    let exportKWh = 0;
    let importKWh = 0;

    const reserveKWh = house.hasBattery
      ? (() => {
          const hoursUntilMorning = nextTime < 6 ? 6 - nextTime : nextTime >= 18 ? 24 - nextTime + 6 : 0;
          return hoursUntilMorning > 0 ? (house.baseConsumption * hoursUntilMorning) / 1000 : 0;
        })()
      : 0;

    // Battery-only homes try to charge during the day when prices are low.
    // Use a modest charging power so the charge is visible over multiple ticks.
    const daytimeChargeW = !house.hasSolar && house.hasBattery && isDaytime
      ? Math.min(1200, 450 + house.baseConsumption * 0.22)
      : 0;

    if (netKWh >= 0) {
      // surplus: charge battery first, then export surplus
      const chargeKWh = Math.min(house.batteryCapacity - batteryLevel, netKWh);
      batteryLevel += chargeKWh;
      exportKWh = netKWh - chargeKWh;

      // allow selling stored energy only up to the current surplus and only above reserve
      if (house.hasBattery && house.hasSolar && exportKWh > 0 && batteryLevel > reserveKWh) {
        const sellable = Math.min(batteryLevel - reserveKWh, exportKWh);
        exportKWh += sellable;
        batteryLevel -= sellable;
      }
    } else {
      // deficit: discharge battery to cover demand, otherwise import from grid
      const demandKWh = Math.abs(netKWh);
      const dischargeKWh = Math.min(batteryLevel - reserveKWh, demandKWh);
      const dischargeEffective = Math.max(0, dischargeKWh);
      batteryLevel -= dischargeEffective;
      importKWh = demandKWh - dischargeEffective;
    }

    if (daytimeChargeW > 0) {
      const daytimeChargeKWh = (daytimeChargeW * TICK_HOURS) / 1000;
      importKWh += daytimeChargeKWh;
      batteryLevel = Math.min(house.batteryCapacity, batteryLevel + daytimeChargeKWh);
    }

    return {
      ...house,
      consumption,
      production,
      batteryLevel: clamp(batteryLevel, 0, house.batteryCapacity),
      importW: (importKWh * 1000) / TICK_HOURS,
      exportW: (exportKWh * 1000) / TICK_HOURS,
      buyOrders: [],
      sellOrders: [],
    };
  });

  const totalDemand = updatedHouses.reduce((sum, h) => sum + h.consumption, 0);
  const totalProduction = updatedHouses.reduce((sum, h) => sum + h.production, 0);

  const houseMap = new Map(updatedHouses.map((house) => [house.id, { ...house }]));
  const nextTrades = [];
  const settlements = [];
  let localTradeWh = 0;
  // track money settled via peer-to-peer trades this tick
  let settledMoney = 0;
  // track battery level changes for diagnostics
  const prevBatteryLevels = new Map((state.houses || []).map((h) => [h.id, h.batteryLevel || 0]));

  const activeTrades = (state.trades || []).filter((trade) => trade.status === 'ongoing');

  for (const trade of activeTrades) {
    const seller = houseMap.get(trade.sellerId);
    const buyer = houseMap.get(trade.buyerId);

    if (!seller || !buyer) {
      continue;
    }

    const plannedWh = (trade.rateW || 0) * TICK_HOURS;
    const sellerAvailableWh = Math.max(0, seller.exportW * TICK_HOURS);
    const buyerNeedWh = Math.max(0, buyer.importW * TICK_HOURS);
    const transferableWh = Math.min(plannedWh, trade.remainingWh ?? plannedWh, sellerAvailableWh, buyerNeedWh);

    if (transferableWh > 0) {
      const transferRateW = transferableWh / TICK_HOURS;
      seller.exportW = Math.max(0, seller.exportW - transferRateW);
      buyer.importW = Math.max(0, buyer.importW - transferRateW);
      trade.tickTransferWh = transferableWh;
      trade.transferredWh = (trade.transferredWh || 0) + transferableWh;
      trade.remainingWh = Math.max(0, (trade.remainingWh ?? 0) - transferableWh);
      localTradeWh += transferableWh;
    } else {
      trade.tickTransferWh = 0;
    }

    trade.status = (trade.remainingWh ?? 0) > 0 ? 'ongoing' : 'completed';
    trade.price = trade.price ?? 0;

    if (trade.status === 'ongoing') {
      nextTrades.push(trade);
    }
  }

  const buyOrders = updatedHouses
    .filter((house) => house.importW > 0)
    .map((house) => ({
      houseId: house.id,
      // create orders covering multiple ticks so orders are not trivially tiny
      energyWh: house.importW * TICK_HOURS * ORDER_TICKS,
      powerW: house.importW,
      status: 'open',
    }));

  const sellOrders = updatedHouses
    .filter((house) => house.exportW > 0 && (house.production > house.consumption || (house.hasBattery && house.batteryLevel > 0)))
    .map((house) => ({
      houseId: house.id,
      // sellers offer a multi-tick amount as well
      energyWh: house.exportW * TICK_HOURS * ORDER_TICKS,
      powerW: house.exportW,
      status: 'open',
    }));

  const buyQueue = buyOrders.map((order) => ({ ...order, remainingWh: order.energyWh }));
  const sellQueue = sellOrders.map((order) => ({ ...order, remainingWh: order.energyWh }));

  for (const buyerOrder of buyQueue) {
    for (const sellerOrder of sellQueue) {
      if (buyerOrder.remainingWh <= 0) {
        break;
      }
      if (sellerOrder.remainingWh <= 0) {
        continue;
      }

      const matchedWh = Math.min(buyerOrder.remainingWh, sellerOrder.remainingWh);
      if (matchedWh <= 0) {
        continue;
      }

      const buyer = houseMap.get(buyerOrder.houseId);
      const seller = houseMap.get(sellerOrder.houseId);
      if (!buyer || !seller) {
        continue;
      }

      const targetRateW = matchedWh / (TICK_HOURS * 4);
      const tradeRateW = Math.max(75, Math.min(buyerOrder.powerW, sellerOrder.powerW, targetRateW));
      const initialTransferWh = Math.min(tradeRateW * TICK_HOURS, matchedWh);

      const trade = {
        id: `trade-${seller.id}-${buyer.id}-${Date.now()}-${Math.random().toString(16).slice(2)}`,
        sellerId: seller.id,
        buyerId: buyer.id,
        rateW: tradeRateW,
        remainingWh: matchedWh - initialTransferWh,
        transferredWh: initialTransferWh,
        tickTransferWh: initialTransferWh,
        price: 0,
        status: matchedWh - initialTransferWh > 0 ? 'ongoing' : 'completed',
        createdAt: Date.now(),
      };

      buyerOrder.remainingWh -= matchedWh;
      sellerOrder.remainingWh -= matchedWh;
      localTradeWh += initialTransferWh;
      settlements.push({ sellerId: seller.id, buyerId: buyer.id, transferWh: initialTransferWh });

      seller.exportW = Math.max(0, seller.exportW - tradeRateW);
      buyer.importW = Math.max(0, buyer.importW - tradeRateW);

      if (trade.status === 'ongoing') {
        nextTrades.push(trade);
      }
    }
  }

  const totalLocalTrade = localTradeWh / TICK_HOURS;
  // Use post-match importW values from houseMap so market price reflects matched trades
  const totalGridImport = Math.max(0, Array.from(houseMap.values()).reduce((sum, h) => sum + (h.importW || 0), 0));
  const gridDependency = totalDemand > 0 ? totalGridImport / totalDemand : 0;
  const marketPrice = pickMarketPrice(gridDependency);

  // Track how much money the external grid collects this tick (for diagnostics).
  let gridRevenue = 0;

  for (const trade of activeTrades) {
    if ((trade.tickTransferWh || 0) <= 0) {
      continue;
    }

    settlements.push({
      sellerId: trade.sellerId,
      buyerId: trade.buyerId,
      transferWh: trade.tickTransferWh,
    });

    trade.price = marketPrice;
  }

  for (const trade of nextTrades) {
    trade.price = marketPrice;
  }

  for (const settlement of settlements) {
    const energyKWh = settlement.transferWh / 1000;
    const seller = houseMap.get(settlement.sellerId);
    const buyer = houseMap.get(settlement.buyerId);

    if (seller) {
      const sellerRevenue = energyKWh * marketPrice;
      seller.cumulativeBalance += sellerRevenue;
      seller.balance += sellerRevenue;
      settledMoney += sellerRevenue;
    }

    if (buyer) {
      const buyerCost = energyKWh * marketPrice;
      buyer.cumulativeBalance -= buyerCost;
      buyer.balance -= buyerCost;
      settledMoney -= buyerCost;
    }
  }

  for (const house of houseMap.values()) {
    if (house.importW > 0) {
      const gridCost = (house.importW * TICK_HOURS / 1000) * marketPrice * 1.35;
      house.cumulativeBalance -= gridCost;
      house.balance -= gridCost;
      gridRevenue += gridCost;
    }

    const houseBuyOrders = buyQueue
      .filter((order) => order.houseId === house.id && order.remainingWh > 0)
      .map((order) => ({
        ...order,
        status: 'open',
      }));

    const houseSellOrders = sellQueue
      .filter((order) => order.houseId === house.id && order.remainingWh > 0)
      .map((order) => ({
        ...order,
        status: 'open',
      }));

    house.buyOrders = houseBuyOrders;
    house.sellOrders = houseSellOrders;
  }

  const houses = Array.from(houseMap.values());
  const totalBatteryDelta = houses.reduce((sum, h) => sum + ((h.batteryLevel || 0) - (prevBatteryLevels.get(h.id) || 0)), 0);
  const totalCumulativeBalance = houses.reduce((sum, house) => sum + house.cumulativeBalance, 0);
  const nextHistoryEntry = {
    timeHours: nextTime,
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
    timeHours: nextTime,
    history: [...(state.history || []).slice(-47), nextHistoryEntry],
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

  seed: SEED,
  houses: initialCity.houses,
  roads: initialCity.roads,
  trades: [],
  history: [],
  timeHours: 7,
  totals: {
    demandW: 0,
    productionW: 0,
    localTradeW: 0,
    gridDependency: 0,
    marketPrice: 0.18,
  },
  tickMs: TICK_MS,

  tick: () => {
    set((state) => tickSimulation(state));
  },

  toggleHouseLabels: () => {
    set((state) => ({
      showHouseLabels: !state.showHouseLabels,
    }));
  },

  reset: () => {
    const city = createCityLayout(get().seed);
    set({
      houses: city.houses,
      roads: city.roads,
      trades: [],
      history: [],
      timeHours: 7,
    });
    get().tick();
  },

  setSeed: (seed) => {
    const numericSeed = Number(seed);
    if (!Number.isFinite(numericSeed)) {
      return;
    }

    const city = createCityLayout(numericSeed);
    set({
      seed: numericSeed,
      houses: city.houses,
      roads: city.roads,
      trades: [],
      history: [],
      timeHours: 7,
    });
    get().tick();
  },

  getClockLabel: () => formatClock(get().timeHours),
}));
