export interface YuristimMarkProps {
  className?: string;
}

export function YuristimMark({ className }: YuristimMarkProps) {
  return (
    <span aria-label="Yuristim" className={className}>
      Y
    </span>
  );
}
