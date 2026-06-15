import { z } from "zod";

export const createLibraryFolderSchema = z.object({
  name: z.string().trim().min(1).max(200),
  collapsed: z.boolean().default(false),
  sortOrder: z.number().int().default(0),
  order: z.number().int().optional(),
});

export const updateLibraryFolderSchema = z.object({
  name: z.string().trim().min(1).max(200).optional(),
  collapsed: z.boolean().optional(),
  sortOrder: z.number().int().optional(),
  order: z.number().int().optional(),
});

export type CreateLibraryFolderInput = z.infer<typeof createLibraryFolderSchema>;
export type UpdateLibraryFolderInput = z.infer<typeof updateLibraryFolderSchema>;
