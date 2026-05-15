// Responsive breakpoint media queries. Match the Tailwind-aligned
// widths (Q2): phone ≤ 639px / tablet 640–1023px / desktop ≥ 1024px.
// Used by the responsive controller and the boot-time layout pick in
// mountCreator. Desktop is the implicit fallback when neither matches,
// so it has no exported query of its own.

export const PHONE_QUERY = '(max-width: 639px)';
export const TABLET_QUERY = '(min-width: 640px) and (max-width: 1023px)';
