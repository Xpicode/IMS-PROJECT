import "server-only";
import NextAuth, { CredentialsSignin } from "next-auth";
import Credentials from "next-auth/providers/credentials";
import { decode as jwtDecode, encode as jwtEncode } from "next-auth/jwt";
import { headers } from "next/headers";
import { prisma } from "@/lib/db/prisma";
import { writeAudit } from "@/lib/audit";
import { verifyCredentials } from "./credentials";
import { createSession, deleteSession, resolveSession, SESSION_MAX_AGE_S, touchSession } from "./sessions";
import { SECURE_COOKIES, SESSION_COOKIE } from "./cookie";

/**
 * Auth.js (credentials provider) with *database-backed* sessions.
 *
 * Auth.js only supports the Credentials provider with its "jwt" session
 * strategy. We keep that strategy but replace the JWT itself: the session
 * cookie carries an opaque random token whose SHA-256 lives in `sessions`.
 * So logout, deactivation, and role changes end a session immediately, and
 * nothing about the user is stored in the cookie.
 */
type SessionPayload = { sub?: string; sessionToken?: string };

class InvalidLogin extends CredentialsSignin {
  code = "invalid_login";
}
class InactiveAccount extends CredentialsSignin {
  code = "account_inactive";
}

export const { handlers, auth, signIn, signOut } = NextAuth({
  basePath: "/api/v1/auth",
  trustHost: true,
  secret: process.env.AUTH_SECRET,
  session: { strategy: "jwt", maxAge: SESSION_MAX_AGE_S },
  cookies: {
    sessionToken: {
      name: SESSION_COOKIE,
      options: { httpOnly: true, sameSite: "lax", path: "/", secure: SECURE_COOKIES },
    },
  },
  pages: { signIn: "/login", error: "/login" },
  providers: [
    Credentials({
      credentials: { email: { label: "Email" }, password: { label: "Password", type: "password" } },
      async authorize(c) {
        const user = await verifyCredentials(String(c?.email ?? ""), String(c?.password ?? ""));
        if (!user) throw new InvalidLogin();
        if ("inactive" in user) throw new InactiveAccount();
        return { id: user.id };
      },
    }),
  ],
  callbacks: {
    jwt({ token, user }) {
      if (user?.id) token.sub = user.id;
      return token;
    },
    session({ session, token }) {
      return { ...session, user: { ...session.user, id: token.sub as string } };
    },
  },
  jwt: {
    async encode(params) {
      if (params.salt !== SESSION_COOKIE) return jwtEncode(params);
      const t = (params.token ?? {}) as SessionPayload;
      if (t.sessionToken) {
        await touchSession(t.sessionToken);
        return t.sessionToken;
      }
      if (!t.sub) throw new Error("Cannot create a session without a user");
      let ua: string | null = null;
      try {
        ua = (await headers()).get("user-agent");
      } catch {
        /* outside a request */
      }
      const token = await createSession(t.sub, ua);
      await prisma.user.update({ where: { id: t.sub }, data: { lastLoginAt: new Date() } });
      await writeAudit(prisma, { actorId: t.sub, eventType: "auth.signed_in", recordType: "user", recordId: t.sub });
      return token;
    },
    async decode(params) {
      if (params.salt !== SESSION_COOKIE) return jwtDecode(params);
      const s = await resolveSession(params.token);
      if (!s) return null;
      return { sub: s.userId, sessionToken: params.token } satisfies SessionPayload;
    },
  },
  events: {
    async signOut(message) {
      const t = ("token" in message ? message.token : null) as SessionPayload | null;
      if (t?.sessionToken) {
        await deleteSession(t.sessionToken);
        if (t.sub) {
          await writeAudit(prisma, { actorId: t.sub, eventType: "auth.signed_out", recordType: "user", recordId: t.sub });
        }
      }
    },
  },
});
