"use client";

import { useCallback, useEffect, useState } from "react";
import { Camera, Plus, Send, Trash2, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Field } from "@/components/common/field";
import { StatusChip } from "@/components/common/status-chip";
import { FieldScreen } from "../field-shell";
import { go, useField } from "../field-context";
import { Scanner } from "../scanner";
import { fieldFetch } from "@/lib/field/net";
import { listBorrowDrafts, removeBorrowDraft, saveBorrowDraft, sendBorrowDraft } from "@/lib/field/borrow";
import type { BorrowDraftRec } from "@/lib/field/db";
import { normalizeCode, parseScan } from "@/lib/codes";

type Loc = { id: string; code: string; name: string };
const LOC_KEY = (u: string) => `ims-field-locations-${u}`;

const STATE: Record<
  BorrowDraftRec["status"],
  { kind: "sync"; status: "DRAFT" | "SENDING" | "ACKED" | "REJECTED" | "FAILED"; text: string }
> = {
  DRAFT: { kind: "sync", status: "DRAFT", text: "Not official yet. Send it when you're ready." },
  SENDING: { kind: "sync", status: "SENDING", text: "Sending…" },
  SENT: { kind: "sync", status: "ACKED", text: "Sent. A supervisor checks it and releases the equipment." },
  REJECTED: { kind: "sync", status: "REJECTED", text: "" },
  FAILED: { kind: "sync", status: "FAILED", text: "" },
};

