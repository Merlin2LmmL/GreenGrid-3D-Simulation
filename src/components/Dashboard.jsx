import { useMemo, useState, useEffect } from 'react';
import { useEnergyStore } from '../store/useEnergyStore';

const formatWatt = (value) => `${Math.round(value).toLocaleString('de-DE')} W`;
const formatPrice = (value) => `${value.toFixed(3).replace('.', ',')} €/kWh`;
const formatPower = (value) => `${Math.round(value)} W`;
const formatEuros = (value) => `${value >= 0 ? '+' : ''}${value.toFixed(2).replace('.', ',')} €`;
const formatWh = (value) => {
  if (value >= 1000) {
    return `${(value / 1000).toFixed(3).replace('.', ',')} kWh`;
  }
  return `${value.toFixed(2).replace('.', ',')} Wh`;
};

const SPAN_OPTIONS = [
  { label: '2h', value: 2 },
  { label: '4h', value: 4 },
  { label: '12h', value: 12 },
  { label: '24h', value: 24 },
  { label: '2d', value: 48 },
  { label: '4d', value: 96 },
  { label: '7d', value: 168 },
  { label: 'Max', value: Infinity },
];

export default function Dashboard() {
  const totals = useEnergyStore((state) => state.totals);
  const houses = useEnergyStore((state) => state.houses);
  const trades = useEnergyStore((state) => state.trades);
  const history = useEnergyStore((state) => state.history);
  const clock = useEnergyStore((state) => state.getClockLabel());
  const historySpan = useEnergyStore((state) => state.historySpan);
  const isPaused = useEnergyStore((state) => state.isPaused);
  const togglePaused = useEnergyStore((state) => state.togglePaused);
  const showHouseLabels = useEnergyStore((state) => state.showHouseLabels);
  const toggleHouseLabels = useEnergyStore((state) => state.toggleHouseLabels);
  const labelScale = useEnergyStore((state) => state.labelScale);

  const [graphMode, setGraphMode] = useState('energy'); // 'energy', 'price', 'trades'

  const localGenerated = useMemo(
    () => Math.min(totals.productionW, totals.demandW),
    [totals.productionW, totals.demandW]
  );

  const avgBattery = useMemo(() => {
    const housesWithBattery = houses.filter(h => h.batteryCapacity > 0);
    if (housesWithBattery.length === 0) return 0;
    const sum = housesWithBattery.reduce((acc, house) => acc + (house.batteryLevel / house.batteryCapacity) * 100, 0);
    return sum / housesWithBattery.length;
  }, [houses]);

  const housesById = useMemo(() => new Map(houses.map(h => [h.id, h])), [houses]);

  const weatherLabel = useEnergyStore((s) => {
    const intensity = s.weatherIntensity;
    if (intensity === 0) return 'Sonnig';
    if (intensity <= 0.25) return 'Heiter';
    if (intensity <= 0.5) return 'Bewölkt';
    if (intensity <= 0.75) return 'Stark bewölkt';
    return 'Regnerisch';
  });

  return (
    <div className="pointer-events-none absolute left-4 top-4 z-[1000] w-80 sm:w-96 max-h-[calc(100vh-2rem)] flex flex-col rounded-3xl p-5 text-sm text-emerald-50 glass-panel sm:left-6 sm:top-6 sm:p-6 shadow-2xl">
      {/* Header */}
      <div className="flex justify-between items-start mb-6 shrink-0">
        <div>
          <h1 className="text-2xl font-bold tracking-tight text-white leading-none">GreenGrid</h1>
          <p className="text-[10px] uppercase tracking-[0.3em] font-bold text-emerald-400/90 mt-1">Autonomous Energy Mesh</p>
        </div>
        <div className="bg-white/10 px-3 py-1.5 rounded-xl border border-white/10 backdrop-blur-md">
          <span className="text-xs font-mono font-bold text-emerald-200">{clock}</span>
        </div>
      </div>

      <div className="flex-1 overflow-y-auto pr-2 custom-scrollbar pointer-events-auto">
        {/* Metrics Grid */}
        <div className="grid grid-cols-2 gap-3 mb-6">
          <Metric label="Marktpreis" value={formatPrice(totals.marketPrice)} highlight />
          <Metric label="Wetter" value={weatherLabel} />
          <Metric label="Verbrauch" value={formatWatt(totals.demandW)} />
          <Metric label="Lokal erzeugt" value={formatWatt(localGenerated)} />
          <Metric label="Netz-Last" value={`${(totals.gridDependency * 100).toFixed(1)}%`} />
          <Metric label="Ø Speicher" value={`${avgBattery.toFixed(1)}%`} />
          <Metric
            label="Netto-Gewinn"
            value={formatEuros(totals.totalCumulativeBalance ?? 0)}
            variant={(totals.totalCumulativeBalance ?? 0) >= 0 ? 'success' : 'danger'}
          />
        </div>

        {/* Graph Section */}
        <div className="mb-6">
          <div className="flex items-center justify-between mb-3 px-1">
            <div className="text-[10px] uppercase tracking-wider text-emerald-200/60 font-bold">Analyse</div>
            <div className="flex gap-1 bg-black/20 p-1 rounded-lg">
              <GraphTab active={graphMode === 'energy'} onClick={() => setGraphMode('energy')} label="Watt" />
              <GraphTab active={graphMode === 'price'} onClick={() => setGraphMode('price')} label="Preis" />
              <GraphTab active={graphMode === 'trades'} onClick={() => setGraphMode('trades')} label="P2P" />
            </div>
          </div>

          <div className="relative h-40 w-full rounded-2xl bg-black/30 p-4 border border-white/5 overflow-hidden mb-3">
            {graphMode === 'energy' && <EnergyGraph history={history} span={historySpan} />}
            {graphMode === 'price' && <PriceGraph history={history} span={historySpan} />}
            {graphMode === 'trades' && <TradeVolumeGraph history={history} span={historySpan} />}
          </div>

          <Slider
            label="Graph-Zeitraum"
            value={SPAN_OPTIONS.findIndex(o => o.value === historySpan)}
            min={0}
            max={SPAN_OPTIONS.length - 1}
            step={1}
            unit=""
            valueLabel={SPAN_OPTIONS.find(o => o.value === historySpan)?.label || 'Max'}
            onChange={(idx) => useEnergyStore.getState().setHistorySpan(SPAN_OPTIONS[idx].value)}
          />
        </div>

        {/* Trades Section */}
        <div className="mb-6 border-t border-white/10 pt-4">
          <div className="flex justify-between items-center mb-3 px-1">
            <div className="text-[10px] uppercase tracking-wider text-emerald-200/60 font-bold">P2P Markttransaktionen</div>
            <div className="bg-emerald-400/20 px-2 py-0.5 rounded-md text-[9px] font-bold text-emerald-400 border border-emerald-400/20">
              {trades.length} AKTIV
            </div>
          </div>

          {trades.length > 0 ? (
            <div className="max-h-48 overflow-y-auto space-y-2 pr-1 custom-scrollbar">
              {trades.map((trade) => (
                <TradeItem key={trade.id} trade={trade} housesById={housesById} />
              ))}
            </div>
          ) : (
            <div className="text-center py-4 bg-white/5 rounded-xl border border-dashed border-white/10">
              <span className="text-[10px] text-emerald-200/30">Keine aktiven Transaktionen</span>
            </div>
          )}
        </div>

        {/* Simulation Settings Section */}
        <div className="border-t border-white/10 pt-4 mb-2">
          <div className="flex justify-between items-center mb-4 px-1">
            <div className="text-[10px] uppercase tracking-wider text-emerald-200/60 font-bold">Simulationseinstellungen</div>
            <div className="flex gap-2">
              <HeaderButton
                active={showHouseLabels}
                onClick={toggleHouseLabels}
                icon={showHouseLabels ? '🏷️' : '🚫'}
                label="Labels"
              />
              <HeaderButton
                active={isPaused}
                onClick={togglePaused}
                icon={isPaused ? '▶️' : '⏸️'}
                label={isPaused ? 'Fortsetzen' : 'Pause'}
                variant={isPaused ? 'warning' : 'default'}
              />
            </div>
          </div>
          <div className="space-y-4 px-1">
            <ExponentialSlider
              label="Tick-Dauer (Echtzeit)"
              value={useEnergyStore((s) => s.tickMs)}
              min={10}
              max={60000}
              unit="ms"
              k={1.2}
              onChange={(v) => useEnergyStore.getState().setTickMs(v)}
            />
            <ExponentialSlider
              label="Simulations-Geschwindigkeit"
              value={useEnergyStore((s) => s.simMinutesPerTick)}
              min={0.1}
              max={60}
              unit="min/tick"
              k={0.4}
              onChange={(v) => useEnergyStore.getState().setSimMinutesPerTick(v)}
            />
            <Slider
              label="Label-Größe"
              value={labelScale}
              min={0.5}
              max={2.5}
              step={0.1}
              unit="x"
              onChange={(v) => useEnergyStore.getState().setLabelScale(v)}
            />
          </div>
        </div>
      </div>
    </div>
  );
}

