// Shared motion values, so every panel moves with the same calm timing.
// About 250 ms with a quick start and soft landing, within the 150 to 250 ms guardrail.
export const PANEL_TRANSITION = { duration: 0.25, ease: [0.2, 0, 0, 1] as const };

// Gentle lift on mouse hover (Motion ignores touch for hover). Reduced motion
// turns this movement off automatically.
export const HOVER_LIFT = { y: -3, scale: 1.012 };
