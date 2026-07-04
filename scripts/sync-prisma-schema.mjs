import fs from "node:fs";
import path from "node:path";

const prismaDir = path.resolve(process.cwd(), "prisma");
const templatePath = path.join(prismaDir, "schema.template.prisma");
const schemaPath = path.join(prismaDir, "schema.prisma");

function loadEnv() {
  for (const file of [".env.local", ".env"]) {
    const envPath = path.resolve(process.cwd(), file);
    if (!fs.existsSync(envPath)) continue;

    const content = fs.readFileSync(envPath, "utf8");
    for (const line of content.split("\n")) {
      const trimmed = line.trim();
      if (!trimmed || trimmed.startsWith("#")) continue;
      const eq = trimmed.indexOf("=");
      if (eq === -1) continue;
      const key = trimmed.slice(0, eq).trim();
      let value = trimmed.slice(eq + 1).trim();
      if (
        (value.startsWith('"') && value.endsWith('"')) ||
        (value.startsWith("'") && value.endsWith("'"))
      ) {
        value = value.slice(1, -1);
      }
      if (!process.env[key]) {
        process.env[key] = value;
      }
    }
  }
}

loadEnv();

const provider = process.env.DATABASE_PROVIDER || "sqlite";
const template = fs.readFileSync(templatePath, "utf8");
const resolved = template.replace(/__DATABASE_PROVIDER__/g, provider);

fs.writeFileSync(schemaPath, resolved);
console.log(`Wrote prisma/schema.prisma for provider: ${provider}`);
