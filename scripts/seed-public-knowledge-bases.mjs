import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import OpenAI from "openai";
import { QdrantClient } from "@qdrant/js-client-rest";
import { PrismaClient, ImportSource, KbVisibility } from "@prisma/client";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(__dirname, "..");

const DEFAULT_EMBEDDING_MODEL = "text-embedding-3-small";
const DEFAULT_EMBEDDING_DIMENSIONS = 1536;
const DEFAULT_QDRANT_URL =
  "https://728c3995-d04c-4506-97be-7f5c6698f34c.eu-central-1-0.aws.cloud.qdrant.io";
const CHUNK_SIZE = 1200;
const CHUNK_OVERLAP = 200;

function loadEnv() {
  for (const file of [".env.local", ".env"]) {
    const envPath = path.join(root, file);
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

function normalizeSourceUrl(url) {
  try {
    const parsed = new URL(url.trim());
    parsed.hash = "";
    return parsed.toString().replace(/\/$/, "");
  } catch {
    return url.trim().replace(/\/$/, "");
  }
}

function getExtension(filename) {
  const cleanName = filename.split("?")[0]?.split("#")[0] ?? filename;
  const extension = cleanName.split(".").pop()?.toLowerCase();
  return extension || "";
}

function normalizeWhitespace(text) {
  return text.replace(/\r\n/g, "\n").replace(/\t/g, " ").replace(/ +/g, " ").trim();
}

function chunkText(text) {
  const normalized = normalizeWhitespace(text);
  if (!normalized) return [];

  const chunks = [];
  let start = 0;
  let chunkIndex = 0;

  while (start < normalized.length) {
    const end = Math.min(start + CHUNK_SIZE, normalized.length);
    const slice = normalized.slice(start, end).trim();
    if (slice) {
      chunks.push({ text: slice, chunkIndex });
      chunkIndex += 1;
    }
    if (end >= normalized.length) break;
    start = Math.max(end - CHUNK_OVERLAP, start + 1);
  }

  return chunks;
}

function buildCollectionName(knowledgeBaseId) {
  return `kb_${knowledgeBaseId.replace(/[^a-zA-Z0-9_-]/g, "_")}`;
}

async function ensureCollection(client, collectionName) {
  const collections = await client.getCollections();
  const exists = collections.collections.some((collection) => collection.name === collectionName);
  if (exists) return;

  await client.createCollection(collectionName, {
    vectors: {
      size: DEFAULT_EMBEDDING_DIMENSIONS,
      distance: "Cosine",
    },
  });
}

async function embedTexts(openaiClient, texts) {
  const response = await openaiClient.embeddings.create({
    model: DEFAULT_EMBEDDING_MODEL,
    input: texts,
    dimensions: DEFAULT_EMBEDDING_DIMENSIONS,
  });
  return response.data.map((item) => item.embedding);
}

async function parsePdf(buffer) {
  const { PDFParse } = await import("pdf-parse");
  const parser = new PDFParse({ data: buffer });
  try {
    const result = await parser.getText();
    return normalizeWhitespace(result.text || "");
  } finally {
    await parser.destroy();
  }
}

const SUPPORTED_EXTENSIONS = new Set(["pdf", "txt", "md", "html", "csv", "json"]);

async function downloadRemoteFile(url, fallbackFilename) {
  const response = await fetch(url, {
    redirect: "follow",
    headers: {
      "user-agent": "Mozilla/5.0 KnowledgeBaseLab/1.0",
    },
  });

  if (!response.ok) {
    throw new Error(`Download failed (${response.status}) for ${url}`);
  }

  const disposition = response.headers.get("content-disposition");
  let filename =
    fallbackFilename ||
    decodeURIComponent(new URL(response.url).pathname.split("/").pop() || "download");
  if (disposition) {
    const match =
      disposition.match(/filename\*=UTF-8''([^;]+)/i) ||
      disposition.match(/filename="?([^"]+)"?/i);
    if (match?.[1]) {
      filename = decodeURIComponent(match[1]);
    }
  }

  const extension = getExtension(filename);
  const usableName = extension ? filename : `${filename}.pdf`;
  if (!SUPPORTED_EXTENSIONS.has(getExtension(usableName))) {
    throw new Error(`Unsupported file type for ${usableName}`);
  }

  const buffer = Buffer.from(await response.arrayBuffer());
  if (!buffer.length) {
    throw new Error(`Empty file from ${url}`);
  }

  const contentType = response.headers.get("content-type") || "application/pdf";
  return {
    filename: usableName,
    mimeType: contentType,
    buffer,
  };
}

async function ingestFile({
  openaiClient,
  qdrantClient,
  prisma,
  knowledgeBase,
  filename,
  mimeType,
  buffer,
  sourceUrl,
}) {
  const text = await parsePdf(buffer);
  const chunks = chunkText(text);
  if (!chunks.length) {
    throw new Error(`No indexable text found in ${filename}`);
  }

  const vectors = await embedTexts(
    openaiClient,
    chunks.map((chunk) => chunk.text),
  );

  const knowledgeFile = await prisma.knowledgeFile.create({
    data: {
      knowledgeBaseId: knowledgeBase.id,
      originalName: filename,
      importSource: ImportSource.WEB,
      sourceUrl,
      status: "IN_PROGRESS",
      bytes: buffer.length,
      mimeType,
      attributesJson: JSON.stringify({
        source: ImportSource.WEB.toLowerCase(),
        source_url: sourceUrl.slice(0, 512),
      }),
    },
  });

  await qdrantClient.upsert(knowledgeBase.qdrantCollectionName, {
    wait: true,
    points: chunks.map((chunk, index) => ({
      id: crypto.randomUUID(),
      vector: vectors[index],
      payload: {
        knowledgeBaseId: knowledgeBase.id,
        fileId: knowledgeFile.id,
        filename,
        chunkIndex: chunk.chunkIndex,
        text: chunk.text,
        source: ImportSource.WEB.toLowerCase(),
        sourceUrl,
      },
    })),
  });

  await prisma.knowledgeFile.update({
    where: { id: knowledgeFile.id },
    data: {
      status: "COMPLETED",
      chunkCount: chunks.length,
    },
  });
}

const PUBLIC_KNOWLEDGE_BASES = [
  {
    name: "Clinical Trials: Cancer",
    description:
      "Public open-access sources on oncology clinical trials, trial reporting, ethics review, and cancer research guidance.",
    urls: [
      {
        url: "https://pmc.ncbi.nlm.nih.gov/articles/PMC2647457/pdf/08-053769.pdf",
        title: "Reporting the findings of clinical trials (WHO discussion paper)",
      },
      {
        url: "https://www.ncbi.nlm.nih.gov/books/n/who44783/pdf/",
        title: "WHO ethics review standards for health-related research",
      },
      {
        url: "https://pmc.ncbi.nlm.nih.gov/articles/PMC2010938/pdf/",
        title: "WHO handbook for reporting results of cancer treatment",
      },
    ],
  },
  {
    name: "Aneurysms",
    description:
      "Public clinical guidance on intracranial aneurysms, subarachnoid hemorrhage, screening, and management.",
    urls: [
      {
        url: "https://pmc.ncbi.nlm.nih.gov/articles/PMC9446328/pdf/10.1177_23969873221099736.pdf",
        title: "ESO guidelines on management of unruptured intracranial aneurysms",
      },
      {
        url: "https://pmc.ncbi.nlm.nih.gov/articles/PMC4239410/pdf/",
        title: "Clinical practice guideline for management of intracranial aneurysms",
      },
      {
        url: "https://www.ncbi.nlm.nih.gov/books/NBK588910/pdf/",
        title: "NICE guideline: subarachnoid haemorrhage from ruptured aneurysm",
      },
      {
        url: "https://pmc.ncbi.nlm.nih.gov/articles/PMC10563934/pdf/",
        title: "Unruptured intracranial aneurysms review",
      },
    ],
  },
  {
    name: "Clinical Trials: Stroke",
    description:
      "Public open-access sources on acute stroke trials, thrombectomy evidence, and stroke trial enrollment.",
    urls: [
      {
        url: "https://pmc.ncbi.nlm.nih.gov/articles/PMC10542906/pdf/nihms-1925087.pdf",
        title: "Enhancing enrollment in acute stroke trials",
      },
      {
        url: "https://pmc.ncbi.nlm.nih.gov/articles/PMC12671639/pdf/",
        title: "Endovascular therapy in acute ischemic stroke with large infarct (SVIN guideline)",
      },
      {
        url: "https://pmc.ncbi.nlm.nih.gov/articles/PMC11460660/pdf/",
        title: "Mechanical thrombectomy in late-presenting LVO stroke",
      },
    ],
  },
  {
    name: "Ayurvedic Primary Care",
    description:
      "Public Ministry of Ayush and related guidance on Ayurveda in primary healthcare and wellness centres.",
    urls: [
      {
        url: "https://www.icmr.gov.in/icmrobject/custom_data/pdf/policy-briefs/IROR_7_Ayush_Himachal_revised_after_reviwers_comments.pdf",
        title: "Engaging public sector AYUSH practitioners in TB case detection",
      },
      {
        url: "https://www.icmr.gov.in/icmrobject/uploads/Guidelines/1740984016_icmraddendumethicalrequirementsforresearchinintegrativemedicine.pdf",
        title: "ICMR ethical requirements for research in integrative medicine",
      },
      {
        url: "https://www.icmr.gov.in/icmrobject/custom_data/1707817583_call_for_proposals_final_v2.pdf",
        title: "Ayush-ICMR advanced centre for integrative health research",
      },
      {
        url: "https://www.icmr.gov.in/icmrobject/uploads/Report/1752588650_nedl2ndedition.pdf",
        title: "National essential diagnostics list with Ayushman Bharat primary care context",
      },
    ],
  },
];

async function createKnowledgeBase(prisma, qdrantClient, name, description) {
  const existing = await prisma.knowledgeBase.findFirst({
    where: { name },
  });
  if (existing) {
    await prisma.knowledgeBase.update({
      where: { id: existing.id },
      data: {
        visibility: KbVisibility.PUBLIC,
        ownerId: null,
      },
    });
    console.log(`  Reusing existing KB: ${name} (${existing.id})`);
    return existing;
  }

  const kb = await prisma.knowledgeBase.create({
    data: {
      name,
      description,
      qdrantCollectionName: `kb_pending_${Date.now()}`,
      visibility: KbVisibility.PUBLIC,
      ownerId: null,
    },
  });

  const collectionName = buildCollectionName(kb.id);
  await ensureCollection(qdrantClient, collectionName);

  const updated = await prisma.knowledgeBase.update({
    where: { id: kb.id },
    data: { qdrantCollectionName: collectionName },
  });

  console.log(`  Created KB: ${name} (${updated.id})`);
  return updated;
}

async function findExistingByUrl(prisma, knowledgeBaseId, sourceUrl) {
  const normalized = normalizeSourceUrl(sourceUrl);
  const files = await prisma.knowledgeFile.findMany({
    where: {
      knowledgeBaseId,
      sourceUrl: { not: null },
    },
  });

  return (
    files.find((file) => file.sourceUrl && normalizeSourceUrl(file.sourceUrl) === normalized) ??
    null
  );
}

async function addUrlToKnowledgeBase({
  openaiClient,
  qdrantClient,
  prisma,
  knowledgeBase,
  source,
}) {
  const existing = await findExistingByUrl(prisma, knowledgeBase.id, source.url);
  if (existing) {
    console.log(`    Skip (already indexed): ${source.title}`);
    return { skipped: true };
  }

  console.log(`    Adding: ${source.title}`);
  const file = await downloadRemoteFile(
    source.url,
    source.title.replace(/[^\w.-]+/g, "_") + ".pdf",
  );

  await ingestFile({
    openaiClient,
    qdrantClient,
    prisma,
    knowledgeBase,
    filename: file.filename,
    mimeType: file.mimeType,
    buffer: file.buffer,
    sourceUrl: source.url,
  });

  return { skipped: false };
}

async function main() {
  loadEnv();

  if (!process.env.OPENAI_API_KEY) {
    throw new Error("OPENAI_API_KEY is required to seed public knowledge bases.");
  }

  const qdrantUrl = process.env.QDRANT_URL?.trim() || DEFAULT_QDRANT_URL;
  const qdrantApiKey = process.env.QDRANT_API_KEY?.trim() || undefined;

  const prisma = new PrismaClient();
  const openaiClient = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });
  const qdrantClient = new QdrantClient({
    url: qdrantUrl,
    apiKey: qdrantApiKey,
  });

  console.log("Seeding public knowledge bases...\n");

  const summary = [];

  for (const spec of PUBLIC_KNOWLEDGE_BASES) {
    console.log(`\n== ${spec.name} ==`);
    const knowledgeBase = await createKnowledgeBase(
      prisma,
      qdrantClient,
      spec.name,
      spec.description,
    );

    let added = 0;
    let skipped = 0;
    let failed = 0;

    for (const source of spec.urls) {
      try {
        const result = await addUrlToKnowledgeBase({
          openaiClient,
          qdrantClient,
          prisma,
          knowledgeBase,
          source,
        });
        if (result.skipped) skipped += 1;
        else added += 1;
      } catch (error) {
        failed += 1;
        console.error(`    Failed: ${source.title}`);
        console.error(`      ${error instanceof Error ? error.message : error}`);
      }
    }

    summary.push({
      name: spec.name,
      id: knowledgeBase.id,
      collectionName: knowledgeBase.qdrantCollectionName,
      added,
      skipped,
      failed,
    });
  }

  console.log("\n\nSeed summary:");
  for (const item of summary) {
    console.log(
      `- ${item.name}\n  kb_id: ${item.id}\n  collection: ${item.collectionName}\n  added: ${item.added}, skipped: ${item.skipped}, failed: ${item.failed}`,
    );
  }

  await prisma.$disconnect();
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
