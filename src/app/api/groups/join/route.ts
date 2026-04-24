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

    const body = (await req.json()) as { code?: unknown };
    const code = typeof body.code === "string" ? body.code.trim().toUpperCase() : "";
    if (!code) return errorJson("Join code is required", 400);

    const group = await prisma.group.findUnique({
      where: { code },
      select: { id: true, name: true, code: true, createdAt: true, ownerId: true },
    });
    if (!group) return errorJson("Invalid join code", 404);

    await prisma.groupMember.upsert({
      where: {
        userId_groupId: {
          userId: session.user.id,
          groupId: group.id,
        },
      },
      create: {
        userId: session.user.id,
        groupId: group.id,
      },
      update: {},
    });

    return NextResponse.json(group);
  } catch (err) {
    console.error("[POST /api/groups/join]", err);
    return errorJson("Could not join group", 500);
  }
}