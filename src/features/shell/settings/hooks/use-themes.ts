// ──────────────────────────────────────────────
// Hooks: Custom Themes
// ──────────────────────────────────────────────
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { storageApi } from "../../../../shared/api/storage-api";
import { themesApi } from "../../../../shared/api/customization-api";
import {
  createThemeSchema,
  setActiveThemeSchema,
  updateThemeSchema,
  type CreateThemeInput,
  type UpdateThemeInput,
} from "../../../../engine/contracts/schemas/theme.schema";
import type { Theme } from "../../../../engine/contracts/types/theme";

const themeKeys = {
  all: ["themes"] as const,
  list: () => [...themeKeys.all, "list"] as const,
};

export function findDuplicateTheme(themes: Theme[], name: string, css: string) {
  return themes.find((theme) => theme.name === name && theme.css === css) ?? null;
}

export function useThemes() {
  return useQuery({
    queryKey: themeKeys.list(),
    queryFn: () => storageApi.list<Theme>("themes"),
    staleTime: Infinity,
    refetchOnWindowFocus: false,
    refetchOnReconnect: false,
  });
}

export function useCreateTheme() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (data: CreateThemeInput) => storageApi.create<Theme>("themes", createThemeSchema.parse(data)),
    onSuccess: (createdTheme) => {
      qc.setQueryData<Theme[]>(themeKeys.list(), (themes) => {
        if (!themes) return [createdTheme];
        const existingTheme = themes.some((theme) => theme.id === createdTheme.id);
        if (existingTheme) {
          return themes.map((theme) => (theme.id === createdTheme.id ? { ...theme, ...createdTheme } : theme));
        }
        return [...themes, createdTheme];
      });
      void qc.invalidateQueries({ queryKey: themeKeys.all });
    },
  });
}

export function useUpdateTheme() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id, ...data }: { id: string } & UpdateThemeInput) =>
      storageApi.update<Theme>("themes", id, updateThemeSchema.parse(data)),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: themeKeys.all });
    },
  });
}

export function useDeleteTheme() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => storageApi.delete("themes", id),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: themeKeys.all });
    },
  });
}

export function useSetActiveTheme() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (id: string | null): Promise<Theme | null> => {
      const payload = setActiveThemeSchema.parse({ id });
      return themesApi.setActive(payload.id);
    },
    onMutate: (id) => {
      const previous = qc.getQueryData<Theme[]>(themeKeys.list());
      if (previous) {
        qc.setQueryData<Theme[]>(
          themeKeys.list(),
          previous.map((theme) => {
            const isActive = !!id && theme.id === id;
            return { ...theme, isActive, active: isActive };
          }),
        );
      }
      return { previous };
    },
    onError: (_error, _id, context) => {
      if (context?.previous) {
        qc.setQueryData(themeKeys.list(), context.previous);
      }
    },
    onSuccess: (selected, id) => {
      qc.setQueryData<Theme[] | undefined>(themeKeys.list(), (themes) =>
        themes?.map((theme) => {
          const isActive = !!id && theme.id === id;
          if (selected && theme.id === selected.id) {
            return { ...theme, ...selected, isActive: true, active: true };
          }
          return { ...theme, isActive, active: isActive };
        }),
      );
      void qc.invalidateQueries({ queryKey: themeKeys.all });
    },
  });
}
