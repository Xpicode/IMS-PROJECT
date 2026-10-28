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
