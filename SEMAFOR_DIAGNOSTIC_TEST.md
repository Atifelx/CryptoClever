# SEMAFOR DIAGNOSTIC TEST - FIND WHY IT FAILS ON SOME SYMBOLS

## Server Status: ✅ RUNNING ON http://localhost:3000

═══════════════════════════════════════════════════════════════════════════════

## DIAGNOSTIC LOGGING ADDED

I've added comprehensive diagnostic logging to the ZigZag algorithm to understand why Semafor works for BTC but fails for TRX and other symbols.

### What the Diagnostic Logs Will Show:

**1. Initial Parameters:**
```
🔍 ZigZag Diagnostic: {
  totalCandles: 500,
  depth: 5,
  deviation: '0.8%',
  backstep: 3,
  avgPrice: '0.28123456',      ← Average price of symbol
  priceRange: '0.02345678',    ← High - Low range
  volatility: '8.34%',         ← Price volatility
  minRequiredMove: '0.00225'   ← Minimum price move needed (deviation * avgPrice)
}
```

**2. Pivot Detection Statistics:**
```
📊 ZigZag Statistics: {
  highChecks: 150,              ← How many potential high pivots found
  highPassed: 12,               ← How many passed deviation+backstep checks
  highPassRate: '8.0%',        ← Success rate
  deviationFailsHigh: 120,      ← Failed due to insufficient deviation
  backstepFailsHigh: 18,        ← Failed due to insufficient backstep
  lowChecks: 145,
  lowPassed: 11,
  lowPassRate: '7.6%',
  deviationFailsLow: 125,
  backstepFailsLow: 9,
  totalPivots: 23,
  highs: 12,
  lows: 11
}
```

### Expected Problem Patterns:

**PROBLEM 1: Deviation Too High for Low-Price Coins**
```
Symbol: TRX (price ~$0.28)
deviation: 0.8%
minRequiredMove: $0.00224

If TRX moves from $0.280 to $0.282:
Actual move: $0.002 (0.71%)
Required move: $0.00224 (0.8%)
Result: ❌ REJECTED (0.71% < 0.8%)
```

**PROBLEM 2: Deviation Too Low for High-Price Coins**
```
Symbol: BTC (price ~$98,000)
deviation: 0.8%
minRequiredMove: $784

If BTC moves from $98,000 to $98,500:
Actual move: $500 (0.51%)
Required move: $784 (0.8%)
Result: ❌ REJECTED (0.51% < 0.8%)
```

═══════════════════════════════════════════════════════════════════════════════

## TESTING INSTRUCTIONS

### 1. Open Browser Console (F12)

### 2. Load BTC/USDT (Known Working Symbol)

**Watch Console For:**
```
🔍 ZigZag Diagnostic: {
  avgPrice: '98234.56',
  priceRange: '3456.78',
  volatility: '3.52%',
  minRequiredMove: '785.88'
}

📊 ZigZag Statistics: {
  highPassRate: 'X.X%',
  lowPassRate: 'X.X%',
  totalPivots: XX,
  deviationFailsHigh: XX,
  deviationFailsLow: XX
}
```

**Record These Values:**
- avgPrice:
- volatility:
- highPassRate:
- lowPassRate:
- totalPivots:
- deviationFails:

### 3. Switch to TRX/USDT (Known Failing Symbol)

**Watch Console For:**
```
🔍 ZigZag Diagnostic: {
  avgPrice: '0.28',
  priceRange: '0.02',
  volatility: 'X.X%',
  minRequiredMove: '0.00224'
}

📊 ZigZag Statistics: {
  highPassRate: 'X.X%',      ← Probably very low!
  lowPassRate: 'X.X%',        ← Probably very low!
  totalPivots: X,             ← Probably 0-5
  deviationFailsHigh: XXX,    ← Probably very high!
  deviationFailsLow: XXX      ← Probably very high!
}
```

**Record These Values:**
- avgPrice:
- volatility:
- highPassRate:
- lowPassRate:
- totalPivots:
- deviationFails:

### 4. Test ETH/USDT (Medium Price)

**Record same values**

### 5. Test DOGE/USDT (Very Low Price ~$0.08)

**Record same values**

═══════════════════════════════════════════════════════════════════════════════

## EXPECTED FINDINGS

### Hypothesis 1: Fixed Deviation % Doesn't Work Across Price Ranges

