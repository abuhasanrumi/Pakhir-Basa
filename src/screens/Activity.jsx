import { CalendarClock, HandCoins, Settings, Soup, Users } from "lucide-react";
import { useMemo, useState } from "react";
import { addDays, formatDisplayDate, localDateString, today } from "../lib/format";

const KINDS = {
  meal: { label: "Meals", icon: Soup },
  plan: { label: "Meal plans", icon: CalendarClock },
  money: { label: "Money", icon: HandCoins },
  people: { label: "People", icon: Users },
  settings: { label: "Settings", icon: Settings },
};

const FILTERS = [{ id: "all", label: "All" }, ...Object.entries(KINDS).map(([id, kind]) => ({ id, label: kind.label }))];

function secondsOf(entry) {
  return Number(entry.at?.seconds || entry.createdAt?.seconds || 0);
}

function dayHeading(date) {
  if (date === today()) return "Today";
  if (date === addDays(today(), -1)) return "Yesterday";
  return formatDisplayDate(date);
}

// This month's change log: who did what, newest first.
export function Activity({ entries }) {
  const [filter, setFilter] = useState("all");

  const groups = useMemo(() => {
    const sorted = [...entries]
      .filter((entry) => filter === "all" || entry.kind === filter)
      .sort((left, right) => secondsOf(right) - secondsOf(left));
    return sorted.reduce((acc, entry) => {
      const seconds = secondsOf(entry);
      const date = seconds ? localDateString(new Date(seconds * 1000)) : today();
      const last = acc[acc.length - 1];
      if (last && last.date === date) last.items.push(entry);
      else acc.push({ date, items: [entry] });
      return acc;
    }, []);
  }, [entries, filter]);

  return (
    <div className="activity-screen">
      <div className="chip-row money-filters" role="tablist" aria-label="Filter">
        {FILTERS.map((item) => (
          <button aria-selected={filter === item.id} className={filter === item.id ? "chip active" : "chip"} key={item.id} role="tab" type="button" onClick={() => setFilter(item.id)}>
            {item.label}
          </button>
        ))}
      </div>

      <section className="panel feed">
        {groups.length ? (
          groups.map((group) => (
            <div className="feed-group" key={group.date}>
              <h4>{dayHeading(group.date)}</h4>
              {group.items.map((entry) => {
                const Icon = KINDS[entry.kind]?.icon || Settings;
                const seconds = secondsOf(entry);
                return (
                  <div className={`activity-row activity-row--${entry.kind}`} key={entry.id}>
                    <span className="activity-row__icon">
                      <Icon size={17} />
                    </span>
                    <span className="activity-row__text">
                      <strong>{entry.actorName}</strong>
                      <span>{entry.summary}</span>
                    </span>
                    <time className="activity-row__time">{seconds ? new Date(seconds * 1000).toLocaleTimeString("en", { hour: "numeric", minute: "2-digit" }) : "now"}</time>
                  </div>
                );
              })}
            </div>
          ))
        ) : (
          <p className="empty">No changes recorded yet this month. New meals, money and people changes will show up here.</p>
        )}
      </section>
    </div>
  );
}
