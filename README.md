# Knowledge Base Lab

A Next.js experimentation app for building and testing multiple OpenAI File Search knowledge bases. You can:

- create a new OpenAI-backed knowledge base
- attach an existing OpenAI vector store
- upload files from your computer
- import supported files from public Google Drive links
- search the web for supported files and add them
- add sources directly by URL, with duplicate detection
- filter indexed documents by name, source type, status, and URL
- run direct retrieval search
- ask chat questions grounded in a single selected knowledge base with file citations
- call an OpenAI-compatible `/v1/chat/completions` endpoint backed by a selected knowledge base

## Stack

- Next.js App Router
- TypeScript
- Tailwind CSS
- Prisma client
- SQLite for local development
- OpenAI Responses API + vector stores

## Local setup

1. Install dependencies:

```bash
npm install
```

2. Create your env file if needed:

```bash
cp .env.example .env.local
```

3. Add an `OPENAI_API_KEY` to `.env.local` if you want a server fallback key.

4. Start the app:

```bash
npm run dev
```

The app starts on [http://localhost:3000](http://localhost:3000).

## API key behavior

- Users can paste their own OpenAI key in the app UI. It is stored only in `sessionStorage`.
- If no user key is present, the app falls back to `OPENAI_API_KEY` from the server environment.
- Fallback-key usage is limited to:
  - 1 search or chat request per minute per browser session
  - 5 successful file additions per hour per browser session

## Database notes

- Local development uses SQLite.
- The local SQLite file is created at `prisma/dev.db`.
- Prisma schema generation runs automatically before `dev` and `build`.

## Vercel deployment

Set these environment variables in Vercel:

- `OPENAI_API_KEY`
- `SESSION_SECRET`
- `DATABASE_PROVIDER=postgresql`
- `DATABASE_URL=<your-postgres-connection-string>`

The project is structured so the app code stays the same across local SQLite and deployed Postgres usage.

## Public knowledge base seed

To create starter public knowledge bases with curated open-access sources:

```bash
npm run seed:public-kbs
```

This seeds:

- Clinical Trials: Cancer
- Aneurysms
- Clinical Trials: Stroke
- Ayurvedic Primary Care

The script is idempotent: rerunning it reuses existing KBs by name and skips already-indexed source URLs.

## RAG API

The app exposes an OpenAI-compatible chat completions endpoint backed by a selected knowledge base vector store.

### Endpoint

`POST /v1/chat/completions`

### Required headers

- `Authorization: Bearer <OPENAI_API_KEY>` or `x-openai-api-key: <OPENAI_API_KEY>`
- `x-knowledge-base-id: <kb_id>`

You can also pass `model: "kb_<kb_id>"` instead of the `x-knowledge-base-id` header.

### Request body

```json
{
  "model": "gpt-5.5",
  "messages": [
    { "role": "user", "content": "What does the knowledge base say about treatment?" }
  ],
  "stream": false
}
```

### Example

```bash
curl https://your-app.example.com/v1/chat/completions \
  -H "Authorization: Bearer $OPENAI_API_KEY" \
  -H "Content-Type: application/json" \
  -H "x-knowledge-base-id: <kb_id>" \
  -d '{
    "model": "gpt-5.5",
    "messages": [
      { "role": "user", "content": "Summarize the indexed sources." }
    ]
  }'
```

### Response shape

The route returns an OpenAI-style `chat.completion` object. It also includes:

- `citations`: grounded file citations extracted from file search
- `warning`: present when no grounded results were retrieved

### Notes

- `stream: true` is not supported yet and returns `501`.
- The knowledge base id is shown in the workspace header after you open a project.
- Existing app routes remain available under `/api/knowledge-bases/...` for the UI and internal workflows.
