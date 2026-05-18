import { prisma } from "@/lib/prisma";
import { auth } from "@/lib/auth";
import { NextResponse } from "next/server";
import { calculateNetBalances, simplifyDebts } from "@/lib/simplifyDebts";

function errorJson(message: string, status: number) {
  return NextResponse.json({ error: message }, { status });
}

function round(amount: number) {
  return Number(amount.toFixed(2));
}

export async function GET(req: Request, context: any) {
  const { params } = context;
  try {
    const session = await auth.api.getSession({ headers: req.headers });
    if (!session) return errorJson("Unauthorized", 401);

    const groupId = params.id;
    const membership = await prisma.groupMember.findUnique({
      where: {
        userId_groupId: { userId: session.user.id, groupId },
      },
      select: { id: true },
    });
    if (!membership) return errorJson("Forbidden", 403);

    const [group, expenses, settlements] = await prisma.$transaction([
      prisma.group.findUnique({
        where: { id: groupId },
        select: {
          id: true,
          name: true,
          code: true,
          ownerId: true,
          members: {
            select: {
              userId: true,
              user: { select: { name: true, email: true } },
            },
          },
        },
      }),
      prisma.expense.findMany({
        where: { groupId },
        select: {
          id: true,
          amount: true,
          paidById: true,
          splits: true,
        },
      }),
      prisma.settlement.findMany({
        where: { groupId },
        orderBy: { createdAt: "desc" },
      }),
    ]);

    if (!group) return errorJson("Group not found", 404);

    const memberNameMap = new Map<string, string>(
      group.members.map((member) => [
        member.userId,
        member.user.name ?? member.user.email ?? member.userId,
      ]),
    );

    const expensePayload = expenses.map((expense) => {
      const splitRows = expense.splits.map((split) => ({
        userId: split.userId,
        amount: round(split.amount),
      }));
      const equalAmount = splitRows.length ? round(expense.amount / splitRows.length) : 0;
      const isEqual = splitRows.every((split) => split.amount === equalAmount);
      return {
        id: expense.id,
        amount: round(expense.amount),
        paidById: expense.paidById,
        splitType: isEqual ? ("equal" as const) : ("custom" as const),
        users: splitRows.map((split) => split.userId),
        customSplits: isEqual ? [] : splitRows,
      };
    });

    const balances = calculateNetBalances(expensePayload).map((entry) => ({
      ...entry,
      name: memberNameMap.get(entry.userId) ?? entry.userId,
    }));
    const settlementPlan = simplifyDebts(balances);

    const history = settlements.map((settlement) => ({
      id: settlement.id,
      groupId: settlement.groupId,
      fromUserId: settlement.fromUserId,
      toUserId: settlement.toUserId,
      amount: round(settlement.amount),
      status: settlement.status,
      createdAt: settlement.createdAt.toISOString(),
      updatedAt: settlement.updatedAt.toISOString(),
    }));

    return NextResponse.json({
      group: { id: group.id, name: group.name, code: group.code, ownerId: group.ownerId },
      balances,
      settlementPlan,
      settlementHistory: history,
    });
  } catch (err) {
    console.error("[GET /api/groups/[id]/settlements]", err);
    return errorJson("Could not load settlement data", 500);
  }
}

export async function POST(req: Request, context: any) {
  const { params } = context;
  try {
    const session = await auth.api.getSession({ headers: req.headers });
    if (!session) return errorJson("Unauthorized", 401);

    const groupId = params.id;
    const membership = await prisma.groupMember.findUnique({
      where: {
        userId_groupId: { userId: session.user.id, groupId },
      },
      select: { id: true },
    });
    if (!membership) return errorJson("Forbidden", 403);

    const body = (await req.json()) as {
      fromUserId?: unknown;
      toUserId?: unknown;
      amount?: unknown;
    };

    const fromUserId = typeof body.fromUserId === "string" ? body.fromUserId : "";
    const toUserId = typeof body.toUserId === "string" ? body.toUserId : "";
    const amount = typeof body.amount === "number" ? body.amount : Number.NaN;

    if (!fromUserId || !toUserId || fromUserId === toUserId) {
      return errorJson("Invalid settlement participants", 400);
    }
    if (!Number.isFinite(amount) || amount <= 0) {
      return errorJson("Settlement amount must be greater than zero", 400);
    }

    const settlement = await prisma.settlement.create({
      data: {
        groupId,
        fromUserId,
        toUserId,
        amount: round(amount),
        status: "pending",
      },
    });

    return NextResponse.json({ settlement }, { status: 201 });
  } catch (err) {
    console.error("[POST /api/groups/[id]/settlements]", err);
    return errorJson("Could not create settlement", 500);
  }
}
