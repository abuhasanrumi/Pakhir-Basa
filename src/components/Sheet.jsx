import { ArrowLeft, X } from "lucide-react";
import { useEffect, useRef } from "react";
import { createPortal } from "react-dom";

// A bottom sheet on phones and a centred dialog on larger screens.
export function Sheet({ children, onBack, onClose, open = true, title }) {
  const onCloseRef = useRef(onClose);
  onCloseRef.current = onClose;

  useEffect(() => {
    if (!open) return undefined;
    function onKeyDown(event) {
      if (event.key === "Escape") onCloseRef.current?.();
    }
    document.addEventListener("keydown", onKeyDown);
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.removeEventListener("keydown", onKeyDown);
      document.body.style.overflow = previousOverflow;
    };
  }, [open]);

  if (!open) return null;

  // Render at <body> level so the sheet always covers the tab bar and the + button.
  return createPortal(
    <div className="ui-sheet-backdrop" role="presentation" onMouseDown={onClose}>
      <section aria-label={title} aria-modal="true" className="ui-sheet" role="dialog" onMouseDown={(event) => event.stopPropagation()}>
        <div className="ui-sheet__handle" aria-hidden="true" />
        <header className="ui-sheet__head">
          {onBack ? (
            <button aria-label="Back" className="ui-sheet__icon" type="button" onClick={onBack}>
              <ArrowLeft size={20} />
            </button>
          ) : null}
          <h2>{title}</h2>
          <button aria-label="Close" className="ui-sheet__icon" type="button" onClick={onClose}>
            <X size={20} />
          </button>
        </header>
        <div className="ui-sheet__body">{children}</div>
      </section>
    </div>,
    document.body,
  );
}
