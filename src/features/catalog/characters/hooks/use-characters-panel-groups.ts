import { useCallback, useRef, useState } from "react";
import { toast } from "sonner";

import {
  applyGroupMembershipChangesWithRollback,
  buildGroupMembershipMoveChanges,
  GroupMembershipRollbackError,
} from "../../lib/group-membership-move";
import { useCreateGroup, useUpdateGroup } from "./use-characters";
import type { ParsedGroupRow } from "../lib/characters-panel-model";

export function useCharactersPanelGroups() {
  const createGroup = useCreateGroup();
  const updateGroup = useUpdateGroup();
  const membershipMoveInFlightRef = useRef(false);
  const [membershipMovePending, setMembershipMovePending] = useState(false);
  const [groupsExpanded, setGroupsExpanded] = useState(true);
  const [expandedGroupId, setExpandedGroupId] = useState<string | null>(null);
  const [creatingGroup, setCreatingGroup] = useState(false);
  const [newGroupName, setNewGroupName] = useState("");
  const [editingGroupId, setEditingGroupId] = useState<string | null>(null);
  const [editGroupName, setEditGroupName] = useState("");
  const [assigningToGroup, setAssigningToGroup] = useState<string | null>(null);

  const toggleGroupsExpanded = useCallback(() => {
    setGroupsExpanded((expanded) => !expanded);
  }, []);

  const startCreateGroup = useCallback(() => {
    setCreatingGroup(true);
    setGroupsExpanded(true);
  }, []);

  const cancelCreateGroup = useCallback(() => {
    setCreatingGroup(false);
    setNewGroupName("");
  }, []);

  const handleCreateGroup = useCallback(async () => {
    const name = newGroupName.trim();
    if (!name) return;
    const previousName = newGroupName;
    setNewGroupName("");
    setCreatingGroup(false);
    try {
      await createGroup.mutateAsync({ name, characterIds: [] });
    } catch (error) {
      setNewGroupName(previousName);
      setCreatingGroup(true);
      toast.error(error instanceof Error ? error.message : "Failed to create character folder.");
    }
  }, [newGroupName, createGroup]);

  const handleRenameGroup = useCallback(
    async (groupId: string) => {
      const name = editGroupName.trim();
      if (!name) return;
      const previousEditingGroupId = editingGroupId;
      const previousEditGroupName = editGroupName;
      setEditingGroupId(null);
      setEditGroupName("");
      try {
        await updateGroup.mutateAsync({ id: groupId, name });
      } catch (error) {
        setEditingGroupId(previousEditingGroupId ?? groupId);
        setEditGroupName(previousEditGroupName);
        toast.error(error instanceof Error ? error.message : "Failed to rename character folder.");
      }
    },
    [editGroupName, editingGroupId, updateGroup],
  );

  const toggleGroupMember = useCallback(
    (groupId: string, charId: string, groups: ParsedGroupRow[]) => {
      if (updateGroup.isPending || membershipMoveInFlightRef.current) return;
      const targetGroup = groups.find((group) => group.id === groupId && group.isSynthetic !== true);
      if (!targetGroup) return;
      const targetGroupId = targetGroup.memberIds.includes(charId) ? null : groupId;
      const changes = buildGroupMembershipMoveChanges({
        groups,
        itemId: charId,
        targetGroupId,
      });

      if (changes.length === 0) return;
      membershipMoveInFlightRef.current = true;
      setMembershipMovePending(true);
      void applyGroupMembershipChangesWithRollback(changes, (change) =>
        updateGroup.mutateAsync({ id: change.id, characterIds: change.memberIds }),
      )
        .catch((error) => {
          toast.error(
            error instanceof GroupMembershipRollbackError
              ? "Failed to update folder assignment. Rollback also failed; refresh before retrying."
              : error instanceof Error
                ? error.message
                : "Failed to update folder assignment.",
          );
        })
        .finally(() => {
          membershipMoveInFlightRef.current = false;
          setMembershipMovePending(false);
        });
    },
    [updateGroup],
  );

  const moveCharacterToGroup = useCallback(
    (targetGroupId: string | null, charId: string, groups: ParsedGroupRow[]) => {
      if (updateGroup.isPending || membershipMoveInFlightRef.current) return;
      const changes = buildGroupMembershipMoveChanges({
        groups,
        itemId: charId,
        targetGroupId,
      });

      if (changes.length === 0) return;
      membershipMoveInFlightRef.current = true;
      setMembershipMovePending(true);
      void applyGroupMembershipChangesWithRollback(changes, (change) =>
        updateGroup.mutateAsync({ id: change.id, characterIds: change.memberIds }),
      )
        .catch((error) => {
          toast.error(
            error instanceof GroupMembershipRollbackError
              ? "Failed to update folder assignment. Rollback also failed; refresh before retrying."
              : error instanceof Error
                ? error.message
                : "Failed to update folder assignment.",
          );
        })
        .finally(() => {
          membershipMoveInFlightRef.current = false;
          setMembershipMovePending(false);
        });
    },
    [updateGroup],
  );

  const toggleAssigningToGroup = useCallback(
    (groupId: string, onOpenNewGroup?: () => void) => {
      if (assigningToGroup !== groupId) {
        onOpenNewGroup?.();
      }
      setAssigningToGroup(assigningToGroup === groupId ? null : groupId);
    },
    [assigningToGroup],
  );

  return {
    assigningToGroup,
    cancelCreateGroup,
    creatingGroup,
    editGroupName,
    editingGroupId,
    expandedGroupId,
    groupsExpanded,
    groupMembershipPending: updateGroup.isPending || membershipMovePending,
    handleCreateGroup,
    handleRenameGroup,
    moveCharacterToGroup,
    newGroupName,
    setAssigningToGroup,
    setEditGroupName,
    setEditingGroupId,
    setExpandedGroupId,
    setNewGroupName,
    startCreateGroup,
    toggleAssigningToGroup,
    toggleGroupMember,
    toggleGroupsExpanded,
  };
}
