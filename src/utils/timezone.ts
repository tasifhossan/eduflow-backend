/**
 * Converts a date string (YYYY-MM-DD) and a local time string (HH:MM or HH:MM:SS)
 * into a UTC Date object using the specified IANA timezone, correctly handling
 * daylight saving shifts and non-DST regions using standard Intl (zero external packages).
 */
export function localTimeToUtc(
  dateStr: string, // YYYY-MM-DD
  timeStr: string, // HH:MM or HH:MM:SS
  timeZone: string
): Date {
  const [yearStr, monthStr, dayStr] = dateStr.split('-');
  const [hourStr, minStr, secStr] = timeStr.split(':');

  const year = parseInt(yearStr, 10);
  const month = parseInt(monthStr, 10);
  const day = parseInt(dayStr, 10);
  const hour = parseInt(hourStr, 10);
  const minute = parseInt(minStr, 10);
  const second = secStr ? parseInt(secStr, 10) : 0;

  // Initial estimate assuming UTC
  const utcTime = Date.UTC(year, month - 1, day, hour, minute, second);

  const formatter = new Intl.DateTimeFormat('en-US', {
    timeZone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hour12: false,
  });

  const parts = formatter.formatToParts(new Date(utcTime));
  const partMap: Record<string, number> = {};
  for (const p of parts) {
    if (p.type !== 'literal') {
      partMap[p.type] = parseInt(p.value, 10);
    }
  }

  if (partMap.hour === 24) partMap.hour = 0;

  const localUtc = Date.UTC(
    partMap.year,
    partMap.month - 1,
    partMap.day,
    partMap.hour,
    partMap.minute,
    partMap.second
  );

  const offsetMs = localUtc - utcTime;
  const targetUtcTime = utcTime - offsetMs;

  return new Date(targetUtcTime);
}