function Metric({ label, value, highlight, variant }) {
  const textColor = variant === 'success' ? 'text-emerald-400' : (variant === 'danger' ? 'text-red-400' : 'text-white');
  return (
    <div className={`rounded-2xl border border-white/5 bg-white/5 p-3 backdrop-blur-sm ${highlight ? 'ring-1 ring-emerald-400/30' : ''}`}>
      <div className="text-[9px] uppercase tracking-widest text-emerald-200/50 font-bold">{label}</div>
      <div className={`mt-1 font-bold text-sm ${textColor}`}>{value}</div>
    </div>
  );
}

function GraphTab({ active, onClick, label }) {
  return (
    <button
      onClick={onClick}
      className={`px-2 py-0.5 rounded-md text-[9px] font-bold transition-all ${active ? 'bg-emerald-500 text-white shadow-lg' : 'text-emerald-200/40 hover:text-emerald-200'}`}
    >
      {label}
    </button>
  );
}

function HeaderButton({ active, onClick, icon, label, variant }) {
  const bgClass = variant === 'warning' ? (active ? 'bg-amber-500/30' : 'bg-white/5') : (active ? 'bg-emerald-500/30' : 'bg-white/5');
  const borderClass = variant === 'warning' ? (active ? 'border-amber-500/50' : 'border-white/10') : (active ? 'border-emerald-500/50' : 'border-white/10');
  const textClass = active ? 'text-white' : 'text-white/40';

  return (
    <button
      onClick={onClick}
      className={`flex items-center gap-1.5 px-2 py-1 rounded-lg border transition-all ${bgClass} ${borderClass} ${textClass} hover:bg-white/10`}
    >
      <span className="text-xs">{icon}</span>
      <span className="text-[9px] font-bold uppercase tracking-wider">{label}</span>
    </button>
  );
}

