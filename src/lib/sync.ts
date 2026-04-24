import { db } from "./db";

type SyncResult = {
  syncedGroups: number;
  syncedExpenses: number;
  errors: number;
};

function isOnline() {
  return typeof navigator === "undefined" ? true : navigator.onLine;
}

async function syncPendingGroups() {
  const pendingGroups = (await db.groups.toArray()).filter((group) => !group.synced);
  let synced = 0;
  let errors = 0;

  for (const group of pendingGroups) {
    if (group.pendingAction !== "create") continue;
    try {
      const res = await fetch("/api/groups", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name: group.name }),
      });
      if (!res.ok) {
        errors += 1;
        continue;
      }
      synced += 1;
      await db.groups.update(group.id, {
        synced: true,
        pendingAction: undefined,
      });
    } catch {
      errors += 1;
    }
  }
  return { synced, errors };
}

async function syncPendingExpenses() {
  const pendingExpenses = (await db.expenses.toArray()).filter((expense) => !expense.synced);
  let synced = 0;
  let errors = 0;

  for (const exp of pendingExpenses) {
    try {
      const res = await fetch("/api/expenses", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          title: exp.title,
          amount: exp.amount,
          groupId: exp.groupId,
          splitType: exp.splitType,
          users: exp.users,
          customSplits: exp.customSplits,
        }),
      });
      if (!res.ok) {
        errors += 1;
        continue;
      }
      synced += 1;
      await db.expenses.update(exp.id, { synced: true });
    } catch {
      errors += 1;
    }
  }
  return { synced, errors };
}

/**
 * Pull latest server groups and merge into local cache.
 * We preserve local unsynced groups so users can continue working offline.
 */
export async function pullGroupsToLocal() {
  if (!isOnline()) return;
  const res = await fetch("/api/groups");
  if (!res.ok) return;
  const serverGroups = (await res.json()) as Array<{
    id: string;
    name: string;
    code: string;
    createdAt: string;
    ownerId: string;
    membersCount: number;
    memberIds: string[];
  }>;
  await db.transaction("rw", db.groups, db.members, async () => {
    const localUnsynced = (await db.groups.toArray()).filter((group) => !group.synced);
    await db.groups.clear();
    await db.members.clear();
    await db.groups.bulkPut(
      serverGroups.map((group) => ({
        ...group,
        synced: true,
      })),
    );
    const memberRows = serverGroups.flatMap((group) =>
      group.memberIds.map((memberId) => ({
        id: `${group.id}:${memberId}`,
        userId: memberId,
        groupId: group.id,
        joinedAt: new Date().toISOString(),
        synced: true,
      })),
    );
    if (memberRows.length > 0) {
      await db.members.bulkPut(memberRows);
    }
    if (localUnsynced.length > 0) {
      await db.groups.bulkPut(localUnsynced);
    }
  });
}

export async function syncPendingData(): Promise<SyncResult> {
  if (!isOnline()) {
    return { syncedGroups: 0, syncedExpenses: 0, errors: 0 };
  }
  const groupResult = await syncPendingGroups();
  const expenseResult = await syncPendingExpenses();
  await pullGroupsToLocal();

  return {
    syncedGroups: groupResult.synced,
    syncedExpenses: expenseResult.synced,
    errors: groupResult.errors + expenseResult.errors,
  };
}