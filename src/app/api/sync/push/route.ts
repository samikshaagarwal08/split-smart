import { prisma } from "@/lib/prisma";
import { auth } from "@/lib/auth";
import { NextResponse } from "next/server";

type SyncGroup = {
  id: string;
  name: string;
  code: string;
  ownerId: string;
  createdAt: string;
  updatedAt: string;
  deleted?: boolean;
};

type SyncExpense = {
  id: string;
  title: string;
  amount: number;
  groupId: string;
  splitType: "equal" | "custom";
  users: string[];
  customSplits: { userId: string; amount: number }[];
  createdAt: string;
  updatedAt: string;
  deleted?: boolean;
};

type SyncSettlement = {
  id: string;
  fromUserId: string;
  toUserId: string;
  groupId: string;
  amount: number;
  status?: string;
  createdAt: string;
  updatedAt: string;
  deleted?: boolean;
};

type SplitRow = {
  userId: string;
  amount: number;
};

function errorJson(message: string, status: number) {
  return NextResponse.json({ error: message }, { status });
}

function isNewer(remote: string, local?: string | null) {
  if (!local) return true;
  return new Date(remote).getTime() > new Date(local).getTime();
}

function normalizeId(id: unknown) {
  return typeof id === "string" ? id : "";
}

function normalizeString(value: unknown) {
  return typeof value === "string" ? value : "";
}

function normalizeUserId(userId: string, sessionUserId: string) {
  return userId === "me" ? sessionUserId : userId;
}

function normalizeStatus(status: unknown) {
  return status === "paid" ? "paid" : "pending";
}

function dedupeSplitRows(rows: SplitRow[]) {
  const aggregated = rows.reduce<Record<string, number>>((acc, row) => {
    acc[row.userId] = (acc[row.userId] ?? 0) + row.amount;
    return acc;
  }, {});

  return Object.entries(aggregated).map(([userId, amount]) => ({ userId, amount }));
}

