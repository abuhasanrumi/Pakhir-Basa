import { ChevronRight, LogOut } from "lucide-react";
import { useEffect } from "react";
import { trackedSignOut } from "../lib/actions";
import { Avatar } from "./Avatar.jsx";

// Phone-only bottom sheet for the less-used pages, the mess switcher and sign out.
export function MoreSheet({ activeView, children, currentMess, items, member, onClose, onNavigate, user }) {
  useEffect(() => {
    function onKeyDown(event) {
      if (event.key === "Escape") onClose();
    }
    document.addEventListener("keydown", onKeyDown);
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.removeEventListener("keydown", onKeyDown);
      document.body.style.overflow = previousOverflow;
    };
  }, [onClose]);

  return (
    <div className="sheet-backdrop" role="presentation" onClick={onClose}>
      <section aria-label="More" aria-modal="true" className="more-sheet" role="dialog" onClick={(event) => event.stopPropagation()}>
        <div className="more-sheet__handle" aria-hidden="true" />
        <div className="more-sheet__profile">
          <Avatar name={member.name} photoURL={user.photoURL} size={48} />
          <div>
            <strong>{member.name}</strong>
            <span>
              {member.role} · {currentMess?.name || "Pakhir Basa"}
            </span>
          </div>
        </div>

        {items.length ? (
          <div className="more-sheet__links">
            {items.map((item) => {
              const Icon = item.icon;
              return (
                <button className={activeView === item.id ? "more-sheet__link active" : "more-sheet__link"} key={item.id} type="button" onClick={() => onNavigate(item.id)}>
                  <Icon size={20} />
                  <span>{item.label}</span>
                  <ChevronRight size={18} />
                </button>
              );
            })}
          </div>
        ) : null}

        <div className="more-sheet__switcher">{children}</div>

        <button className="more-sheet__signout" type="button" onClick={trackedSignOut}>
          <LogOut size={18} /> Sign out
        </button>
      </section>
    </div>
  );
}
