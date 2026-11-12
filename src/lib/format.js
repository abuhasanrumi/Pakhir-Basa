import { taka } from "./calculations";

// Local calendar date as YYYY-MM-DD (toISOString would give the UTC date, which is
// yesterday between midnight and 6 am in Bangladesh).
export function localDateString(date = new Date()) {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

export const today = () => localDateString();

export function addDays(dateString, days) {
  const date = new Date(`${dateString}T00:00:00`);
  date.setDate(date.getDate() + days);
  return localDateString(date);
}

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
