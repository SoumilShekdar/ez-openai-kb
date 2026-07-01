import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import OpenAI from "openai";
import { PrismaClient, ImportSource, SourceMode } from "@prisma/client";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(__dirname, "..");

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

const SUPPORTED_EXTENSIONS = new Set([
  "pdf",
  "doc",
  "docx",
  "txt",
  "md",
  "html",
  "csv",
  "json",
]);

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
  return new File([buffer], usableName, { type: contentType });
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
    searches: [
      { query: "cancer clinical trials reporting PDF", preset: "pmc" },
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
    searches: [{ query: "intracranial aneurysm guidelines PDF", preset: "pmc" }],
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
    searches: [{ query: "stroke clinical trials enrollment PDF", preset: "pmc" }],
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
    searches: [{ query: "ayurveda primary health care PDF", preset: "india" }],
  },
];

async function createKnowledgeBase(client, prisma, name, description) {
  const existing = await prisma.knowledgeBase.findFirst({
    where: { name },
  });
  if (existing) {
    console.log(`  Reusing existing KB: ${name} (${existing.id})`);
    return existing;
  }

  const vectorStore = await client.vectorStores.create({
    name,
    metadata: description ? { description } : undefined,
  });

  const kb = await prisma.knowledgeBase.create({
    data: {
      name,
      description,
      vectorStoreId: vectorStore.id,
      sourceMode: SourceMode.CREATED,
    },
  });

  console.log(`  Created KB: ${name} (${kb.id})`);
  return kb;
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

async function addUrlToKnowledgeBase({ client, prisma, knowledgeBase, source }) {
  const existing = await findExistingByUrl(prisma, knowledgeBase.id, source.url);
  if (existing) {
    console.log(`    Skip (already indexed): ${source.title}`);
    return { skipped: true };
  }

  console.log(`    Adding: ${source.title}`);
  const file = await downloadRemoteFile(source.url, source.title.replace(/[^\w.-]+/g, "_") + ".pdf");

  const uploaded = await client.files.create({
    file,
    purpose: "assistants",
  });

  const attributes = {
    source: ImportSource.WEB.toLowerCase(),
    source_url: source.url.slice(0, 512),
  };

  const vectorFile = await client.vectorStores.files.createAndPoll(knowledgeBase.vectorStoreId, {
    file_id: uploaded.id,
    attributes,
  });

  await prisma.knowledgeFile.upsert({
    where: { openaiFileId: uploaded.id },
    update: {
      knowledgeBaseId: knowledgeBase.id,
      vectorStoreFileId: vectorFile.id,
      originalName: file.name,
      importSource: ImportSource.WEB,
      sourceUrl: source.url,
      status:
        vectorFile.status === "completed"
          ? "COMPLETED"
          : vectorFile.status === "failed"
            ? "FAILED"
            : "IN_PROGRESS",
      bytes: file.size,
      mimeType: file.type,
      attributesJson: JSON.stringify(attributes),
    },
    create: {
      knowledgeBaseId: knowledgeBase.id,
      openaiFileId: uploaded.id,
      vectorStoreFileId: vectorFile.id,
      originalName: file.name,
      importSource: ImportSource.WEB,
      sourceUrl: source.url,
      status:
        vectorFile.status === "completed"
          ? "COMPLETED"
          : vectorFile.status === "failed"
            ? "FAILED"
            : "IN_PROGRESS",
      bytes: file.size,
      mimeType: file.type,
      attributesJson: JSON.stringify(attributes),
    },
  });

  return { skipped: false, status: vectorFile.status };
}

async function main() {
  loadEnv();

  if (!process.env.OPENAI_API_KEY) {
    throw new Error("OPENAI_API_KEY is required to seed public knowledge bases.");
  }

  const prisma = new PrismaClient();
  const client = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });

  console.log("Seeding public knowledge bases...\n");

  const summary = [];

  for (const spec of PUBLIC_KNOWLEDGE_BASES) {
    console.log(`\n== ${spec.name} ==`);
    const knowledgeBase = await createKnowledgeBase(
      client,
      prisma,
      spec.name,
      spec.description,
    );

    let added = 0;
    let skipped = 0;
    let failed = 0;

    for (const source of spec.urls) {
      try {
        const result = await addUrlToKnowledgeBase({
          client,
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
      vectorStoreId: knowledgeBase.vectorStoreId,
      added,
      skipped,
      failed,
    });
  }

  console.log("\n\nSeed summary:");
  for (const item of summary) {
    console.log(
      `- ${item.name}\n  kb_id: ${item.id}\n  vs_id: ${item.vectorStoreId}\n  added: ${item.added}, skipped: ${item.skipped}, failed: ${item.failed}`,
    );
  }

  await prisma.$disconnect();
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
