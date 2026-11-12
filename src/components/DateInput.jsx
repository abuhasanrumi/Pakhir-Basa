import { CalendarCheck } from "lucide-react";
import { formatDisplayDate, isTodayDate } from "../lib/format";

export function DateInput({ disabled = false, label = "Date", min, onChange, showToday = false, value }) {
  return (
    <div className="pretty-date-control">
      <input className="pretty-date-display" readOnly value={formatDisplayDate(value)} />
      {showToday && isTodayDate(value) ? <span className="today-chip">Today</span> : null}
      <CalendarCheck className="pretty-date-icon" size={18} />
      <input
        aria-label={label}
        className="native-date-picker"
        disabled={disabled}
        min={min}
        type="date"
        value={value || ""}
        onChange={(event) => onChange(event.target.value)}
      />
    </div>
  );
}