/** Borrow request on the phone (§7.5 step 1): saved locally, sent to a supervisor when online. */
export function BorrowView() {
  const { db, user, online } = useField();
  const [list, setList] = useState<BorrowDraftRec[] | null>(null);
  const [locs, setLocs] = useState<Loc[]>([]);
  const [editing, setEditing] = useState<string | "new" | null>(null);
  const [form, setForm] = useState({ locationId: "", borrowerName: "", borrowerDept: "", purpose: "", notes: "" });
  const [tags, setTags] = useState<string[]>([]);
  const [ids, setIds] = useState<{ id: string; label: string }[]>([]);
  const [tag, setTag] = useState("");
  const [scan, setScan] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [sending, setSending] = useState<string | null>(null);

  const reload = useCallback(() => listBorrowDrafts(db).then(setList), [db]);
  useEffect(() => {
    void reload();
  }, [reload]);

  // Where can I ask from? From the server when online (kept for offline), else from my downloaded counts.
  useEffect(() => {
    let alive = true;
    (async () => {
      const cached = JSON.parse(localStorage.getItem(LOC_KEY(user.id)) ?? "null") as Loc[] | null;
      const fromCounts = (await db.assignments.toArray()).map((a) => a.location);
      const merge = (xs: Loc[]) =>
        [...new Map(xs.map((l) => [l.id, l])).values()].sort((a, b) => a.code.localeCompare(b.code));
      if (alive) setLocs(merge([...(cached ?? []), ...fromCounts]));
      try {
        const r = await fieldFetch("/api/v1/me", {}, 5000);
        if (!r.ok) return;
        const me = (await r.json()) as { locations: Loc[] | "ALL" };
        if (Array.isArray(me.locations)) {
          const l = me.locations.map(({ id, code, name }) => ({ id, code, name }));
          localStorage.setItem(LOC_KEY(user.id), JSON.stringify(l));
          if (alive) setLocs(merge(l));
        }
      } catch {
        /* offline: keep what we have */
      }
    })();
    return () => {
      alive = false;
    };
  }, [db, user.id]);

  function open(d?: BorrowDraftRec) {
    setError(null);
    setMsg(null);
    setEditing(d?.id ?? "new");
    setForm({
      locationId: d?.location.id ?? (locs.length === 1 ? locs[0].id : ""),
      borrowerName: d?.borrowerName ?? user.name,
      borrowerDept: d?.borrowerDept ?? "",
      purpose: d?.purpose ?? "",
      notes: d?.notes ?? "",
    });
    setTags(d?.tags ?? []);
    setIds(d?.assetIds ?? []);
  }

  async function addTag(raw: string) {
    const s = parseScan(raw);
    if (!s) return;
    if (s.kind === "ims") {
      if (s.type !== "asset") return setMsg("That label is not an asset. Scan the label on the equipment.");
      // Show the tag if this phone knows it from a downloaded count.
      const known = await db.targets.filter((t) => t.assetId === s.id).first();
      const label = known?.tag ?? `Scanned asset ${s.id.slice(0, 8)}`;
      setIds((xs) => (xs.some((x) => x.id === s.id) ? xs : [...xs, { id: s.id, label }]));
      setScan(false);
      return setMsg(`Added ${label}.`);
    }
    const t = normalizeCode(s.code);
    setTags((ts) => (ts.includes(t) ? ts : [...ts, t]));
    setTag("");
    setScan(false);
    setMsg(`Added ${t}.`);
  }

  async function save() {
    setError(null);
    const loc = locs.find((l) => l.id === form.locationId);
    if (!loc) return setError("Pick where the equipment is.");
    try {
      await saveBorrowDraft(db, {
        id: editing === "new" ? undefined : editing!,
        location: loc,
        ...form,
        tags,
        assetIds: ids,
      });
      setEditing(null);
      await reload();
    } catch (e) {
      setError((e as Error).message);
    }
  }

  async function send(id: string) {
    setSending(id);
    try {
      await sendBorrowDraft(db, id, (u, i) => fieldFetch(u, i, 15000));
    } finally {
      setSending(null);
      await reload();
    }
  }

  if (editing) {
    return (
      <FieldScreen title={editing === "new" ? "New borrow request" : "Edit request"} back={() => setEditing(null)}>
        <p className="rounded-lg border bg-muted/50 p-3 text-[15px]">
          Saved on this phone first. Nothing is official until a supervisor releases it.
        </p>
        {error && (
          <p className="rounded-lg border border-danger/40 bg-danger-soft p-3 font-medium text-danger" role="alert">
            {error}
          </p>
        )}
        <Field id="br-loc" label="Equipment is at">
          <select
            id="br-loc"
            className="h-12 w-full rounded-md border bg-background px-3 text-base"
            value={form.locationId}
            onChange={(e) => setForm({ ...form, locationId: e.target.value })}
          >
            <option value="">Pick a location</option>
            {locs.map((l) => (
              <option key={l.id} value={l.id}>
                {l.code} · {l.name}
              </option>
            ))}
          </select>
        </Field>
        <Field id="br-tag" label="Assets" hint="Type the tag printed on the label, or scan its barcode.">
          <div className="flex gap-2">
            <Input
              id="br-tag"
              value={tag}
              autoComplete="off"
              autoCapitalize="characters"
              className="h-12 min-w-0 flex-1 text-lg"
              onChange={(e) => setTag(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter") {
                  e.preventDefault();
                  void addTag(tag);
                }
              }}
            />
            {/* size="lg" is full width on field screens, so the small Add button uses size="icon". */}
            <Button type="button" size="icon" variant="outline" onClick={() => void addTag(tag)} aria-label="Add tag">
              <Plus aria-hidden />
            </Button>
          </div>
        </Field>
        <Button type="button" size="lg" variant="outline" onClick={() => setScan((s) => !s)} aria-pressed={scan}>
          <Camera aria-hidden /> {scan ? "Stop scanning" : "Scan a label"}
        </Button>
        {scan && <Scanner onCode={(c) => void addTag(c)} />}
        {msg && (
          <p className="text-[15px]" role="status">
            {msg}
          </p>
        )}
        {tags.length + ids.length > 0 && (
          <ul className="flex flex-wrap gap-2" aria-label="Assets in this request">
            {ids.map((a) => (
              <li key={a.id} className="flex items-center gap-1 rounded-full border bg-card py-1 pr-1 pl-3 font-medium">
                {a.label}
                <Button
                  type="button"
                  size="icon"
                  variant="ghost"
                  className="size-8"
                  aria-label={`Remove ${a.label}`}
                  onClick={() => setIds((xs) => xs.filter((x) => x.id !== a.id))}
                >
                  <X aria-hidden />
                </Button>
              </li>
            ))}
            {tags.map((t) => (
              <li key={t} className="flex items-center gap-1 rounded-full border bg-card py-1 pr-1 pl-3 font-medium">
                {t}
                <Button
                  type="button"
                  size="icon"
                  variant="ghost"
                  className="size-8"
                  aria-label={`Remove ${t}`}
                  onClick={() => setTags((ts) => ts.filter((x) => x !== t))}
                >
                  <X aria-hidden />
                </Button>
              </li>
            ))}
          </ul>
        )}
        <Field id="br-name" label="Borrower">
          <Input
            id="br-name"
            className="h-12"
            value={form.borrowerName}
            maxLength={120}
            onChange={(e) => setForm({ ...form, borrowerName: e.target.value })}
          />
        </Field>
        <Field id="br-dept" label="Department or site" optional>
          <Input
            id="br-dept"
            className="h-12"
            value={form.borrowerDept}
            maxLength={120}
            onChange={(e) => setForm({ ...form, borrowerDept: e.target.value })}
          />
        </Field>
        <Field id="br-purpose" label="Purpose" hint="Work order or job.">
          <Input
            id="br-purpose"
            className="h-12"
            value={form.purpose}
            maxLength={300}
            onChange={(e) => setForm({ ...form, purpose: e.target.value })}
          />
        </Field>
        <Field id="br-notes" label="Notes" optional>
          <Textarea
            id="br-notes"
            value={form.notes}
            maxLength={1000}
            onChange={(e) => setForm({ ...form, notes: e.target.value })}
          />
        </Field>
        <Button size="lg" onClick={save}>
          Save on this phone
        </Button>
      </FieldScreen>
    );
  }

  return (
    <FieldScreen title="Borrow requests" back={() => go({})}>
      <p className="text-[15px] text-muted-foreground">
        Ask for equipment here. A supervisor checks the request and releases it; the official form is made then.
      </p>
      <Button size="lg" onClick={() => open()}>
        <Plus aria-hidden /> New borrow request
      </Button>
      {list === null ? (
        <p className="text-muted-foreground">Loading…</p>
      ) : list.length === 0 ? (
        <p className="text-muted-foreground">No requests on this phone.</p>
      ) : (
        <ul className="flex flex-col gap-3" aria-label="My requests">
          {list.map((d) => {
            const st = STATE[d.status];
            const canEdit = d.status === "DRAFT" || d.status === "REJECTED" || d.status === "FAILED";
            // A refused request would be refused again as is: fix it first (Edit makes a new request).
            const canSend = d.status === "DRAFT" || d.status === "FAILED";
            return (
              <li key={d.id} className="flex flex-col gap-2 rounded-xl border bg-card p-4">
                <div className="flex flex-wrap items-start justify-between gap-2">
                  <div className="min-w-0">
                    <p className="text-lg font-semibold">
                      {[...(d.assetIds ?? []).map((a) => a.label), ...d.tags].join(", ")}
                    </p>
                    <p className="text-[15px] text-muted-foreground">
                      {d.location.code} · {d.borrowerName} · {d.purpose}
                    </p>
                  </div>
                  <StatusChip kind={st.kind} status={st.status} />
                </div>
                <p
                  className={
                    d.status === "REJECTED" || d.status === "FAILED" ? "font-medium text-danger" : "text-[15px]"
                  }
                >
                  {d.error ?? st.text}
                </p>
                <div className="flex flex-wrap gap-2">
                  {canSend && (
                    <Button size="lg" onClick={() => send(d.id)} disabled={!online} loading={sending === d.id}>
                      <Send aria-hidden /> {online ? "Send to supervisor" : "Send when online"}
                    </Button>
                  )}
                  {canEdit && (
                    <Button size="lg" variant={canSend ? "outline" : "default"} onClick={() => open(d)}>
                      {canSend ? "Edit" : "Fix and send again"}
                    </Button>
                  )}
                  {(canEdit || d.status === "SENT") && (
                    <Button
                      size="lg"
                      variant="ghost"
                      aria-label={d.status === "SENT" ? "Remove from this phone" : "Delete request"}
                      onClick={async () => {
                        if (d.status !== "SENT" && !window.confirm("Delete this request from the phone?")) return;
                        await removeBorrowDraft(db, d.id);
                        await reload();
                      }}
                    >
                      <Trash2 aria-hidden /> {d.status === "SENT" ? "Clear" : "Delete"}
                    </Button>
                  )}
                </div>
              </li>
            );
          })}
        </ul>
      )}
    </FieldScreen>
  );
}
