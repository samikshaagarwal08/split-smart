import { prisma } from "@/lib/prisma";
import { auth } from "@/lib/auth";
import { NextResponse } from "next/server";

function errorJson(message: string, status: number) {
  return NextResponse.json({ error: message }, { status });
}

function round(amount: number) {
  return Number(amount.toFixed(2));
}

export async function GET(req: Request) {
  try {
    const session = await auth.api.getSession({ headers: req.headers });
    if (!session) return errorJson("Unauthorized", 401);

    const memberGroups = await prisma.groupMember.findMany({
      where: { userId: session.user.id },
      select: { groupId: true },
    });
    const groupIds = memberGroups.map((row) => row.groupId);

    const groups = await prisma.group.findMany({
      where: { id: { in: groupIds } },
      select: {
        id: true,
        code: true,
        name: true,
        createdAt: true,
        updatedAt: true,
        deleted: true,
        ownerId: true,
        members: {
          select: {
            id: true,
            userId: true,
            groupId: true,
            joinedAt: true,
            updatedAt: true,
            deleted: true,
            user: {
              select: {
                name: true,
                email: true,
              },
            },
          },
        },
      },
    });

    const expenses = await prisma.expense.findMany({
      where: { groupId: { in: groupIds } },
      select: {
        id: true,
        createdAt: true,
        updatedAt: true,
        groupId: true,
        title: true,
        amount: true,
        paidById: true,
        deleted: true,
        splits: true,
      },
    });

    const settlements = await prisma.settlement.findMany({
      where: { groupId: { in: groupIds } },
      select: {
        id: true,
        groupId: true,
        fromUserId: true,
        toUserId: true,
        amount: true,
        status: true,
        createdAt: true,
        updatedAt: true,
        deleted: true,
      },
    });

    const normalizedGroups = groups.map((group) => ({
      id: group.id,
      name: group.name,
      code: group.code,
      ownerId: group.ownerId,
      createdAt: group.createdAt.toISOString(),
      updatedAt: group.updatedAt.toISOString(),
      deleted: group.deleted,
      membersCount: group.members.length,
      memberIds: group.members.map((member) => member.userId),
      members: group.members.map((member) => ({
        id: member.id,
        userId: member.userId,
        groupId: member.groupId,
        joinedAt: member.joinedAt.toISOString(),
        updatedAt: member.updatedAt.toISOString(),
        deleted: member.deleted,
        name: member.user.name ?? member.user.email ?? member.userId,
      })),
    }));

    const normalizedExpenses = expenses.map((expense) => {
      const splitRows = expense.splits.map((split) => ({
        userId: split.userId,
        amount: round(split.amount),
      }));
      const equalAmount = splitRows.length
        ? round(expense.amount / splitRows.length)
        : 0;
      const isEqual = splitRows.every((split) => split.amount === equalAmount);

      return {
        id: expense.id,
        title: expense.title,
        amount: round(expense.amount),
        groupId: expense.groupId,
        createdAt: expense.createdAt.toISOString(),
        updatedAt: expense.updatedAt.toISOString(),
        deleted: expense.deleted,
        splitType: isEqual ? "equal" : "custom",
        users: splitRows.map((split) => split.userId),
        customSplits: isEqual ? [] : splitRows,
      };
    });

    const normalizedSettlements = settlements.map((settlement) => ({
      id: settlement.id,
      groupId: settlement.groupId,
      fromUserId: settlement.fromUserId,
      toUserId: settlement.toUserId,
      amount: round(settlement.amount),
      status: settlement.status,
      createdAt: settlement.createdAt.toISOString(),
      updatedAt: settlement.updatedAt.toISOString(),
      deleted: settlement.deleted,
    }));

    return NextResponse.json({ groups: normalizedGroups, expenses: normalizedExpenses, settlements: normalizedSettlements });
  } catch (err) {
    console.error("[GET /api/sync/pull]", err);
    return errorJson("Could not pull server state", 500);
  }
}
