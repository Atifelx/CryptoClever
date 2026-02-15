/**
 * Time utility functions for Indian Standard Time (IST - GMT+5:30)
 */

/**
 * Convert UTC timestamp to IST (Indian Standard Time)
 * @param timestamp Unix timestamp in seconds
 * @returns Date object in IST
 */
export function toIST(timestamp: number): Date {
  const utcDate = new Date(timestamp * 1000);
  // IST is UTC+5:30
  const istOffset = 5.5 * 60 * 60 * 1000; // 5 hours 30 minutes in milliseconds
  return new Date(utcDate.getTime() + istOffset);
}

/**
 * Format timestamp to IST time string
 * @param timestamp Unix timestamp in seconds
 * @param format 'time' | 'date' | 'datetime'
 * @returns Formatted string in IST
 */
export function formatIST(timestamp: number, format: 'time' | 'date' | 'datetime' = 'datetime'): string {
  const istDate = toIST(timestamp);
  
  const hours = istDate.getUTCHours().toString().padStart(2, '0');
  const minutes = istDate.getUTCMinutes().toString().padStart(2, '0');
  const day = istDate.getUTCDate().toString().padStart(2, '0');
  const month = (istDate.getUTCMonth() + 1).toString().padStart(2, '0');
  const year = istDate.getUTCFullYear();
  
  if (format === 'time') {
    return `${hours}:${minutes}`;
  } else if (format === 'date') {
    return `${day}/${month}/${year}`;
  } else {
    return `${day}/${month}/${year} ${hours}:${minutes}`;
  }
}

/**
 * Get current IST time
 */
export function getCurrentIST(): Date {
  return toIST(Math.floor(Date.now() / 1000));
}
