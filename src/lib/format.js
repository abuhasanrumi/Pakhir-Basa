import { taka } from "./calculations";

export const today = () => new Date().toISOString().slice(0, 10);

export const OFFLINE_NOTICE = "You’re offline, so this is the last saved version. You can edit again once you’re back online.";

export function formatTk(amount) {
  return `৳${taka(amount).toLocaleString("en-BD", { minimumFractionDigits: 0, maximumFractionDigits: 2 })}`;
}

export function formatDisplayDate(date) {
  if (!date) return "";
  const parsed = new Date(`${date}T00:00:00`);
  if (Number.isNaN(parsed.getTime())) return date;
  const day = parsed.toLocaleDateString("en", { day: "numeric" });
  const month = parsed.toLocaleDateString("en", { month: "long" });
  const year = parsed.toLocaleDateString("en", { year: "numeric" });
  return `${day} ${month}, ${year}`;
}

export function formatDisplayDateRange(startDate, endDate, fallback = "closing") {
  return `${formatDisplayDate(startDate)} to ${endDate ? formatDisplayDate(endDate) : fallback}`;
}

export function isTodayDate(date) {
  return date === today();
}

export function isBeforeDate(date, minDate) {
  return Boolean(date && minDate && date < minDate);
}
