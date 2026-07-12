type DekiHistoryPersistenceEntity = "deki-sessions" | "deki-messages";

type DekiHistoryPersistenceRecord = {
  entity: DekiHistoryPersistenceEntity;
  id: string;
  value: Record<string, unknown>;
};

export type DekiHistoryPersistenceSnapshot = {
  activeSessionId: string;
  records: DekiHistoryPersistenceRecord[];
};

export type DekiHistoryPersistencePlan = {
  creates: DekiHistoryPersistenceRecord[];
  updates: DekiHistoryPersistenceRecord[];
  deletes: Array<Pick<DekiHistoryPersistenceRecord, "entity" | "id">>;
  activeSessionChanged: boolean;
};

function recordKey(record: Pick<DekiHistoryPersistenceRecord, "entity" | "id">): string {
  return `${record.entity}:${record.id}`;
}

function recordsEqual(left: Record<string, unknown>, right: Record<string, unknown>): boolean {
  return JSON.stringify(left) === JSON.stringify(right);
}

export function planDekiHistoryPersistence(
  previous: DekiHistoryPersistenceSnapshot,
  next: DekiHistoryPersistenceSnapshot,
): DekiHistoryPersistencePlan {
  const previousByKey = new Map(previous.records.map((record) => [recordKey(record), record]));
  const nextByKey = new Map(next.records.map((record) => [recordKey(record), record]));
  const creates: DekiHistoryPersistenceRecord[] = [];
  const updates: DekiHistoryPersistenceRecord[] = [];

  for (const record of next.records) {
    const existing = previousByKey.get(recordKey(record));
    if (!existing) creates.push(record);
    else if (!recordsEqual(existing.value, record.value)) updates.push(record);
  }

  const deletes = previous.records
    .filter((record) => !nextByKey.has(recordKey(record)))
    .map(({ entity, id }) => ({ entity, id }))
    .sort((left, right) => {
      if (left.entity !== right.entity) return left.entity === "deki-messages" ? -1 : 1;
      return left.id.localeCompare(right.id);
    });

  return {
    creates,
    updates,
    deletes,
    activeSessionChanged: previous.activeSessionId !== next.activeSessionId,
  };
}
