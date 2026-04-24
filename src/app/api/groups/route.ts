import { prisma } from "@/lib/prisma";
import { auth } from "@/lib/auth";
import { NextResponse } from "next/server";

const MAX_NAME_LENGTH = 120;
const CODE_LENGTH = 6;

function errorJson(message: string, status: number) {
  return NextResponse.json({ error: message }, { status });
}

function generateCode() {
  const chars = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
  let code = "";
  for (let i = 0; i < CODE_LENGTH; i += 1) {
    code += chars[Math.floor(Math.random() * chars.length)];
  }
  return code;
}

export async function POST(req: Request) {
  try {
    const session = await auth.api.getSession({ headers: req.headers });
    if (!session) return errorJson("Unauthorized", 401);

    let body: unknown;
    try {
      body = await req.json();
    } catch {
      return errorJson("Request body must be valid JSON", 400);
    }

    if (!body || typeof body !== "object") {
      return errorJson("Expected a JSON object", 400);
    }

    const rawName = (body as Record<string, unknown>)["name"];
    const name =
      typeof rawName === "string" ? rawName.trim() : "";

    if (!name) {
      return errorJson("Group name is required", 400);
    }
    if (name.length > MAX_NAME_LENGTH) {
      return errorJson(`Group name must be at most ${MAX_NAME_LENGTH} characters`, 400);
    }

    let group:
      | { id: string; name: string; createdAt: Date; code: string; ownerId: string }
      | null = null;
    for (let attempt = 0; attempt < 5; attempt += 1) {
      try {
        group = await prisma.$transaction(async (tx) => {
          const created = await tx.group.create({
            data: {
              name,
              ownerId: session.user.id,
              code: generateCode(),
            },
            select: { id: true, name: true, createdAt: true, code: true, ownerId: true },
          });
          await tx.groupMember.create({
            data: { groupId: created.id, userId: session.user.id },
          });
          return created;
        });
        break;
      } catch (err) {
        const message = err instanceof Error ? err.message : "";
        if (!message.includes("Unique constraint")) throw err;
      }
    }
    if (!group) return errorJson("Could not generate unique join code", 500);

    return NextResponse.json(group, { status: 201 });
  } catch (err) {
    console.error("[POST /api/groups]", err);
    return errorJson("Could not create group", 500);
  }
}

export async function GET(req: Request) {
  try {
    const session = await auth.api.getSession({ headers: req.headers });
    if (!session) return errorJson("Unauthorized", 401);

    const groups = await prisma.group.findMany({
      where: {
        members: {
          some: { userId: session.user.id },
        },
      },
      orderBy: { createdAt: "desc" },
      select: {
        id: true,
        name: true,
        createdAt: true,
        code: true,
        ownerId: true,
        members: {
          select: { userId: true },
        },
        _count: { select: { members: true } },
      },
    });
    const normalized = groups.map((g) => ({
      id: g.id,
      name: g.name,
      createdAt: g.createdAt,
      code: g.code,
      ownerId: g.ownerId,
      membersCount: g._count.members,
      memberIds: g.members.map((m) => m.userId),
    }));
    return NextResponse.json(normalized);
  } catch (err) {
    console.error("[GET /api/groups]", err);
    return errorJson("Could not load groups", 500);
  }
}
