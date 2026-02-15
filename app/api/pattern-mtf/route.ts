import { NextRequest, NextResponse } from 'next/server';
import { analyzeMTFPatterns } from '../../lib/indicators/patternRecognitionMTF';
import { Candle } from '../../lib/binance';

/**
 * Multi-Timeframe Pattern Analysis API
 * 
 * POST /api/pattern-mtf
 * Body: { symbol: string, timeframe: string, candles: Candle[] }
 * 
 * Returns: MTFPatternAnalysis with confluence scoring
 */

export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const { symbol, timeframe, candles } = body;

    if (!symbol || !timeframe || !candles || !Array.isArray(candles)) {
      return NextResponse.json(
        { error: 'Missing symbol, timeframe, or candles array' },
        { status: 400 }
      );
    }

    // Validate timeframe
    const validTimeframes = ['1m', '5m', '15m', '1h', '4h', '1d'];
    if (!validTimeframes.includes(timeframe)) {
      return NextResponse.json(
        { error: 'Invalid timeframe' },
        { status: 400 }
      );
    }

    // Analyze multi-timeframe patterns
    const analysis = await analyzeMTFPatterns(candles, symbol, timeframe);

    return NextResponse.json(analysis);
  } catch (error: any) {
    console.error('MTF pattern analysis error:', error);
    return NextResponse.json(
      { error: error.message || 'Internal server error' },
      { status: 500 }
    );
  }
}