function Slider({ label, value, min, max, step, unit, valueLabel, onChange }) {
  const displayValue = valueLabel !== undefined ? valueLabel : `${value}${unit}`;
  return (
    <div className="space-y-2 pointer-events-auto">
      <div className="flex justify-between items-center text-[10px]">
        <span className="text-emerald-200/70 font-medium">{label}</span>
        <span className="text-emerald-400 font-bold">{displayValue}</span>
      </div>
      <input
        type="range"
        min={min}
        max={max}
        step={step}
        value={value}
        onChange={(e) => onChange(Number(e.target.value))}
        className="w-full h-1.5 bg-emerald-900/40 rounded-full appearance-none cursor-pointer accent-emerald-400 hover:accent-emerald-300 transition-all"
      />
    </div>
  );
}

function ExponentialSlider({ label, value, min, max, unit, onChange, k = 1.0 }) {
  const linearValue = Math.pow(Math.log(value / min) / Math.log(max / min), 1 / k);

  const handleInput = (e) => {
    const lin = Number(e.target.value);
    const exp = min * Math.pow(max / min, Math.pow(lin, k));

    let snapped = exp;
    if (exp > 100) snapped = Math.round(exp / 10) * 10;
    else if (exp > 10) snapped = Math.round(exp);
    else snapped = Math.round(exp * 10) / 10;

    onChange(snapped);
  };

  const displayValue = value >= 10 ? Math.round(value) : value.toFixed(1);

  return (
    <div className="space-y-2 pointer-events-auto">
      <div className="flex justify-between items-center text-[10px]">
        <span className="text-emerald-200/70 font-medium">{label}</span>
        <span className="text-emerald-400 font-bold">{displayValue}{unit}</span>
      </div>
      <input
        type="range"
        min={0}
        max={1}
        step={0.001}
        value={linearValue}
        onChange={handleInput}
        className="w-full h-1.5 bg-emerald-900/40 rounded-full appearance-none cursor-pointer accent-emerald-400 hover:accent-emerald-300 transition-all"
      />
    </div>
  );
}

