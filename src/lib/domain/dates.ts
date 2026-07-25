import {
  addDays,
  addMonths,
  differenceInCalendarDays,
  endOfMonth,
  format,
  parseISO,
  startOfMonth,
} from "date-fns";

/**
 * All ledger dates are ISO calendar dates (YYYY-MM-DD) interpreted in the host's
 * local timezone — a personal-finance ledger has no meaningful notion of UTC
 * "days", and self-hosters run one process in one place.
 */

export type ISODate = string; // YYYY-MM-DD
export type Period = string; // YYYY-MM

export function toISODate(d: Date): ISODate {
  return format(d, "yyyy-MM-dd");
}

export function parseISODate(d: ISODate): Date {
  return parseISO(d);
}

export function todayISO(): ISODate {
  return toISODate(new Date());
}

export function nowISO(): string {
  return new Date().toISOString();
}

export function periodOf(date: ISODate): Period {
  return date.slice(0, 7);
}

export function periodStart(period: Period): ISODate {
  return `${period}-01`;
}

export function periodEnd(period: Period): ISODate {
  return toISODate(endOfMonth(parseISO(periodStart(period))));
}

export function periodRange(period: Period): { from: ISODate; to: ISODate } {
  return { from: periodStart(period), to: periodEnd(period) };
}

export function addPeriods(period: Period, n: number): Period {
  return format(addMonths(parseISO(periodStart(period)), n), "yyyy-MM");
}

export function previousPeriod(period: Period): Period {
  return addPeriods(period, -1);
}

export function daysInPeriod(period: Period): number {
  return Number(periodEnd(period).slice(8));
}

/** "July" — for insight copy that reads like a sentence. */
export function periodLabel(period: Period): string {
  return format(parseISO(periodStart(period)), "LLLL");
}

export function addDaysISO(date: ISODate, n: number): ISODate {
  return toISODate(addDays(parseISO(date), n));
}

export function addMonthsISO(date: ISODate, n: number): ISODate {
  return toISODate(addMonths(parseISO(date), n));
}

export function daysBetween(from: ISODate, to: ISODate): number {
  return differenceInCalendarDays(parseISO(to), parseISO(from));
}

export function startOfMonthISO(date: ISODate): ISODate {
  return toISODate(startOfMonth(parseISO(date)));
}

/**
 * How far into `period` the given day is, as a 1..daysInPeriod count. Days before
 * the period clamp to 1 and days after clamp to the full month, which makes
 * run-rate projections behave for past and future months without branching.
 */
export function elapsedDaysInPeriod(period: Period, today: ISODate): number {
  const total = daysInPeriod(period);
  const day = daysBetween(periodStart(period), today) + 1;
  return Math.min(Math.max(day, 1), total);
}
