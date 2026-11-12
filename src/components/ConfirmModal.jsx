import { Shield, Trash2 } from "lucide-react";
import { useEffect, useState } from "react";

export function ConfirmModal({ confirmLabel = "Confirm", message, onCancel, onConfirm, open, requiredPhrase = "", title }) {
  const [confirmationText, setConfirmationText] = useState("");
  const requiresPhrase = Boolean(requiredPhrase);
  const canConfirm = !requiresPhrase || confirmationText.trim() === requiredPhrase;

  useEffect(() => {
    if (open) setConfirmationText("");
  }, [open]);

  if (!open) return null;

  return (
    <div className="modal-backdrop modal-backdrop--soft" role="presentation">
      <div className="modal-card confirm-modal" role="dialog" aria-modal="true" aria-labelledby="confirm-title">
        <div className="confirm-modal__header">
          <div className="confirm-modal__icon" aria-hidden="true">
            <Shield size={22} />
          </div>
          <div className="modal-heading confirm-modal__heading">
            <span className="eyebrow">Just checking</span>
            <h2 id="confirm-title">{title}</h2>
            <p>{message}</p>
          </div>
        </div>
        <div className="confirm-modal__footer">
          <div className="confirm-modal__note">
            <Trash2 size={16} />
            <span>Please confirm so this doesn’t happen by accident.</span>
          </div>
          {requiresPhrase ? (
            <label className="confirm-modal__phrase">
              <span>
                Type <strong>{requiredPhrase}</strong> to continue
              </span>
              <input
                autoFocus
                value={confirmationText}
                onChange={(event) => setConfirmationText(event.target.value)}
                onKeyDown={(event) => {
                  if (event.key === "Enter" && canConfirm) {
                    event.preventDefault();
                    onConfirm();
                  }
                }}
              />
            </label>
          ) : null}
          <div className="modal-actions confirm-modal__actions">
            <button className="secondary" type="button" onClick={onCancel}>Cancel</button>
            <button className="danger" disabled={!canConfirm} type="button" onClick={onConfirm}>{confirmLabel}</button>
          </div>
        </div>
      </div>
    </div>
  );
}
