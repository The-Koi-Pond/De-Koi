// ──────────────────────────────────────────────
// Update ("patch") schemas
// ──────────────────────────────────────────────
// An update sends only the fields that changed. Zod 4's `.partial()` still fills
// in a field's `.default()` / `.prefault()` when the field is missing, so
// `createSchema.partial().parse({ name })` would come back with every defaulted
// field reset (an empty description, no tags). These helpers keep a missing field
// missing, which is what `.partial()` / `.deepPartial()` did in Zod 3.
import { z } from "zod";

type AnyField = z.core.$ZodType;

type WithoutDefault<F> =
  F extends z.ZodDefault<infer Inner extends AnyField>
    ? Inner
    : F extends z.ZodPrefault<infer Inner extends AnyField>
      ? Inner
      : F;

type PatchShape<S extends z.core.$ZodShape> = { [K in keyof S]: z.ZodOptional<WithoutDefault<S[K]> & AnyField> };

type DeepPartial<T> = T extends readonly (infer Item)[]
  ? DeepPartial<Item>[]
  : T extends Record<string, unknown>
    ? { [K in keyof T]?: DeepPartial<T[K]> }
    : T;

function withoutDefault(field: AnyField): AnyField {
  return field instanceof z.ZodDefault || field instanceof z.ZodPrefault ? field.unwrap() : field;
}

/** `.partial()` for updates: every field optional, and a missing field never gets its default. */
export function patchSchema<S extends z.core.$ZodShape, C extends z.core.$ZodObjectConfig>(
  schema: z.ZodObject<S, C>,
): z.ZodObject<PatchShape<S>, C> {
  const shape = Object.fromEntries(
    Object.entries(schema.shape).map(([key, field]) => [key, z.optional(withoutDefault(field))]),
  );
  return schema.extend(shape) as unknown as z.ZodObject<PatchShape<S>, C>;
}

// Zod 3's deepPartial: objects are made partial at every depth, through arrays,
// optionals, nullables and tuples. A field behind a default is not looked into
// (Zod 3 didn't either), but its default no longer fills a missing field.
function deepPartialField(field: AnyField): AnyField {
  if (field instanceof z.ZodObject) return deepPatchSchema(field);
  if (field instanceof z.ZodArray) {
    const element = deepPartialField(field.element);
    return element === field.element ? field : field.clone({ ...field._zod.def, element } as typeof field._zod.def);
  }
  if (field instanceof z.ZodOptional) {
    const inner = deepPartialField(field.unwrap());
    return inner === field.unwrap()
      ? field
      : field.clone({ ...field._zod.def, innerType: inner } as typeof field._zod.def);
  }
  if (field instanceof z.ZodNullable) {
    const inner = deepPartialField(field.unwrap());
    return inner === field.unwrap()
      ? field
      : field.clone({ ...field._zod.def, innerType: inner } as typeof field._zod.def);
  }
  if (field instanceof z.ZodTuple) {
    const items = field._zod.def.items.map((item) => deepPartialField(item));
    return items.every((item, index) => item === field._zod.def.items[index])
      ? field
      : field.clone({ ...field._zod.def, items } as typeof field._zod.def);
  }
  return field;
}

/** `.deepPartial()` for updates, with the same missing-field rule as `patchSchema`. */
export function deepPatchSchema<S extends z.core.$ZodShape, C extends z.core.$ZodObjectConfig>(
  schema: z.ZodObject<S, C>,
): z.ZodObject<{ [K in keyof S]: z.ZodOptional<z.ZodType<DeepPartial<z.output<S[K]>>>> }, C> {
  const shape = Object.fromEntries(
    Object.entries(schema.shape).map(([key, field]) => [
      key,
      z.optional(
        field instanceof z.ZodDefault || field instanceof z.ZodPrefault ? field.unwrap() : deepPartialField(field),
      ),
    ]),
  );
  return schema.extend(shape) as never;
}
