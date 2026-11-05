import { useEffect, useRef, useState, type ComponentProps } from 'react';
import { NewPlanForm } from './NewPlanForm';
import formStyles from './PurchaseDialog.module.css';

type NewPlanDialogProps = Omit<ComponentProps<typeof NewPlanForm>, 'onSavingChange'> & { onClose: () => void };

/** The new plan form over the week screen, for a week that already has an allowance. */
export function NewPlanDialog({ onClose, ...formProps }: NewPlanDialogProps) {
  const [saving, setSaving] = useState(false);
  const dialogRef = useRef<HTMLDialogElement>(null);
  // Same focus handling as the other forms: remember the opener once (the
  // effect runs twice in development) and return focus to it on removal.
  const openerRef = useRef<HTMLElement | null>(null);
  useEffect(() => {
    if (!openerRef.current && document.activeElement instanceof HTMLElement) {
      openerRef.current = document.activeElement;
    }
    const opener = openerRef.current;
    const dialog = dialogRef.current;
    if (dialog && !dialog.open) dialog.showModal();
    return () => opener?.focus();
  }, []);

  return (
    <dialog
      ref={dialogRef}
      className={formStyles.dialog}
      aria-labelledby="new-plan-title"
      onClose={onClose}
      // Escape must not hide a save that is still on its way.
      onCancel={(event) => {
        if (saving) event.preventDefault();
      }}
    >
      <div className={formStyles.titleRow}>
        <h2 id="new-plan-title" className={formStyles.title}>
          Start a new plan
        </h2>
        <button type="button" className={formStyles.close} onClick={onClose} disabled={saving}>
          Close
        </button>
      </div>
      <NewPlanForm {...formProps} onSavingChange={setSaving} />
    </dialog>
  );
}
