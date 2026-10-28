import { execSync } from "node:child_process";
import { config } from "dotenv";

export default function setup() {
  config({ quiet: true });
  const url = process.env.TEST_DATABASE_URL;
  if (!url) throw new Error("TEST_DATABASE_URL is not set (see .env.example)");
  // Apply the same reviewed migrations used in production.
  execSync("npx prisma migrate deploy", {
    stdio: "pipe",
    env: { ...process.env, DATABASE_URL: url },
  });
}
