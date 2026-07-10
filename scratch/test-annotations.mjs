import OpenAI from "openai";
import dotenv from "dotenv";

dotenv.config();

const client = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY,
});

async function run() {
  const vectorStoreId = "vs_6a3e37cc1bf88191a22b93ee3f2d6ea8";
  
  console.log("Calling OpenAI Responses API with vector store:", vectorStoreId);
  try {
    const response = await client.responses.create({
      model: "gpt-5.5", // use the same model as in route.ts
      input: [
        {
          role: "system",
          content: [
            {
              type: "input_text",
              text: "You are a medical knowledge-base assistant. Answer using the retrieved knowledge base when possible. Cite grounded claims with file citations. If the knowledge base does not contain enough information, say so explicitly and avoid inventing unsupported facts."
            }
          ]
        },
        {
          role: "user",
          content: [
            {
              type: "input_text",
              text: "What is the treatment for hypertension?"
            }
          ]
        }
      ],
      tools: [
        {
          type: "file_search",
          vector_store_ids: [vectorStoreId],
          max_num_results: 8,
          ranking_options: {
            ranker: "auto",
            score_threshold: 0.15,
          }
        }
      ],
      include: ["file_search_call.results"]
    });

    console.log("Response ID:", response.id);
    const message = response.output?.find((item) => item.type === "message");
    
    console.log("OUTPUT PARTS:");
    for (const part of message?.content ?? []) {
      console.log(`Part Type: ${part.type}`);
      if (part.type === "output_text") {
        console.log("TEXT CONTENT:", JSON.stringify(part.text));
        console.log("ANNOTATIONS:", JSON.stringify(part.annotations, null, 2));
      }
    }
  } catch (error) {
    console.error("OpenAI call failed:", error);
  }
}

run();
