import { CircleCheckIcon, CircleDashedIcon, FlaskConicalIcon } from "lucide-react";
import { partyColor } from "@/lib/parties";
import { cn } from "@/lib/utils";

/** Confirmed vs Unverified always shows text and an icon, never colour alone (SPEC §6.5). */
export function StatusBadge({ level, className }: { level: "confirmed" | "unverified"; className?: string }) {
  const confirmed = level === "confirmed";
  const Icon = confirmed ? CircleCheckIcon : CircleDashedIcon;
  return (
    <span
      className={cn(
        "inline-flex shrink-0 items-center gap-1 rounded-full border px-2 py-0.5 text-xs font-semibold",
        confirmed
          ? "border-transparent bg-confirmed text-confirmed-foreground"
          : "border-unverified-border bg-unverified text-unverified-foreground",
        className,
      )}
    >
      <Icon className="size-3.5" aria-hidden />
      {confirmed ? "Confirmed" : "Unverified"}
    </span>
  );
}

export function PartyBadge({
  code,
  color,
  name,
  className,
}: {
  code: string | null;
  color?: string | null;
  name?: string;
  className?: string;
}) {
  if (!code) return <span className="text-muted-foreground">Unknown</span>;
  return (
    <span
      title={name}
      className={cn("inline-flex items-center gap-1.5 rounded-full border bg-card px-2 py-0.5 text-xs font-semibold", className)}
    >
      <span aria-hidden className="size-2.5 rounded-full" style={{ backgroundColor: partyColor(code, color) }} />
      {code}
    </span>
  );
}

export function FictionalBadge() {
  return (
    <span className="inline-flex items-center gap-1 rounded-full border border-unverified-border bg-unverified px-2 py-0.5 text-xs font-semibold text-unverified-foreground">
      <FlaskConicalIcon className="size-3.5" aria-hidden />
      Fictional demo record
    </span>
  );
}
