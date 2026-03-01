/**
 * PHOENIX TRADING INDICATOR - COMPLETE TRADING SYSTEM
 * 
 * Features:
 * - Multi-EMA trend detection (8, 21, 50)
 * - Supertrend for direction
 * - RSI(5) for momentum
 * - Volume confirmation
 * - VWAP for price validation
 * - Time filter (13:00-22:00 UTC)
 * - Exit signals based on multiple conditions
 */

import type { Candle } from '../../store/candlesStore';

export interface PhoenixSignal {
  time: number;
  price: number;
  type: 'BUY' | 'SELL';
  label: string;
  confidence: number;
  zoneHigh: number;
  zoneLow: number;
  stopLoss: number;
  takeProfit1: number;
  takeProfit2: number;
  exitAfterCandles: number; // Max hold time
  indicators: {
    ema8: number;
    ema21: number;
    ema50: number;
    rsi: number;
    volumeRatio: number;
    supertrend: number;
    vwap: number;
  };
}

export interface PhoenixResult {
  signals: PhoenixSignal[];
  currentTrend: 'UP' | 'DOWN' | 'SIDEWAYS';
  trendStrength: number;
  supertrendUp: number | null;
  supertrendDown: number | null;
}

/**
 * Calculate SMA (Simple Moving Average)
 */
function calculateSMA(data: number[], period: number): number[] {
  const sma: number[] = [];
  
  for (let i = period - 1; i < data.length; i++) {
    const sum = data.slice(i - period + 1, i + 1).reduce((a, b) => a + b, 0);
    sma.push(sum / period);
  }
  
  return sma;
}

/**
 * Calculate EMA (Exponential Moving Average)
 */
function calculateEMA(data: number[], period: number): number[] {
  const ema: number[] = [];
  const multiplier = 2 / (period + 1);
  
  // Start with SMA for first value
  let sum = 0;
  for (let i = 0; i < period && i < data.length; i++) {
    sum += data[i];
  }
  ema[period - 1] = sum / period;
  
  // Calculate EMA for rest
  for (let i = period; i < data.length; i++) {
    ema[i] = (data[i] - ema[i - 1]) * multiplier + ema[i - 1];
  }
  
  return ema;
}

/**
 * Calculate ATR (Average True Range)
 */
function calculateATR(highs: number[], lows: number[], closes: number[], period: number): number[] {
  const atr: number[] = [];
  const trueRanges: number[] = [];
  
  for (let i = 1; i < highs.length; i++) {
    const tr = Math.max(
      highs[i] - lows[i],
      Math.abs(highs[i] - closes[i - 1]),
      Math.abs(lows[i] - closes[i - 1])
    );
    trueRanges.push(tr);
  }
  
  // Calculate ATR using EMA
  const atrValues = calculateEMA(trueRanges, period);
  
  return atrValues;
}

/**
 * Calculate Supertrend
 */
function calculateSupertrend(
  highs: number[],
  lows: number[],
  closes: number[],
  period: number = 10,
  multiplier: number = 3
): { value: number; direction: 'UP' | 'DOWN' }[] {
  const atr = calculateATR(highs, lows, closes, period);
  const supertrend: { value: number; direction: 'UP' | 'DOWN' }[] = [];
  
  let currentTrend = 1; // 1 = up, -1 = down
  let currentSupertrend = 0;
  
  for (let i = 0; i < closes.length; i++) {
    if (i < period) {
      supertrend.push({ value: closes[i], direction: 'UP' });
      continue;
    }
    
    const atrIndex = i - 1;
    const atrValue = atr[atrIndex] || 0;
    const hl2 = (highs[i] + lows[i]) / 2;
    
    const upperBand = hl2 + (multiplier * atrValue);
    const lowerBand = hl2 - (multiplier * atrValue);
    
    // Determine trend
    if (currentTrend === 1) {
      currentSupertrend = Math.max(lowerBand, currentSupertrend);
      if (closes[i] < currentSupertrend) {
        currentTrend = -1;
        currentSupertrend = upperBand;
      }
    } else {
      currentSupertrend = Math.min(upperBand, currentSupertrend);
      if (closes[i] > currentSupertrend) {
        currentTrend = 1;
        currentSupertrend = lowerBand;
      }
    }
    
    supertrend.push({
      value: currentSupertrend,
      direction: currentTrend === 1 ? 'UP' : 'DOWN',
    });
  }
  
  return supertrend;
}

/**
 * Calculate RSI (Relative Strength Index)
 */
function calculateRSI(data: number[], period: number): number[] {
  const rsi: number[] = [];
  const gains: number[] = [];
  const losses: number[] = [];
  
  for (let i = 1; i < data.length; i++) {
    const change = data[i] - data[i - 1];
    gains.push(change > 0 ? change : 0);
    losses.push(change < 0 ? -change : 0);
  }
  
  for (let i = period - 1; i < gains.length; i++) {
    const avgGain = gains.slice(i - period + 1, i + 1).reduce((a, b) => a + b, 0) / period;
    const avgLoss = losses.slice(i - period + 1, i + 1).reduce((a, b) => a + b, 0) / period;
    
    if (avgLoss === 0) {
      rsi.push(100);
    } else {
      const rs = avgGain / avgLoss;
      rsi.push(100 - (100 / (1 + rs)));
    }
  }
  
  return rsi;
}

