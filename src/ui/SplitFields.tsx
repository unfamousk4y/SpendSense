import type { ReactNode } from 'react';
import { parsePercent, readSplitTexts, type SplitTexts } from '../domain/split';
// Same labels and boxes as the other forms.
import formStyles from '../features/week/PurchaseDialog.module.css';
import styles from './SplitFields.module.css';

type SplitFieldsProps = {
  texts: SplitTexts;
  onChange: (texts: SplitTexts) => void;
  /** Says what this split applies to, which differs between setup and a payment. */
  hint: ReactNode;
};

const FIELDS: { key: keyof SplitTexts; label: string }[] = [
  { key: 'needs', label: 'Needs' },
  { key: 'wants', label: 'Wants' },
  { key: 'savings', label: 'Savings' },
];

/** The three percent boxes, with a running total that says what is wrong in words. */
export function SplitFields({ texts, onChange, hint }: SplitFieldsProps) {
  const { split, totalPercent } = readSplitTexts(texts);

  return (
    <fieldset className={styles.split}>
      <legend className={formStyles.label}>How to split your money</legend>
      <p className={styles.hint}>{hint}</p>
      <div className={styles.percents}>
        {FIELDS.map(({ key, label }) => {
          const invalid = texts[key].trim() !== '' && parsePercent(texts[key]) === null;
          return (
            <label key={key} className={formStyles.field}>
              <span className={formStyles.label}>{label}</span>
              <span className={`${formStyles.amountBox} ${invalid ? formStyles.invalid : ''}`}>
                <input
                  className={formStyles.amountInput}
                  inputMode="numeric"
                  autoComplete="off"
                  value={texts[key]}
                  onChange={(event) => onChange({ ...texts, [key]: event.target.value })}
                  aria-label={`${label} percent`}
                  aria-invalid={invalid}
                />
                <span className={formStyles.prefix} aria-hidden="true">
                  %
                </span>
              </span>
            </label>
          );
        })}
      </div>
      <p className={split ? styles.hint : formStyles.error} role="status">
        {totalPercent === null
          ? 'Each percent must be a whole number from 0 to 100.'
          : split
            ? 'Total: 100%'
            : `Total: ${totalPercent}%. It needs to come to 100%.`}
      </p>
    </fieldset>
  );
}
