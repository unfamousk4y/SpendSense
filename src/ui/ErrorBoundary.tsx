import { Component, type ReactNode } from 'react';
import styles from './ErrorBoundary.module.css';

type ErrorBoundaryProps = { children: ReactNode };
type ErrorBoundaryState = { crashed: boolean };

/**
 * If anything throws while drawing, React removes the whole page. This catches
 * that and shows a way forward instead of a blank screen. React only offers
 * this to class components, so it is the one class in the app.
 *
 * It only covers errors while drawing, not failed saves: those are expected
 * and handled by the forms. The error itself is not shown or sent anywhere,
 * since it could include a student's amounts or merchants.
 */
export class ErrorBoundary extends Component<ErrorBoundaryProps, ErrorBoundaryState> {
  state: ErrorBoundaryState = { crashed: false };

  static getDerivedStateFromError(): ErrorBoundaryState {
    return { crashed: true };
  }

  render() {
    if (!this.state.crashed) return this.props.children;
    return (
      <main className={styles.page}>
        <div className={styles.card} role="alert">
          <h1 className={styles.title}>Something went wrong</h1>
          <p className={styles.text}>
            SpendSense hit a problem drawing this screen. Anything you already saved is safe. Anything you were still
            typing may need entering again.
          </p>
          <button type="button" className={styles.reload} onClick={() => window.location.reload()}>
            Reload
          </button>
        </div>
      </main>
    );
  }
}