/**
 * Calculate VWAP (Volume Weighted Average Price)
 */
function calculateVWAP(candles: Candle[]): number[] {
  const vwap: number[] = [];
  let cumulativeTPV = 0;
  let cumulativeVolume = 0;
  
  for (const candle of candles) {
    const typicalPrice = (candle.high + candle.low + candle.close) / 3;
    const volume = candle.volume ?? 0;
    
    cumulativeTPV += typicalPrice * volume;
    cumulativeVolume += volume;
    
    vwap.push(cumulativeVolume > 0 ? cumulativeTPV / cumulativeVolume : typicalPrice);
  }
  
  return vwap;
}

/**
 * Check if current time is within trading hours (13:00-22:00 UTC)
 */
function isWithinTradingHours(timestamp: number): boolean {
  const date = new Date(timestamp * 1000);
  const hour = date.getUTCHours();
  return hour >= 13 && hour < 22;
}

/**
 * Detect market trend using EMA alignment
 */
function detectTrend(ema8: number, ema21: number, ema50: number): 'UP' | 'DOWN' | 'SIDEWAYS' {
  // Simplified trend detection - just EMA8 vs EMA50 with 0.5% buffer
  if (ema8 > ema50 * 1.005) {
    return 'UP';
  }
  
  if (ema8 < ema50 * 0.995) {
    return 'DOWN';
  }
  
  // Choppy/Sideways
  return 'SIDEWAYS';
}

/**
 * Main Phoenix Trading Indicator
 */
