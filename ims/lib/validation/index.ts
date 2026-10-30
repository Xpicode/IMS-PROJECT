import { z } from "zod";
import { ApiError, type FieldErrors } from "@/lib/api/errors";

/**
 * Shared Zod schemas. The same schema validates the form on the client and the
 * request body in the API (IMS_BUILD_PLAN §5 "Forms").
 */
export const roleSchema = z.enum(["ADMIN", "SUPERVISOR", "FIELD"]);
export const locationTypeSchema = z.enum(["WAREHOUSE", "SITE", "AREA"]);
export const locationAccessSchema = z.enum(["FULL", "VIEW_ONLY"]);
export const uuid = z.uuid({ error: "Pick a valid record." });

export const passwordSchema = z
  .string()
  .min(10, { error: "Use at least 10 characters." })
  .max(200, { error: "Use 200 characters or fewer." });

export const emailSchema = z
  .string()
  .trim()
  .toLowerCase()
  .pipe(z.email({ error: "Enter a valid email address, like name@company.com." }).max(254));

const name = z.string().trim().min(1, { error: "Enter a name." }).max(120, { error: "Use 120 characters or fewer." });

export const userLocationsSchema = z
  .array(z.object({ id: uuid, access: locationAccessSchema.default("FULL") }))
  .max(200)
  .refine((ls) => new Set(ls.map((l) => l.id)).size === ls.length, { error: "Each location can be added once." });

export const createUserSchema = z.object({
  name,
  email: emailSchema,
  password: passwordSchema,
  role: roleSchema,
  locations: userLocationsSchema.default([]),
});
export type CreateUserInput = z.input<typeof createUserSchema>;

export const updateUserSchema = z
  .object({
    name: name.optional(),
    role: roleSchema.optional(),
    status: z.enum(["ACTIVE", "INACTIVE"]).optional(),
    locations: userLocationsSchema.optional(),
  })
  .refine((v) => Object.values(v).some((x) => x !== undefined), { error: "Nothing to change." });
export type UpdateUserInput = z.input<typeof updateUserSchema>;

export const locationCodeSchema = z
  .string()
  .trim()
  .toUpperCase()
  .min(1, { error: "Enter a short code, like WH-A." })
  .max(40, { error: "Use 40 characters or fewer." })
  .regex(/^[A-Z0-9][A-Z0-9._-]*$/, { error: "Use letters, numbers, dots, dashes, or underscores." });

export const createLocationSchema = z.object({
  code: locationCodeSchema,
  name,
  type: locationTypeSchema,
  parentId: uuid.nullish(),
});
export type CreateLocationInput = z.input<typeof createLocationSchema>;

export const updateLocationSchema = z
  .object({
    name: name.optional(),
    type: locationTypeSchema.optional(),
    isActive: z.boolean().optional(),
  })
  .refine((v) => Object.values(v).some((x) => x !== undefined), { error: "Nothing to change." });
export type UpdateLocationInput = z.input<typeof updateLocationSchema>;

export const resetPasswordSchema = z.object({
  token: z.string().min(20).max(200),
  password: passwordSchema,
});

/** Turn Zod issues into { "field.path": ["message"] }. */
export function fieldErrors(err: z.ZodError): FieldErrors {
  const out: FieldErrors = {};
  for (const issue of err.issues) {
    const key = issue.path.join(".") || "_";
    (out[key] ??= []).push(issue.message);
  }
  return out;
}

/** Parse or throw VALIDATION_FAILED (422) with field errors. */
export function parse<S extends z.ZodType>(schema: S, data: unknown): z.output<S> {
  const r = schema.safeParse(data);
  if (r.success) return r.data;
  throw new ApiError("VALIDATION_FAILED", "Some fields need attention. Check the highlighted fields.", {
    fields: fieldErrors(r.error),
  });
}

// ---------------------------------------------------------------------------
// Phase 2: items, stock, assets
// ---------------------------------------------------------------------------

const optText = (max: number) =>
  z
    .string()
    .trim()
    .max(max, { error: `Use ${max} characters or fewer.` })
    .transform((v) => v || undefined)
    .optional();

export const skuSchema = z
  .string()
  .trim()
  .toUpperCase()
  .min(1, { error: "Enter a SKU, like PPE-0001." })
  .max(40, { error: "Use 40 characters or fewer." })
  .regex(/^[A-Z0-9][A-Z0-9._\-/]*$/, { error: "Use letters, numbers, dots, dashes, slashes, or underscores." });

