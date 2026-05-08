import { db } from "./db";

type SyncResult = {
  syncedGroups: number;
  syncedExpenses: number;
  errors: number;
};

type RemoteGroupMember = {
  id: string;
  userId: string;
  groupId: string;
  joinedAt: string;
  updatedAt: string;
  deleted: boolean;
  name?: string | null;
};

type RemoteGroup = {
  id: string;
  name: string;
  code: string;
  createdAt: string;
  updatedAt: string;
  ownerId: string;
  deleted: boolean;
  membersCount: number;
  memberIds: string[];
  members: RemoteGroupMember[];
};

type RemoteExpense = {
  id: string;
  title: string;
  amount: number;
  groupId: string;
  splitType: "equal" | "custom";
  users: string[];
  customSplits: { userId: string; amount: number }[];
  createdAt: string;
  updatedAt: string;
  deleted: boolean;
};

function isOnline() {
  return typeof navigator === "undefined" ? true : navigator.onLine;
}

function normalizeDate(value: string | undefined) {
  return value ?? new Date().toISOString();
}

function isNewer(remote: string, local: string | undefined) {
  return new Date(remote).getTime() > new Date(normalizeDate(local)).getTime();
}

async function pushLocalChanges() {
  const localGroups = (await db.groups.toArray()).filter((group) => !group.synced || group.deleted);
  const localExpenses = (await db.expenses.toArray()).filter((expense) => !expense.synced || expense.deleted);

  if (localGroups.length === 0 && localExpenses.length === 0) {
    return { groups: 0, expenses: 0, updates: [] };
  }

  const res = await fetch("/api/sync/push", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ groups: localGroups, expenses: localExpenses }),
  });

  if (!res.ok) {
    throw new Error("Failed to push local changes");
  }

  const data = (await res.json()) as {
    groups: number;
    expenses: number;
    updatedGroups?: Array<{ id: string; code: string; updatedAt: string }>;
  };

  await db.transaction("rw", db.groups, db.expenses, async () => {
    for (const group of localGroups) {
      await db.groups.update(group.id, {
        synced: true,
        pendingAction: undefined,
      });
    }
    for (const expense of localExpenses) {
      await db.expenses.update(expense.id, { synced: true });
    }
    if (data.updatedGroups) {
      for (const updated of data.updatedGroups) {
        await db.groups.update(updated.id, {
          code: updated.code,
          updatedAt: updated.updatedAt,
          synced: true,
        });
      }
    }
  });

  return {
    groups: data.groups,
    expenses: data.expenses,
    updates: data.updatedGroups ?? [],
  };
}

async function pullServerData() {
  const res = await fetch("/api/sync/pull");
  if (!res.ok) {
    throw new Error("Failed to pull server state");
  }

  const data = (await res.json()) as {
    groups: RemoteGroup[];
    expenses: RemoteExpense[];
  };

  let syncedGroups = 0;
  let syncedExpenses = 0;

  await db.transaction("rw", db.groups, db.expenses, db.members, async () => {
    for (const group of data.groups) {
      if (group.deleted) {
        await db.groups.delete(group.id);
        await db.expenses.where("groupId").equals(group.id).delete();
        await db.members.where("groupId").equals(group.id).delete();
        continue;
      }

      const localGroup = await db.groups.get(group.id);
      if (!localGroup || isNewer(group.updatedAt, localGroup.updatedAt)) {
        await db.groups.put({
          id: group.id,
          name: group.name,
          code: group.code,
          createdAt: group.createdAt,
          updatedAt: group.updatedAt,
          ownerId: group.ownerId,
          membersCount: group.membersCount,
          memberIds: group.memberIds,
          synced: true,
          deleted: false,
        });
        syncedGroups += 1;
      }

      const serverMemberUserIds = group.members.filter((member) => !member.deleted).map((member) => member.userId);

      for (const serverMember of group.members) {
        if (serverMember.deleted) {
          await db.members.delete(serverMember.id);
          continue;
        }

        const localMember = await db.members.get(serverMember.id);
        const name = serverMember.name ?? serverMember.userId;
        if (!localMember || isNewer(serverMember.updatedAt, localMember.updatedAt)) {
          await db.members.put({
            id: serverMember.id,
            userId: serverMember.userId,
            groupId: serverMember.groupId,
            joinedAt: serverMember.joinedAt,
            updatedAt: serverMember.updatedAt,
            synced: true,
            deleted: false,
            name,
          });
        }
      }

      if (serverMemberUserIds.length > 0) {
        await db.members
          .where("groupId")
          .equals(group.id)
          .and((member) => member.userId === "me")
          .delete();
      }
    }

    for (const expense of data.expenses) {
      if (expense.deleted) {
        await db.expenses.delete(expense.id);
        continue;
      }

      const localExpense = await db.expenses.get(expense.id);
      if (!localExpense || isNewer(expense.updatedAt, localExpense.updatedAt)) {
        await db.expenses.put({
          id: expense.id,
          title: expense.title,
          amount: expense.amount,
          groupId: expense.groupId,
          splitType: expense.splitType,
          users: expense.users,
          customSplits: expense.customSplits,
          createdAt: expense.createdAt,
          updatedAt: expense.updatedAt,
          synced: true,
          deleted: false,
        });
        syncedExpenses += 1;
      }
    }
  });

  return { syncedGroups, syncedExpenses };
}

export async function pullGroupsToLocal() {
  if (!isOnline()) return { syncedGroups: 0, syncedExpenses: 0, errors: 0 };
  try {
    const result = await pullServerData();
    return { syncedGroups: result.syncedGroups, syncedExpenses: result.syncedExpenses, errors: 0 };
  } catch {
    return { syncedGroups: 0, syncedExpenses: 0, errors: 1 };
  }
}

export async function syncPendingData(): Promise<SyncResult> {
  if (!isOnline()) {
    return { syncedGroups: 0, syncedExpenses: 0, errors: 0 };
  }

  let errors = 0;
  let syncedGroups = 0;
  let syncedExpenses = 0;

  try {
    const pushResult = await pushLocalChanges();
    syncedGroups += pushResult.groups;
    syncedExpenses += pushResult.expenses;
  } catch {
    errors += 1;
  }

  try {
    const pullResult = await pullServerData();
    syncedGroups += pullResult.syncedGroups;
    syncedExpenses += pullResult.syncedExpenses;
  } catch {
    errors += 1;
  }

  return { syncedGroups, syncedExpenses, errors };
}
