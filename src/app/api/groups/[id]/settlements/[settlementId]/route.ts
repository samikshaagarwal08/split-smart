import { prisma } from "@/lib/prisma";
import { auth } from "@/lib/auth";
import { NextResponse } from "next/server";

function errorJson(message: string, status: number) {
  return NextResponse.json({ error: message }, { status });
}

function round(amount: number) {
  return Number(amount.toFixed(2));
}

export async function PATCH(req: Request, context: any) {
  const { params } = context;
  try {
    const session = await auth.api.getSession({ headers: req.headers });
    if (!session) return errorJson("Unauthorized", 401);

    const groupId = params.id;
    const settlementId = params.settlementId;

    const membership = await prisma.groupMember.findUnique({
      where: {
        userId_groupId: { userId: session.user.id, groupId },
      },
      select: { id: true },
    });
    if (!membership) return errorJson("Forbidden", 403);

    const body = (await req.json()) as {
      status?: unknown;
      amount?: unknown;
    };

    const status = body.status === "paid" ? "paid" : undefined;
    const amount = typeof body.amount === "number" ? round(body.amount) : undefined;

    const settlement = await prisma.settlement.findUnique({
      where: { id: settlementId },
    });
    if (!settlement || settlement.groupId !== groupId) {
      return errorJson("Settlement not found", 404);
    }

    const updateData: Record<string, unknown> = {};
    if (status) updateData.status = status;
    if (amount !== undefined) updateData.amount = amount;

    if (Object.keys(updateData).length === 0) {
      return errorJson("No valid settlement fields provided", 400);
    }

    const updated = await prisma.settlement.update({
      where: { id: settlementId },
      data: {
        ...updateData,
      } as any,
    });

    return NextResponse.json({ settlement: updated });
  } catch (err) {
    console.error("[PATCH /api/groups/[id]/settlements/[settlementId]]", err);
    return errorJson("Could not update settlement", 500);
  }
}
