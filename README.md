# Knowledge Base Lab

A Next.js experimentation app for building and testing multiple OpenAI File Search knowledge bases. You can:

- create a new OpenAI-backed knowledge base
- attach an existing OpenAI vector store
- upload files from your computer
- import supported files from public Google Drive links
- search the web for supported files and add them
- run direct retrieval search
- ask chat questions grounded in a single selected knowledge base with file citations

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