/** Whole numbers only (default policy §9.2, pending confirmation). */
export const quantitySchema = z
  .number({ error: "Enter a quantity." })
  .int({ error: "Use whole numbers only." })
  .positive({ error: "Enter more than 0." })
  .max(1_000_000, { error: "That's more than 1,000,000. Check the quantity." });

const minStockSchema = z
  .number()
  .int({ error: "Use a whole number." })
  .min(0, { error: "Use 0 or more." })
  .max(1_000_000);

export const createItemSchema = z.object({
  sku: skuSchema,
  name: z.string().trim().min(1, { error: "Enter the item name." }).max(160),
  description: optText(1000),
  categoryId: uuid.nullish(),
  unitId: uuid,
  trackingType: z.enum(["STOCK", "ASSET"], { error: "Pick Stock (counted) or Asset (individually tagged)." }),
  minStock: minStockSchema.default(0),
  brand: optText(80),
  model: optText(80),
  barcode: optText(100),
});
export type CreateItemInput = z.input<typeof createItemSchema>;

export const updateItemSchema = createItemSchema
  .omit({ sku: true, trackingType: true, barcode: true })
  .partial()
  // No default here: a .default() survives .partial() in Zod 4, so an edit that left
  // the field out would reset the low-stock level to 0.
  .extend({ minStock: minStockSchema.optional(), isActive: z.boolean().optional() });
export type UpdateItemInput = z.input<typeof updateItemSchema>;

const linesSchema = z
  .array(z.object({ itemId: uuid, quantity: quantitySchema }))
  .min(1, { error: "Add at least one item." })
  .max(100, { error: "Use 100 lines or fewer. Split it into two transactions." })
  .refine((ls) => new Set(ls.map((l) => l.itemId)).size === ls.length, {
    error: "Each item can appear once. Combine the quantities into one line.",
  });

/** Going ahead while a count is open (§7.7): only with a written reason. */
export const countExceptionSchema = z
  .object({
    reason: z.string().trim().min(3, { error: "Say why stock has to move while it is being counted." }).max(300),
  })
  .optional();

export const receiptSchema = z.object({
  locationId: uuid,
  lines: linesSchema,
  source: optText(160),
  countException: countExceptionSchema,
  externalRef: optText(80),
  notes: optText(1000),
});
export type ReceiptInput = z.input<typeof receiptSchema>;

export const issueSchema = z.object({
  locationId: uuid,
  lines: linesSchema,
  recipientName: z.string().trim().min(1, { error: "Enter who receives the stock." }).max(120),
  purpose: z.string().trim().min(1, { error: "Enter what it's for, like a work order." }).max(300),
  notes: optText(1000),
  countException: countExceptionSchema,
});
export type IssueInput = z.input<typeof issueSchema>;

export const transferSchema = z
  .object({
    fromLocationId: uuid,
    toLocationId: uuid,
    lines: linesSchema,
    reason: optText(300),
    notes: optText(1000),
    countException: countExceptionSchema,
  })
  .refine((v) => v.fromLocationId !== v.toLocationId, {
    error: "Pick two different locations.",
    path: ["toLocationId"],
  });
export type TransferInput = z.input<typeof transferSchema>;

export const assetConditionSchema = z.enum(["GOOD", "FAIR", "DAMAGED"]);
export const assetStatusSchema = z.enum([
  "AVAILABLE",
  "BORROWED",
  "UNDER_MAINTENANCE",
  "NEEDS_REVIEW",
  "LOST",
  "RETIRED",
]);

export const tagPrefixSchema = z
  .string()
  .trim()
  .toUpperCase()
  .min(1, { error: "Enter a tag prefix, like TOOL." })
  .max(20)
  .regex(/^[A-Z0-9][A-Z0-9-]*$/, { error: "Use letters, numbers, and dashes." });

export const createAssetsSchema = z.object({
  itemId: uuid,
  locationId: uuid,
  quantity: z
    .number()
    .int({ error: "Use a whole number." })
    .min(1, { error: "Add at least 1." })
    .max(200, { error: "Add 200 or fewer at a time." }),
  tagPrefix: tagPrefixSchema,
  condition: assetConditionSchema.default("GOOD"),
  custodianName: optText(120),
  serialNumbers: z.array(z.string().trim().max(100)).max(200).default([]),
  notes: optText(1000),
});
export type CreateAssetsInput = z.input<typeof createAssetsSchema>;

export const changeAssetStatusSchema = z.object({
  status: assetStatusSchema,
  reason: z.string().trim().min(1, { error: "Say why the status is changing." }).max(1000),
  expectedVersion: z.number().int().positive(),
});
export type ChangeAssetStatusInput = z.input<typeof changeAssetStatusSchema>;