function TradeItem({ trade, housesById }) {
  const buyer = housesById.get(trade.buyerId);
  const seller = housesById.get(trade.sellerId);
  const progress = ((trade.totalWh - trade.remainingWh) / trade.totalWh) * 100;

  return (
    <div className="rounded-xl bg-white/5 p-3 border border-white/5 hover:bg-white/10 transition-colors">
      <div className="flex justify-between items-center mb-1.5">
        <div className="flex items-center gap-2">
          <span className="text-[10px] font-bold text-white">{seller?.name}</span>
          <span className="text-emerald-400">→</span>
          <span className="text-[10px] font-bold text-white">{buyer?.name}</span>
        </div>
        <span className="text-[10px] font-mono text-emerald-300 bg-emerald-400/10 px-1.5 py-0.5 rounded">{formatPrice(trade.pricePerKWh)}</span>
      </div>
      <div className="flex justify-between text-[9px] text-emerald-100/40 mb-2">
        <span className="flex items-center gap-1">
          <span className="w-1.5 h-1.5 rounded-full bg-emerald-400 animate-pulse"></span>
          {formatPower(trade.lastDeliveryW)} Transfer
        </span>
        <span>{formatWh(trade.totalWh - trade.remainingWh)} / {formatWh(trade.totalWh)}</span>
      </div>
      <div className="h-1 w-full bg-black/40 rounded-full overflow-hidden">
        <div
          className="h-full bg-gradient-to-r from-emerald-600 to-emerald-400 transition-all duration-1000 ease-out"
          style={{ width: `${progress}%` }}
        />
      </div>
    </div>
  );
}

const GRAPH_WIDTH = 340;
const GRAPH_HEIGHT = 120;
const GRAPH_PADDING_TOP = 20;
const GRAPH_PADDING_BOTTOM = 20;
const GRAPH_PADDING_LEFT = 40;
const GRAPH_PADDING_RIGHT = 10;

function EnergyGraph({ history, span }) {
  const data = useMemo(() => {
    if (span === Infinity || history.length === 0) return history;
    const latest = history[history.length - 1].elapsedHours;
    return history.filter(h => h.elapsedHours >= latest - span);
  }, [history, span]);
  if (data.length < 2) return null;

  const demandW = data.map((entry) => entry.demandW ?? 0);
  const productionW = data.map((entry) => entry.productionW ?? 0);
  const max = Math.max(1, ...demandW, ...productionW);
  const dataCount = data.length - 1;

  const getPoints = (values) => values.map((v, i) => {
    const x = GRAPH_PADDING_LEFT + (i / dataCount) * (GRAPH_WIDTH - GRAPH_PADDING_LEFT - GRAPH_PADDING_RIGHT);
    const y = GRAPH_HEIGHT - GRAPH_PADDING_BOTTOM - (v / max) * (GRAPH_HEIGHT - GRAPH_PADDING_BOTTOM - GRAPH_PADDING_TOP);
    return `${x},${y}`;
  }).join(' ');

  const formatKW = (v) => `${(v / 1000).toFixed(1)}k`;

  return (
    <svg viewBox={`0 0 ${GRAPH_WIDTH} ${GRAPH_HEIGHT}`} className="w-full h-full overflow-visible">
      <line x1={GRAPH_PADDING_LEFT} y1={GRAPH_PADDING_TOP} x2={GRAPH_WIDTH - GRAPH_PADDING_RIGHT} y2={GRAPH_PADDING_TOP} stroke="rgba(255,255,255,0.05)" />
      <line x1={GRAPH_PADDING_LEFT} y1={GRAPH_HEIGHT - GRAPH_PADDING_BOTTOM} x2={GRAPH_WIDTH - GRAPH_PADDING_RIGHT} y2={GRAPH_HEIGHT - GRAPH_PADDING_BOTTOM} stroke="rgba(255,255,255,0.1)" />

      <text x={GRAPH_PADDING_LEFT - 5} y={GRAPH_PADDING_TOP} fill="rgba(255,255,255,0.3)" fontSize="8" textAnchor="end" dominantBaseline="middle">{formatKW(max)}</text>
      <text x={GRAPH_PADDING_LEFT - 5} y={GRAPH_HEIGHT - GRAPH_PADDING_BOTTOM} fill="rgba(255,255,255,0.3)" fontSize="8" textAnchor="end" dominantBaseline="middle">0</text>

      <polyline fill="none" stroke="#ef4444" strokeWidth="2" strokeLinejoin="round" points={getPoints(demandW)} />
      <polyline fill="none" stroke="#10b981" strokeWidth="2" strokeLinejoin="round" points={getPoints(productionW)} />

      <text x={GRAPH_PADDING_LEFT} y={GRAPH_PADDING_TOP - 10} fill="#ef4444" fontSize="8" fontWeight="bold">VERBRAUCH</text>
      <text x={GRAPH_PADDING_LEFT + 60} y={GRAPH_PADDING_TOP - 10} fill="#10b981" fontSize="8" fontWeight="bold">SOLAR</text>
    </svg>
  );
}

