type ProgressRingProps = {
  value: number;
  size?: number;
  stroke?: number;
  label?: string;
  className?: string;
  textClassName?: string;
  ringColor?: string;
  trackColor?: string;
  innerClassName?: string;
  ariaLabel?: string;
};

export default function ProgressRing({
  value,
  size = 44,
  stroke = 4,
  label,
  className = "",
  textClassName = "text-xs font-extrabold text-zinc-100",
  ringColor = "#10b981",
  trackColor = "rgba(63, 63, 70, 0.6)",
  innerClassName = "bg-zinc-950",
  ariaLabel,
}: ProgressRingProps) {
  const safe = Number.isFinite(value) ? Math.min(1, Math.max(0, value)) : 0;
  const pct = Math.round(safe * 100);
  const display = label ?? `${pct}%`;
  const innerSize = Math.max(0, size - stroke * 2);

  return (
    <div
      className={`relative inline-flex items-center justify-center rounded-full ${className}`}
      style={{ width: size, height: size, background: `conic-gradient(${ringColor} ${pct}%, ${trackColor} 0)` }}
      role="img"
      aria-label={ariaLabel ?? `Progress ${pct}%`}
      title={`${pct}%`}
    >
      <div className={`absolute rounded-full ${innerClassName}`} style={{ width: innerSize, height: innerSize }} />
      <div className={`relative z-10 leading-none ${textClassName}`}>{display}</div>
    </div>
  );
}
