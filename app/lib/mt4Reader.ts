/**
 * MT4 Indicator Reader Utility
 * 
 * NOTE: Reading .ex4 (compiled) files is extremely difficult because:
 * 1. They are compiled binary files (not human-readable)
 * 2. Proprietary format (MetaQuotes)
 * 3. Reverse engineering is complex and may have legal issues
 * 
 * ALTERNATIVES:
 * 1. If you have .mq4 source files → We can read and parse those
 * 2. If you know the indicator logic → We can re-implement in TypeScript
 * 3. If you have indicator documentation → We can build from specs
 * 
 * This utility provides functions to work with MT4 indicators in various ways.
 */

import { Candle } from './indicators/types';

/**
 * Attempt to read .mq4 source file (if provided)
 * MQ4 files are text-based and can be parsed
 */
export async function readMQ4File(file: File): Promise<string | null> {
  try {
    const text = await file.text();
    
    // Basic validation - check if it looks like MQ4 code
    if (text.includes('#property') || text.includes('int OnInit()') || text.includes('int OnCalculate')) {
      return text;
    }
    
    console.warn('File does not appear to be a valid .mq4 file');
    return null;
  } catch (error) {
    console.error('Error reading MQ4 file:', error);
    return null;
  }
}

/**
 * Parse MQ4 source code to extract indicator logic
 * This is a basic parser - may need enhancement for complex indicators
 */
export function parseMQ4Code(mq4Code: string): {
  indicatorName: string;
  inputs: Record<string, any>;
  buffers: string[];
  logic: string;
} | null {
  try {
    // Extract indicator name
    const nameMatch = mq4Code.match(/#property\s+indicator_short_name\s+"([^"]+)"/i);
    const indicatorName = nameMatch ? nameMatch[1] : 'Unknown';
    
    // Extract input parameters
    const inputs: Record<string, any> = {};
    const inputMatches = mq4Code.matchAll(/input\s+(\w+)\s+(\w+)\s*=\s*([^;]+);/gi);
    for (const match of inputMatches) {
      const type = match[1];
      const name = match[2];
      const defaultValue = match[3].trim();
      inputs[name] = { type, defaultValue };
    }
    
    // Extract buffer names
    const buffers: string[] = [];
    const bufferMatches = mq4Code.matchAll(/SetIndexBuffer\(\s*(\d+),\s*(\w+)\s*\)/gi);
    for (const match of bufferMatches) {
      buffers.push(match[2]);
    }
    
    // Extract OnCalculate logic
    const onCalculateMatch = mq4Code.match(/int\s+OnCalculate[^{]*\{([\s\S]*?)\n\s*return\s+\d+;/);
    const logic = onCalculateMatch ? onCalculateMatch[1] : '';
    
    return {
      indicatorName,
      inputs,
      buffers,
      logic
    };
  } catch (error) {
    console.error('Error parsing MQ4 code:', error);
    return null;
  }
}

/**
 * Convert MT4 indicator logic to TypeScript function
 * This is a helper to guide manual conversion
 */
export function generateTypeScriptStub(
  indicatorName: string,
  inputs: Record<string, any>,
  logic: string
): string {
  const inputParams = Object.entries(inputs)
    .map(([name, config]: [string, any]) => {
      const tsType = config.type === 'int' ? 'number' : 
                     config.type === 'double' ? 'number' : 
                     config.type === 'string' ? 'string' : 'any';
      return `  ${name}: ${tsType} = ${config.defaultValue}`;
    })
    .join(',\n');
  
  return `
/**
 * ${indicatorName} - Converted from MT4
 * TODO: Implement the logic from MT4 OnCalculate function
 */
export function calculate${indicatorName.replace(/\s+/g, '')}(
  candles: Candle[],
${inputParams}
): any[] {
  // TODO: Convert MT4 logic to TypeScript
  // Original logic:
  /*
  ${logic}
  */
  
  // Placeholder implementation
  return [];
}
`;
}

/**
 * Attempt to read .ex4 file (compiled binary)
 * WARNING: This is extremely difficult and may not work
 * .ex4 files are compiled binaries with proprietary format
 */
export async function attemptReadEX4(file: File): Promise<{
  success: boolean;
  message: string;
  data?: any;
}> {
  try {
    const arrayBuffer = await file.arrayBuffer();
    const bytes = new Uint8Array(arrayBuffer);
    
    // Check file signature (basic validation)
    // MT4 .ex4 files typically start with specific bytes
    if (bytes.length < 100) {
      return {
        success: false,
        message: 'File too small to be a valid .ex4 file'
      };
    }
    
    // Try to find readable strings in the binary
    const strings: string[] = [];
    let currentString = '';
    
    for (let i = 0; i < bytes.length; i++) {
      const byte = bytes[i];
      // ASCII printable range
      if (byte >= 32 && byte <= 126) {
        currentString += String.fromCharCode(byte);
      } else {
        if (currentString.length > 4) {
          strings.push(currentString);
        }
        currentString = '';
      }
    }
    
    // Look for indicator name or other readable info
    const indicatorName = strings.find(s => 
      s.includes('indicator') || 
      s.length > 10 && s.length < 50
    );
    
    return {
      success: false,
      message: '.ex4 files are compiled binaries. Cannot extract logic directly. Please provide .mq4 source file instead.',
      data: {
        fileSize: bytes.length,
        foundStrings: strings.slice(0, 20), // First 20 strings
        indicatorName: indicatorName || 'Not found'
      }
    };
  } catch (error) {
    return {
      success: false,
      message: `Error reading .ex4 file: ${error instanceof Error ? error.message : 'Unknown error'}`
    };
  }
}

/**
 * Main function to handle MT4 indicator files
 * Supports both .mq4 (source) and .ex4 (compiled) files
 */
export async function processMT4Indicator(file: File): Promise<{
  success: boolean;
  type: 'mq4' | 'ex4' | 'unknown';
  data?: any;
  message: string;
  typescriptStub?: string;
}> {
  const fileName = file.name.toLowerCase();
  
  if (fileName.endsWith('.mq4')) {
    // Read and parse .mq4 source file
    const mq4Code = await readMQ4File(file);
    if (!mq4Code) {
      return {
        success: false,
        type: 'mq4',
        message: 'Failed to read .mq4 file'
      };
    }
    
    const parsed = parseMQ4Code(mq4Code);
    if (!parsed) {
      return {
        success: false,
        type: 'mq4',
        message: 'Failed to parse .mq4 file'
      };
    }
    
    const typescriptStub = generateTypeScriptStub(
      parsed.indicatorName,
      parsed.inputs,
      parsed.logic
    );
    
    return {
      success: true,
      type: 'mq4',
      message: 'Successfully parsed .mq4 file',
      data: parsed,
      typescriptStub
    };
  } else if (fileName.endsWith('.ex4')) {
    // Attempt to read .ex4 (will likely fail, but provide helpful message)
    const result = await attemptReadEX4(file);
    return {
      success: result.success,
      type: 'ex4',
      message: result.message,
      data: result.data
    };
  } else {
    return {
      success: false,
      type: 'unknown',
      message: 'Unknown file type. Please provide .mq4 or .ex4 file'
    };
  }
}

/**
 * Helper to convert MT4 indicator parameters to our format
 */
export function convertMT4ToOurFormat(
  mt4Data: any,
  candles: Candle[]
): {
  indicator: string;
  parameters: Record<string, any>;
  candles: Candle[];
} {
  return {
    indicator: mt4Data.indicatorName || 'Unknown',
    parameters: mt4Data.inputs || {},
    candles
  };
}