function PriceGraph({ history, span }) {
  const data = useMemo(() => {
    if (span === Infinity || history.length === 0) return history;
    const latest = history[history.length - 1].elapsedHours;
    return history.filter(h => h.elapsedHours >= latest - span);
  }, [history, span]);
  if (data.length < 2) return null;

  const values = data.map((h) => h.marketPrice ?? 0);
  const min = Math.min(...values);
  const max = Math.max(...values);
  const range = max - min || 0.1;
  const dataCount = data.length - 1;

  const points = values.map((v, i) => {
    const x = GRAPH_PADDING_LEFT + (i / dataCount) * (GRAPH_WIDTH - GRAPH_PADDING_LEFT - GRAPH_PADDING_RIGHT);
    const y = GRAPH_HEIGHT - GRAPH_PADDING_BOTTOM - ((v - min) / range) * (GRAPH_HEIGHT - GRAPH_PADDING_BOTTOM - GRAPH_PADDING_TOP);
    return `${x},${y}`;
  }).join(' ');

  return (
    <svg viewBox={`0 0 ${GRAPH_WIDTH} ${GRAPH_HEIGHT}`} className="w-full h-full overflow-visible">
      <line x1={GRAPH_PADDING_LEFT} y1={GRAPH_PADDING_TOP} x2={GRAPH_WIDTH - GRAPH_PADDING_RIGHT} y2={GRAPH_PADDING_TOP} stroke="rgba(255,255,255,0.05)" />
      <line x1={GRAPH_PADDING_LEFT} y1={GRAPH_HEIGHT - GRAPH_PADDING_BOTTOM} x2={GRAPH_WIDTH - GRAPH_PADDING_RIGHT} y2={GRAPH_HEIGHT - GRAPH_PADDING_BOTTOM} stroke="rgba(255,255,255,0.1)" />

      <text x={GRAPH_PADDING_LEFT - 5} y={GRAPH_PADDING_TOP} fill="rgba(255,255,255,0.3)" fontSize="8" textAnchor="end" dominantBaseline="middle">{max.toFixed(2)}</text>
      <text x={GRAPH_PADDING_LEFT - 5} y={GRAPH_HEIGHT - GRAPH_PADDING_BOTTOM} fill="rgba(255,255,255,0.3)" fontSize="8" textAnchor="end" dominantBaseline="middle">{min.toFixed(2)}</text>

      <polyline fill="none" stroke="#f59e0b" strokeWidth="2" strokeLinejoin="round" points={points} />
      <text x={GRAPH_PADDING_LEFT} y={GRAPH_PADDING_TOP - 10} fill="#f59e0b" fontSize="8" fontWeight="bold">MARKT-PREIS (€/kWh)</text>
    </svg>
  );
}

