/**
 * Deep Market Structure Engine
 * Pure, deterministic market analysis
 */

export { runDeepAnalysis } from './DeepAnalysisRunner';
export type { Candle, Pivot, MarketStructure, MarketRegime, AnalysisResult } from './types';

// Individual module exports (for advanced usage)
export { calculateATR } from './ATR';
export { detectPivots } from './StreamingPivotEngine';
export { classifyStructure } from './StructureClassifier';
export { calculateImpulseScore } from './ImpulseAnalyzer';
export { classifyRegime } from './RegimeClassifier';
export { aggregateConfidence } from './ConfidenceAggregator';
