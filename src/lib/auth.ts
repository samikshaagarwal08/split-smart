// import { betterAuth } from "better-auth";

// /**
//  * Better Auth reads `BETTER_AUTH_SECRET` / `BETTER_AUTH_URL` by convention.
//  * `AUTH_SECRET` is still accepted here so older `.env` setups keep working.
//  */
// const FALLBACK_SECRET = "split-smart-dev-only-secret-min-32-characters-long";

// function authSecret() {
//   const fromEnv = process.env.BETTER_AUTH_SECRET ?? process.env.AUTH_SECRET;
//   if (fromEnv) return fromEnv;
//   // `next build` runs with NODE_ENV=production; keep a fallback so CI / local builds succeed.
//   if (process.env.NODE_ENV === "production") {
//     console.warn(
//       "[auth] BETTER_AUTH_SECRET (or AUTH_SECRET) is not set. Set it before deploying.",
//     );
//   }
//   return FALLBACK_SECRET;
// }

// function authBaseUrl() {
//   return (
//     process.env.BETTER_AUTH_URL ??
//     (process.env.VERCEL_URL ? `https://${process.env.VERCEL_URL}` : "http://localhost:3000")
//   );
// }

// export const auth = betterAuth({
//   secret: authSecret(),
//   baseURL: authBaseUrl(),
// });


import { prismaAdapter } from "better-auth/adapters/prisma";
import { betterAuth } from "better-auth";
import { prisma } from "./prisma";

export const auth = betterAuth({
  database: prismaAdapter(prisma, {
    provider: "postgresql",
  }),
  secret:
    process.env.BETTER_AUTH_SECRET ??
    process.env.AUTH_SECRET ??
    "split-smart-dev-only-secret-min-32-characters-long",
  baseURL:
    process.env.BETTER_AUTH_URL ??
    (process.env.VERCEL_URL
      ? `https://${process.env.VERCEL_URL}`
      : "http://localhost:3000"),

  emailAndPassword: {
    enabled: true,
    requireEmailVerification: false,
  },

  session: {
    expiresIn: 7 * 24 * 60 * 60, // 7 days
  },
});