function TradeVolumeGraph({ history, span }) {
  const data = useMemo(() => {
    if (span === Infinity || history.length === 0) return history;
    const latest = history[history.length - 1].elapsedHours;
    return history.filter(h => h.elapsedHours >= latest - span);
  }, [history, span]);
  if (data.length < 2) return null;

  const values = data.map((h) => h.localTradeW ?? 0);
  const max = Math.max(1, ...values);
  const dataCount = data.length - 1;

  const points = values.map((v, i) => {
    const x = GRAPH_PADDING_LEFT + (i / dataCount) * (GRAPH_WIDTH - GRAPH_PADDING_LEFT - GRAPH_PADDING_RIGHT);
    const y = GRAPH_HEIGHT - GRAPH_PADDING_BOTTOM - (v / max) * (GRAPH_HEIGHT - GRAPH_PADDING_BOTTOM - GRAPH_PADDING_TOP);
    return `${x},${y}`;
  }).join(' ');

  return (
    <svg viewBox={`0 0 ${GRAPH_WIDTH} ${GRAPH_HEIGHT}`} className="w-full h-full overflow-visible">
      <line x1={GRAPH_PADDING_LEFT} y1={GRAPH_PADDING_TOP} x2={GRAPH_WIDTH - GRAPH_PADDING_RIGHT} y2={GRAPH_PADDING_TOP} stroke="rgba(255,255,255,0.05)" />
      <line x1={GRAPH_PADDING_LEFT} y1={GRAPH_HEIGHT - GRAPH_PADDING_BOTTOM} x2={GRAPH_WIDTH - GRAPH_PADDING_RIGHT} y2={GRAPH_HEIGHT - GRAPH_PADDING_BOTTOM} stroke="rgba(255,255,255,0.1)" />

      <text x={GRAPH_PADDING_LEFT - 5} y={GRAPH_PADDING_TOP} fill="rgba(255,255,255,0.3)" fontSize="8" textAnchor="end" dominantBaseline="middle">{Math.round(max)}</text>
      <text x={GRAPH_PADDING_LEFT - 5} y={GRAPH_HEIGHT - GRAPH_PADDING_BOTTOM} fill="rgba(255,255,255,0.3)" fontSize="8" textAnchor="end" dominantBaseline="middle">0</text>

      <polyline fill="none" stroke="#3b82f6" strokeWidth="2" strokeLinejoin="round" points={points} />
      <text x={GRAPH_PADDING_LEFT} y={GRAPH_PADDING_TOP - 10} fill="#3b82f6" fontSize="8" fontWeight="bold">P2P VOLUMEN (W)</text>
    </svg>
  );
}

export function DebugToolbar({ debug, toggleDebug }) {
  return (
    <div className="pointer-events-none fixed right-6 bottom-6 z-[2000] flex flex-col items-end gap-3">
      <div className="pointer-events-auto flex items-center gap-3">
        {debug && (
          <div className="flex items-center gap-2 bg-black/60 backdrop-blur-xl border border-red-500/30 px-3 py-1.5 rounded-xl shadow-2xl">
            <span className="text-[10px] font-bold text-red-400 uppercase tracking-widest">Performance</span>
            <FPSCounter />
          </div>
        )}
        <button
          onClick={toggleDebug}
          className={`flex h-10 w-10 items-center justify-center rounded-xl border transition-all shadow-xl ${debug
            ? 'bg-red-500/20 border-red-500/50 text-red-400'
            : 'bg-white/5 border-white/10 text-white/40 hover:bg-white/10 hover:text-white'
            }`}
          title="Toggle Debug Mode (D)"
        >
          {debug ? '🔧' : '🛠️'}
        </button>
      </div>
    </div>
  );
}

function FPSCounter() {
  const [fps, setFps] = useState(0);

  useEffect(() => {
    let lastTime = performance.now();
    let frames = 0;
    let requestId;

    const update = () => {
      const now = performance.now();
      frames++;

      if (now >= lastTime + 1000) {
        setFps(Math.round((frames * 1000) / (now - lastTime)));
        lastTime = now;
        frames = 0;
      }

      requestId = requestAnimationFrame(update);
    };

    requestId = requestAnimationFrame(update);
    return () => cancelAnimationFrame(requestId);
  }, []);

  return (
    <span className="text-[10px] font-mono font-bold text-red-400 mt-0.5">
      {fps} FPS
    </span>
  );
}

