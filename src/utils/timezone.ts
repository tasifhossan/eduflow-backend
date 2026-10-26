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

export function getZonedDateParts(date: Date, timeZone: string) {
  const formatter = new Intl.DateTimeFormat('en-US', {
    timeZone,
    year: 'numeric',
    month: 'numeric',
    day: 'numeric',
    weekday: 'short',
    hour: 'numeric',
    minute: 'numeric',
    second: 'numeric',
    hour12: false,
  });
  const parts = formatter.formatToParts(date);
  const partMap: Record<string, string> = {};
  for (const p of parts) {
    if (p.type !== 'literal') {
      partMap[p.type] = p.value;
    }
  }
  const year = parseInt(partMap.year, 10);
  const month = parseInt(partMap.month, 10);
  const day = parseInt(partMap.day, 10);
  const weekdayStr = partMap.weekday; // 'Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'
  const weekdayMap: Record<string, number> = {
    Sun: 0,
    Mon: 1,
    Tue: 2,
    Wed: 3,
    Thu: 4,
    Fri: 5,
    Sat: 6,
  };
  const dayOfWeek = weekdayMap[weekdayStr] ?? 0;
  return { year, month, day, dayOfWeek };
}

export function getAcademicDateRanges(now: Date, timeZone: string, weekStartsOn: number = 6) {
  const { year, month, day, dayOfWeek } = getZonedDateParts(now, timeZone);
  const monthStr = String(month).padStart(2, '0');
  const dayStr = String(day).padStart(2, '0');

  const todayStart = localTimeToUtc(`${year}-${monthStr}-${dayStr}`, '00:00:00', timeZone);
  const todayEnd = new Date(todayStart.getTime() + 24 * 60 * 60 * 1000 - 1);

  const diff = (dayOfWeek - weekStartsOn + 7) % 7;
  const startDayObj = new Date(Date.UTC(year, month - 1, day - diff));
  const sYear = startDayObj.getUTCFullYear();
  const sMonth = String(startDayObj.getUTCMonth() + 1).padStart(2, '0');
  const sDay = String(startDayObj.getUTCDate()).padStart(2, '0');

  const weekStart = localTimeToUtc(`${sYear}-${sMonth}-${sDay}`, '00:00:00', timeZone);
  const weekEnd = new Date(weekStart.getTime() + 7 * 24 * 60 * 60 * 1000 - 1);

  return { todayStart, todayEnd, weekStart, weekEnd };
}

