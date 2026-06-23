import { z } from "zod";

const MAX_EXTENSION_CSS_BYTES = 256 * 1024; // 256 KiB
const MAX_EXTENSION_JS_BYTES = 1024 * 1024; // 1 MiB

function utf8ByteLength(value: string): number {
  let bytes = 0;
  for (let i = 0; i < value.length; i += 1) {
    const code = value.charCodeAt(i);
    if (code < 0x80) bytes += 1;
    else if (code < 0x800) bytes += 2;
    else if (code >= 0xd800 && code < 0xdc00) {
      bytes += 4;
      i += 1;
    } else bytes += 3;
  }
  return bytes;
}

const cssByteLimit = (value: string | null | undefined) =>
  value == null || utf8ByteLength(value) <= MAX_EXTENSION_CSS_BYTES;
const jsByteLimit = (value: string | null | undefined) =>
  value == null || utf8ByteLength(value) <= MAX_EXTENSION_JS_BYTES;

const cssByteMessage = `CSS must be at most ${MAX_EXTENSION_CSS_BYTES} bytes`;
const jsByteMessage = `JS must be at most ${MAX_EXTENSION_JS_BYTES} bytes`;

const PACKAGE_ID_PATTERN = /^[a-z0-9][a-z0-9._-]{0,95}$/i;
const packagePermissionSchema = z.enum([
  "ui:styles",
  "ui:settings",
  "ui:overlay",
  "ui:messages",
  "storage:plugin-memory",
  "runtime:dom",
  "prompt:read",
  "generation:request",
]);
const uiSlotSchema = z.enum(["settings", "overlay", "messages", "theme"]);
const compatibilitySchema = z
  .object({
    deKoi: z.string().min(1).max(80).optional(),
  })
  .strict();
const uiContributionsSchema = z
  .object({
    slots: z.array(uiSlotSchema).max(12).optional(),
  })
  .strict();
const sourceSchema = z.enum(["file", "package", "profile"]);
const extensionManifestMetadataSchema = {
  packageId: z.string().regex(PACKAGE_ID_PATTERN).optional(),
  packageVersion: z.string().min(1).max(80).optional(),
  manifestVersion: z.literal(1).optional(),
  compatibility: compatibilitySchema.nullable().optional(),
  permissions: z.array(packagePermissionSchema).max(16).optional(),
  uiContributions: uiContributionsSchema.nullable().optional(),
  source: sourceSchema.optional(),
};

export const createExtensionSchema = z.object({
  name: z.string().min(1).max(200),
  description: z.string().max(2000).default(""),
  css: z.string().nullable().optional().refine(cssByteLimit, { message: cssByteMessage }),
  js: z.string().nullable().optional().refine(jsByteLimit, { message: jsByteMessage }),
  enabled: z.boolean().optional(),
  installedAt: z.string().datetime().optional(),
  ...extensionManifestMetadataSchema,
});

export const updateExtensionSchema = z
  .object({
    name: z.string().min(1).max(200).optional(),
    description: z.string().max(2000).optional(),
    css: z.string().nullable().optional().refine(cssByteLimit, { message: cssByteMessage }),
    js: z.string().nullable().optional().refine(jsByteLimit, { message: jsByteMessage }),
    enabled: z.boolean().optional(),
    ...extensionManifestMetadataSchema,
  })
  .refine((value) => Object.keys(value).length > 0, {
    message: "Must update at least one field",
  });

export type CreateExtensionInput = z.infer<typeof createExtensionSchema>;
export type UpdateExtensionInput = z.infer<typeof updateExtensionSchema>;