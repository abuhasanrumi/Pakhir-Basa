import { HandCoins, Mic, Moon, ShoppingBasket, Store, Sun } from "lucide-react";
import { aiEnabled } from "../lib/ai";
import { MONEY_KINDS, MoneyForm } from "./MoneyForm.jsx";
import { Sheet } from "./Sheet.jsx";

// The "+" menu: pick what to add, then fill a short form in the same sheet.
// `step` is null for the menu, or a money kind ("deposit", "merchant", "bazaar").
export function QuickAddSheet({ initial = null, isCalculatedMonth, onClose, onOpenAssistant, onOpenMeal, onStepChange, step, ...formProps }) {
  const options = [
    { id: "lunch", label: "Lunch", hint: "Who ate lunch", icon: Sun, onPick: () => onOpenMeal("lunch") },
    { id: "dinner", label: "Dinner", hint: "Who ate dinner", icon: Moon, onPick: () => onOpenMeal("dinner") },
    { id: "deposit", label: "Deposit", hint: "Money given to the mess", icon: HandCoins, onPick: () => onStepChange("deposit") },
    isCalculatedMonth
      ? { id: "bazaar", label: "Bazaar", hint: "Shopping from mess cash", icon: ShoppingBasket, onPick: () => onStepChange("bazaar") }
      : null,
    { id: "merchant", label: "Paid to merchant", hint: "Meal bill paid from mess cash", icon: Store, onPick: () => onStepChange("merchant") },
  ].filter(Boolean);

  if (step) {
    return (
      <Sheet title={MONEY_KINDS[step].title} onBack={() => onStepChange(null)} onClose={onClose}>
        <MoneyForm initial={initial} kind={step} onDone={onClose} {...formProps} />
      </Sheet>
    );
  }

  return (
    <Sheet title="Add" onClose={onClose}>
      {aiEnabled && onOpenAssistant ? (
        <button className="quick-add-voice" type="button" onClick={onOpenAssistant}>
          <span className="quick-add-voice__icon">
            <Mic size={22} />
          </span>
          <span>
            <strong>Say or type it</strong>
            <small>“আজ দুপুরে সবাই এক করে” · “Topu deposited 1000”</small>
          </span>
        </button>
      ) : null}
      <div className="quick-add-grid">
        {options.map(({ hint, icon: Icon, id, label, onPick }) => (
          <button className={`quick-add-option quick-add-option--${id}`} key={id} type="button" onClick={onPick}>
            <span className="quick-add-option__icon">
              <Icon size={22} />
            </span>
            <strong>{label}</strong>
            <small>{hint}</small>
          </button>
        ))}
      </div>
    </Sheet>
  );
}
