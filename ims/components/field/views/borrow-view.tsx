"use client";

import { useCallback, useEffect, useState } from "react";
import { Camera, Plus, Send, Trash2, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Field } from "@/components/common/field";
import { StatusChip } from "@/components/common/status-chip";
import { NumberInput } from "@/components/common/number-input";
import { FieldScreen } from "../field-shell";
import { go, useField } from "../field-context";
import { Scanner } from "../scanner";
import { fieldFetch } from "@/lib/field/net";
import {
  describeLines,
  findItems,
  listBorrowDrafts,
  mergeLines,
  removeBorrowDraft,
  saveBorrowDraft,
  sendBorrowDraft,
  type ItemHit,
} from "@/lib/field/borrow";
import type { BorrowDraftRec, BorrowLineRec } from "@/lib/field/db";
import { normalizeCode, parseScan } from "@/lib/codes";

type Loc = { id: string; code: string; name: string };
const LOC_KEY = (u: string) => `ims-field-locations-${u}`;

const STATE: Record<
  BorrowDraftRec["status"],
  { kind: "sync"; status: "DRAFT" | "SENDING" | "ACKED" | "REJECTED" | "FAILED"; text: string }
> = {
  DRAFT: { kind: "sync", status: "DRAFT", text: "Not official yet. Send it when you're ready." },
  SENDING: { kind: "sync", status: "SENDING", text: "Sending…" },
  SENT: { kind: "sync", status: "ACKED", text: "Sent. A supervisor checks it and releases the items." },
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
  const [lines, setLines] = useState<BorrowLineRec[]>([]);
  const [tag, setTag] = useState("");
  const [scan, setScan] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [sending, setSending] = useState<string | null>(null);
  const [tagError, setTagError] = useState<string | null>(null);
  const [hits, setHits] = useState<{ q: string; rows: ItemHit[] } | null>(null);

  const reload = useCallback(() => listBorrowDrafts(db).then(setList), [db]);
  useEffect(() => {
    void reload();
  }, [reload]);

  // Online: show matching items while typing.
  const q = tag.trim();
  const searching = online && q.length >= 2;
  useEffect(() => {
    if (!searching) return;
    let alive = true;
    const t = setTimeout(() => {
      findItems(fieldFetch, q).then(
        (rows) => alive && setHits({ q, rows: rows.slice(0, 8) }),
        () => alive && setHits(null),
      );
    }, 300);
    return () => {
      alive = false;
      clearTimeout(t);
    };
  }, [searching, q]);
  const shown = searching && hits?.q === q ? hits.rows : null;
  const loc = locs.find((l) => l.id === form.locationId);

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
    setLines(d?.lines ?? []);
  }

  function addLine(l: BorrowLineRec) {
    setLines((ls) => mergeLines([...ls, l]));
    setTag("");
    setScan(false);
    setTagError(null);
  }
  const addHit = (h: ItemHit) => {
    addLine({ itemId: h.id, label: `${h.name} (${h.sku})`, quantity: 1 });
    setMsg(`Added ${h.name}. Set how many below.`);
  };

  /** A typed or scanned code: matched online; offline it's kept as a code and the server matches it on Send. */
  async function addTag(raw: string) {
    setTagError(null);
    const s = parseScan(raw);
    if (!s) return;
    if (s.kind === "ims") {
      if (s.type !== "item") return setMsg("That label is a location. Scan the label on the item or its shelf.");
      // Show the name if this phone knows the item from a downloaded count.
      const known = await db.targets.filter((t) => t.itemId === s.id).first();
      addLine({ itemId: s.id, label: known ? `${known.name} (${known.sku})` : "Scanned item", quantity: 1 });
      return setMsg(`Added ${known?.name ?? "the scanned item"}. Set how many below.`);
    }
    const code = normalizeCode(s.code);
    if (online) {
      let rows: ItemHit[] | null = null;
      try {
        rows = await findItems(fieldFetch, code);
      } catch {
        /* no answer: keep the code, the server checks it on Send */
      }
      if (rows) {
        const exact = rows.find((r) => r.sku === code) ?? (rows.length === 1 ? rows[0] : undefined);
        if (exact) return addHit(exact);
        if (!rows.length) {
          setMsg(null);
          return setTagError(`No item matches ${code}. Check the code, or search by name.`);
        }
        return setMsg("Several items match. Tap the right one in the list.");
      }
    }
    addLine({ code, label: code, quantity: 1 });
    setMsg(
      online ? `Added ${code}.` : `Added ${code}. You're offline, so it isn't checked yet; the supervisor checks it.`,
    );
  }

  async function save() {
    setError(null);
    if (!loc) return setError("Pick where to borrow from.");
    try {
      await saveBorrowDraft(db, {
        id: editing === "new" ? undefined : editing!,
        location: loc,
        ...form,
        lines,
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
        <Field id="br-loc" label="Borrow from">
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
        <Field id="br-tag" label="Items" hint="Type a name or SKU to find the item, or scan its label or barcode.">
          <div className="flex gap-2">
            <Input
              id="br-tag"
              value={tag}
              autoComplete="off"
              autoCapitalize="characters"
              className="h-12 min-w-0 flex-1 text-lg"
              aria-invalid={!!tagError || undefined}
              aria-describedby={tagError ? "br-tag-error" : undefined}
              onChange={(e) => {
                setTag(e.target.value);
                setTagError(null);
              }}
              onKeyDown={(e) => {
                if (e.key === "Enter") {
                  e.preventDefault();
                  void addTag(tag);
                }
              }}
            />
            {/* size="lg" is full width on field screens, so the small Add button uses size="icon". */}
            <Button type="button" size="icon" variant="outline" onClick={() => void addTag(tag)} aria-label="Add item">
              <Plus aria-hidden />
            </Button>
          </div>
        </Field>
        {tagError && (
          <p id="br-tag-error" className="font-medium text-danger" role="alert">
            {tagError}
          </p>
        )}
        {shown && !tagError && (
          <>
            {shown.length === 0 ? (
              <p className="font-medium text-danger" role="alert">
                No item matches &quot;{q}&quot;.
              </p>
            ) : (
              <ul className="flex flex-col divide-y rounded-lg border bg-card" aria-label="Matching items">
                {shown.map((h) => (
                  <li key={h.id} className="flex items-center gap-3 p-3">
                    <div className="min-w-0 flex-1">
                      <p className="font-medium">{h.name}</p>
                      <p className="text-sm text-muted-foreground">
                        {h.sku} · {h.onHand} {h.unitCode} on hand
                      </p>
                    </div>
                    <Button type="button" variant="outline" onClick={() => addHit(h)}>
                      <Plus aria-hidden /> Add
                    </Button>
                  </li>
                ))}
              </ul>
            )}
          </>
        )}
        <Button type="button" size="lg" variant="outline" onClick={() => setScan((s) => !s)} aria-pressed={scan}>
          <Camera aria-hidden /> {scan ? "Stop scanning" : "Scan a label"}
        </Button>
        {scan && <Scanner onCode={(c) => void addTag(c)} />}
        {msg && (
          <p className="text-[15px]" role="status">
            {msg}
          </p>
        )}
        {lines.length > 0 && (
          <ul className="flex flex-col divide-y rounded-lg border bg-card" aria-label="Items in this request">
            {lines.map((l, i) => (
              <li key={l.itemId ?? l.code} className="flex flex-col gap-2 p-3">
                <div className="flex items-center gap-2">
                  <p className="min-w-0 flex-1 font-medium">{l.label}</p>
                  <Button
                    type="button"
                    size="icon"
                    variant="ghost"
                    aria-label={`Remove ${l.label}`}
                    onClick={() => setLines((ls) => ls.filter((_, j) => j !== i))}
                  >
                    <X aria-hidden />
                  </Button>
                </div>
                <NumberInput
                  id={`br-qty-${i}`}
                  label={`quantity of ${l.label}`}
                  aria-label={`How many ${l.label}`}
                  min={1}
                  value={l.quantity}
                  onChange={(v) => setLines((ls) => ls.map((x, j) => (j === i ? { ...x, quantity: v ?? 1 } : x)))}
                />
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
        Ask for items here. A supervisor checks the request and releases it; the stock goes down and the official form
        is made then.
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
              <li key={d.id} className="flex flex-col gap-2 surface p-4">
                <div className="flex flex-wrap items-start justify-between gap-2">
                  <div className="min-w-0">
                    <p className="text-lg font-semibold">{describeLines(d)}</p>
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