export async function POST(req: Request) {
  try {
    const session = await auth.api.getSession({ headers: req.headers });
    if (!session) return errorJson("Unauthorized", 401);

    const body = (await req.json()) as {
      groups?: unknown;
      expenses?: unknown;
      settlements?: unknown;
    };

    const groups = Array.isArray(body.groups) ? body.groups.map((item) => ({
      id: normalizeId((item as any).id),
      name: normalizeString((item as any).name),
      code: normalizeString((item as any).code),
      ownerId: normalizeId((item as any).ownerId),
      createdAt: normalizeString((item as any).createdAt),
      updatedAt: normalizeString((item as any).updatedAt),
      deleted: Boolean((item as any).deleted),
    })) : [];

    const expenses = Array.isArray(body.expenses) ? body.expenses.map((item) => ({
      id: normalizeId((item as any).id),
      title: normalizeString((item as any).title),
      amount: typeof (item as any).amount === "number" ? (item as any).amount : Number.NaN,
      groupId: normalizeId((item as any).groupId),
      splitType: (item as any).splitType === "custom" ? "custom" : "equal",
      users: Array.isArray((item as any).users) ? (item as any).users.filter((u: unknown): u is string => typeof u === "string") : [],
      customSplits: Array.isArray((item as any).customSplits)
        ? (item as any).customSplits
            .filter((entry: unknown) => entry && typeof entry === "object")
            .map((entry: any) => ({
              userId: normalizeId(entry.userId),
              amount: typeof entry.amount === "number" ? entry.amount : Number.NaN,
            }))
        : [],
      createdAt: normalizeString((item as any).createdAt),
      updatedAt: normalizeString((item as any).updatedAt),
      deleted: Boolean((item as any).deleted),
    })) : [];

    const settlements = Array.isArray(body.settlements) ? body.settlements.map((item) => ({
      id: normalizeId((item as any).id),
      fromUserId: normalizeId((item as any).fromUserId),
      toUserId: normalizeId((item as any).toUserId),
      groupId: normalizeId((item as any).groupId),
      amount: typeof (item as any).amount === "number" ? (item as any).amount : Number.NaN,
      status: normalizeStatus((item as any).status),
      createdAt: normalizeString((item as any).createdAt),
      updatedAt: normalizeString((item as any).updatedAt),
      deleted: Boolean((item as any).deleted),
    })) : [];

    let syncedGroups = 0;
    let syncedExpenses = 0;
    let syncedSettlements = 0;
    const updatedGroups: Array<{ id: string; code: string; updatedAt: string }> = [];

    for (const group of groups) {
      if (!group.id || !group.name) continue;

      const existing = await prisma.group.findUnique({
        where: { id: group.id },
        select: { updatedAt: true, deleted: true, code: true },
      });

      if (group.deleted) {
        if (existing) {
          await prisma.group.update({ where: { id: group.id }, data: { deleted: true } });
          syncedGroups += 1;
        }
        continue;
      }

      if (!existing) {
        const code = group.code && group.code !== "PENDING"
          ? group.code
          : `G-${Math.random().toString(36).slice(2, 8).toUpperCase()}`;
        const created = await prisma.group.create({
          data: {
            id: group.id,
            name: group.name,
            ownerId: session.user.id,
            code,
          },
        });
        await prisma.groupMember.upsert({
          where: {
            userId_groupId: { userId: session.user.id, groupId: created.id },
          },
          create: {
            userId: session.user.id,
            groupId: created.id,
          },
          update: {},
        });
        syncedGroups += 1;
        updatedGroups.push({ id: created.id, code: created.code, updatedAt: created.updatedAt.toISOString() });
        continue;
      }

      if (isNewer(group.updatedAt, existing.updatedAt.toISOString())) {
        const updated = await prisma.group.update({
          where: { id: group.id },
          data: {
            name: group.name,
            code: group.code && group.code !== "PENDING" ? group.code : existing.code,
            deleted: false,
          },
        });
        syncedGroups += 1;
        updatedGroups.push({ id: updated.id, code: updated.code, updatedAt: updated.updatedAt.toISOString() });
      }
    }

    for (const expense of expenses) {
      if (!expense.id || !expense.title || !expense.groupId || !Number.isFinite(expense.amount)) continue;

      const existing = await prisma.expense.findUnique({
        where: { id: expense.id },
        select: { updatedAt: true, deleted: true },
      });

      const normalizedUsers = expense.users.map((userId: string) => normalizeUserId(userId, session.user.id));
      const splitRows: SplitRow[] =
        expense.splitType === "custom"
          ? expense.customSplits.map((entry: { userId: string; amount: number }) => ({
              userId: normalizeUserId(entry.userId, session.user.id),
              amount: entry.amount,
            }))
          : normalizedUsers.map((userId: string) => ({
              userId,
              amount: Number((expense.amount / Math.max(normalizedUsers.length, 1)).toFixed(2)),
            }));

      const dedupedSplitRows = dedupeSplitRows(splitRows);

      if (expense.deleted) {
        if (existing) {
          await prisma.expense.update({ where: { id: expense.id }, data: { deleted: true } });
          syncedExpenses += 1;
        }
        continue;
      }

      if (!existing) {
        await prisma.expense.create({
          data: {
            id: expense.id,
            title: expense.title,
            amount: expense.amount,
            groupId: expense.groupId,
            paidById: session.user.id,
            splits: {
              create: dedupedSplitRows.map((row: SplitRow) => ({
                userId: row.userId,
                amount: row.amount,
              })),
            },
          },
        });
        syncedExpenses += 1;
        continue;
      }

      if (isNewer(expense.updatedAt, existing.updatedAt.toISOString())) {
        await prisma.expense.update({
          where: { id: expense.id },
          data: {
            title: expense.title,
            amount: expense.amount,
            splits: {
              deleteMany: {},
              create: dedupedSplitRows.map((row: SplitRow) => ({
                userId: row.userId,
                amount: row.amount,
              })),
            },
          },
        });
        syncedExpenses += 1;
      }
    }

    for (const settlement of settlements) {
      if (!settlement.id || !settlement.fromUserId || !settlement.toUserId || !settlement.groupId || !Number.isFinite(settlement.amount)) continue;
      if (settlement.fromUserId === settlement.toUserId) continue;

      const normalizedFrom = normalizeUserId(settlement.fromUserId, session.user.id);
      const normalizedTo = normalizeUserId(settlement.toUserId, session.user.id);
      const status = normalizeStatus(settlement.status);

      const existing = await prisma.settlement.findUnique({
        where: { id: settlement.id },
        select: { updatedAt: true, deleted: true },
      });

      if (settlement.deleted) {
        if (existing) {
          await prisma.settlement.update({ where: { id: settlement.id }, data: { deleted: true } });
          syncedSettlements += 1;
        }
        continue;
      }

      if (!existing) {
        await prisma.settlement.create({
          data: {
            id: settlement.id,
            groupId: settlement.groupId,
            fromUserId: normalizedFrom,
            toUserId: normalizedTo,
            amount: Number(settlement.amount.toFixed(2)),
            status,
          },
        });
        syncedSettlements += 1;
        continue;
      }

      if (isNewer(settlement.updatedAt, existing.updatedAt.toISOString())) {
        await prisma.settlement.update({
          where: { id: settlement.id },
          data: {
            amount: Number(settlement.amount.toFixed(2)),
            status,
            deleted: false,
          },
        });
        syncedSettlements += 1;
      }
    }

    return NextResponse.json({ groups: syncedGroups, expenses: syncedExpenses, settlements: syncedSettlements, updatedGroups });
  } catch (err) {
    console.error("[POST /api/sync/push]", err);
    return errorJson("Could not sync local changes", 500);
  }
}
