export interface OpeningStatusHours {
  weekday: number;
  opens_at: string | null;
  closes_at: string | null;
  break_starts_at: string | null;
  break_ends_at: string | null;
  is_closed: number;
}

function minutesSinceMidnight(value: string | null): number | null {
  if (!value || !/^([01]\d|2[0-3]):[0-5]\d$/.test(value)) return null;
  const [hours, minutes] = value.split(":").map(Number);
  return hours * 60 + minutes;
}

function localTime(now: Date, timeZone: string): { weekday: number; minute: number } {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone,
    weekday: "short",
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
  }).formatToParts(now);
  const value = (type: Intl.DateTimeFormatPartTypes) => parts.find((part) => part.type === type)?.value;
  const weekday = ({ Sun: 0, Mon: 1, Tue: 2, Wed: 3, Thu: 4, Fri: 5, Sat: 6 } as const)[value("weekday") as "Sun"];
  const hour = Number(value("hour"));
  const minute = Number(value("minute"));

  if (weekday === undefined || !Number.isInteger(hour) || !Number.isInteger(minute)) {
    throw new Error(`Could not determine local time for ${timeZone}.`);
  }
  return { weekday, minute: hour * 60 + minute };
}

function containsTime(target: number, start: number, end: number): boolean {
  return target >= start && target < end;
}

export function openingStatusAt(
  rows: readonly OpeningStatusHours[],
  now: Date,
  timeZone = "Asia/Seoul",
): "open" | "closed" | "unknown" {
  if (rows.length === 0) return "unknown";

  const local = localTime(now, timeZone);
  if (rows.some((row) => row.weekday === local.weekday && row.is_closed === 1)) return "closed";

  const target = local.weekday * 1_440 + local.minute;
  for (const row of rows) {
    if (row.is_closed === 1) continue;
    const opensAt = minutesSinceMidnight(row.opens_at);
    const closesAt = minutesSinceMidnight(row.closes_at);
    if (opensAt === null || closesAt === null) continue;

    const start = row.weekday * 1_440 + opensAt;
    const end = row.weekday * 1_440 + closesAt + (closesAt <= opensAt ? 1_440 : 0);
    for (const weekOffset of [-10_080, 0, 10_080]) {
      if (!containsTime(target, start + weekOffset, end + weekOffset)) continue;

      const breakStartsAt = minutesSinceMidnight(row.break_starts_at);
      const breakEndsAt = minutesSinceMidnight(row.break_ends_at);
      if (breakStartsAt === null || breakEndsAt === null) return "open";
      const breakStart = row.weekday * 1_440 + breakStartsAt + weekOffset;
      const breakEnd = row.weekday * 1_440 + breakEndsAt + (breakEndsAt <= breakStartsAt ? 1_440 : 0) + weekOffset;
      return containsTime(target, breakStart, breakEnd) ? "closed" : "open";
    }
  }
  return "closed";
}
