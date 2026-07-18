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

type Interval = {
  row: OpeningStatusHours;
  opensAt: number;
  endsAt: number;
  breakStartsAt: number | null;
  breakEndsAt: number | null;
};

type DaySchedule = { closed: boolean; intervals: Interval[] } | null;

function intervalFor(row: OpeningStatusHours): Interval | "closed" | null {
  if (row.is_closed === 1) return "closed";
  if (row.is_closed !== 0) return null;

  const opensAt = minutesSinceMidnight(row.opens_at);
  const closesAt = minutesSinceMidnight(row.closes_at);
  if (opensAt === null || closesAt === null || opensAt === closesAt) return null;
  const endsAt = closesAt + (closesAt < opensAt ? 1_440 : 0);

  const hasBreakStart = row.break_starts_at !== null;
  const hasBreakEnd = row.break_ends_at !== null;
  if (hasBreakStart !== hasBreakEnd) return null;
  if (!hasBreakStart) return { row, opensAt, endsAt, breakStartsAt: null, breakEndsAt: null };

  const breakStartsAt = minutesSinceMidnight(row.break_starts_at);
  const breakEndsAt = minutesSinceMidnight(row.break_ends_at);
  if (breakStartsAt === null || breakEndsAt === null || breakStartsAt === breakEndsAt) return null;
  const normalizedBreakStart = breakStartsAt < opensAt ? breakStartsAt + 1_440 : breakStartsAt;
  const normalizedBreakEnd = breakEndsAt <= normalizedBreakStart ? breakEndsAt + 1_440 : breakEndsAt;
  if (normalizedBreakStart < opensAt || normalizedBreakStart >= normalizedBreakEnd || normalizedBreakEnd > endsAt) return null;
  return { row, opensAt, endsAt, breakStartsAt: normalizedBreakStart, breakEndsAt: normalizedBreakEnd };
}

function daySchedule(rows: readonly OpeningStatusHours[]): DaySchedule {
  let closed = false;
  const intervals: Interval[] = [];
  for (const row of rows) {
    const parsed = intervalFor(row);
    if (parsed === null) return null;
    if (parsed === "closed") closed = true;
    else intervals.push(parsed);
  }
  return closed && intervals.length > 0 ? null : { closed, intervals };
}

export function openingStatusAt(
  rows: readonly OpeningStatusHours[],
  now: Date,
  timeZone = "Asia/Seoul",
): "open" | "closed" | "unknown" {
  if (rows.length === 0) return "unknown";

  const local = localTime(now, timeZone);
  const today = daySchedule(rows.filter((row) => row.weekday === local.weekday));
  const yesterday = daySchedule(rows.filter((row) => row.weekday === (local.weekday + 6) % 7));
  if (!today || !yesterday) return "unknown";
  if (today.closed) return "closed";

  const target = local.weekday * 1_440 + local.minute;
  const intervals = [
    ...today.intervals,
    ...yesterday.intervals.filter((interval) => interval.endsAt > 1_440),
  ];
  let open = false;
  for (const interval of intervals) {
    const { row, opensAt, endsAt, breakStartsAt, breakEndsAt } = interval;

    const start = row.weekday * 1_440 + opensAt;
    const end = row.weekday * 1_440 + endsAt;
    for (const weekOffset of [-10_080, 0, 10_080]) {
      if (!containsTime(target, start + weekOffset, end + weekOffset)) continue;

      if (breakStartsAt === null || breakEndsAt === null) {
        open = true;
        continue;
      }
      const breakStart = row.weekday * 1_440 + breakStartsAt + weekOffset;
      const breakEnd = row.weekday * 1_440 + breakEndsAt + weekOffset;
      if (!containsTime(target, breakStart, breakEnd)) open = true;
    }
  }
  return open ? "open" : "closed";
}