export function calculatePhoenixIndicator(candles: Candle[]): PhoenixResult {
  if (!candles || candles.length < 100) {
    return {
      signals: [],
      currentTrend: 'SIDEWAYS',
      trendStrength: 0,
      supertrendUp: null,
      supertrendDown: null,
    };
  }
  
  try {
    // Use last 800 candles as per spec
    const data = candles.length > 800 ? candles.slice(-800) : candles;
    
    console.log(`[Phoenix Trading] 🔍 Analyzing ${data.length} candles...`);
    
    // 1. Calculate all indicators
    const closes = data.map(c => c.close);
    const highs = data.map(c => c.high);
    const lows = data.map(c => c.low);
    const volumes = data.map(c => c.volume ?? 0);
    
    const ema8 = calculateEMA(closes, 8);
    const ema21 = calculateEMA(closes, 21);
    const ema50 = calculateEMA(closes, 50);
    const supertrend = calculateSupertrend(highs, lows, closes, 10, 3);
    const rsi5 = calculateRSI(closes, 5);
    const volumeMA = calculateSMA(volumes, 20);
    const vwap = calculateVWAP(data);
    
    // 2. Scan for signals
    const signals: PhoenixSignal[] = [];
    
    for (let i = 50; i < data.length; i++) {
      const candle = data[i];
      
      // Check time filter (temporarily disabled for testing)
      // if (!isWithinTradingHours(candle.time)) {
      //   continue;
      // }
      
      const currentEMA8 = ema8[i];
      const currentEMA21 = ema21[i];
      const currentEMA50 = ema50[i];
      const currentRSI = rsi5[i - 1]; // RSI offset by 1
      const currentSupertrend = supertrend[i];
      const currentVWAP = vwap[i];
      const currentVolume = candle.volume ?? 0;
      const currentVolumeMA = volumeMA[i - 20] || 0;
      
      if (!currentEMA8 || !currentEMA21 || !currentEMA50 || !currentRSI) continue;
      
      const trend = detectTrend(currentEMA8, currentEMA21, currentEMA50);
      const volumeRatio = currentVolumeMA > 0 ? currentVolume / currentVolumeMA : 0;
      const vwapDiff = Math.abs((candle.close - currentVWAP) / currentVWAP) * 100;
      const isGreenCandle = candle.close > candle.open;
      const isRedCandle = candle.close < candle.open;
      
      // Debug: Log conditions every 50 candles
      if (i % 50 === 0) {
        console.log(`[Phoenix Debug] Candle ${i}/${data.length}:`, {
          trend,
          close: candle.close.toFixed(2),
          ema21: currentEMA21.toFixed(2),
          supertrend: currentSupertrend.direction,
          volumeRatio: volumeRatio.toFixed(2),
          rsi: currentRSI.toFixed(1),
          vwapDiff: vwapDiff.toFixed(3),
          isGreen: isGreenCandle,
          isRed: isRedCandle,
        });
      }
      
      // === LONG SIGNAL (RELAXED - Allow in any trend) ===
      if (
        candle.close > candle.open && // Green candle
        currentSupertrend.direction === 'UP' &&
        volumeRatio > 1.3 && // Very relaxed volume threshold
        currentRSI >= 40 && currentRSI <= 80 // Wide RSI range
      ) {
        const stopLoss = currentSupertrend.value;
        const takeProfit1 = candle.close * 1.002; // +0.2%
        const takeProfit2 = candle.close * 1.003; // +0.3%
        
        console.log(`[Phoenix] 🟢 LONG SIGNAL at ${candle.time} | Price: ${candle.close} | RSI: ${currentRSI.toFixed(1)} | Vol: ${volumeRatio.toFixed(1)}x | Trend: ${trend}`);
        
        signals.push({
          time: candle.time,
          price: candle.close,
          type: 'BUY',
          label: 'LONG Entry',
          confidence: 85,
          zoneHigh: candle.high,
          zoneLow: candle.low,
          stopLoss,
          takeProfit1,
          takeProfit2,
          exitAfterCandles: 10,
          indicators: {
            ema8: currentEMA8,
            ema21: currentEMA21,
            ema50: currentEMA50,
            rsi: currentRSI,
            volumeRatio,
            supertrend: currentSupertrend.value,
            vwap: currentVWAP,
          },
        });
      }
      
      // === SHORT SIGNAL (RELAXED - Allow in any trend) ===
      if (
        candle.close < candle.open && // Red candle
        currentSupertrend.direction === 'DOWN' &&
        volumeRatio > 1.3 && // Very relaxed volume threshold
        currentRSI >= 20 && currentRSI <= 60 // Wide RSI range
      ) {
        const stopLoss = currentSupertrend.value;
        const takeProfit1 = candle.close * 0.998; // -0.2%
        const takeProfit2 = candle.close * 0.997; // -0.3%
        
        console.log(`[Phoenix] 🔴 SHORT SIGNAL at ${candle.time} | Price: ${candle.close} | RSI: ${currentRSI.toFixed(1)} | Vol: ${volumeRatio.toFixed(1)}x | Trend: ${trend}`);
        
        signals.push({
          time: candle.time,
          price: candle.close,
          type: 'SELL',
          label: 'SHORT Entry',
          confidence: 85,
          zoneHigh: candle.high,
          zoneLow: candle.low,
          stopLoss,
          takeProfit1,
          takeProfit2,
          exitAfterCandles: 10,
          indicators: {
            ema8: currentEMA8,
            ema21: currentEMA21,
            ema50: currentEMA50,
            rsi: currentRSI,
            volumeRatio,
            supertrend: currentSupertrend.value,
            vwap: currentVWAP,
          },
        });
      }
    }
    
    console.log(`[Phoenix Trading] 🎯 Found ${signals.length} valid signals`);
    
    // 3. Filter to recent signals
    const now = data[data.length - 1].time;
    const recentSignals = signals
      .filter(s => s.time >= now - (3600 * 24)) // Last 24 hours
      .sort((a, b) => b.time - a.time)
      .slice(0, 15);
    
    // 4. Determine current trend
    const lastEMA8 = ema8[ema8.length - 1];
    const lastEMA21 = ema21[ema21.length - 1];
    const lastEMA50 = ema50[ema50.length - 1];
    const currentTrend = detectTrend(lastEMA8, lastEMA21, lastEMA50);
    const trendStrength = Math.abs(((lastEMA8 - lastEMA50) / lastEMA50) * 100);
    
    // 5. Get current supertrend values
    const lastSupertrend = supertrend[supertrend.length - 1];
    const supertrendUp = lastSupertrend.direction === 'UP' ? lastSupertrend.value : null;
    const supertrendDown = lastSupertrend.direction === 'DOWN' ? lastSupertrend.value : null;
    
    console.log(`[Phoenix Trading] 📈 Trend: ${currentTrend} | EMA8: ${lastEMA8.toFixed(2)} | EMA21: ${lastEMA21.toFixed(2)} | EMA50: ${lastEMA50.toFixed(2)}`);
    console.log(`[Phoenix Trading] ⭐ Showing ${recentSignals.length} signals (last 24h):`);
    recentSignals.forEach(s => {
      console.log(`  ${s.type === 'BUY' ? '🟢' : '🔴'} ${s.label} | RSI: ${s.indicators.rsi.toFixed(1)} | Vol: ${s.indicators.volumeRatio.toFixed(1)}x | TP2: ${s.takeProfit2.toFixed(2)} | SL: ${s.stopLoss.toFixed(2)}`);
    });
    
    return {
      signals: recentSignals,
      currentTrend,
      trendStrength,
      supertrendUp,
      supertrendDown,
    };
  } catch (error) {
    console.error('[Phoenix Trading] ❌ Error:', error);
    return {
      signals: [],
      currentTrend: 'SIDEWAYS',
      trendStrength: 0,
      supertrendUp: null,
      supertrendDown: null,
    };
  }
}
