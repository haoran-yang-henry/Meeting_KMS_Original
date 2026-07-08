# Meeting KMS — System Architecture

---

## Repository Understanding

**User entry and input:**
Users begin in `Index.tsx` by uploading a meeting file (VTT, SRT, DOCX, PDF, TXT, JSON). The full workflow is orchestrated by `useTranscriptWorkflow`. Project/group/topic metadata is attached at this stage.

**Transcript Processing Pipeline:**
File is parsed and semantically chunked client-side (`transcript-parser.ts`: 600+ raw cues → 80–120 semantic segments). Segments are immediately embedded and indexed into Azure AI Search (`transcripts-add-to-index`). Transcript Correction (`transcripts-check`) runs in parallel with Summary Generation — confirmed by `Promise.all([checkBatchPromises, transcripts-generate-summary])` at lines 521–524 of `useTranscriptWorkflow.ts`. Corrections can trigger a re-index of the corrected segments.

**Summary Management Pipeline:**
`transcripts-generate-summary` runs in parallel with Transcript Correction. Its output is persisted with full meeting metadata via `transcripts-save-summary` (Metadata & Summaries). This then cascades into `transcripts-generate-project-summary`, which aggregates all meeting summaries for the project and writes a unified project context field (Project Memory). This cascade fires after every save event.

**Supporting components:**
All LLM and embedding calls are server-side inside Supabase Edge Functions. Azure OpenAI GPT is used by Transcript Correction, Summary Generation, and Retrieval. The embedding model is used during Embed & Index and inside Retrieval for query encoding. The persistent store is Azure AI Search (no relational database).

**User-facing access surfaces:**
Chat Interface (`Index.tsx` + `transcripts-chat`): an agentic edge function that routes to one of four tools — search transcript, search summary, adjust summary, extract. `Search.tsx` uses the same function with cross-transcript RAG enabled. Dashboard (`Dashboard.tsx` + `useTranscriptFilter` → `transcripts-search`): read-only, no AI generation triggered from the dashboard.

**Important files inspected:**
`useTranscriptWorkflow.ts` (lines 414, 521–524, 560, 586), `transcript-parser.ts`, `Index.tsx`, `Dashboard.tsx`, `Search.tsx`, `useTranscriptFilter.ts`, `transcripts-chat/index.ts`, `transcripts-generate-summary/index.ts`, `transcripts-check/index.ts`, `transcripts-generate-project-summary/index.ts`

**Assumptions / uncertainties:**
Parse & Chunk is placed as a shared entry node outside both pipeline subgraphs because it feeds both pipelines in parallel. `transcripts-generate-organization-summary` exists in the repo but is not invoked from any active frontend workflow and is excluded.

---

## System Architecture Diagram

```mermaid
flowchart TB
    classDef user  fill:#FFD580,stroke:#C8960C,color:#000,font-weight:bold
    classDef proc  fill:#AED6F1,stroke:#2471A3,color:#000
    classDef summ  fill:#A9DFBF,stroke:#1E8449,color:#000
    classDef store fill:#F1948A,stroke:#B03A2E,color:#fff,font-weight:bold
    classDef ai    fill:#D7BDE2,stroke:#7D3C98,color:#000
    classDef acc   fill:#FAD7A0,stroke:#D68910,color:#000
    classDef tech  fill:#FAFAFA,stroke:#CCCCCC,color:#555

    TECH["Frontend: React · TypeScript · Vite
    Backend: Supabase Edge Functions · Deno
    AI / Search: Azure OpenAI · Azure AI Search"]:::tech

    Analyst(["Analyst"]):::user
    Upload["Upload Transcript"]:::proc
    Parse["Parse & Chunk Transcript"]:::proc

    subgraph PipeA ["  Transcript Processing Pipeline  "]
        direction TB
        Correct["Transcript Correction"]:::proc
        Embed["Embed & Index Segments"]:::proc
        Correct --> Embed
    end

    subgraph PipeB ["  Summary Management Pipeline  "]
        direction TB
        GenSum["Generate Summary"]:::summ
        UpdateMeta["Update Metadata & Summaries"]:::summ
        UpdateProjMem["Update Project Memory"]:::summ
        GenSum --> UpdateMeta --> UpdateProjMem
    end

    subgraph KB ["  Knowledge Base / Search  "]
        direction LR
        SI[("Search Index")]:::store
        MS[("Metadata & Summaries")]:::store
        PM[("Project Memory")]:::store
    end

    AIS["AI Services
    LLM · Embeddings"]:::ai

    Chat["Chat Interface"]:::acc
    Dash["Dashboard & Views"]:::acc

    TECH          -.-  Analyst
    Analyst       -->  Upload
    Upload        -->  Parse
    Parse         -->  Correct
    Parse         -->  GenSum

    Embed         -->  SI
    UpdateMeta    -->  MS
    UpdateProjMem -->  PM

    Correct       -.-> AIS
    GenSum        -.-> AIS
    Embed         -.-> AIS

    SI            -->  Chat
    MS            -->  Dash
    PM            -->  Dash
```

> **Arrow legend:** Solid arrows show primary data and control flow. Dashed arrows show AI service dependency (LLM / embedding calls made server-side within each module).
