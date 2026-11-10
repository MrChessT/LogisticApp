// Marca de LogisticApp: una «L» que es a la vez una balda con una caja encima (stock en su sitio).
export function LogoMark({ size = 30 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 32 32" aria-hidden="true" focusable="false">
      <rect width="32" height="32" rx="8" fill="var(--brand-700, #1d5a45)" />
      <path d="M10.5 8v14.25c0 .97.78 1.75 1.75 1.75H24" fill="none" stroke="#fff" strokeWidth="3" strokeLinecap="round" />
      <rect x="15.25" y="12.5" width="7.5" height="7.5" rx="1.75" fill="var(--accent, #d8f06d)" />
    </svg>
  );
}

export function Logo() {
  return (
    <span className="logo">
      <LogoMark />
      <span className="logo-word">Logistic<span>App</span></span>
    </span>
  );
}
