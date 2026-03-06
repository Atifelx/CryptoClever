/**
 * Indicator Registry
 * Centralized management of all indicators
 */

export type IndicatorCategory = 'trend' | 'oscillator' | 'overlay' | 'volume' | 'support-resistance';

export interface IndicatorConfig {
  id: string;
  name: string;
  category: IndicatorCategory;
  description: string;
  defaultEnabled: boolean;
  hasSettings: boolean;
  icon?: string;
}

export const INDICATOR_REGISTRY: Record<string, IndicatorConfig> = {
  // Support/Resistance Indicators
  semafor: {
    id: 'semafor',
    name: 'Semafor',
    category: 'support-resistance',
    description: 'Identifies swing highs and lows (pivot points)',
    defaultEnabled: true,
    hasSettings: true,
    icon: '🔴',
  },
  // Scalp Signal Indicator
  scalpSignal: {
    id: 'scalpSignal',
    name: 'Scalp Signal',
    category: 'support-resistance',
    description: 'EMA + Supertrend + RSI + VWAP scalp entries (13:00–22:00 UTC, volume confirmation)',
    defaultEnabled: false,
    hasSettings: true,
    icon: '⚡',
  },
  // Trend Indicator
  trendIndicator: {
    id: 'trendIndicator',
    name: 'Trend Indicator',
    category: 'trend',
    description: 'EMA(20/50/200) trend identification with volume confirmation - shows UPTREND/DOWNTREND/SIDEWAYS',
    defaultEnabled: false,
    hasSettings: true,
    icon: '📈',
  },
  // FMCBR (Fibo Musang Candle Break Retest) — Core Engine; toggled via "Keep Live" in header.
  // Replaces TrendScalp: uses 1000 1m candles → 5m aggregation, IB/DB + CB1 + Fibonacci levels.
  fmcbr: {
    id: 'fmcbr',
    name: 'FMCBR 3.0',
    category: 'support-resistance',
    description: 'Fibo Musang Candle Break Retest: 5m break/retest + Fib levels (entry & TP). Turn on via Core Engine / Keep Live.',
    defaultEnabled: false,
    hasSettings: false,
    icon: '📐',
  },
};

/**
 * Get all indicators grouped by category
 */
export function getIndicatorsByCategory(): Record<IndicatorCategory, IndicatorConfig[]> {
  const grouped: Record<IndicatorCategory, IndicatorConfig[]> = {
    trend: [],
    oscillator: [],
    overlay: [],
    volume: [],
    'support-resistance': [],
  };

  Object.values(INDICATOR_REGISTRY).forEach(indicator => {
    grouped[indicator.category].push(indicator);
  });

  return grouped;
}

/**
 * Get indicator by ID
 */
export function getIndicator(id: string): IndicatorConfig | undefined {
  return INDICATOR_REGISTRY[id];
}

/**
 * Get all indicator IDs
 */
export function getAllIndicatorIds(): string[] {
  return Object.keys(INDICATOR_REGISTRY);
}