export function SettingsMenu() {
  const [isOpen, setIsOpen] = useState(false);
  const mapSettings = useEnergyStore((s) => s.mapSettings);
  const updateMapSettings = useEnergyStore((s) => s.updateMapSettings);

  return (
    <div className="pointer-events-none fixed right-6 top-6 z-[2000] flex flex-col items-end gap-3">
      <div className="pointer-events-auto">
        <button
          onClick={() => setIsOpen(!isOpen)}
          className={`flex h-12 w-12 items-center justify-center rounded-2xl border transition-all shadow-2xl ${isOpen
            ? 'bg-emerald-500 border-emerald-400 text-white'
            : 'bg-black/40 backdrop-blur-xl border-white/10 text-emerald-100 hover:bg-black/60'
            }`}
          title="Karteneinstellungen"
        >
          <span className="text-xl">⚙️</span>
        </button>
      </div>

      {isOpen && (
        <div className="pointer-events-auto w-80 rounded-3xl p-6 text-sm text-emerald-50 glass-panel shadow-2xl border border-white/10 animate-in fade-in zoom-in duration-200 origin-top-right">
          <div className="mb-6">
            <h2 className="text-lg font-bold text-white mb-1">Karteneinstellungen</h2>
            <p className="text-[10px] uppercase tracking-widest text-emerald-400/70 font-bold">Parameter & Generierung</p>
          </div>

          <div className="space-y-6">
            <Slider
              label="Stadt-Größe"
              value={mapSettings.citySize}
              min={0.5}
              max={2.5}
              step={0.1}
              unit="x"
              onChange={(v) => updateMapSettings({ citySize: v })}
            />

            <div className="space-y-2">
              <div className="flex justify-between items-center text-[10px]">
                <span className="text-emerald-200/70 font-medium">Seed (Zufallswert)</span>
                <span className="text-emerald-400 font-bold">#{mapSettings.seed}</span>
              </div>
              <input
                type="number"
                value={mapSettings.seed}
                onChange={(e) => updateMapSettings({ seed: parseInt(e.target.value) || 1 })}
                className="w-full bg-black/40 border border-white/10 rounded-xl px-3 py-2 text-emerald-100 focus:outline-none focus:ring-1 focus:ring-emerald-400/50 transition-all"
              />
            </div>

            <Slider
              label="Solar-Quote"
              value={mapSettings.solarRatio}
              min={0}
              max={1}
              step={0.05}
              unit=""
              valueLabel={`${(mapSettings.solarRatio * 100).toFixed(0)}%`}
              onChange={(v) => updateMapSettings({ solarRatio: v })}
            />

            <div className="pt-2 space-y-4 border-t border-white/5">
              <Slider
                label="Batterie (mit Solar)"
                value={mapSettings.solarBatteryRatio}
                min={0}
                max={1}
                step={0.05}
                unit=""
                valueLabel={`${(mapSettings.solarBatteryRatio * 100).toFixed(0)}%`}
                onChange={(v) => updateMapSettings({ solarBatteryRatio: v })}
              />

              <Slider
                label="Batterie (ohne Solar)"
                value={mapSettings.noSolarBatteryRatio}
                min={0}
                max={1}
                step={0.05}
                unit=""
                valueLabel={`${(mapSettings.noSolarBatteryRatio * 100).toFixed(0)}%`}
                onChange={(v) => updateMapSettings({ noSolarBatteryRatio: v })}
              />
            </div>

            <div className="pt-2 space-y-4 border-t border-white/5">
              <Slider
                label="Wetter-Intensität (Max)"
                value={mapSettings.maxWeatherIntensity}
                min={0}
                max={2.0}
                step={0.1}
                unit="x"
                onChange={(v) => updateMapSettings({ maxWeatherIntensity: v })}
              />
            </div>

            <button
              onClick={() => updateMapSettings({ seed: Math.floor(Math.random() * 10000) })}
              className="w-full py-3 bg-emerald-500 hover:bg-emerald-400 text-white rounded-xl font-bold text-xs uppercase tracking-widest transition-all shadow-lg active:scale-[0.98]"
            >
              Neu Generieren 🎲
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