**Current Fixed Values:**
```typescript
'1m':  { depth: 5,  deviation: 0.8,  backstep: 3 }
```

**Problem:**
- 0.8% of $98,000 (BTC) = $784 move required
- 0.8% of $0.28 (TRX) = $0.00224 move required
- 0.8% of $0.08 (DOGE) = $0.00064 move required

**Reality:**
- TRX typically moves in $0.001-$0.002 steps
- DOGE typically moves in $0.0005-$0.001 steps
- Fixed 0.8% is TOO HIGH for low-price coins!

### Hypothesis 2: Volatility-Based Parameters Needed

**Solution:**
Instead of fixed 0.8%, use volatility-adjusted deviation:
```typescript
function getAdaptiveParameters(timeframe, candles) {
  const volatility = calculateVolatility(candles);
  
  if (volatility < 2%) {
    // Low volatility: tighter parameters
    deviation = 0.3;
  } else if (volatility < 5%) {
    // Medium volatility
    deviation = 0.5;
  } else {
    // High volatility: looser parameters
    deviation = 0.8;
  }
}
```

═══════════════════════════════════════════════════════════════════════════════

## TESTING CHECKLIST

**For EACH Symbol (BTC, TRX, ETH, DOGE):**

1. ✓ Load symbol
2. ✓ Open console (F12)
3. ✓ Find "🔍 ZigZag Diagnostic" log
4. ✓ Record: avgPrice, volatility, minRequiredMove
5. ✓ Find "📊 ZigZag Statistics" log
6. ✓ Record: totalPivots, passRates, deviationFails
7. ✓ Count circles on chart
8. ✓ Compare with log numbers

**Fill This Table:**

| Symbol | avgPrice | volatility | minMove | totalPivots | passRate | circles |
|--------|----------|------------|---------|-------------|----------|---------|
| BTC    |          |            |         |             |          |         |
| TRX    |          |            |         |             |          |         |
| ETH    |          |            |         |             |          |         |
| DOGE   |          |            |         |             |          |         |

**Expected Results:**
- BTC: High totalPivots (20-30), good passRate (5-10%), many circles
- TRX: Low totalPivots (0-5), poor passRate (<2%), few/no circles
- Pattern: Lower price = fewer pivots = deviation too strict

═══════════════════════════════════════════════════════════════════════════════

## ONCE YOU HAVE THE DATA

**Share console logs showing:**

1. **BTC Diagnostic:**
   ```
   🔍 ZigZag Diagnostic: { ... }
   📊 ZigZag Statistics: { ... }
   ```

2. **TRX Diagnostic:**
   ```
   🔍 ZigZag Diagnostic: { ... }
   📊 ZigZag Statistics: { ... }
   ```

3. **Comparison:**
   - What's different between BTC and TRX?
   - Is deviationFails much higher for TRX?
   - Is passRate much lower for TRX?
   - Is volatility different?

**Then I can apply the correct fix based on real data!**

═══════════════════════════════════════════════════════════════════════════════

## NEXT STEPS FOR ME

**Once you provide the diagnostic data, I will:**

1. **If deviation is the problem:**
   - Implement dynamic deviation based on price/volatility
   - Use ATR (Average True Range) for adaptive parameters
   - Test with all symbols

2. **If depth is the problem:**
   - Adjust depth based on volatility
   - Higher volatility = larger depth

3. **If backstep is the problem:**
   - Make backstep relative to volatility

4. **Likely Fix (Prediction):**
   ```typescript
   function getAdaptiveParameters(timeframe, candles) {
     // Calculate volatility from recent candles
     const volatility = calculateVolatility(candles);
     
     // Base parameters
     const params = baseParams[timeframe];
     
     // Adjust deviation based on volatility
     if (volatility < 3%) {
       params.deviation = 0.3; // Tight for low volatility
     } else if (volatility < 6%) {
       params.deviation = 0.5;
     } else {
       params.deviation = 0.8;
     }
     
     return params;
   }
   ```

═══════════════════════════════════════════════════════════════════════════════

**DIAGNOSTIC LOGGING IS READY!**

**Hard refresh browser (Cmd+Shift+R), then test BTC and TRX and share the console logs!**

Last Updated: 2026-02-15
Status: ✅ DIAGNOSTIC LOGGING ADDED, WAITING FOR TEST RESULTS
