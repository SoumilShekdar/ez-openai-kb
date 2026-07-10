import OpenAI from "openai";
import dotenv from "dotenv";

dotenv.config();

const client = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY,
});

async function run() {
  const vectorStoreId = "vs_6a3e37cc1bf88191a22b93ee3f2d6ea8";
  
  console.log("Calling OpenAI Responses API with new prompt and vector store:", vectorStoreId);
  try {
    const response = await client.responses.create({
      model: "gpt-5.5",
      input: [
        {
          role: "system",
          content: [
            {
              type: "input_text",
              text: "You are a medical knowledge-base assistant. Answer ONLY using the retrieved file content. Do not use outside knowledge or general clinical knowledge. If the answer is not in the files, say: 'I cannot find that in the files.' For every sentence/statement you make, you must either ground it using a file citation (e.g. 【1†source】) or, if you must include outside knowledge or conversational filler that is not directly found in the files, you MUST append '[not in files]' at the end of that sentence."
            }
          ]
        },
        {
          role: "user",
          content: [
            {
              type: "input_text",
              text: "Describe diabetes as found in the files. Then, describe general insulin therapy (which is not in the files) using outside knowledge, appending '[not in files]' to those outside knowledge sentences."
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
