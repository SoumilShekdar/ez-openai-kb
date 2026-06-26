import fs from "node:fs";
import path from "node:path";

const prismaDir = path.resolve(process.cwd(), "prisma");
const templatePath = path.join(prismaDir, "schema.template.prisma");
const schemaPath = path.join(prismaDir, "schema.prisma");

const provider = process.env.DATABASE_PROVIDER || "sqlite";
const template = fs.readFileSync(templatePath, "utf8");
const resolved = template.replace(/__DATABASE_PROVIDER__/g, provider);

fs.writeFileSync(schemaPath, resolved);
console.log(`Wrote prisma/schema.prisma for provider: ${provider}`);
