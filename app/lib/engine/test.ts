/**
 * Test file for Deep Market Structure Engine
 * Run with: npx tsx app/lib/engine/test.ts
 */

import { runDeepAnalysis, Candle } from './index';

/**
 * Generate mock candles with realistic price movement
 */
function generateMockCandles(count: number): Candle[] {
  const candles: Candle[] = [];
  let price = 50000; // Starting price
  const baseTime = Date.now() - (count * 60000); // 1 minute intervals

  for (let i = 0; i < count; i++) {
    // Simulate price movement with some volatility
    const volatility = 0.02; // 2% volatility
    const trend = Math.sin(i / 50) * 0.01; // Slow trend
    const noise = (Math.random() - 0.5) * volatility;
    
    const change = price * (trend + noise);
    const open = price;
    const close = price + change;
    const high = Math.max(open, close) * (1 + Math.random() * 0.005);
    const low = Math.min(open, close) * (1 - Math.random() * 0.005);
    const volume = 1000000 + Math.random() * 500000;
    const time = baseTime + (i * 60000);

    candles.push({
      open,
      high,
      low,
      close,
      volume,
      time
    });

    price = close; // Next candle starts where this one closed
  }

  return candles;
}

/**
 * Run test with 500 candles
 */
function runTest() {
  console.log('🧪 Testing Deep Market Structure Engine\n');
  console.log('=' .repeat(50));
  
  // Generate 500 mock candles
  console.log('📊 Generating 500 mock candles...');
  const candles = generateMockCandles(500);
  console.log(`✅ Generated ${candles.length} candles`);
  console.log(`   First candle: $${candles[0].close.toFixed(2)}`);
  console.log(`   Last candle: $${candles[candles.length - 1].close.toFixed(2)}`);
  console.log('');

  // Run deep analysis
  console.log('🔍 Running deep analysis...');
  const startTime = Date.now();
  const result = runDeepAnalysis(candles);
  const endTime = Date.now();
  const duration = endTime - startTime;

  console.log(`✅ Analysis completed in ${duration}ms\n`);
  console.log('=' .repeat(50));
  console.log('📈 ANALYSIS RESULTS');
  console.log('=' .repeat(50));
  console.log(`Structure: ${result.structure}`);
  console.log(`Regime: ${result.regime}`);
  console.log(`Impulse Score: ${result.impulseScore.toFixed(2)}/100`);
  console.log(`Confidence: ${result.confidence.toFixed(2)}/100`);
  console.log(`Pivots Detected: ${result.pivots.length}`);
  console.log('');

  // Show pivot details
  if (result.pivots.length > 0) {
    console.log('📍 PIVOT POINTS (Last 10):');
    console.log('-'.repeat(50));
    const lastPivots = result.pivots.slice(-10);
    lastPivots.forEach((pivot, idx) => {
      const candle = candles[pivot.index];
      console.log(`${idx + 1}. ${pivot.type} @ $${pivot.price.toFixed(2)} (Index: ${pivot.index}, Time: ${new Date(pivot.time).toISOString()})`);
    });
    console.log('');
  }

  // Validation
  console.log('=' .repeat(50));
  console.log('✅ VALIDATION');
  console.log('=' .repeat(50));
  
  const validations = [
    { name: 'Result is object', pass: typeof result === 'object' && result !== null },
    { name: 'Structure is valid', pass: ['Bullish', 'Bearish', 'Range'].includes(result.structure) },
    { name: 'Regime is valid', pass: ['EXPANSION', 'COMPRESSION', 'TREND', 'RANGE'].includes(result.regime) },
    { name: 'Impulse score in range', pass: result.impulseScore >= 0 && result.impulseScore <= 100 },
    { name: 'Confidence in range', pass: result.confidence >= 0 && result.confidence <= 100 },
    { name: 'Pivots is array', pass: Array.isArray(result.pivots) },
    { name: 'Pivots have correct structure', pass: result.pivots.every(p => 
      p.type === 'HIGH' || p.type === 'LOW' &&
      typeof p.price === 'number' &&
      typeof p.index === 'number' &&
      typeof p.time === 'number'
    )},
  ];

  let allPassed = true;
  validations.forEach(v => {
    const status = v.pass ? '✅' : '❌';
    console.log(`${status} ${v.name}`);
    if (!v.pass) allPassed = false;
  });

  console.log('');
  if (allPassed) {
    console.log('🎉 ALL TESTS PASSED!');
  } else {
    console.log('⚠️  SOME TESTS FAILED');
  }

  return { result, allPassed };
}

// Run test if executed directly
if (require.main === module) {
  runTest();
}

export { runTest, generateMockCandles };
