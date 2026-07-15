// ──────────────────────────────────────────────
// Theme Zod Schemas
// ──────────────────────────────────────────────
import { z } from "zod";
import { utf8ByteLength } from "../text-bytes";

export const MAX_THEME_CSS_BYTES = 256 * 1024;

const themeCssSchema = z.string().refine((css) => utf8ByteLength(css) <= MAX_THEME_CSS_BYTES, {
  message: "Theme CSS must be 256 KiB or smaller",
});

export const createThemeSchema = z.object({
  name: z.string().min(1).max(200),
  css: themeCssSchema.default(""),
  installedAt: z.string().datetime().optional(),
});

export const updateThemeSchema = z
  .object({
    name: z.string().min(1).max(200).optional(),
    css: themeCssSchema.optional(),
    isActive: z.boolean().optional(),
    active: z.boolean().optional(),
  })
  .refine((value) => Object.keys(value).length > 0, {
    message: "Must update at least one field",
  });

export const setActiveThemeSchema = z.object({
  id: z.string().nullable(),
});

export type CreateThemeInput = z.infer<typeof createThemeSchema>;
export type UpdateThemeInput = z.infer<typeof updateThemeSchema>;
export type SetActiveThemeInput = z.infer<typeof setActiveThemeSchema>;
