import { HandCoins, Moon, ShoppingBasket, Store, Sun } from "lucide-react";
import { MONEY_KINDS, MoneyForm } from "./MoneyForm.jsx";
import { Sheet } from "./Sheet.jsx";

// The "+" menu: pick what to add, then fill a short form in the same sheet.
// `step` is null for the menu, or a money kind ("deposit", "merchant", "bazaar").
export function QuickAddSheet({ isCalculatedMonth, onClose, onOpenMeal, onStepChange, step, ...formProps }) {
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
        <MoneyForm kind={step} onDone={onClose} {...formProps} />
      </Sheet>
    );
  }

  return (
    <Sheet title="Add" onClose={onClose}>
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
