import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { config } from "dotenv";
config({ quiet: true });
if (!process.env.TEST_DATABASE_URL) throw new Error("TEST_DATABASE_URL is not set (see .env.example)");
// Every integration test talks to the test database, never the dev database.
process.env.DATABASE_URL = process.env.TEST_DATABASE_URL;
process.env.AUTH_SECRET ??= "test-secret-test-secret-test-secret";
// PDFs from tests go to a throwaway folder, never the dev documents folder.
process.env.DOCUMENTS_DIR = mkdtempSync(path.join(tmpdir(), "ims-docs-test-"));
process.env.COMPANY_NAME ??= "Test Company Inc.";