export const updateAssetSchema = z
  .object({
    serialNumber: z.string().trim().max(100).nullable().optional(),
    condition: assetConditionSchema.optional(),
    custodianName: z.string().trim().max(120).nullable().optional(),
    notes: z.string().trim().max(1000).nullable().optional(),
    expectedVersion: z.number().int().positive(),
  })
  .refine((v) => Object.keys(v).some((k) => k !== "expectedVersion" && v[k as keyof typeof v] !== undefined), {
    error: "Nothing to change.",
  });
export type UpdateAssetInput = z.input<typeof updateAssetSchema>;

export const categorySchema = z.object({ name: z.string().trim().min(1, { error: "Enter a name." }).max(80) });
export const unitSchema = z.object({
  code: z
    .string()
    .trim()
    .toLowerCase()
    .min(1, { error: "Enter a short code, like pcs." })
    .max(20)
    .regex(/^[a-z0-9][a-z0-9._-]*$/, { error: "Use letters, numbers, dots, or dashes." }),
  name: z.string().trim().min(1, { error: "Enter a name, like Piece." }).max(60),
});

// ---------------------------------------------------------------------------
// Phase 3: count sessions
// ---------------------------------------------------------------------------

export const createCountSchema = z
  .object({
    name: z.string().trim().min(1, { error: "Name the count, like Q4 count – Main Warehouse." }).max(120),
    locationId: uuid,
    assigneeIds: z.array(uuid).max(50, { error: "Assign 50 people or fewer." }).default([]),
    includeStock: z.boolean().default(true),
    includeAssets: z.boolean().default(true),
    /** Empty = everything at the location. */
    categoryIds: z.array(uuid).max(100).default([]),
    dueAt: z.iso.datetime({ offset: true, error: "Pick a valid date." }).nullish(),
    notes: optText(1000),
  })
  .refine((v) => v.includeStock || v.includeAssets, {
    error: "Count stock, assets, or both.",
    path: ["includeStock"],
  });
export type CreateCountInput = z.input<typeof createCountSchema>;

// ---------------------------------------------------------------------------
// Borrowing (§7.5–7.6)
// ---------------------------------------------------------------------------
const personName = (what: string) =>
  z
    .string()
    .trim()
    .min(1, { error: `Enter ${what}.` })
    .max(120);
const loanHeader = {
  locationId: uuid,
  borrowerName: personName("who is borrowing"),
  borrowerDept: optText(120),
  purpose: z.string().trim().min(1, { error: "Enter what it's for, like a work order." }).max(300),
  dueAt: z.iso.datetime({ offset: true, error: "Pick a valid date." }).nullish(),
  receivedByName: optText(120),
  notes: optText(1000),
};

export const borrowDraftSchema = z
  .object({
    ...loanHeader,
    assetIds: z.array(uuid).max(100).default([]),
    /** Typed or scanned tags (field drafts). */
    assetTags: z.array(z.string().trim().min(1).max(60)).max(100).default([]),
  })
  .refine((v) => v.assetIds.length + v.assetTags.length > 0, { error: "Add at least one asset.", path: ["assetTags"] });
export type BorrowDraftInput = z.input<typeof borrowDraftSchema>;

export const releaseSchema = z.object({
  ...loanHeader,
  /** Release a draft prepared earlier (keeps its id). */
  draftId: uuid.optional(),
  lines: z
    .array(
      z.object({
        assetId: uuid,
        condition: z.enum(["GOOD", "FAIR", "DAMAGED"]),
        accessories: optText(300),
      }),
    )
    .min(1, { error: "Add at least one asset." })
    .max(100, { error: "Release 100 assets or fewer at a time." }),
});
export type ReleaseInput = z.input<typeof releaseSchema>;

export const returnSchema = z.object({
  returnedByName: personName("who brought it back"),
  /** Receiving location; defaults to where it was borrowed from. */
  locationId: uuid.optional(),
  notes: optText(1000),
  lines: z
    .array(
      z.object({
        lineId: uuid,
        condition: z.enum(["GOOD", "FAIR", "DAMAGED"]),
        /** Damaged assets go to review by default (§7.6 step 5). */
        damagedStatus: z.enum(["UNDER_MAINTENANCE", "NEEDS_REVIEW"]).optional(),
        missingAccessories: optText(300),
        notes: optText(500),
      }),
    )
    .min(1, { error: "Tick at least one asset that is coming back." })
    .max(100),
});
export type ReturnInput = z.input<typeof returnSchema>;
