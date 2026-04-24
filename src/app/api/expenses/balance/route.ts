import { auth } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { NextResponse } from "next/server";

function errorJson(message: string, status: number) {
  return NextResponse.json({ error: message }, { status });
}

function toCents(amount: number) {
  return Math.round(amount * 100);
}

function fromCents(cents: number) {
  return Number((cents / 100).toFixed(2));
}

export async function GET(req: Request) {
  try {
    const session = await auth.api.getSession({ headers: req.headers });
    if (!session) return errorJson("Unauthorized", 401);

    const url = new URL(req.url);
    const groupId = url.searchParams.get("groupId");

    const membershipWhere = groupId
      ? { userId: session.user.id, groupId }
      : { userId: session.user.id };
    const memberships = await prisma.groupMember.findMany({
      where: membershipWhere,
      select: { groupId: true },
    });
    const groupIds = memberships.map((m) => m.groupId);
    if (groupIds.length === 0) {
      return NextResponse.json({ balances: [], settlements: [] });
    }

    const expenses = await prisma.expense.findMany({
      where: { groupId: { in: groupIds } },
      select: {
        id: true,
        title: true,
        amount: true,
        groupId: true,
        paidById: true,
        splits: {
          select: {
            userId: true,
            amount: true,
          },
        },
      },
    });

    const net = new Map<string, number>();
    for (const expense of expenses) {
      net.set(expense.paidById, (net.get(expense.paidById) ?? 0) + toCents(expense.amount));
      for (const split of expense.splits) {
        net.set(split.userId, (net.get(split.userId) ?? 0) - toCents(split.amount));
      }
    }

    const userIds = Array.from(net.keys());
    const users = await prisma.user.findMany({
      where: { id: { in: userIds } },
      select: { id: true, name: true, email: true },
    });
    const userMap = new Map(users.map((u) => [u.id, u]));

    const balances = userIds.map((userId) => {
      const user = userMap.get(userId);
      const cents = net.get(userId) ?? 0;
      return {
        userId,
        name: user?.name ?? null,
        email: user?.email ?? "",
        balance: fromCents(cents),
      };
    });

    const creditors = balances
      .filter((b) => b.balance > 0)
      .map((b) => ({ ...b, cents: toCents(b.balance) }))
      .sort((a, b) => b.cents - a.cents);
    const debtors = balances
      .filter((b) => b.balance < 0)
      .map((b) => ({ ...b, cents: Math.abs(toCents(b.balance)) }))
      .sort((a, b) => b.cents - a.cents);

    const settlements: {
      fromUserId: string;
      fromName: string | null;
      toUserId: string;
      toName: string | null;
      amount: number;
    }[] = [];

    let i = 0;
    let j = 0;
    while (i < debtors.length && j < creditors.length) {
      const debtor = debtors[i];
      const creditor = creditors[j];
      const settleCents = Math.min(debtor.cents, creditor.cents);
      settlements.push({
        fromUserId: debtor.userId,
        fromName: debtor.name,
        toUserId: creditor.userId,
        toName: creditor.name,
        amount: fromCents(settleCents),
      });
      debtor.cents -= settleCents;
      creditor.cents -= settleCents;
      if (debtor.cents === 0) i += 1;
      if (creditor.cents === 0) j += 1;
    }

    return NextResponse.json({ balances, settlements });
  } catch (err) {
    console.error("[GET /api/expenses/balance]", err);
    return errorJson("Could not calculate balances", 500);
  }
}
