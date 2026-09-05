import { FileUp, MoreHorizontal, Plus } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { DialogShell } from "./common";
import { ImportWatchlistDialog } from "./ImportWatchlistDialog";
import { WatchlistItemMenu } from "./menus";

import { R } from "../lib/format";
import { type Watchlist } from "../types";
import type { StockMeta } from "../lib/stocks";

export function SidebarItem({
  label, count, active, onClick, className = "",
}: {
  label: string; count: number; active: boolean; onClick: () => void; className?: string;
}) {
  return (
    <button
      className={`w-full flex items-center justify-between gap-2 px-2 py-1.5 rounded-lg text-[12px] transition-all ${className}`}
      style={{
        background: active ? "var(--v-line-strong)" : "transparent",
        color:      active ? "var(--v-ink)"         : "var(--v-ink-soft)",
        fontWeight: active ? 600 : 400,
      }}
      onClick={onClick}
    >
      <span className="truncate text-left">{label}</span>
      <span className="text-[10px] font-mono flex-shrink-0" style={{ color: "var(--v-ink-dim)" }}>{count}</span>
    </button>
  );
}

export function WatchlistSidebar({
  watchlists, activeId, onSelect, onCreate, onImport, onDelete, onRename, onReorder, open,
}: {
  watchlists: Watchlist[];
  activeId: string;
  onSelect: (id: string) => void;
  onCreate: (name: string) => void;
  onImport: (name: string, symbols: string[], stocks: StockMeta[]) => void;
  onDelete: (id: string) => void;
  onRename: (id: string, name: string) => void;
  onReorder: (fromId: string, toId: string) => void;
  open: boolean;
}) {
  const [creating, setCreating] = useState(false);
  const [importing, setImporting] = useState(false);
  const [name, setName] = useState("");
  const inputRef = useRef<HTMLInputElement>(null);
  const [menuFor, setMenuFor] = useState<string | null>(null);
  const dragIdRef = useRef<string | null>(null);
  const [dragOverId, setDragOverId] = useState<string | null>(null);
  const [renamingId, setRenamingId] = useState<string | null>(null);
  const [renameValue, setRenameValue] = useState("");
  const [confirmDelete, setConfirmDelete] = useState<Watchlist | null>(null);
  const renameRef = useRef<HTMLInputElement>(null);

  useEffect(() => { if (creating) inputRef.current?.focus(); }, [creating]);
  useEffect(() => { if (renamingId) renameRef.current?.focus(); }, [renamingId]);

  const submit = () => {
    if (name.trim()) { onCreate(name.trim()); setName(""); setCreating(false); }
  };

  const commitRename = () => {
    if (renamingId && renameValue.trim()) onRename(renamingId, renameValue.trim());
    setRenamingId(null);
    setRenameValue("");
  };

  const finishDrag = () => {
    const from = dragIdRef.current;
    const to = dragOverId;
    dragIdRef.current = null;
    setDragOverId(null);
    if (from && to && from !== to) onReorder(from, to);
  };

  const allStocks = watchlists.find(w => w.id === "portfolio");
  const userLists = watchlists.filter(w => w.id !== "portfolio");

  return (
    <aside
      className={`flex flex-col flex-shrink-0 border-r overflow-hidden transition-[width,opacity] duration-200 ease-out ${
        open ? "w-40 sm:w-52 opacity-100" : "w-0 opacity-0 border-r-0 pointer-events-none"
      }`}
      style={{ background: "var(--v-panel)", borderColor: "var(--v-line)" }}
      aria-hidden={!open}
    >
      <div className="px-3 pt-4 pb-4 flex-1 overflow-y-auto w-40 sm:w-52">
        <div className="flex items-center justify-between px-2 mb-1.5">
          <div className="text-[9px] font-mono font-semibold tracking-[0.15em] uppercase" style={{ color: "var(--v-ink-dim)" }}>
            Watchlists
          </div>
          <div className="flex items-center gap-0.5">
            <button
              className="w-5 h-5 rounded flex items-center justify-center hover:bg-white/10 transition-colors"
              onClick={() => setImporting(true)}
              title="Import from a Yahoo Finance CSV export"
              aria-label="Import watchlist"
            >
              <FileUp size={11} style={{ color: "var(--v-ink-dim)" }} />
            </button>
            <button
              className="w-5 h-5 rounded flex items-center justify-center hover:bg-white/10 transition-colors"
              onClick={() => setCreating(true)}
              title="New watchlist"
              aria-label="New watchlist"
            >
              <Plus size={12} style={{ color: "var(--v-ink-dim)" }} />
            </button>
          </div>
        </div>

        {allStocks && (
          <SidebarItem
            label="All Stocks"
            count={allStocks.symbols.length}
            active={activeId === "portfolio"}
            onClick={() => onSelect("portfolio")}
          />
        )}

        {userLists.map(wl => (
          renamingId === wl.id ? (
            <div key={wl.id} className="px-2 mt-1">
              <input
                ref={renameRef}
                value={renameValue}
                onChange={e => setRenameValue(e.target.value)}
                onKeyDown={e => {
                  if (e.key === "Enter") commitRename();
                  if (e.key === "Escape") { setRenamingId(null); setRenameValue(""); }
                }}
                onBlur={commitRename}
                className="w-full px-2.5 py-1.5 rounded-lg text-xs outline-none"
                style={{
                  background: "var(--v-line-strong)", color: "var(--v-ink)",
                  border: "1px solid var(--v-line-strong)", fontFamily: "Geist Mono, monospace",
                }}
              />
            </div>
          ) : (
            <div
              key={wl.id}
              className="group/item relative flex items-center"
              style={{ opacity: dragOverId === wl.id ? 0.6 : 1, cursor: "grab" }}
              draggable
              onDragStart={e => { e.dataTransfer.effectAllowed = "move"; dragIdRef.current = wl.id; }}
              onDragOver={e => { e.preventDefault(); e.dataTransfer.dropEffect = "move"; setDragOverId(wl.id); }}
              onDragEnd={finishDrag}
            >
              <SidebarItem
                label={wl.name} count={wl.symbols.length}
                active={activeId === wl.id} onClick={() => onSelect(wl.id)}
                className="flex-1"
              />
              <button
                className="w-5 h-5 rounded opacity-0 group-hover/item:opacity-100 flex items-center justify-center hover:bg-white/10 transition-all mr-1"
                style={{ opacity: menuFor === wl.id ? 1 : undefined }}
                onClick={() => setMenuFor(v => (v === wl.id ? null : wl.id))}
              >
                <MoreHorizontal size={11} style={{ color: "var(--v-ink-dim)" }} />
              </button>
              {menuFor === wl.id && (
                <WatchlistItemMenu
                  onRename={() => { setRenamingId(wl.id); setRenameValue(wl.name); setMenuFor(null); }}
                  onDelete={() => { setConfirmDelete(wl); setMenuFor(null); }}
                  onClose={() => setMenuFor(null)}
                />
              )}
            </div>
          )
        ))}

        {creating && (
          <div className="px-2 mt-1">
            <input
              ref={inputRef}
              value={name}
              onChange={e => setName(e.target.value)}
              onKeyDown={e => {
                if (e.key === "Enter") submit();
                if (e.key === "Escape") { setCreating(false); setName(""); }
              }}
              onBlur={() => { if (!name.trim()) { setCreating(false); setName(""); } }}
              placeholder="List name…"
              className="w-full px-2.5 py-1.5 rounded-lg text-xs outline-none"
              style={{
                background: "var(--v-line-strong)", color: "var(--v-ink)",
                border: "1px solid var(--v-line-strong)", fontFamily: "Geist Mono, monospace",
              }}
            />
          </div>
        )}
      </div>

      {importing && (
        <ImportWatchlistDialog
          onClose={() => setImporting(false)}
          onImport={onImport}
        />
      )}

      {confirmDelete && (
        <DialogShell
          title="Delete watchlist"
          onClose={() => setConfirmDelete(null)}
          footer={
            <>
              <button
                className="px-3.5 py-2 rounded-lg text-xs font-medium transition-colors hover:bg-white/5"
                style={{ color: "var(--v-ink-soft)" }}
                onClick={() => setConfirmDelete(null)}
              >
                Cancel
              </button>
              <button
                className="px-4 py-2 rounded-lg text-xs font-semibold transition-opacity hover:opacity-90"
                style={{ background: R, color: "#0a0a0a" }}
                onClick={() => { onDelete(confirmDelete.id); setConfirmDelete(null); }}
              >
                Delete
              </button>
            </>
          }
        >
          <p className="text-sm" style={{ color: "var(--v-ink-soft)" }}>
            Delete <span className="font-semibold" style={{ color: "var(--v-ink)" }}>“{confirmDelete.name}”</span>?
            This can’t be undone.
          </p>
        </DialogShell>
      )}
    </aside>
  );
}
