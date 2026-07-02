import fs from "node:fs";
import path from "node:path";
import { DatabaseSync } from "node:sqlite";

const provider = process.env.DATABASE_PROVIDER || "sqlite";

if (provider !== "sqlite") {
  console.log("Skipping SQLite init because DATABASE_PROVIDER is not sqlite.");
  process.exit(0);
}

const databaseUrl = process.env.DATABASE_URL || "file:./dev.db";
if (!databaseUrl.startsWith("file:")) {
  throw new Error(`Unsupported SQLite DATABASE_URL: ${databaseUrl}`);
}

const relativePath = databaseUrl.replace(/^file:/, "");
const databasePath = path.resolve(process.cwd(), "prisma", relativePath);
fs.mkdirSync(path.dirname(databasePath), { recursive: true });

const db = new DatabaseSync(databasePath);
db.exec(`
  PRAGMA foreign_keys = ON;

  CREATE TABLE IF NOT EXISTS "KnowledgeBase" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "name" TEXT NOT NULL,
    "description" TEXT,
    "vectorStoreId" TEXT NOT NULL,
    "sourceMode" TEXT NOT NULL,
    "visibility" TEXT NOT NULL DEFAULT 'PRIVATE',
    "ownerId" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
  );

  CREATE UNIQUE INDEX IF NOT EXISTS "KnowledgeBase_vectorStoreId_key"
  ON "KnowledgeBase"("vectorStoreId");

  CREATE TABLE IF NOT EXISTS "KnowledgeFile" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "knowledgeBaseId" TEXT NOT NULL,
    "openaiFileId" TEXT NOT NULL,
    "vectorStoreFileId" TEXT,
    "originalName" TEXT NOT NULL,
    "importSource" TEXT NOT NULL,
    "sourceUrl" TEXT,
    "status" TEXT NOT NULL,
    "bytes" INTEGER,
    "mimeType" TEXT,
    "attributesJson" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "KnowledgeFile_knowledgeBaseId_fkey"
      FOREIGN KEY ("knowledgeBaseId") REFERENCES "KnowledgeBase" ("id")
      ON DELETE CASCADE ON UPDATE CASCADE
  );

  CREATE UNIQUE INDEX IF NOT EXISTS "KnowledgeFile_openaiFileId_key"
  ON "KnowledgeFile"("openaiFileId");

  CREATE INDEX IF NOT EXISTS "KnowledgeFile_knowledgeBaseId_createdAt_idx"
  ON "KnowledgeFile"("knowledgeBaseId", "createdAt");

  CREATE TABLE IF NOT EXISTS "UsageEvent" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "sessionId" TEXT NOT NULL,
    "eventType" TEXT NOT NULL,
    "keyMode" TEXT NOT NULL,
    "knowledgeBaseId" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "UsageEvent_knowledgeBaseId_fkey"
      FOREIGN KEY ("knowledgeBaseId") REFERENCES "KnowledgeBase" ("id")
      ON DELETE SET NULL ON UPDATE CASCADE
  );

  CREATE INDEX IF NOT EXISTS "UsageEvent_sessionId_createdAt_idx"
  ON "UsageEvent"("sessionId", "createdAt");

  CREATE INDEX IF NOT EXISTS "UsageEvent_eventType_createdAt_idx"
  ON "UsageEvent"("eventType", "createdAt");
`);

const PUBLIC_KB_NAMES = [
  "Clinical Trials: Cancer",
  "Aneurysms",
  "Clinical Trials: Stroke",
  "Ayurvedic Primary Care",
];

function columnExists(table, column) {
  const rows = db.prepare(`PRAGMA table_info("${table}")`).all();
  return rows.some((row) => row.name === column);
}

function ensureKnowledgeBaseAuthColumns() {
  if (!columnExists("KnowledgeBase", "visibility")) {
    db.exec(`ALTER TABLE "KnowledgeBase" ADD COLUMN "visibility" TEXT NOT NULL DEFAULT 'PRIVATE';`);
  }

  if (!columnExists("KnowledgeBase", "ownerId")) {
    db.exec(`ALTER TABLE "KnowledgeBase" ADD COLUMN "ownerId" TEXT;`);
  }

  db.exec(`
    CREATE INDEX IF NOT EXISTS "KnowledgeBase_visibility_idx"
    ON "KnowledgeBase"("visibility");

    CREATE INDEX IF NOT EXISTS "KnowledgeBase_ownerId_idx"
    ON "KnowledgeBase"("ownerId");
  `);

  const placeholders = PUBLIC_KB_NAMES.map(() => "?").join(", ");
  db.prepare(
    `UPDATE "KnowledgeBase"
     SET "visibility" = 'PUBLIC', "ownerId" = NULL
     WHERE "name" IN (${placeholders})`,
  ).run(...PUBLIC_KB_NAMES);

  db.prepare(
    `UPDATE "KnowledgeBase"
     SET "visibility" = 'PRIVATE', "ownerId" = NULL
     WHERE "name" NOT IN (${placeholders})
       AND ("visibility" IS NULL OR "visibility" = 'PRIVATE')
       AND "ownerId" IS NULL`,
  ).run(...PUBLIC_KB_NAMES);
}

ensureKnowledgeBaseAuthColumns();

db.close();
console.log(`Initialized SQLite database at ${databasePath}`);
