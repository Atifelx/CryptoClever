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
