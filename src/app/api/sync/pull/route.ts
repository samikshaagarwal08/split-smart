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
        ownerId: true,
        members: {
          select: {
            id: true,
            userId: true,
            groupId: true,
            joinedAt: true,
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
        groupId: true,
        title: true,
        amount: true,
        paidById: true,
        splits: true,
      },
    });

    const normalizedGroups = groups.map((group) => ({
      id: group.id,
      name: group.name,
      code: group.code,
      ownerId: group.ownerId,
      createdAt: group.createdAt.toISOString(),
      membersCount: group.members.length,
      memberIds: group.members.map((member) => member.userId),
      members: group.members.map((member) => ({
        id: member.id,
        userId: member.userId,
        groupId: member.groupId,
        joinedAt: member.joinedAt.toISOString(),
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
        splitType: isEqual ? "equal" : "custom",
        users: splitRows.map((split) => split.userId),
        customSplits: isEqual ? [] : splitRows,
      };
    });

    return NextResponse.json({ groups: normalizedGroups, expenses: normalizedExpenses });
  } catch (err) {
    console.error("[GET /api/sync/pull]", err);
    return errorJson("Could not pull server state", 500);
  }
}
