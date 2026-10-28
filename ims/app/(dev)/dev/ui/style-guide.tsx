"use client";

import { useState } from "react";
import { Boxes, MapPin, Save } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { ALL_STATUSES, StatusChip, type StatusKind } from "@/components/common/status-chip";
import { DataList, DataListSkeleton } from "@/components/common/data-list";
import { EmptyState } from "@/components/common/empty-state";
import { NumberInput } from "@/components/common/number-input";
import { ConfirmSheet } from "@/components/common/confirm-sheet";
import { Wizard } from "@/components/common/wizard";
import { SyncPill } from "@/components/common/sync-pill";
import { describedBy, Field } from "@/components/common/field";
import { PageHeader } from "@/components/common/page-header";

const SAMPLE = [
  { id: "1", sku: "PPE-0001", name: "Safety Gloves", unit: "pair", qty: 120, status: "OK" as const },
  { id: "2", sku: "ELC-0042", name: "Cable ties", unit: "pack", qty: 4, status: "LOW" as const },
  { id: "3", sku: "TOL-0007", name: "Drill bits 8mm", unit: "set", qty: 0, status: "OUT" as const },
];

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="flex flex-col gap-4 rounded-xl border bg-card p-4 md:p-6" aria-labelledby={title}>
      <h2 id={title} className="text-xl font-semibold">
        {title}
      </h2>
      {children}
    </section>
  );
}

