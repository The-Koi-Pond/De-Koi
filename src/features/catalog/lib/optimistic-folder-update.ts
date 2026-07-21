import type { QueryClient, QueryKey } from "@tanstack/react-query";

type FolderRecord = { id: string };
const folderUpdateRevisions = new WeakMap<QueryClient, Map<string, number>>();

export interface OptimisticFolderUpdateContext {
  id: string;
  optimisticValues: Record<string, unknown>;
  previousValues: Record<string, unknown>;
  revisions: Record<string, number>;
}

function revisionKey(queryKey: QueryKey, folderId: string, field: string): string {
  return JSON.stringify([queryKey, folderId, field]);
}

export async function optimisticallyUpdateFolder<TFolder extends FolderRecord>(
  queryClient: QueryClient,
  queryKey: QueryKey,
  update: FolderRecord,
): Promise<OptimisticFolderUpdateContext | null> {
  await queryClient.cancelQueries({ queryKey, exact: true });

  const folders = queryClient.getQueryData<TFolder[]>(queryKey);
  const previousFolder = folders?.find((folder) => folder.id === update.id);
  if (!previousFolder) return null;

  const optimisticValues = { ...(update as Record<string, unknown>) };
  delete optimisticValues.id;
  const previousRecord = previousFolder as TFolder & Record<string, unknown>;
  const previousValues = Object.fromEntries(Object.keys(optimisticValues).map((key) => [key, previousRecord[key]]));
  const revisionMap = folderUpdateRevisions.get(queryClient) ?? new Map<string, number>();
  folderUpdateRevisions.set(queryClient, revisionMap);
  const revisions = Object.fromEntries(
    Object.keys(optimisticValues).map((key) => {
      const keyForField = revisionKey(queryKey, update.id, key);
      const revision = (revisionMap.get(keyForField) ?? 0) + 1;
      revisionMap.set(keyForField, revision);
      return [key, revision];
    }),
  );

  queryClient.setQueryData<TFolder[]>(queryKey, (current) =>
    current?.map((folder) => (folder.id === update.id ? { ...folder, ...optimisticValues } : folder)),
  );

  return { id: update.id, optimisticValues, previousValues, revisions };
}

export function rollbackOptimisticFolderUpdate<TFolder extends FolderRecord>(
  queryClient: QueryClient,
  queryKey: QueryKey,
  context: OptimisticFolderUpdateContext | null | undefined,
): void {
  if (!context) return;
  const revisionMap = folderUpdateRevisions.get(queryClient);

  queryClient.setQueryData<TFolder[]>(queryKey, (folders) =>
    folders?.map((folder) => {
      if (folder.id !== context.id) return folder;

      const current = folder as TFolder & Record<string, unknown>;
      const rollbackValues: Record<string, unknown> = {};
      for (const [key, optimisticValue] of Object.entries(context.optimisticValues)) {
        const isLatestUpdate = revisionMap?.get(revisionKey(queryKey, context.id, key)) === context.revisions[key];
        if (isLatestUpdate && Object.is(current[key], optimisticValue)) {
          rollbackValues[key] = context.previousValues[key];
        }
      }
      return { ...folder, ...rollbackValues };
    }),
  );
}
