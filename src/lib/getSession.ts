import { auth } from "./auth";
import { headers } from "next/headers";

export async function getSession() {
  const requestHeaders = await headers();

  try {
    return await auth.api.getSession({
      headers: requestHeaders,
    });
  } catch (error) {
    // Better Auth can throw on transient DB/network disconnects (e.g. Prisma P1017).
    // Returning null keeps navigation stable and redirects to login gracefully.
    console.error("[getSession] Failed to fetch session", error);
    return null;
  }
}