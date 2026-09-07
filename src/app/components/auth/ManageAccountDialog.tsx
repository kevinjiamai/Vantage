import { useRef, useState } from "react";
import { DialogShell, ProfileAvatar } from "../common";
import { authErrorMessage } from "../../lib/account";
import { G, R } from "../../lib/format";
import type { Profile } from "../../types";

export function ManageAccountDialog({
  profile, onClose, onSave, onReset, onDeleteAccount,
}: {
  profile: Profile;
  onClose: () => void;
  onSave: (p: Profile) => void;
  onReset: () => void;
  onDeleteAccount: (password: string) => Promise<void>;
}) {
  const [name, setName] = useState(profile.name);
  const [pic, setPic] = useState(profile.pic);
  const [confirmReset, setConfirmReset] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [deleteBusy, setDeleteBusy] = useState(false);
  const [deleteError, setDeleteError] = useState<string | null>(null);
  const [deletePassword, setDeletePassword] = useState("");
  const fileRef = useRef<HTMLInputElement>(null);

  const onPickFile = (file: File | null) => {
    if (!file || !file.type.startsWith("image/")) return;
    const reader = new FileReader();
    reader.onload = () => {
      if (typeof reader.result === "string") setPic(reader.result);
    };
    reader.readAsDataURL(file);
  };

  const handleDelete = async () => {
    if (!deletePassword) {
      setDeleteError("Enter your password to confirm.");
      return;
    }
    setDeleteBusy(true);
    setDeleteError(null);
    try {
      await onDeleteAccount(deletePassword);
    } catch (err) {
      setDeleteError(authErrorMessage(err));
      setDeleteBusy(false);
    }
  };

  return (
    <DialogShell
      title="Manage account"
      onClose={onClose}
      footer={
        <>
          <button
            className="px-3.5 py-2 rounded-lg text-xs font-medium transition-colors hover:bg-white/5"
            style={{ color: "var(--v-ink-soft)" }}
            onClick={onClose}
          >
            Cancel
          </button>
          <button
            className="px-4 py-2 rounded-lg text-xs font-semibold"
            style={{ background: G, color: "#0a0a0a" }}
            onClick={() => {
              onSave({
                ...profile,
                name: name.trim() || profile.name,
                pic,
              });
              onClose();
            }}
          >
            Save
          </button>
        </>
      }
    >
      <div className="flex flex-col gap-4">
        <div className="flex items-center gap-4">
          <ProfileAvatar pic={pic} size={56} />
          <div className="min-w-0 flex-1">
            <div className="text-[10px] font-mono uppercase tracking-widest mb-2" style={{ color: "var(--v-ink-dim)" }}>
              Profile photo
            </div>
            <input
              ref={fileRef}
              type="file"
              accept="image/*"
              className="hidden"
              onChange={e => onPickFile(e.target.files?.[0] ?? null)}
            />
            <div className="flex gap-2">
              <button
                className="px-3 py-1.5 rounded-lg text-xs font-medium"
                style={{ background: "var(--v-line)", color: "var(--v-ink)" }}
                onClick={() => fileRef.current?.click()}
              >
                Upload photo
              </button>
              {pic && (
                <button
                  className="px-3 py-1.5 rounded-lg text-xs font-medium"
                  style={{ color: "var(--v-ink-soft)" }}
                  onClick={() => setPic("")}
                >
                  Remove
                </button>
              )}
            </div>
          </div>
        </div>
        <div>
          <label className="block text-[10px] font-mono uppercase tracking-widest mb-2" style={{ color: "var(--v-ink-dim)" }}>
            Name
          </label>
          <input
            value={name}
            onChange={e => setName(e.target.value)}
            className="w-full px-3 py-2.5 rounded-xl text-sm font-mono outline-none"
            style={{ background: "var(--v-line)", color: "var(--v-ink)", border: "1px solid var(--v-line-strong)" }}
          />
        </div>
        <div>
          <label className="block text-[10px] font-mono uppercase tracking-widest mb-2" style={{ color: "var(--v-ink-dim)" }}>
            Email
          </label>
          <input
            type="email"
            value={profile.email}
            readOnly
            className="w-full px-3 py-2.5 rounded-xl text-sm font-mono outline-none opacity-70"
            style={{ background: "var(--v-line)", color: "var(--v-ink)", border: "1px solid var(--v-line-strong)" }}
          />
        </div>

        <div className="pt-2" style={{ borderTop: "1px solid var(--v-line)" }}>
          <div className="text-[10px] font-mono uppercase tracking-widest mb-2" style={{ color: "var(--v-ink-dim)" }}>
            Danger zone
          </div>
          {!confirmReset ? (
            <button
              className="w-full px-3 py-2.5 rounded-xl text-xs font-medium text-left transition-colors hover:bg-white/5"
              style={{ color: R, border: "1px solid rgba(248,113,130,0.35)" }}
              onClick={() => { setConfirmReset(true); setConfirmDelete(false); }}
            >
              Reset trade history
            </button>
          ) : (
            <div className="rounded-xl p-3" style={{ border: "1px solid rgba(248,113,130,0.35)", background: "rgba(248,113,130,0.08)" }}>
              <div className="text-xs mb-3" style={{ color: "var(--v-ink-soft)" }}>
                Sets bank to $0 and clears portfolio + transactions. This can’t be undone.
              </div>
              <div className="flex gap-2">
                <button
                  className="flex-1 px-3 py-2 rounded-lg text-xs font-medium"
                  style={{ color: "var(--v-ink-soft)", background: "var(--v-line)" }}
                  onClick={() => setConfirmReset(false)}
                >
                  Cancel
                </button>
                <button
                  className="flex-1 px-3 py-2 rounded-lg text-xs font-semibold"
                  style={{ background: R, color: "#0a0a0a" }}
                  onClick={() => { onReset(); onClose(); }}
                >
                  Reset
                </button>
              </div>
            </div>
          )}

          {!confirmDelete ? (
            <button
              className="w-full mt-2 px-3 py-2.5 rounded-xl text-xs font-medium text-left transition-colors hover:bg-white/5"
              style={{ color: R, border: "1px solid rgba(248,113,130,0.35)" }}
              onClick={() => {
                setConfirmDelete(true);
                setConfirmReset(false);
                setDeleteError(null);
                setDeletePassword("");
              }}
            >
              Delete account
            </button>
          ) : (
            <div className="mt-2 rounded-xl p-3" style={{ border: "1px solid rgba(248,113,130,0.35)", background: "rgba(248,113,130,0.08)" }}>
              <div className="text-xs mb-3" style={{ color: "var(--v-ink-soft)" }}>
                Permanently deletes your account and all synced data. This can’t be undone.
              </div>
              <input
                type="password"
                value={deletePassword}
                autoComplete="current-password"
                placeholder="Confirm your password"
                onChange={e => { setDeletePassword(e.target.value); setDeleteError(null); }}
                onKeyDown={e => { if (e.key === "Enter" && !deleteBusy) void handleDelete(); }}
                className="w-full px-2.5 py-2 rounded-lg text-xs outline-none mb-2"
                style={{
                  background: "var(--v-line-strong)", color: "var(--v-ink)",
                  border: "1px solid var(--v-line-strong)", fontFamily: "Geist Mono, monospace",
                }}
              />
              {deleteError && (
                <div className="text-[11px] font-mono mb-2" style={{ color: R }}>{deleteError}</div>
              )}
              <div className="flex gap-2">
                <button
                  className="flex-1 px-3 py-2 rounded-lg text-xs font-medium"
                  style={{ color: "var(--v-ink-soft)", background: "var(--v-line)" }}
                  disabled={deleteBusy}
                  onClick={() => { setConfirmDelete(false); setDeletePassword(""); }}
                >
                  Cancel
                </button>
                <button
                  className="flex-1 px-3 py-2 rounded-lg text-xs font-semibold disabled:opacity-50"
                  style={{ background: R, color: "#0a0a0a" }}
                  disabled={deleteBusy || !deletePassword}
                  onClick={handleDelete}
                >
                  {deleteBusy ? "Deleting…" : "Delete"}
                </button>
              </div>
            </div>
          )}
        </div>
      </div>
    </DialogShell>
  );
}
