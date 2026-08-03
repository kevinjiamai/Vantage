import { Check, User as UserIcon, X } from "lucide-react";
import { useEffect, useId, useLayoutEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { G } from "../lib/format";

export function ProfileAvatar({ pic, size, className = "" }: { pic: string; size: number; className?: string }) {
  if (pic) {
    return (
      <img
        src={pic}
        alt=""
        className={`rounded-full object-cover border flex-shrink-0 ${className}`}
        style={{ width: size, height: size, borderColor: "var(--v-line-strong)", background: "var(--v-line)" }}
      />
    );
  }
  return (
    <div
      className={`rounded-full flex items-center justify-center border flex-shrink-0 ${className}`}
      style={{ width: size, height: size, borderColor: "var(--v-line-strong)", background: "var(--v-line)" }}
    >
      <UserIcon size={Math.round(size * 0.45)} style={{ color: "var(--v-ink-dim)" }} />
    </div>
  );
}

/** Shimmer bar for text / numeric placeholders */
export function TextSkeleton({
  width = "4rem", height = "0.75rem", className = "", rounded = "rounded-md",
}: {
  width?: string | number;
  height?: string | number;
  className?: string;
  rounded?: string;
}) {
  return (
    <span
      className={`v-skeleton ${rounded} ${className}`}
      style={{ width, height }}
      aria-hidden
    />
  );
}

/** Animated chart wave loader */
export function ChartSkeleton({ height = 260, className = "" }: { height?: number; className?: string }) {
  const uid = useId();
  const fillId = `chart-skel-fill-${uid}`;
  return (
    <div
      className={`v-chart-loader flex items-center justify-center ${className}`}
      style={{ height }}
      role="status"
      aria-label="Loading chart"
    >
      <svg viewBox="0 0 320 120" preserveAspectRatio="none" aria-hidden>
        <defs>
          <linearGradient id={fillId} x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor="var(--v-ink-dim)" stopOpacity="0.22" />
            <stop offset="100%" stopColor="var(--v-ink-dim)" stopOpacity="0" />
          </linearGradient>
        </defs>
        <path
          className="v-chart-fill"
          d="M8 88 C 40 86, 52 40, 80 48 S 120 96, 150 70 S 200 20, 230 36 S 280 90, 312 58 L 312 120 L 8 120 Z"
          fill={`url(#${fillId})`}
        />
        <path
          className="v-chart-path"
          d="M8 88 C 40 86, 52 40, 80 48 S 120 96, 150 70 S 200 20, 230 36 S 280 90, 312 58"
        />
      </svg>
    </div>
  );
}

export function StatCell({ label, value, accent }: { label: string; value: string; accent?: string }) {
  return (
    <div className="flex flex-col gap-1 min-w-0">
      <div className="text-[9px] font-mono uppercase tracking-[0.12em]" style={{ color: "var(--v-ink-dim)" }}>{label}</div>
      <div className="text-[13px] font-mono font-medium tabular-nums truncate" style={{ color: accent ?? "var(--v-ink)" }}>{value}</div>
    </div>
  );
}

// ─── DialogShell ───────────────────────────────────────────────────────────────

export function DialogShell({
  title, onClose, children, footer, dismissible = true, wide = false,
}: {
  title: string;
  onClose: () => void;
  children: React.ReactNode;
  footer: React.ReactNode;
  dismissible?: boolean;
  wide?: boolean;
}) {
  useEffect(() => {
    if (!dismissible) return;
    const h = (e: KeyboardEvent) => { if (e.key === "Escape") onClose(); };
    document.addEventListener("keydown", h);
    return () => document.removeEventListener("keydown", h);
  }, [onClose, dismissible]);

  return (
    <div
      className="fixed inset-0 z-[100] flex items-center justify-center p-4"
      style={{ background: "rgba(0,0,0,0.55)" }}
      onClick={dismissible ? onClose : undefined}
    >
      <div
        className={`w-full rounded-2xl border shadow-2xl overflow-hidden flex flex-col max-h-[min(90vh,720px)] ${wide ? "max-w-lg" : "max-w-sm"}`}
        style={{ background: "var(--v-panel)", borderColor: "var(--v-line-strong)" }}
        onClick={e => e.stopPropagation()}
      >
        <div className="flex items-center justify-between px-5 py-4 border-b flex-shrink-0" style={{ borderColor: "var(--v-line)" }}>
          <div className="font-mono text-[13px] font-semibold tracking-wide" style={{ color: "var(--v-ink)" }}>{title}</div>
          {dismissible && (
            <button
              className="w-7 h-7 rounded-lg flex items-center justify-center hover:bg-white/10 transition-colors"
              onClick={onClose}
            >
              <X size={14} style={{ color: "var(--v-ink-dim)" }} />
            </button>
          )}
        </div>
        <div className="px-5 py-4 overflow-y-auto flex-1" style={{ scrollbarWidth: "thin", scrollbarColor: "var(--v-line-strong) transparent" }}>
          {children}
        </div>
        <div className="flex justify-end gap-2 px-5 py-4 border-t flex-shrink-0" style={{ borderColor: "var(--v-line)" }}>
          {footer}
        </div>
      </div>
    </div>
  );
}

export function DropdownMenu<T extends string>({
  options, value, onChange, icon, label, activeSuffix,
}: {
  options: { value: T; label: string }[];
  value: T;
  onChange: (v: T) => void;
  icon: React.ReactNode;
  label: string;
  activeSuffix?: string;
}) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  const menuRef = useRef<HTMLDivElement>(null);
  const [menuPos, setMenuPos] = useState<{ top: number; right: number } | null>(null);

  useEffect(() => {
    if (!open) return;
    const h = (e: MouseEvent) => {
      const t = e.target as Node;
      if (ref.current?.contains(t) || menuRef.current?.contains(t)) return;
      setOpen(false);
    };
    document.addEventListener("mousedown", h);
    return () => document.removeEventListener("mousedown", h);
  }, [open]);

  useLayoutEffect(() => {
    if (!open || !ref.current) {
      setMenuPos(null);
      return;
    }
    const update = () => {
      const r = ref.current!.getBoundingClientRect();
      setMenuPos({ top: r.bottom + 4, right: window.innerWidth - r.right });
    };
    update();
    window.addEventListener("resize", update);
    window.addEventListener("scroll", update, true);
    return () => {
      window.removeEventListener("resize", update);
      window.removeEventListener("scroll", update, true);
    };
  }, [open]);

  const active = value !== options[0].value;

  return (
    <div ref={ref} className="relative">
      <button
        className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium transition-colors"
        style={{ background: active ? "var(--v-line-strong)" : "var(--v-line)", color: "var(--v-ink)" }}
        onClick={() => setOpen(v => !v)}
      >
        {icon}
        <span className="hidden sm:inline">
          {options.find(o => o.value === value)?.label ?? label}
          {activeSuffix ? ` ${activeSuffix}` : ""}
        </span>
      </button>
      {open && menuPos && createPortal(
        <div
          ref={menuRef}
          className="fixed z-[200] min-w-[148px] rounded-xl border py-1.5 shadow-2xl"
          style={{ top: menuPos.top, right: menuPos.right, background: "var(--v-panel)", borderColor: "var(--v-line-strong)" }}
        >
          {options.map(o => (
            <button
              key={o.value}
              className="w-full text-left px-3 py-1.5 text-xs flex items-center gap-2 hover:bg-white/5 transition-colors"
              style={{ color: o.value === value ? "var(--v-ink)" : "var(--v-ink-soft)" }}
              onClick={() => { onChange(o.value); setOpen(false); }}
            >
              {o.value === value ? <Check size={10} color={G} /> : <span className="w-[10px]" />}
              {o.label}
              {o.value === value && activeSuffix ? (
                <span className="ml-auto font-mono" style={{ color: "var(--v-ink-dim)" }}>{activeSuffix}</span>
              ) : null}
            </button>
          ))}
        </div>,
        document.body,
      )}
    </div>
  );
}
