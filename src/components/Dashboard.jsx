import { useMemo } from 'react';
import { useEnergyStore } from '../store/useEnergyStore';

const formatWatt = (value) => `${Math.round(value).toLocaleString('de-DE')} W`;
const formatPrice = (value) => `${value.toFixed(3).replace('.', ',')} €/kWh`;
const formatPower = (value) => `${Math.round(value)} W`;
const formatWh = (value) => {
  if (value >= 1000) {
    return `${(value / 1000).toFixed(3).replace('.', ',')} kWh`;
  }
  return `${value.toFixed(2).replace('.', ',')} Wh`;
};

export default function Dashboard() {
  const totals = useEnergyStore((state) => state.totals);
  const houses = useEnergyStore((state) => state.houses);
  const trades = useEnergyStore((state) => state.trades);
  const history = useEnergyStore((state) => state.history);
  const clock = useEnergyStore((state) => state.getClockLabel());

  const localGenerated = useMemo(
    () => Math.min(totals.productionW, totals.demandW),
    [totals.productionW, totals.demandW]
  );

  const avgBattery = useMemo(() => {
    if (houses.length === 0) return 0;
    const sum = houses.reduce((acc, house) => acc + (house.batteryLevel / house.batteryCapacity) * 100, 0);
    return sum / houses.length;
  }, [houses]);
  
  const housesById = useMemo(() => new Map(houses.map(h => [h.id, h])), [houses]);
  const housesWithPendingOrders = useMemo(() => {
    return houses.filter(h => h.buyOrders.length > 0 || h.sellOrders.length > 0);
  }, [houses]);

  const cumulativeBalanceTotal = useMemo(
    () => houses.reduce((sum, house) => sum + house.cumulativeBalance, 0),
    [houses]
  );

  return (
    <div className="pointer-events-none absolute left-4 top-4 z-50 max-w-sm rounded-2xl p-4 text-sm text-emerald-50 glass-panel sm:left-6 sm:top-6 sm:p-5">
      <h1 className="text-xl font-semibold tracking-wide text-emerald-100">GreenGrid Live</h1>
      <p className="mt-1 text-xs uppercase tracking-[0.2em] text-emerald-300/90">Dezentrales Energienetz</p>

      <div className="mt-4 grid grid-cols-2 gap-3 text-xs sm:text-sm">
        <Metric label="Uhrzeit" value={clock} />
        <Metric label="Marktpreis" value={formatPrice(totals.marketPrice)} />
        <Metric label="Gesamtverbrauch" value={formatWatt(totals.demandW)} />
        <Metric label="Lokal erzeugt" value={formatWatt(localGenerated)} />
        <Metric label="Netzabhängigkeit" value={`${(totals.gridDependency * 100).toFixed(1)} %`} />
        <Metric label="Ø Batteriestand" value={`${avgBattery.toFixed(1)} %`} />
        <Metric label="Kumulativ gesamt" value={`${cumulativeBalanceTotal >= 0 ? '+' : ''}${cumulativeBalanceTotal.toFixed(2).replace('.', ',')} €`} />
        <Metric label="Netz-Erlös" value={`${totals.gridRevenue ? (totals.gridRevenue >= 0 ? '+' : '') + totals.gridRevenue.toFixed(2).replace('.', ',') : '0,00'} €`} />
      </div>

      <div className="mt-4 border-t border-emerald-200/15 pt-3">
        <div className="text-[10px] uppercase tracking-wider text-emerald-200/80 font-medium">Energieverlauf</div>
        <EnergyGraph history={history} />
        <PriceGraph history={history} />
      </div>
      
      {trades.length > 0 && (
        <div className="mt-4 border-t border-emerald-200/15 pt-3">
          <div className="text-[10px] uppercase tracking-wider text-emerald-200/80 font-medium">Aktive Trades ({trades.length})</div>
          <div className="mt-2 max-h-24 overflow-y-auto space-y-1 text-[10px]">
            {trades.map((trade, idx) => (
              <div key={idx} className="text-emerald-100/70">
                {formatPower(trade.rateW || trade.powerW || 0)} · {formatWh(trade.remainingWh ?? trade.energyWh ?? 0)} → {housesById.get(trade.buyerId)?.name || '?'}
              </div>
            ))}
          </div>
        </div>
      )}
      
      {housesWithPendingOrders.length > 0 && (
        <div className="mt-3 border-t border-emerald-200/15 pt-3">
          <div className="text-[10px] uppercase tracking-wider text-emerald-200/80 font-medium">Orders ausstehend ({housesWithPendingOrders.length})</div>
          <div className="mt-2 max-h-20 overflow-y-auto space-y-1 text-[10px]">
            {housesWithPendingOrders.slice(0, 5).map((h) => (
              <div key={h.id} className="text-emerald-100/70">
                {h.name}: {h.buyOrders.length > 0 ? '🛒' : ''}{h.sellOrders.length > 0 ? '📦' : ''}
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

function Metric({ label, value }) {
  return (
    <div className="rounded-xl border border-emerald-200/15 bg-emerald-300/5 p-3">
      <div className="text-[10px] uppercase tracking-wider text-emerald-200/80">{label}</div>
      <div className="mt-1 font-medium text-emerald-50">{value}</div>
    </div>
  );
}

function EnergyGraph({ history }) {
  const width = 300;
  const height = 96;
  const padding = 10;

  if (!history || history.length < 2) {
    return (
      <div className="mt-2 rounded-xl border border-emerald-200/15 bg-emerald-300/5 p-3 text-[10px] text-emerald-100/60">
        No graph data yet.
      </div>
    );
  }

  const demandValues = history.map((entry) => entry.demandW ?? 0);
  const productionValues = history.map((entry) => entry.productionW ?? 0);
  const values = [...demandValues, ...productionValues];
  const min = 0;
  const max = Math.max(1, ...values);
  const range = Math.max(1e-6, max - min);

  const span = Math.max(1, history.length - 1);

  const demandPoints = demandValues.map((value, index) => {
    const x = padding + (index / span) * (width - padding * 2);
    const y = height - padding - ((value - min) / range) * (height - padding * 2);
    return `${x.toFixed(1)},${y.toFixed(1)}`;
  });

  const productionPoints = productionValues.map((value, index) => {
    const x = padding + (index / span) * (width - padding * 2);
    const y = height - padding - ((value - min) / range) * (height - padding * 2);
    return `${x.toFixed(1)},${y.toFixed(1)}`;
  });

  return (
    <div className="mt-2 rounded-xl border border-emerald-200/15 bg-emerald-300/5 p-3">
      <svg viewBox={`0 0 ${width} ${height}`} className="h-24 w-full overflow-visible">
        <defs>
          <linearGradient id="demandFill" x1="0" x2="0" y1="0" y2="1">
            <stop offset="0%" stopColor="#ef4444" stopOpacity="0.22" />
            <stop offset="100%" stopColor="#ef4444" stopOpacity="0.02" />
          </linearGradient>
          <linearGradient id="productionFill" x1="0" x2="0" y1="0" y2="1">
            <stop offset="0%" stopColor="#22c55e" stopOpacity="0.24" />
            <stop offset="100%" stopColor="#22c55e" stopOpacity="0.02" />
          </linearGradient>
        </defs>
        <polyline
          fill="none"
          stroke="#ef4444"
          strokeWidth="2.5"
          strokeLinejoin="round"
          strokeLinecap="round"
          points={demandPoints.join(' ')}
        />
        <polyline
          fill="url(#demandFill)"
          stroke="none"
          points={`${padding},${height - padding} ${demandPoints.join(' ')} ${width - padding},${height - padding}`}
        />
        <polyline
          fill="none"
          stroke="#22c55e"
          strokeWidth="2.5"
          strokeLinejoin="round"
          strokeLinecap="round"
          points={productionPoints.join(' ')}
        />
        <polyline
          fill="url(#productionFill)"
          stroke="none"
          points={`${padding},${height - padding} ${productionPoints.join(' ')} ${width - padding},${height - padding}`}
        />
      </svg>
      <div className="mt-1 flex items-center justify-between text-[10px] text-emerald-100/60">
        <span className="text-red-300">Verbrauch</span>
        <span className="text-emerald-300">Produktion</span>
      </div>
    </div>
  );
}

function PriceGraph({ history }) {
  const width = 300;
  const height = 48;
  const padding = 8;

  if (!history || history.length < 2) {
    return null;
  }

  const priceValues = history.map((h) => h.marketPrice ?? 0);
  const min = Math.min(...priceValues);
  const max = Math.max(...priceValues);
  const range = Math.max(1e-6, max - min);
  const span = Math.max(1, history.length - 1);

  const points = priceValues.map((v, idx) => {
    const x = padding + (idx / span) * (width - padding * 2);
    const y = height - padding - ((v - min) / range) * (height - padding * 2);
    return `${x.toFixed(1)},${y.toFixed(1)}`;
  });

  return (
    <div className="mt-2 rounded-xl border border-emerald-200/15 bg-emerald-300/5 p-3">
      <svg viewBox={`0 0 ${width} ${height}`} className="h-12 w-full overflow-visible">
        <polyline
          fill="none"
          stroke="#f59e0b"
          strokeWidth="2"
          strokeLinejoin="round"
          strokeLinecap="round"
          points={points.join(' ')}
        />
      </svg>
      <div className="mt-1 flex items-center justify-between text-[10px] text-emerald-100/60">
        <span className="text-amber-200">Marktpreis</span>
        <span className="text-emerald-300">{history[history.length - 1]?.marketPrice?.toFixed(3).replace('.', ',')} €/kWh</span>
      </div>
    </div>
  );
}
