"use client";

import { useEffect, useRef, useState } from "react";
import { Keyboard } from "lucide-react";
import { Button } from "@/components/ui/button";
import { FieldScreen } from "../field-shell";
import { go, useField } from "../field-context";
import { Scanner } from "../scanner";
import { StorageAlert } from "../storage-alert";
import { findTargets } from "@/lib/field/store";
import type { AssignmentRec, TargetRec } from "@/lib/field/db";

/**
 * Scan or type a code. Opens the matching item/asset in the current
 * assignment (or any downloaded one). Typing always works, even without a camera.
 */
export function ScanView({ assignment, startTyping }: { assignment?: string; startTyping?: boolean }) {
  const { db } = useField();
  const [typing, setTyping] = useState(!!startTyping);
  const [code, setCode] = useState("");
  const [msg, setMsg] = useState<string | null>(null);
  const [choices, setChoices] = useState<(TargetRec & { assignmentName: string })[]>([]);
  const [error, setError] = useState<Error | null>(null);
  const [a, setA] = useState<AssignmentRec | null>(null);
  const [count, setCount] = useState<number | null>(null);
  const input = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (assignment)
      db.assignments.get(assignment).then(
        (x) => setA(x ?? null),
        () => undefined,
      );
    db.assignments.count().then(setCount, () => setCount(0));
  }, [db, assignment]);
  useEffect(() => {
    if (typing) input.current?.focus();
  }, [typing]);

  async function handle(raw: string) {
    const value = raw.trim();
    if (!value) return;
    setMsg(null);
    setChoices([]);
    setError(null);
    try {
      const hits = await findTargets(db, assignment ?? null, value);
      if (hits.length === 1) return go({ v: "count", a: hits[0].sessionId, t: hits[0].id });
      if (hits.length > 1) {
        const names = new Map((await db.assignments.toArray()).map((x) => [x.id, x.name]));
        return setChoices(hits.map((h) => ({ ...h, assignmentName: names.get(h.sessionId) ?? "" })));
      }
      setMsg(
        assignment
          ? `"${value}" is not part of this count. Check the label, or type the code again.`
          : `"${value}" is not in any assignment on this phone. Check the label, or download the assignment first.`,
      );
    } catch (e) {
      setError(e as Error);
    }
  }

  return (
    <FieldScreen
      title={a ? `Scan · ${a.location.code}` : "Scan"}
      subtitle={a?.name}
      back={assignment ? () => go({ v: "assignment", a: assignment }) : () => go({})}
    >
      {count === 0 && (
        <p className="rounded-lg border bg-muted/50 p-3">
          Nothing is downloaded yet. Go to Home and download an assignment, then scan.
        </p>
      )}
      {error && <StorageAlert error={error} />}
      {msg && (
        <p role="alert" className="rounded-lg border-2 border-warning bg-warning-soft p-3 font-medium text-warning">
          {msg}
        </p>
      )}
      {choices.length > 0 && (
        <section aria-label="Pick one" className="flex flex-col gap-2">
          <p className="font-medium">This code is in more than one assignment. Pick one:</p>
          {choices.map((c) => (
            <Button
              key={c.id}
              variant="outline"
              size="lg"
              className="justify-start"
              onClick={() => go({ v: "count", a: c.sessionId, t: c.id })}
            >
              {c.name} · {c.assignmentName}
            </Button>
          ))}
        </section>
      )}
      {!typing && <Scanner onCode={handle} />}
      {typing ? (
        <form
          onSubmit={(e) => {
            e.preventDefault();
            void handle(code);
          }}
          className="flex flex-col gap-2"
        >
          <label htmlFor="scan-code" className="font-medium">
            Type the code
          </label>
          <input
            ref={input}
            id="scan-code"
            value={code}
            onChange={(e) => setCode(e.target.value)}
            autoComplete="off"
            autoCapitalize="characters"
            enterKeyHint="search"
            placeholder="SKU, tag, or barcode number"
            className="h-14 rounded-lg border border-input bg-card px-3 text-lg outline-none focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50"
          />
          <Button type="submit" size="lg">
            Find
          </Button>
          <Button type="button" variant="outline" size="lg" onClick={() => setTyping(false)}>
            Use the camera
          </Button>
        </form>
      ) : (
        <Button size="lg" variant="outline" className="h-16 text-lg" onClick={() => setTyping(true)}>
          <Keyboard aria-hidden /> Type code instead
        </Button>
      )}
    </FieldScreen>
  );
}
