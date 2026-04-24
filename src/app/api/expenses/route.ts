import { prisma } from "@/lib/prisma";
import { auth } from "@/lib/auth";
import { NextResponse } from "next/server";

function errorJson(message: string, status: number) {
  return NextResponse.json({ error: message }, { status });
}

export async function POST(req: Request) {
  try {
    const session = await auth.api.getSession({ headers: req.headers });
    if (!session) return errorJson("Unauthorized", 401);

    const body = (await req.json()) as Record<string, unknown>;
    const title = typeof body.title === "string" ? body.title.trim() : "";
    const amount = typeof body.amount === "number" ? body.amount : Number.NaN;
    const groupId = typeof body.groupId === "string" ? body.groupId : "";
    const splitType = body.splitType === "custom" ? "custom" : "equal";

    if (!title) return errorJson("Expense title is required", 400);
    if (!groupId) return errorJson("groupId is required", 400);
    if (!Number.isFinite(amount) || amount <= 0) {
      return errorJson("Amount must be greater than 0", 400);
    }

    const membership = await prisma.groupMember.findUnique({
      where: {
        userId_groupId: {
          userId: session.user.id,
          groupId,
        },
      },
      select: { id: true },
    });
    if (!membership) return errorJson("You are not a member of this group", 403);

    const groupMembers = await prisma.groupMember.findMany({
      where: { groupId },
      select: { userId: true },
    });
    const allowedUserIds = new Set(groupMembers.map((m) => m.userId));

    let splitRows: { userId: string; amount: number }[] = [];

    if (splitType === "custom") {
      const customSplits = Array.isArray(body.customSplits) ? body.customSplits : [];
      splitRows = customSplits
        .map((entry) => {
          if (!entry || typeof entry !== "object") return null;
          const userId = typeof (entry as { userId?: unknown }).userId === "string"
            ? (entry as { userId: string }).userId
            : "";
          const splitAmount = typeof (entry as { amount?: unknown }).amount === "number"
            ? (entry as { amount: number }).amount
            : Number.NaN;
          if (!userId || !Number.isFinite(splitAmount) || splitAmount < 0) return null;
          return { userId, amount: splitAmount };
        })
        .filter((item): item is { userId: string; amount: number } => Boolean(item));

      if (splitRows.length === 0) return errorJson("At least one custom split is required", 400);
      const totalSplit = splitRows.reduce((sum, item) => sum + item.amount, 0);
      if (Math.abs(totalSplit - amount) > 0.01) {
        return errorJson("Custom split amounts must add up to total amount", 400);
      }
    } else {
      const users = Array.isArray(body.users)
        ? body.users.filter((u): u is string => typeof u === "string")
        : [];
      if (users.length === 0) return errorJson("At least one user is required for equal split", 400);
      const uniqueUsers = Array.from(new Set(users));
      const splitAmount = Number((amount / uniqueUsers.length).toFixed(2));
      splitRows = uniqueUsers.map((userId) => ({ userId, amount: splitAmount }));
      const adjustedTotal = splitRows.reduce((sum, item) => sum + item.amount, 0);
      const delta = Number((amount - adjustedTotal).toFixed(2));
      if (delta !== 0) {
        splitRows[splitRows.length - 1].amount = Number(
          (splitRows[splitRows.length - 1].amount + delta).toFixed(2),
        );
      }
    }

    const invalidUser = splitRows.find((s) => !allowedUserIds.has(s.userId));
    if (invalidUser) return errorJson("Split users must belong to the group", 400);

    const expense = await prisma.expense.create({
      data: {
        title,
        amount: Number(amount.toFixed(2)),
        groupId,
        paidById: session.user.id,
        splits: {
          create: splitRows.map((split) => ({
            userId: split.userId,
            amount: Number(split.amount.toFixed(2)),
          })),
        },
      },
      include: {
        splits: true,
      },
    });

    return NextResponse.json(expense, { status: 201 });
  } catch (err) {
    console.error("[POST /api/expenses]", err);
    return errorJson("Could not create expense", 500);
  }
}