export function StyleGuide() {
  const [qty, setQty] = useState<number | null>(98);
  const [small, setSmall] = useState<number | null>(5);
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [step, setStep] = useState(0);
  const [loading, setLoading] = useState(false);

  return (
    <main className="mx-auto flex w-full max-w-5xl flex-col gap-6 p-4 md:p-8">
      <PageHeader title="UI style guide" description="Every shared component in every state. Sample data only." actions={<SyncPill />} />

      <Section title="Colors">
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-5">
          {["primary", "success", "warning", "danger", "neutral"].map((t) => (
            <div key={t} className="flex flex-col gap-1">
              <div className="h-12 rounded-lg" style={{ background: `var(--${t === "primary" ? "primary" : t})` }} />
              <span className="text-sm">{t}</span>
            </div>
          ))}
        </div>
      </Section>

      <Section title="Typography">
        <p className="text-3xl font-semibold">Heading 30</p>
        <p className="text-2xl font-semibold">Heading 24</p>
        <p className="text-xl font-semibold">Heading 20</p>
        <p className="text-lg">Field body 18</p>
        <p>Body 16 — the minimum for inputs.</p>
        <p className="text-sm text-muted-foreground">Meta 14 — never smaller.</p>
        <p className="text-[36px] font-semibold tabular-nums">1234567890</p>
      </Section>

      <Section title="Buttons">
        <div className="flex flex-wrap gap-3">
          <Button>Confirm issue</Button>
          <Button variant="secondary">Secondary</Button>
          <Button variant="outline">Outline</Button>
          <Button variant="ghost">Ghost</Button>
          <Button variant="destructive">Deactivate</Button>
          <Button disabled>Disabled</Button>
          <Button loading>Saving…</Button>
          <Button size="sm" variant="outline">
            Small (desktop rows)
          </Button>
          <Button size="icon" variant="outline" aria-label="Locations">
            <MapPin aria-hidden />
          </Button>
        </div>
        <div className="max-w-sm">
          <Button size="lg" loading={loading} onClick={() => (setLoading(true), setTimeout(() => setLoading(false), 1500))}>
            <Save aria-hidden /> Save count
          </Button>
        </div>
      </Section>

      <Section title="Inputs">
        <div className="grid gap-4 md:grid-cols-2">
          <Field id="sg-a" label="Item name" hint="As printed on the label.">
            <Input id="sg-a" placeholder="Safety Gloves" {...describedBy("sg-a", undefined, true)} />
          </Field>
          <Field id="sg-b" label="SKU" error="This SKU is already in use. Pick another.">
            <Input id="sg-b" defaultValue="PPE-0001" {...describedBy("sg-b", "x")} />
          </Field>
          <Field id="sg-c" label="Quantity">
            <NumberInput id="sg-c" label="quantity" value={small} onChange={setSmall} />
          </Field>
          <Field id="sg-d" label="Notes" optional>
            <Textarea id="sg-d" placeholder="Two damaged pairs" />
          </Field>
        </div>
        <Field id="sg-e" label="Count (count screen size)">
          <div className="max-w-sm">
            <NumberInput id="sg-e" label="count" size="count" value={qty} onChange={setQty} />
          </div>
        </Field>
      </Section>

      <Section title="Status chips">
        {(Object.keys(ALL_STATUSES) as StatusKind[]).map((k) => (
          <div key={k} className="flex flex-col gap-2">
            <h3 className="text-sm font-medium text-muted-foreground uppercase">{k}</h3>
            <div className="flex flex-wrap gap-2">
              {(ALL_STATUSES[k] as string[]).map((s) => (
                <StatusChip key={s} kind={k} status={s as never} />
              ))}
            </div>
          </div>
        ))}
      </Section>

      <Section title="Alerts and toasts">
        <Alert variant="destructive">
          <AlertTitle>Only 3 left at Warehouse A</AlertTitle>
          <AlertDescription>Lower the quantity or pick another location.</AlertDescription>
        </Alert>
        <Alert>
          <AlertDescription>Password changed. Sign in with your new password.</AlertDescription>
        </Alert>
        <div className="flex flex-wrap gap-2">
          <Button variant="outline" onClick={() => toast.success("Issued 5 Safety Gloves. ISS-2026-000123.")}>
            Success toast
          </Button>
          <Button variant="outline" onClick={() => toast.error("No connection. Your count is saved on this device.")}>
            Error toast
          </Button>
        </div>
      </Section>

      <Section title="DataList (table ↔ cards)">
        <DataList
          label="Sample items"
          rows={SAMPLE}
          rowKey={(r) => r.id}
          columns={[
            { key: "name", header: "Item", primary: true, cell: (r) => r.name },
            { key: "sku", header: "SKU", cell: (r) => r.sku },
            { key: "qty", header: "On hand", align: "right", cell: (r) => `${r.qty} ${r.unit}` },
            { key: "st", header: "Stock", cell: (r) => <StatusChip kind="stock" status={r.status} /> },
          ]}
          rowLabel={(r) => r.name}
          actions={(r) => [
            { label: "Open", onSelect: () => toast(`Opened ${r.name} (sample).`) },
            { label: "Retire", destructive: true, onSelect: () => toast(`Retired ${r.name} (sample).`) },
          ]}
          empty={{ title: "No items" }}
          pagination={{ page: 1, pageCount: 3, href: (p) => `/dev/ui?page=${p}` }}
        />
        <h3 className="font-medium">Empty</h3>
        <DataList label="Empty" rows={[]} rowKey={() => ""} columns={[]} empty={{ icon: Boxes, title: "No counts yet", description: "Scan an item to start." }} />
        <h3 className="font-medium">Loading</h3>
        <DataListSkeleton rows={2} />
      </Section>

      <Section title="ConfirmSheet">
        <div>
          <Button onClick={() => setConfirmOpen(true)}>Open confirm</Button>
        </div>
        <ConfirmSheet
          open={confirmOpen}
          onOpenChange={setConfirmOpen}
          title="Issue stock?"
          description="This changes official balances."
          changes={[
            { label: "Main Warehouse: Safety Gloves", from: 120, to: 115 },
            { label: "Main Warehouse: Cable ties", from: 40, to: 38 },
          ]}
          confirmLabel="Confirm issue"
          onConfirm={() => new Promise((ok, fail) => setTimeout(() => (Math.random() > 0.5 ? ok(undefined) : fail(new Error("Only 3 left at Main Warehouse. Lower the quantity or pick another location."))), 800))}
        />
        <p className="text-sm text-muted-foreground">Fails half the time on purpose, to show the error state.</p>
      </Section>

      <Section title="Wizard">
        <Wizard
          title="Issue stock (sample)"
          current={step}
          onBack={() => setStep((s) => Math.max(0, s - 1))}
          onNext={() => setStep((s) => s + 1)}
          confirmLabel="Confirm issue"
          onConfirm={() => toast.success("Sample only — nothing was issued.")}
        >
          {step === 0 && <p>Where: pick the location to issue from.</p>}
          {step === 1 && <p>What: scan or pick items and quantities.</p>}
          {step === 2 && <p>Who: recipient and purpose.</p>}
          {step === 3 && (
            <dl className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-1">
              <dt className="text-muted-foreground">From</dt>
              <dd>Main Warehouse</dd>
              <dt className="text-muted-foreground">To</dt>
              <dd>Juan Dela Cruz – Site repair</dd>
              <dt className="text-muted-foreground">Items</dt>
              <dd className="tabular-nums">Safety Gloves 5 pair (120 → 115)</dd>
            </dl>
          )}
        </Wizard>
      </Section>

      <Section title="Empty state">
        <EmptyState title="No counts yet" description="Scan an item to start." action={<Button>Scan</Button>} />
      </Section>
    </main>
  );
}
