export type GroupMembershipMoveGroup = {
  id: string;
  memberIds: string[];
  isSynthetic?: boolean;
};

export type GroupMembershipMoveChange = {
  id: string;
  memberIds: string[];
  previousMemberIds: string[];
};

export class GroupMembershipRollbackError extends Error {
  readonly cause: unknown;
  readonly rollbackFailures: unknown[];

  constructor(cause: unknown, rollbackFailures: unknown[]) {
    super("Failed to update group membership and rollback did not fully complete.");
    this.name = "GroupMembershipRollbackError";
    this.cause = cause;
    this.rollbackFailures = rollbackFailures;
  }
}

function replaceMemberIds(memberIds: string[], itemId: string, shouldInclude: boolean): string[] {
  const withoutItem = memberIds.filter((memberId) => memberId !== itemId);
  return shouldInclude ? [...withoutItem, itemId] : withoutItem;
}

export function buildGroupMembershipMoveChanges({
  groups,
  itemId,
  sourceGroupId,
  targetGroupId,
}: {
  groups: readonly GroupMembershipMoveGroup[];
  itemId: string;
  sourceGroupId: string | null;
  targetGroupId: string | null;
}): GroupMembershipMoveChange[] {
  const realGroups = groups.filter((group) => group.isSynthetic !== true);
  const sourceGroup = sourceGroupId ? (realGroups.find((group) => group.id === sourceGroupId) ?? null) : null;
  const targetGroup = targetGroupId ? (realGroups.find((group) => group.id === targetGroupId) ?? null) : null;
  const changes: GroupMembershipMoveChange[] = [];

  if (sourceGroup && sourceGroup.id !== targetGroup?.id && sourceGroup.memberIds.includes(itemId)) {
    changes.push({
      id: sourceGroup.id,
      previousMemberIds: sourceGroup.memberIds,
      memberIds: replaceMemberIds(sourceGroup.memberIds, itemId, false),
    });
  }

  if (targetGroup && !targetGroup.memberIds.includes(itemId)) {
    changes.push({
      id: targetGroup.id,
      previousMemberIds: targetGroup.memberIds,
      memberIds: replaceMemberIds(targetGroup.memberIds, itemId, true),
    });
  }

  return changes;
}

export async function applyGroupMembershipChangesWithRollback(
  changes: readonly GroupMembershipMoveChange[],
  apply: (change: { id: string; memberIds: string[] }) => Promise<unknown>,
): Promise<void> {
  const applied: GroupMembershipMoveChange[] = [];

  try {
    for (const change of changes) {
      await apply({ id: change.id, memberIds: change.memberIds });
      applied.push(change);
    }
  } catch (error) {
    const rollbackFailures: unknown[] = [];
    for (const change of applied.reverse()) {
      try {
        await apply({ id: change.id, memberIds: change.previousMemberIds });
      } catch (rollbackError) {
        rollbackFailures.push(rollbackError);
      }
    }
    if (rollbackFailures.length > 0) {
      throw new GroupMembershipRollbackError(error, rollbackFailures);
    }
    throw error;
  }
}
