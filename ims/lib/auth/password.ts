import "server-only";
import { hash, verify } from "@node-rs/argon2";

// OWASP-recommended argon2id baseline (19 MiB, 2 iterations).
const OPTS = { memoryCost: 19_456, timeCost: 2, parallelism: 1 } as const;

export const hashPassword = (password: string) => hash(password, OPTS);

export async function verifyPassword(passwordHash: string, password: string) {
  try {
    return await verify(passwordHash, password);
  } catch {
    return false;
  }
}

// A valid hash used to keep response time similar when the email is unknown.
let dummy: Promise<string> | undefined;
export const dummyHash = () => (dummy ??= hashPassword("not-a-real-password-placeholder"));
