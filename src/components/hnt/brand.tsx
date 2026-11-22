import { Link } from "@tanstack/react-router";
import { motion, useReducedMotion } from "framer-motion";
import { useState } from "react";
import { isLiveApi } from "@/lib/api";
import { cn } from "@/lib/utils";

type LogoVariant = "light" | "dark";

export function LogoMark({
  variant = "light",
  className,
  hovered = false,
  reduceMotion = false,
}: {
  variant?: LogoVariant;
  className?: string;
  hovered?: boolean;
  reduceMotion?: boolean;
}) {
  return (
    <svg viewBox="0 0 96 96" className={cn("h-10 w-10 shrink-0", className)} aria-hidden="true">
      <rect width="96" height="96" rx="24" fill={variant === "light" ? "#14213D" : "#FFFFFF"} />
      <path
        d="M32 26 V72 M32 50 H62"
        stroke={variant === "light" ? "#FFFFFF" : "#14213D"}
        strokeWidth="10"
        strokeLinecap="round"
        fill="none"
      />
      <motion.g
        initial={false}
        animate={{ y: hovered && !reduceMotion ? -6 : 0 }}
        transition={{ type: "spring", stiffness: 300, damping: 15 }}
      >
        <path
          d="M62 72 V26 M50 37 L62 25 L74 37"
          stroke="#E4572E"
          strokeWidth="10"
          strokeLinecap="round"
          strokeLinejoin="round"
          fill="none"
        />
      </motion.g>
    </svg>
  );
}

export function Logo({
  variant = "light",
  iconOnly = false,
  className,
}: {
  variant?: LogoVariant;
  iconOnly?: boolean;
  className?: string;
}) {
  const [hovered, setHovered] = useState(false);
  const reduceMotion = useReducedMotion() ?? false;

  return (
    <Link
      to="/"
      aria-label={iconOnly ? "Hired Not Tired home" : undefined}
      className={cn("inline-flex items-center gap-3", className)}
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
    >
      <LogoMark variant={variant} hovered={hovered} reduceMotion={reduceMotion} />
      {!iconOnly && (
        <span
          className={cn(
            "flex items-baseline gap-[0.24em] font-display text-[15px] font-bold uppercase tracking-[0.06em] sm:text-base",
            variant === "light" ? "text-brand-navy" : "text-brand-on-dark",
          )}
        >
          <span>HIRED</span>
          <span className={variant === "light" ? "text-brand-not" : "text-brand-not-dark"}>
            NOT
          </span>
          <span>TIRED</span>
        </span>
      )}
    </Link>
  );
}

export function SimBadge({ label = "Simulated" }: { label?: string }) {
  return (
    <span className="inline-flex items-center gap-1 rounded-full border border-warning/30 bg-warning/10 px-2 py-0.5 text-[11px] font-semibold uppercase tracking-wide text-foreground">
      <span className="h-1.5 w-1.5 rounded-full bg-warning" />
      {label}
    </span>
  );
}

export function EngineBadge() {
  return isLiveApi ? null : (
    <span className="hidden rounded-full border border-border bg-muted px-2.5 py-1 text-xs text-muted-foreground sm:inline">
      Preview engine · no live server connected
    </span>
  );
}