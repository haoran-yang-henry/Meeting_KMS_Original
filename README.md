# Meeting KMS

**AI-powered meeting transcription, correction, summarization, and retrieval — built for enterprise knowledge management.**

---

## Overview

Meeting KMS transforms raw meeting transcripts into structured organizational knowledge. Upload a transcript, let AI correct domain-specific errors using your project's context, generate hierarchical summaries, and retrieve insights through semantic search or agentic chat.

```
Upload → Parse → Correct → Summarize → Search
```

---

## Features

### Transcript Ingestion
- Supports VTT, SRT, DOCX, PDF, XLSX, TXT, JSON, MD (up to 50MB)
- Semantic chunking: 600+ raw cues → 80–120 context-rich chunks
- Automatic speaker merging, punctuation-aware splitting
- Duplicate detection via title matching

### AI-Powered Correction
- Context-aware correction using project memory from past meetings
- Categorized suggestions: domain terms, misspellings, abbreviations, redactions
- Review and apply/reject suggestions with live preview
- Custom glossary and redaction rules

### Hierarchical Summarization
- **Meeting level** — per-transcript summary with tags, decisions, action items
- **Project level** — auto-aggregated cross-meeting memory
- Manual editing and one-click regeneration
- Cascade updates: saving a summary refreshes the full project memory

### Retrieval & Agentic Chat
- 4-tool AI agent per transcript:
  - `search_transcript` — RAG over indexed segments
  - `search_summary` — query meeting summaries
  - `adjust_summary` — regenerate with a focus topic
  - `extract_from_transcript` — pull quotes, names, dates
- Global cross-transcript semantic search with conversation history
- Dashboard views: Timeline, Project, Group, Topic, Unassigned

---

## Tech Stack

| Layer | Technology |
|---|---|
| Frontend | React 18, TypeScript, Vite, Tailwind CSS, shadcn/ui |
| Backend | Supabase Edge Functions (Deno) |
| AI Models | Azure OpenAI (chat + embeddings via Text-Embedding-3-Large) |
| Search & Storage | Azure AI Search (hybrid vector + keyword) |
| i18n | i18next — English & German |

---

## Getting Started

### Prerequisites
- Node.js 18+
- A Supabase project
- Azure AI Search index
- Azure OpenAI deployments (chat model + embedding model)

### Installation

```bash
git clone https://github.com/your-username/meeting-kms.git
cd meeting-kms
npm install
```

### Environment Variables

Create a `.env` file:

```env
VITE_SUPABASE_URL=https://<your-project>.supabase.co
VITE_SUPABASE_PROJECT_ID=<your-project-id>
VITE_SUPABASE_PUBLISHABLE_KEY=<your-anon-key>
```

Set the following secrets in your **Supabase project dashboard**:

```
AZURE_SEARCH_ENDPOINT
AZURE_SEARCH_API_KEY
AZURE_SEARCH_INDEX_NAME

AZURE_FOUNDRY_GPT52CHAT_ENDPOINT
AZURE_FOUNDRY_GPT52CHAT_API_KEY

AZURE_AI_FOUNDRY_TEXTEMBEDDING3L_ENDPOINT
AZURE_AI_FOUNDRY_TEXTEMBEDDING3L_API_KEY
```

### Run

```bash
npm run dev       # Development server at http://localhost:8080
npm run build     # Production build
npm run preview   # Preview production build
```

---

## Architecture

```
Browser (React)
    │
    ├── Upload / Correction / Summary  →  Index Page
    ├── Semantic Search + Chat         →  Search Page
    └── Multi-view Dashboard           →  Dashboard Page
    │
    ▼
Supabase Edge Functions (Deno)
    │
    ├── transcripts-add-to-index            →  Embed + upsert to Azure AI Search
    ├── transcripts-check                   →  Correction suggestions via GPT
    ├── transcripts-generate-summary        →  Meeting summary via GPT
    ├── transcripts-generate-project-summary  →  Aggregate project memory
    ├── transcripts-chat                    →  4-tool agentic router
    └── transcripts-search                  →  Hybrid vector + keyword search
    │
    ▼
Azure AI Search  ←→  Azure OpenAI (GPT + Embeddings)
```

All persistent data lives in **Azure AI Search** as two document types:
- `segment` — chunked transcript text with 3072-dim embeddings
- `metadata` — meeting metadata, summaries, tags, and project memory

---

## Data Models

```typescript
interface TranscriptSegment {
  segmentId: string;
  transcriptId: string;
  text: string;
  speaker?: string;
  startTime?: string;
  endTime?: string;
}

interface TranscriptMetadata {
  meetingTitle?: string;
  meetingDate?: string;
  project?: string;
  group?: string;
  topic?: string;
  summaryText?: string;       // Markdown
  summaryTags?: string[];
  projectSummary?: string;    // Aggregated cross-meeting memory
}
```

---

## Project Structure

```
src/
├── pages/           # Index, Search, Dashboard
├── components/      # Correction, chat, summary, dashboard views
├── hooks/           # Business logic (workflow, correction, summary, search)
├── lib/             # Transcript parser, utilities
├── types/           # TypeScript interfaces
└── i18n/            # en / de locale files

supabase/functions/  # All backend edge functions
docs/                # Architecture diagrams and sequence flows
```

---

## Documentation

Detailed architecture and sequence diagrams are in [`/docs`](./docs/):

- [`architecture.md`](./docs/architecture.md) — System overview with Mermaid diagram
- [`functional_modules.md`](./docs/functional_modules.md) — In-depth module breakdown
- Sequence diagrams for each pipeline stage (also available as rendered HTML)

---

## License

MIT
