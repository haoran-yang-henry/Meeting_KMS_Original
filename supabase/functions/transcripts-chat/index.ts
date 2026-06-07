import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { CHAT_MODEL, embedText, NANO_MODEL, openaiConfigured, responsesFetch } from "../_shared/openai.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

// FR4.3 - Conversation message structure
interface ConversationMessage {
  role: "user" | "assistant";
  content: string;
}

// FR4.2 - Chat request
interface ChatRequest {
  query: string;
  transcriptId?: string; // Optional - if not provided, general chat mode
  useRAG?: boolean; // If true, search across all transcripts (for Search page)
  conversationHistory: ConversationMessage[];
  filters?: {
    project?: string;
    group?: string;
    dateFrom?: string;
    dateTo?: string;
  };
  summaryContext?: string; // Optional summary for context (current version)
  originalSummary?: string; // Original summary before any adjustments (for iterative edits)
  transcriptContent?: string; // Full transcript content for summary adjustments
  // REMOVED: adjustSummary flag - now using pure AI routing
}

// Simplified 4-tool agentic design
type AgentToolName = 
  | 'search_transcript'       // RAG search in transcript segments
  | 'search_summary'          // Find info in current summary
  | 'adjust_summary'          // Modify summary using transcript
  | 'extract_from_transcript';// Extract specific content from transcript

interface AgentToolCall {
  tool: AgentToolName;
  confidence: number;
  reasoning: string;
  parameters: {
    focusTopics?: string[];
    excludeTopics?: string[];
    targetLength?: "shorter" | "longer" | "same";
    outputFormat?: "bullets" | "paragraph" | "structured";
  };
}

// Tool definition for the 4-tool agent (Azure Responses API format)
// Note: Azure Responses API requires 'name' at the top level of the tool object
const agentToolDefinition = {
  type: "function",
  name: "route_to_tool",
  description: "Route the user's query to the appropriate tool based on their intent",
  parameters: {
    type: "object",
    properties: {
      tool: {
        type: "string",
        enum: ["search_transcript", "search_summary", "adjust_summary", "extract_from_transcript"],
        description: `Select the appropriate tool:
- search_transcript: User wants to find SPECIFIC INFORMATION from the transcript (who said what, what was discussed, when something happened). Use for questions starting with what/who/when/where/how/why.
- search_summary: User wants to find information IN THE CURRENT SUMMARY (e.g., "what does the summary say about X", "is X mentioned in the summary").
- adjust_summary: User wants to MODIFY, REWRITE, or REGENERATE the summary - shorten, expand, filter topics, reformat, or FOCUS on specific sections (e.g., "make it shorter", "only include management topics", "add more detail", "generate a Purpose section", "rewrite as key decisions", "generate executive summary"). Use this when user wants to transform the summary with a specific focus or format.
- extract_from_transcript: User wants to EXTRACT raw data points or lists from the transcript WITHOUT rewriting the summary (e.g., "list all names mentioned", "what exact quotes were said about X", "extract all dates mentioned").`
      },
      confidence: {
        type: "number",
        description: "Confidence score between 0 and 1"
      },
      reasoning: {
        type: "string",
        description: "Brief explanation of why this tool was selected - this will be shown to the user"
      },
      parameters: {
        type: "object",
        properties: {
          focusTopics: {
            type: "array",
            items: { type: "string" },
            description: "Topics to focus on"
          },
          excludeTopics: {
            type: "array",
            items: { type: "string" },
            description: "Topics to exclude"
          },
          targetLength: {
            type: "string",
            enum: ["shorter", "longer", "same"],
            description: "Desired output length"
          },
          outputFormat: {
            type: "string",
            enum: ["bullets", "paragraph", "structured"],
            description: "Desired output format"
          }
        }
      }
    },
    required: ["tool", "confidence", "reasoning"]
  }
};

/**
 * 4-Tool Agent Router using Azure AI Foundry Chat model
 * Routes queries to the appropriate tool based on user intent
 */
async function routeToTool(
  query: string,
  hasSummaryContext: boolean,
  hasTranscriptId: boolean,
): Promise<AgentToolCall> {
  console.log("Routing query to appropriate tool...");

  if (!openaiConfigured()) {
    console.log("OPENAI_API_KEY not configured, using fallback heuristics");
    return fallbackToolRouting(query, hasSummaryContext, hasTranscriptId);
  }

  const contextInfo = [
    hasSummaryContext ? "A summary is currently displayed" : "No summary context",
    hasTranscriptId ? "Working with a specific transcript" : "Cross-transcript or general mode",
  ].join(". ");

  const systemPrompt = `You are a tool router for a meeting transcript assistant.
Analyze the user's query and route it to the appropriate tool.

CONTEXT:
${contextInfo}

TOOL SELECTION RULES:
1. search_transcript: User asks QUESTIONS about transcript content (what, who, when, where, how, why)
2. search_summary: User asks about what's IN THE SUMMARY specifically
3. adjust_summary: User wants to MODIFY, REGENERATE, or FOCUS the summary (shorten, expand, filter, reformat, generate sections)
4. extract_from_transcript: User wants RAW DATA extraction without summary rewrite (exact quotes, names, dates)

CRITICAL EXAMPLES:
- "Generate a Purpose section" → adjust_summary (regenerating summary with focus)
- "Generate executive summary" → adjust_summary (rewriting summary format)
- "Generate key decisions" → adjust_summary (restructuring summary around decisions)
- "Rewrite as action items" → adjust_summary (reformatting summary)
- "make the summary shorter" → adjust_summary
- "what action items were discussed?" → search_transcript (searching existing content)
- "list all exact quotes about X" → extract_from_transcript (raw data extraction)
- "what does the summary say about X?" → search_summary

Always use the route_to_tool function to provide your analysis.`;

  // Use Responses API format with 'input' instead of 'messages'
  const inputMessages = [
    { role: "system", content: systemPrompt },
    { role: "user", content: query },
  ];

  try {
    const response = await responsesFetch({
        model: CHAT_MODEL,
        input: inputMessages,
        tools: [agentToolDefinition],
        tool_choice: { type: "function", name: "route_to_tool" },
        max_output_tokens: 500,
    });

    if (!response.ok) {
      console.error("Tool routing error:", await response.text());
      return fallbackToolRouting(query, hasSummaryContext, hasTranscriptId);
    }

    const result = await response.json();
    
    // Extract tool call result from Responses API format
    // Responses API returns tool_calls in output array
    const outputItems = result.output || [];
    const toolCallItem = outputItems.find((item: any) => 
      item.type === "function_call" || item.type === "tool_use"
    );
    
    if (toolCallItem) {
      try {
        const args = typeof toolCallItem.arguments === 'string' 
          ? JSON.parse(toolCallItem.arguments) 
          : toolCallItem.arguments;
        console.log(`Tool selected: ${args.tool} (confidence: ${args.confidence})`);
        console.log(`Reasoning: ${args.reasoning}`);
        return {
          tool: args.tool,
          confidence: args.confidence,
          reasoning: args.reasoning,
          parameters: args.parameters || {},
        };
      } catch (e) {
        console.error("Failed to parse tool routing:", e);
      }
    }
    
    // Fallback: try to parse from text output if no tool call found
    const textOutput = outputItems.find((item: any) => item.type === "message" && item.content);
    if (textOutput?.content) {
      console.log("No tool call in output, falling back to heuristics");
    }

    return fallbackToolRouting(query, hasSummaryContext, hasTranscriptId);
  } catch (error) {
    console.error("Tool routing failed:", error);
    return fallbackToolRouting(query, hasSummaryContext, hasTranscriptId);
  }
}

/**
 * Fallback heuristic-based tool routing (used if agent fails)
 */
function fallbackToolRouting(
  query: string,
  hasSummaryContext: boolean,
  hasTranscriptId: boolean,
): AgentToolCall {
  console.log("Using fallback heuristic tool routing");
  const lowerQuery = query.toLowerCase();

  // Extract patterns for extract_from_transcript
  if (/\b(list all|generate|extract|create a list|give me all|provide all)\b/i.test(lowerQuery)) {
    return { 
      tool: "extract_from_transcript", 
      confidence: 0.8, 
      reasoning: "Detected extraction/generation request", 
      parameters: {} 
    };
  }

  // Adjust summary patterns (includes structure/format requests)
  if (hasSummaryContext && /\b(shorten|expand|shorter|longer|make it|condense|only|focus|filter|rewrite|structure|restructure|format|reformat|organize)\b/i.test(lowerQuery)) {
    const targetLength = /shorter|concise|brief|condense/i.test(lowerQuery) ? "shorter" : 
                        /longer|detailed|expand/i.test(lowerQuery) ? "longer" : "same";
    const focusTopics = extractTopics(query);
    return { 
      tool: "adjust_summary", 
      confidence: 0.8, 
      reasoning: "Detected summary modification request", 
      parameters: { targetLength, focusTopics } 
    };
  }

  // Search summary patterns
  if (hasSummaryContext && /\b(summary says?|in the summary|summary mentions?|according to summary)\b/i.test(lowerQuery)) {
    return { 
      tool: "search_summary", 
      confidence: 0.8, 
      reasoning: "User asking about summary content", 
      parameters: {} 
    };
  }

  // Default to search_transcript for questions
  return { 
    tool: "search_transcript", 
    confidence: 0.7, 
    reasoning: "Default: searching transcript for information", 
    parameters: {} 
  };
}

/**
 * Extract topic keywords from query
 */
function extractTopics(query: string): string[] {
  const topicPatterns = [
    /\b(technical|management|business|marketing|sales|finance|hr|legal|product|design|engineering|budget|timeline|deadline|decision|action item|risk|security|performance|testing|deployment|infrastructure)\b/gi
  ];
  
  const topics: string[] = [];
  for (const pattern of topicPatterns) {
    const matches = query.match(pattern);
    if (matches) {
      topics.push(...matches.map(m => m.toLowerCase()));
    }
  }
  return [...new Set(topics)];
}

// FR4.2 - Segment from vector search
interface RetrievedSegment {
  segmentId: string;
  transcriptId?: string;
  meetingTitle?: string;
  text: string;
  startTime?: string;
  endTime?: string;
  project?: string;
  group?: string;
  topics?: string[];
  tags?: string[];
  status?: string;
  summaryText?: string;
  summaryTags?: string[];
  projectSummary?: string;
  organizationSummary?: string;
  score: number;
}

/**
 * FR4.2 - Step 1: Convert query to embedding vector
 */
async function getQueryEmbedding(query: string): Promise<number[]> {
  console.log("Generating query embedding...");
  return await embedText(query);
}

/**
 * FR4.2 - Step 2: Perform Azure AI Search vector search
 */
async function vectorSearch(
  queryVector: number[],
  transcriptId: string | null,
  filters: ChatRequest["filters"],
  searchEndpoint: string,
  searchApiKey: string,
  indexName: string,
  topN: number = 5,
): Promise<RetrievedSegment[]> {
  console.log(
    `Performing vector search${transcriptId ? ` for transcript: ${transcriptId}` : " across all transcripts"}`,
  );

  // Build filter string
  const filterParts: string[] = [`docType eq 'segment'`];

  // Only filter by transcriptId if provided (single transcript mode)
  if (transcriptId) {
    filterParts.push(`transcriptId eq '${transcriptId}'`);
  }

  if (filters?.project) {
    filterParts.push(`project eq '${filters.project}'`);
  }
  if (filters?.group) {
    filterParts.push(`group eq '${filters.group}'`);
  }

  const filterString = filterParts.join(" and ");

  const searchUrl = `${searchEndpoint}/indexes/${indexName}/docs/search?api-version=2023-11-01`;

  const searchBody = {
    count: true,
    select: "segmentId,transcriptId,meetingTitle,text,startTime,endTime,project,group,topics",
    filter: filterString,
    vectorQueries: [
      {
        kind: "vector",
        vector: queryVector,
        fields: "embedding",
        k: topN,
      },
    ],
    top: topN,
  };

  const response = await fetch(searchUrl, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "api-key": searchApiKey,
    },
    body: JSON.stringify(searchBody),
  });

  if (!response.ok) {
    const errorText = await response.text();
    console.error("Vector search error:", errorText);
    throw new Error(`Search error: ${response.status}`);
  }

  const result = await response.json();
  console.log(`Found ${result.value?.length || 0} matching segments`);

  return (result.value || []).map((doc: any) => ({
    segmentId: doc.segmentId,
    transcriptId: doc.transcriptId,
    meetingTitle: doc.meetingTitle,
    text: doc.text,
    startTime: doc.startTime,
    endTime: doc.endTime,
    project: doc.project,
    group: doc.group,
    topics: doc.topics || [],
    score: doc["@search.score"] || 0,
  }));
}

/**
 * Fetch metadata documents for transcriptIds to get project/group info
 */
async function fetchMetadataForTranscripts(
  transcriptIds: string[],
  searchEndpoint: string,
  searchApiKey: string,
  indexName: string,
): Promise<Map<string, { project?: string; group?: string; meetingTitle?: string; status?: string; topics?: string[]; tags?: string[]; summaryText?: string; summaryTags?: string[]; projectSummary?: string }>> {
  if (transcriptIds.length === 0) return new Map();

  const uniqueIds = [...new Set(transcriptIds)];
  const filterParts = uniqueIds.map((id) => `transcriptId eq '${id}'`).join(" or ");
  const filterString = `docType eq 'metadata' and (${filterParts})`;

  const searchUrl = `${searchEndpoint}/indexes/${indexName}/docs/search?api-version=2023-11-01`;

  const response = await fetch(searchUrl, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "api-key": searchApiKey,
    },
    body: JSON.stringify({
      search: "*",
      filter: filterString,
      select: "transcriptId,project,group,meetingTitle,status,topics,tags,summaryText,summaryTags,projectSummary",
      top: uniqueIds.length,
    }),
  });

  if (!response.ok) {
    console.error("Metadata fetch error:", await response.text());
    return new Map();
  }

  const result = await response.json();
  const metaMap = new Map<string, { project?: string; group?: string; meetingTitle?: string; status?: string; topics?: string[]; tags?: string[]; summaryText?: string; summaryTags?: string[]; projectSummary?: string }>();

  for (const doc of result.value || []) {
    metaMap.set(doc.transcriptId, {
      project: doc.project,
      group: doc.group,
      meetingTitle: doc.meetingTitle,
      status: doc.status,
      topics: doc.topics || [],
      tags: doc.tags || [],
      summaryText: doc.summaryText,
      summaryTags: doc.summaryTags || [],
      projectSummary: doc.projectSummary,
    });
  }

  console.log(`Fetched metadata for ${metaMap.size} transcripts`);
  return metaMap;
}

/**
 * Extract text from Responses API format
 */
function extractTextFromResponsesAPI(result: any): string {
  // OpenAI Responses API convenience field
  if (typeof result?.output_text === "string") return result.output_text;

  // Common Responses API shape: { output: [{ type: 'message', content: [{ type:'output_text', text:'...' }] }] }
  const output = result?.output;
  if (Array.isArray(output)) {
    const message = output.find((o: any) => o?.type === "message") || output[0];
    const contentArr = message?.content;
    if (Array.isArray(contentArr)) {
      const texts = contentArr
        .map((c: any) => c?.text)
        .filter((t: any) => typeof t === "string");
      if (texts.length) return texts.join("");
    }
  }

  return "";
}

/**
 * FR4.2 - Step 4 & 5: Create prompt and call reasoning model (GPT-5.2-Chat Responses API)
 */
async function callReasoningModel(
  query: string,
  segments: RetrievedSegment[],
  conversationHistory: ConversationMessage[],
  summaryContext: string | undefined,
  isCrossTranscript: boolean = false,
): Promise<string> {
  console.log("Calling Azure GPT-5.2-Chat (Responses API)...");

  // Build context from retrieved segments - group by meeting if cross-transcript
  let segmentContext: string;

  if (isCrossTranscript) {
    // Group segments by meeting for better context
    const byMeeting = new Map<string, RetrievedSegment[]>();
    segments.forEach((seg) => {
      const key = seg.meetingTitle || seg.transcriptId || "Unknown";
      if (!byMeeting.has(key)) byMeeting.set(key, []);
      byMeeting.get(key)!.push(seg);
    });

    const parts: string[] = [];
    byMeeting.forEach((segs, meeting) => {
      // Include project/group/status metadata for the meeting
      const firstSeg = segs[0];
      const metaInfo = [
        firstSeg.project ? `Project: ${firstSeg.project}` : null,
        firstSeg.group ? `Group: ${firstSeg.group}` : null,
        firstSeg.status ? `Status: ${firstSeg.status}` : null,
      ]
        .filter(Boolean)
        .join(", ");

      parts.push(`--- From "${meeting}"${metaInfo ? ` (${metaInfo})` : ""} ---`);
      
      // Include meeting summary if available
      if (firstSeg.summaryText) {
        parts.push(`Meeting Summary: ${firstSeg.summaryText}`);
      }
      
      // Include project summary if available
      if (firstSeg.projectSummary) {
        parts.push(`Project Summary: ${firstSeg.projectSummary}`);
      }
      
      // Include tags if available
      if (firstSeg.tags && firstSeg.tags.length > 0) {
        parts.push(`Tags: ${firstSeg.tags.join(", ")}`);
      }
      
      parts.push("Segments:");
      segs.forEach((seg, idx) => {
        const timeInfo = seg.startTime ? ` [${seg.startTime}]` : "";
        parts.push(`[${idx + 1}]${timeInfo}: ${seg.text}`);
      });
    });
    segmentContext = parts.join("\n\n");
  } else {
    // Single transcript mode - include summary from first segment if available
    const firstSeg = segments[0];
    let singleTranscriptContext = "";
    
    if (firstSeg?.summaryText) {
      singleTranscriptContext += `Meeting Summary: ${firstSeg.summaryText}\n\n`;
    }
    if (firstSeg?.projectSummary) {
      singleTranscriptContext += `Project Summary: ${firstSeg.projectSummary}\n\n`;
    }
    if (firstSeg?.tags && firstSeg.tags.length > 0) {
      singleTranscriptContext += `Tags: ${firstSeg.tags.join(", ")}\n\n`;
    }
    
    singleTranscriptContext += "Segments:\n";
    singleTranscriptContext += segments
      .map((seg, idx) => {
        const timeInfo = seg.startTime ? ` [${seg.startTime}]` : "";
        const metaInfo = [
          seg.project ? `Project: ${seg.project}` : null,
          seg.group ? `Group: ${seg.group}` : null,
          seg.status ? `Status: ${seg.status}` : null,
        ]
          .filter(Boolean)
          .join(", ");
        const metaSuffix = metaInfo ? ` (${metaInfo})` : "";
        return `[${idx + 1}]${timeInfo}${metaSuffix}: ${seg.text}`;
      })
      .join("\n\n");
    
    segmentContext = singleTranscriptContext;
  }

  // Build system prompt with context
  const contextLabel = isCrossTranscript ? "RETRIEVED SEGMENTS FROM MEETINGS" : "RETRIEVED TRANSCRIPT SEGMENTS";
  let systemPrompt = `You are a helpful meeting assistant that answers questions about transcript content.

${contextLabel}:
${segmentContext}
`;

  if (summaryContext) {
    systemPrompt += `
MEETING SUMMARY:
${summaryContext}
`;
  }

  systemPrompt += `
INSTRUCTIONS:
- Answer questions based on the ${isCrossTranscript ? "meeting segments and summaries" : "transcript segments and summary"} provided above
- If the user asks about summaries, use the Meeting Summary and Project Summary information provided
- If the answer is not in the provided context, say "I couldn't find that information in the ${isCrossTranscript ? "indexed meetings" : "transcript"}"
- Reference specific parts of the ${isCrossTranscript ? "meetings" : "transcript"} when answering
${isCrossTranscript ? "- Mention which meeting the information comes from when relevant" : ""}
- Be concise but thorough
- If timestamps are available, mention them when relevant`;

  // Build messages array with conversation history
  const inputMessages = [
    { role: "system", content: systemPrompt },
    ...conversationHistory.map((msg) => ({
      role: msg.role,
      content: msg.content,
    })),
    { role: "user", content: query },
  ];

  // Log context length for debugging
  const contextLength = JSON.stringify(inputMessages).length;
  console.log(`Context length: ${contextLength} chars, ${inputMessages.length} messages`);

  // Use Responses API format for GPT-5.2-Chat
  const response = await responsesFetch({
      model: CHAT_MODEL,
      input: inputMessages,
      max_output_tokens: 4000,
  });

  if (!response.ok) {
    const errorText = await response.text();
    console.error("Azure GPT-5.2-Chat error:", errorText);
    throw new Error(`Reasoning model error: ${response.status}`);
  }

  const result = await response.json();
  
  // Log response details for debugging
  console.log(`Response has output: ${!!result.output || !!result.output_text}`);
  
  const content = extractTextFromResponsesAPI(result);
  
  if (!content) {
    console.error("Empty response from model:", JSON.stringify(result));
    return "The AI model returned an empty response. Please try asking a simpler or more specific question.";
  }
  
  return content;
}

/**
 * General chat without transcript context (GPT-5.2-Chat Responses API)
 */
async function callGeneralChat(
  query: string,
  conversationHistory: ConversationMessage[],
): Promise<string> {
  console.log("Calling Azure GPT-5.2-Chat for general chat (Responses API)...");

  const systemPrompt = `You are a helpful AI assistant. You can help with general questions, brainstorming, and discussions. Be friendly, helpful, and concise.`;

  const inputMessages = [
    { role: "system", content: systemPrompt },
    ...conversationHistory.map((msg) => ({
      role: msg.role,
      content: msg.content,
    })),
    { role: "user", content: query },
  ];

  const contextLength = JSON.stringify(inputMessages).length;
  console.log(`General chat context length: ${contextLength} chars`);

  // Use Responses API format
  const response = await responsesFetch({
      model: CHAT_MODEL,
      input: inputMessages,
      max_output_tokens: 4000,
  });

  if (!response.ok) {
    const errorText = await response.text();
    console.error("Azure GPT-5.2-Chat error:", errorText);
    throw new Error(`Reasoning model error: ${response.status}`);
  }

  const result = await response.json();
  
  console.log(`General chat has output: ${!!result.output || !!result.output_text}`);
  
  const content = extractTextFromResponsesAPI(result);
  
  if (!content) {
    console.error("Empty general chat response:", JSON.stringify(result));
    return "The AI model returned an empty response. Please try a different question.";
  }
  
  return content;
}

/**
 * Tool: search_summary - Search within the current summary
 */
async function callSummarySearch(
  query: string,
  summaryContext: string,
  conversationHistory: ConversationMessage[],
): Promise<string> {
  console.log("search_summary tool - answering from summary...");

  const systemPrompt = `You are a meeting assistant. Answer the user's question based ONLY on the meeting summary provided.

MEETING SUMMARY:
${summaryContext}

INSTRUCTIONS:
- Answer questions based ONLY on the summary above
- If the information is not in the summary, say "This information is not in the current summary. Would you like me to search the full transcript?"
- Be concise and direct`;

  const inputMessages = [
    { role: "system", content: systemPrompt },
    ...conversationHistory.map((msg) => ({ role: msg.role, content: msg.content })),
    { role: "user", content: query },
  ];

  const response = await responsesFetch({
      model: CHAT_MODEL,
      input: inputMessages,
      max_output_tokens: 2000,
  });

  if (!response.ok) {
    throw new Error(`Summary search error: ${response.status}`);
  }

  const result = await response.json();
  return extractTextFromResponsesAPI(result) || "Unable to search the summary.";
}

/**
 * Check if query is asking for a full meeting recap/summary (needs all segments)
 */
function isFullRecapQuery(query: string): boolean {
  const lowerQuery = query.toLowerCase();
  const recapPatterns = [
    /\b(full|complete|detailed|comprehensive|thorough)\b.*(recap|summary|overview|review)/,
    /\b(recap|summarize|summary).*(full|complete|entire|whole|all)/,
    /\bgive me a recap\b/,
    /\bgenerate.*(recap|summary)\b/,
    /\brecap (of )?(the |this )?(meeting|transcript|session)\b/,
    /\bsummarize (the |this )?(entire|whole|full)?\s*(meeting|transcript|session)?\b/,
    /\bwhat (was|happened|discussed) in (the |this )?(meeting|session)\b/,
    /\b(meeting|transcript) recap\b/,
    /\boverview of (the |this )?(meeting|transcript|session)\b/,
    /\bkey points from (the |this )?(meeting|transcript)\b/,
    /\bmain (points|topics|discussions?) (from|in|of)\b/,
  ];
  
  return recapPatterns.some(pattern => pattern.test(lowerQuery));
}

/**
 * Fetch ALL segments for a specific transcript (for full recap queries)
 */
async function fetchAllTranscriptSegments(
  transcriptId: string,
  searchEndpoint: string,
  searchApiKey: string,
  indexName: string,
): Promise<RetrievedSegment[]> {
  console.log(`Fetching ALL segments for transcript: ${transcriptId}`);
  
  const filterString = `docType eq 'segment' and transcriptId eq '${transcriptId}'`;
  const searchUrl = `${searchEndpoint}/indexes/${indexName}/docs/search?api-version=2023-11-01`;

  const searchBody = {
    search: "*",
    filter: filterString,
    select: "segmentId,transcriptId,meetingTitle,text,startTime,endTime,project,group,topics",
    orderby: "segmentId asc", // Order by segment ID to maintain chronological order
    top: 1000, // Get up to 1000 segments
  };

  const response = await fetch(searchUrl, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "api-key": searchApiKey,
    },
    body: JSON.stringify(searchBody),
  });

  if (!response.ok) {
    const errorText = await response.text();
    console.error("Fetch all segments error:", errorText);
    throw new Error(`Search error: ${response.status}`);
  }

  const result = await response.json();
  const allSegments = result.value || [];
  console.log(`Found ${allSegments.length} total segments for transcript`);

  // Sample segments to stay within token limits (~50k chars max for context)
  // Aim for ~100 segments max to keep context manageable
  const MAX_SEGMENTS = 100;
  const MAX_CHARS = 50000;
  
  let segments: any[] = allSegments;
  
  if (allSegments.length > MAX_SEGMENTS) {
    // Sample evenly across the transcript to maintain coverage
    const step = allSegments.length / MAX_SEGMENTS;
    segments = [];
    for (let i = 0; i < allSegments.length && segments.length < MAX_SEGMENTS; i += step) {
      segments.push(allSegments[Math.floor(i)]);
    }
    console.log(`Sampled ${segments.length} segments from ${allSegments.length} total`);
  }
  
  // Further limit by character count if needed
  let totalChars = 0;
  const limitedSegments: any[] = [];
  for (const doc of segments) {
    const textLen = doc.text?.length || 0;
    if (totalChars + textLen > MAX_CHARS && limitedSegments.length > 0) {
      console.log(`Character limit reached at ${limitedSegments.length} segments (${totalChars} chars)`);
      break;
    }
    totalChars += textLen;
    limitedSegments.push(doc);
  }

  console.log(`Using ${limitedSegments.length} segments (${totalChars} chars) for recap`);

  return limitedSegments.map((doc: any) => ({
    segmentId: doc.segmentId,
    transcriptId: doc.transcriptId,
    meetingTitle: doc.meetingTitle,
    text: doc.text,
    startTime: doc.startTime,
    endTime: doc.endTime,
    project: doc.project,
    group: doc.group,
    topics: doc.topics || [],
    score: 1, // All segments are equally relevant for full recap
  }));
}

/**
 * Check if query is asking about meeting inventory/metadata (count, list, etc.)
 */
function isMetadataQuery(query: string): boolean {
  const lowerQuery = query.toLowerCase();
  const metadataPatterns = [
    // Meeting counts and lists
    /how many (meetings?|transcripts?)/,
    /list (all )?(the )?(meetings?|transcripts?)/,
    /what (meetings?|transcripts?) (do you have|are there|exist)/,
    /show (me )?(all )?(the )?(meetings?|transcripts?)/,
    /count (of )?(meetings?|transcripts?)/,
    /number of (meetings?|transcripts?)/,
    /what do you have/,
    /what's (indexed|available)/,
    /which (meetings?|transcripts?)/,
    // Projects
    /what projects? (do you have|are there|exist)/,
    /list (all )?(the )?projects?/,
    /show (me )?(all )?(the )?projects?/,
    /how many projects?/,
    /which projects?/,
    /all projects/,
    // Topics
    /what topics? (do you have|are there|exist)/,
    /list (all )?(the )?topics?/,
    /show (me )?(all )?(the )?topics?/,
    /how many topics?/,
    /which topics?/,
    /all topics/,
    // Keywords/Tags
    /what (keywords?|tags?) (do you have|are there|exist)/,
    /list (all )?(the )?(keywords?|tags?)/,
    /show (me )?(all )?(the )?(keywords?|tags?)/,
    /how many (keywords?|tags?)/,
    /which (keywords?|tags?)/,
    /all (keywords?|tags?)/,
    // Status
    /what status(es)? (do you have|are there|exist)/,
    /list (all )?(the )?status(es)?/,
    /show (me )?(all )?(the )?status(es)?/,
    /what are the status(es)?/,
    /meetings? (with|by|in) status/,
    /status of (the )?(meetings?|projects?)/,
    /all status(es)?/,
    // Meeting names
    /what are the meeting names?/,
    /list (all )?(the )?meeting (names?|titles?)/,
    /show (me )?(all )?(the )?meeting (names?|titles?)/,
    /all meeting (names?|titles?)/,
    // Summaries
    /what (summaries?|project summar(y|ies)|organization summar(y|ies)) (do you have|are there|exist)/,
    /list (all )?(the )?(summaries?|project summar(y|ies)|organization summar(y|ies))/,
    /show (me )?(all )?(the )?(summaries?|project summar(y|ies)|organization summar(y|ies))/,
    /give me (a )?summary of all/,
    /summarize all/,
    /overview of (all )?(meetings?|projects?|transcripts?)/,
    /all (summaries?|project summar(y|ies)|organization summar(y|ies))/,
    // Groups
    /what groups? (do you have|are there|exist)/,
    /list (all )?(the )?groups?/,
    /show (me )?(all )?(the )?groups?/,
    /how many groups?/,
    /which groups?/,
    /all groups/,
  ];
  return metadataPatterns.some(pattern => pattern.test(lowerQuery));
}

/**
 * Fetch all meeting metadata for inventory questions
 */
async function fetchAllMeetingMetadata(
  searchEndpoint: string,
  searchApiKey: string,
  indexName: string,
  filters?: ChatRequest["filters"],
): Promise<RetrievedSegment[]> {
  console.log("Fetching all meeting metadata for inventory query...");
  
  const filterParts: string[] = [`docType eq 'metadata'`];
  if (filters?.project) {
    filterParts.push(`project eq '${filters.project}'`);
  }
  if (filters?.group) {
    filterParts.push(`group eq '${filters.group}'`);
  }
  const filterString = filterParts.join(" and ");

  const searchUrl = `${searchEndpoint}/indexes/${indexName}/docs/search?api-version=2023-11-01`;

  const response = await fetch(searchUrl, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "api-key": searchApiKey,
    },
    body: JSON.stringify({
      search: "*",
      filter: filterString,
      select: "transcriptId,meetingTitle,meetingDate,project,group,topics,tags,summaryText,status,projectSummary,organizationSummary",
      top: 100,
      orderby: "meetingDate desc",
      count: true,
    }),
  });

  if (!response.ok) {
    console.error("Metadata fetch error:", await response.text());
    return [];
  }

  const result = await response.json();
  console.log(`Found ${result["@odata.count"] || result.value?.length || 0} total meetings`);

  return (result.value || []).map((doc: any) => ({
    segmentId: doc.transcriptId,
    transcriptId: doc.transcriptId,
    meetingTitle: doc.meetingTitle,
    text: doc.summaryText || `Meeting: ${doc.meetingTitle}`,
    project: doc.project,
    group: doc.group,
    topics: doc.topics || [],
    tags: doc.tags || [],
    status: doc.status,
    summaryText: doc.summaryText,
    projectSummary: doc.projectSummary,
    organizationSummary: doc.organizationSummary,
    score: 1,
  }));
}

/**
 * Call reasoning model for metadata/inventory questions (GPT-5.2-Chat Responses API)
 */
async function callMetadataReasoningModel(
  query: string,
  meetings: RetrievedSegment[],
  conversationHistory: ConversationMessage[],
): Promise<string> {
  console.log("Calling Azure GPT-5.2-Chat for metadata query (Responses API)...");

  // Extract unique values for aggregations
  const uniqueProjects = [...new Set(meetings.map(m => m.project).filter(Boolean))];
  const uniqueTopics = [...new Set(meetings.flatMap(m => m.topics || []))];
  const uniqueTags = [...new Set(meetings.flatMap(m => m.tags || []))];
  const uniqueStatuses = [...new Set(meetings.map(m => m.status).filter(Boolean))];
  const uniqueGroups = [...new Set(meetings.map(m => m.group).filter(Boolean))];
  
  // Get project summaries
  const projectSummaries = new Map<string, string>();
  meetings.forEach(m => {
    if (m.project && m.projectSummary && !projectSummaries.has(m.project)) {
      projectSummaries.set(m.project, m.projectSummary);
    }
  });

  // Build a clear list of all meetings with full metadata
  const meetingsList = meetings.map((m, idx) => {
    const parts = [`${idx + 1}. "${m.meetingTitle}"`];
    if (m.project) parts.push(`[Project: ${m.project}]`);
    if (m.group) parts.push(`[Group: ${m.group}]`);
    if (m.status) parts.push(`[Status: ${m.status}]`);
    if (m.topics && m.topics.length > 0) parts.push(`[Topics: ${m.topics.join(', ')}]`);
    if (m.tags && m.tags.length > 0) parts.push(`[Keywords: ${m.tags.join(', ')}]`);
    if (m.summaryText) parts.push(`\n   Summary: ${m.summaryText.substring(0, 200)}${m.summaryText.length > 200 ? '...' : ''}`);
    return parts.join(' ');
  }).join('\n');

  // Build project summaries section
  let projectSummariesText = '';
  if (projectSummaries.size > 0) {
    projectSummariesText = '\n\nPROJECT SUMMARIES:\n' + 
      Array.from(projectSummaries.entries())
        .map(([proj, summary]) => `- ${proj}: ${summary.substring(0, 300)}${summary.length > 300 ? '...' : ''}`)
        .join('\n');
  }

  // Build organization summary section
  let orgSummaryText = '';
  const orgSummary = meetings.find(m => m.organizationSummary);
  if (orgSummary && orgSummary.organizationSummary) {
    orgSummaryText = `\n\nORGANIZATION SUMMARY:\n${orgSummary.organizationSummary}`;
  }

  const systemPrompt = `You are a helpful meeting assistant with access to a database of indexed meetings.

INDEXED MEETINGS (Total: ${meetings.length}):
${meetingsList}

AGGREGATED METADATA:
- Projects (${uniqueProjects.length}): ${uniqueProjects.join(', ') || 'None'}
- Topics (${uniqueTopics.length}): ${uniqueTopics.join(', ') || 'None'}
- Keywords/Tags (${uniqueTags.length}): ${uniqueTags.join(', ') || 'None'}
- Statuses: ${uniqueStatuses.join(', ') || 'None'}
- Groups (${uniqueGroups.length}): ${uniqueGroups.join(', ') || 'None'}
${projectSummariesText}${orgSummaryText}

INSTRUCTIONS:
- Answer questions about the indexed meetings based on the data above
- When asked "how many meetings", respond with the exact count (${meetings.length})
- When asked about projects, list the ${uniqueProjects.length} unique projects
- When asked about topics, list the ${uniqueTopics.length} unique topics
- When asked about keywords/tags, list them from the aggregated data
- When asked about statuses, list which meetings have which status
- When asked about summaries, provide the meeting summaries, project summaries, or organization summary as requested
- When listing meetings, use the exact meeting titles from the data
- Be accurate and use only the information provided
- Do not make up meeting names, projects, topics, or other details`;

  const inputMessages = [
    { role: "system", content: systemPrompt },
    ...conversationHistory.map((msg) => ({
      role: msg.role,
      content: msg.content,
    })),
    { role: "user", content: query },
  ];

  // Use Responses API format
  const response = await responsesFetch({
      model: CHAT_MODEL,
      input: inputMessages,
      max_output_tokens: 4000,
  });

  if (!response.ok) {
    const errorText = await response.text();
    console.error("Azure GPT-5.2-Chat error:", errorText);
    throw new Error(`Reasoning model error: ${response.status}`);
  }

  const result = await response.json();
  const content = extractTextFromResponsesAPI(result);
  return content || "I was unable to generate a response.";
}

/**
 * Reasoning-based intent analysis for summary adjustments
 * Uses GPT-5-Nano to deeply understand user intent before adjusting
 */
interface SummaryAdjustmentIntent {
  action: "shorten" | "expand" | "filter" | "restructure" | "translate" | "other";
  preserveStructure: boolean;
  targetLengthPercent: number | null;
  focusTopics: string[];
  excludeTopics: string[];
  outputFormat: "bullets" | "paragraph" | "structured" | "same";
  reasoning: string;
}

async function analyzeAdjustmentIntent(
  userRequest: string,
  currentSummaryLength: number,
  originalSummaryLength: number,
): Promise<SummaryAdjustmentIntent> {
  console.log("Analyzing adjustment intent with reasoning model...");
  
  // Fallback to heuristics if reasoning model not available
  if (!openaiConfigured()) {
    console.log("OPENAI_API_KEY not configured, using heuristics");
    return heuristicIntentAnalysis(userRequest);
  }

  const analysisPrompt = `Analyze the user's request for adjusting a meeting summary.

USER REQUEST: "${userRequest}"

CONTEXT:
- Original summary length: ${originalSummaryLength} characters
- Current summary length: ${currentSummaryLength} characters

Determine the user's TRUE intent by reasoning step-by-step:

1. SHORTENING vs CUTTING:
   - "shorten" / "make shorter" / "condense" = REDUCE length while PRESERVING all sections and key information
   - "cut to X%" = HARD CUT, may lose sections (only if explicitly requested)
   - Default interpretation: shorten means CONDENSE, not CUT

2. STRUCTURE PRESERVATION:
   - Unless user explicitly says "remove sections" or "just give me X", ALWAYS preserve the original structure
   - Headers like "Key Decisions", "Action Items", "Key Insights" should remain

3. PERCENTAGE INTERPRETATION:
   - "shorten to 50%" = target 50% of ORIGINAL length, preserve ALL sections
   - "reduce by 50%" = remove half the content
   - "50% shorter" = ambiguous, interpret as "target 50% of original length"

4. FILTER vs SHORTEN:
   - "only show management topics" = FILTER (remove non-matching items)
   - "make it shorter" = SHORTEN (condense all items)

Return a JSON object with your analysis.`;

  const toolDef = {
    type: "function",
    function: {
      name: "analyze_adjustment_intent",
      description: "Analyze and return the user's intent for summary adjustment",
      parameters: {
        type: "object",
        properties: {
          action: {
            type: "string",
            enum: ["shorten", "expand", "filter", "restructure", "translate", "other"],
            description: "Primary action the user wants"
          },
          preserveStructure: {
            type: "boolean",
            description: "Whether to preserve all original sections/headers (default true for shortening)"
          },
          targetLengthPercent: {
            type: "number",
            description: "Target length as percentage of ORIGINAL (null if not specified)",
            nullable: true
          },
          focusTopics: {
            type: "array",
            items: { type: "string" },
            description: "Topics to focus on (for filtering)"
          },
          excludeTopics: {
            type: "array",
            items: { type: "string" },
            description: "Topics to exclude"
          },
          outputFormat: {
            type: "string",
            enum: ["bullets", "paragraph", "structured", "same"],
            description: "Desired output format"
          },
          reasoning: {
            type: "string",
            description: "Step-by-step reasoning for the classification"
          }
        },
        required: ["action", "preserveStructure", "targetLengthPercent", "focusTopics", "excludeTopics", "outputFormat", "reasoning"]
      }
    }
  };

  try {
    const response = await responsesFetch({
        model: NANO_MODEL,
        input: [
          { role: "system", content: "You are an intent analysis expert. Analyze the user's request carefully and determine their true intent." },
          { role: "user", content: analysisPrompt }
        ],
        tools: [toolDef],
        tool_choice: { type: "function", name: "analyze_adjustment_intent" },
        max_output_tokens: 1000,
    });

    if (!response.ok) {
      console.error("Reasoning model error:", await response.text());
      return heuristicIntentAnalysis(userRequest);
    }

    const result = await response.json();
    
    // Extract tool call from response
    const toolCall = result.output?.find((o: any) => o.type === "function_call") ||
                     result.choices?.[0]?.message?.tool_calls?.[0];
    
    if (toolCall) {
      const args = typeof toolCall.arguments === 'string' 
        ? JSON.parse(toolCall.arguments) 
        : toolCall.function?.arguments 
          ? JSON.parse(toolCall.function.arguments)
          : null;
      
      if (args) {
        console.log(`Intent analyzed: ${args.action}, preserveStructure: ${args.preserveStructure}, targetPercent: ${args.targetLengthPercent}`);
        console.log(`Reasoning: ${args.reasoning}`);
        return {
          action: args.action || "other",
          preserveStructure: args.preserveStructure ?? true,
          targetLengthPercent: args.targetLengthPercent,
          focusTopics: args.focusTopics || [],
          excludeTopics: args.excludeTopics || [],
          outputFormat: args.outputFormat || "same",
          reasoning: args.reasoning || "",
        };
      }
    }

    return heuristicIntentAnalysis(userRequest);
  } catch (error) {
    console.error("Intent analysis error:", error);
    return heuristicIntentAnalysis(userRequest);
  }
}

/**
 * Fallback heuristic-based intent analysis
 */
function heuristicIntentAnalysis(userRequest: string): SummaryAdjustmentIntent {
  const lowerRequest = userRequest.toLowerCase();
  
  const percentMatch = userRequest.match(/(\d+)\s*%/);
  const targetPercent = percentMatch ? parseInt(percentMatch[1]) : null;
  
  const isShorten = /\b(shorten|shorter|concise|brief|condensed?|compress|reduce|trim)\b/i.test(userRequest);
  const isExpand = /\b(expand|longer|detail|elaborate|comprehensive|thorough|in-depth|more)\b/i.test(userRequest);
  const isFilter = /\b(only|focus|filter|just|specific|relevant|about|regarding)\b/i.test(userRequest);
  
  let action: SummaryAdjustmentIntent["action"] = "other";
  if (isShorten) action = "shorten";
  else if (isExpand) action = "expand";
  else if (isFilter) action = "filter";
  
  return {
    action,
    preserveStructure: action === "shorten", // Always preserve structure when shortening
    targetLengthPercent: targetPercent,
    focusTopics: [],
    excludeTopics: [],
    outputFormat: "same",
    reasoning: "Heuristic fallback analysis",
  };
}

/**
 * Adjust summary based on user request (GPT-5.2-Chat Responses API)
 * Now uses reasoning-based intent analysis first
 */
async function adjustSummaryWithAI(
  userRequest: string,
  currentSummary: string,
  originalSummary: string,
  transcriptContent: string,
): Promise<string> {
  console.log("Adjusting summary with reasoning-first approach...");

  // Step 1: Analyze intent with reasoning model
  const intent = await analyzeAdjustmentIntent(
    userRequest, 
    currentSummary.length, 
    originalSummary.length
  );
  
  console.log(`Analyzed intent: action=${intent.action}, preserveStructure=${intent.preserveStructure}, targetPercent=${intent.targetLengthPercent}`);

  // Truncate transcript content to prevent token limit issues
  const MAX_TRANSCRIPT_CHARS = 20000;
  let truncatedTranscript = transcriptContent;
  if (transcriptContent.length > MAX_TRANSCRIPT_CHARS) {
    const beginChars = Math.floor(MAX_TRANSCRIPT_CHARS * 0.4);
    const middleChars = Math.floor(MAX_TRANSCRIPT_CHARS * 0.3);
    const endChars = MAX_TRANSCRIPT_CHARS - beginChars - middleChars;
    const middleStart = Math.floor(transcriptContent.length / 2) - Math.floor(middleChars / 2);
    truncatedTranscript = 
      transcriptContent.substring(0, beginChars) + 
      "\n\n[...middle section...]\n\n" +
      transcriptContent.substring(middleStart, middleStart + middleChars) +
      "\n\n[...end section...]\n\n" +
      transcriptContent.substring(transcriptContent.length - endChars);
    console.log(`Transcript sampled from ${transcriptContent.length} to ${truncatedTranscript.length} chars`);
  }

  // Build prompt based on reasoning-analyzed intent
  const isShorten = intent.action === "shorten";
  const isFilter = intent.action === "filter";
  const isExpand = intent.action === "expand";
  const targetPercent = intent.targetLengthPercent;
  const preserveStructure = intent.preserveStructure;

  const systemPrompt = `You are a meeting assistant that adjusts summaries based on user requests.

INTENT ANALYSIS (from reasoning model):
- Action: ${intent.action}
- Preserve Structure: ${preserveStructure}
- Target Length: ${targetPercent ? `${targetPercent}% of original` : 'not specified'}
- Reasoning: ${intent.reasoning}

${isShorten ? `ORIGINAL SUMMARY (use this as reference):
${originalSummary}

CURRENT SUMMARY (for comparison):
${currentSummary}` : `CURRENT SUMMARY TO REFINE:
${currentSummary}`}

ORIGINAL TRANSCRIPT (for verification only):
${truncatedTranscript}

${isFilter ? `FILTER MODE INSTRUCTIONS:
The user wants to FILTER or REFINE the CURRENT SUMMARY.
- START FROM the CURRENT SUMMARY - do NOT regenerate from scratch
- REMOVE items that don't match the user's filter criteria
${intent.focusTopics.length > 0 ? `- Focus on these topics: ${intent.focusTopics.join(', ')}` : ''}
${intent.excludeTopics.length > 0 ? `- Exclude these topics: ${intent.excludeTopics.join(', ')}` : ''}
- KEEP only items that are relevant to what the user asked for
- If NO items match, say "The current summary does not contain items matching your criteria"
- Do NOT add new items that weren't in the CURRENT SUMMARY` 
: isShorten ? `SHORTEN MODE INSTRUCTIONS:
The user wants to SHORTEN the summary (condense, NOT cut).
- CRITICAL: Use the ORIGINAL SUMMARY as your base, NOT the current summary
- ${targetPercent ? `Target approximately ${targetPercent}% of the ORIGINAL summary length (~${Math.round(originalSummary.length * targetPercent / 100)} chars)` : 'Make it more concise while keeping all key points'}
${preserveStructure ? `- PRESERVE the exact structure and ALL headers from the original (Meeting Purpose, Key Decisions, Action Items, Key Insights)
- CONDENSE each bullet point to be more concise, do NOT delete entire sections
- Keep the MOST important information from EACH section
- Merge similar points when appropriate, but ensure ALL key topics are covered
- Do NOT cut entire sections like "Key Insights" - every section MUST remain` : '- You may restructure as needed'}` 
: isExpand ? `EXPAND MODE INSTRUCTIONS:
The user wants MORE detail in the summary.
- Add more context and explanation to existing points
- Include additional relevant details from the transcript
- Keep the same structure but make each point more comprehensive`
: `ADJUSTMENT MODE INSTRUCTIONS:
- Modify the summary structure/format based on user's request
- Use the transcript to verify accuracy
- Only include information explicitly in the transcript`}

CRITICAL RULES:
1. NEVER fabricate details not in the transcript
2. ${preserveStructure ? 'PRESERVE the original structure (all headers must remain)' : 'Structure can be modified if needed'}
3. ${isShorten ? 'CONDENSE content by making points shorter, do NOT delete entire sections' : 'Preserve key information from the source summary'}

LENGTH REQUIREMENT:
${isExpand 
  ? `- Include all relevant points with more detail (300-500 words max)`
  : targetPercent 
    ? `- Target approximately ${targetPercent}% of the original length (~${Math.round(originalSummary.length * targetPercent / 100)} chars)
- Keep ALL sections, just make each more concise`
    : isShorten
      ? `- Reduce length while keeping ALL sections
- Condense each bullet point, don't remove sections`
      : `- Keep it concise: 150-200 words MAXIMUM
- Short, direct sentences`}

Return ONLY the adjusted summary text, no labels or prefixes.`;

  const inputMessages = [
    { role: "system", content: systemPrompt },
    { role: "user", content: userRequest },
  ];

  console.log(`System prompt length: ${systemPrompt.length} chars`);

  // Use Responses API format
  const response = await responsesFetch({
      model: CHAT_MODEL,
      input: inputMessages,
      max_output_tokens: 4000,
  });

  if (!response.ok) {
    const errorText = await response.text();
    console.error("Azure GPT-5.2-Chat error:", errorText);
    throw new Error(`Summary adjustment error: ${response.status}`);
  }

  const result = await response.json();
  
  // Log response details for debugging
  console.log(`Response has output: ${!!result.output || !!result.output_text}`);
  
  const content = extractTextFromResponsesAPI(result);
  if (!content) {
    console.error("Empty response from Azure GPT-5.2-Chat:", JSON.stringify(result));
    return "The AI returned an empty response. Please try again.";
  }
  
  return content;
}

serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const { query, transcriptId, useRAG, conversationHistory, filters, summaryContext, originalSummary, transcriptContent }: ChatRequest =
      await req.json();

    // Validate inputs
    if (!query) {
      throw new Error("Missing required field: query");
    }

    // Get credentials (OpenAI)
    if (!openaiConfigured()) {
      throw new Error("OPENAI_API_KEY is not configured");
    }

    // Use 4-tool agent routing
    const toolCall = await routeToTool(
      query,
      !!summaryContext,
      !!transcriptId,
    );

    console.log(`Agent routed to tool: ${toolCall.tool} (confidence: ${toolCall.confidence})`);
    console.log(`Reasoning: ${toolCall.reasoning}`);

    // Handle general chat (no context)
    if (!transcriptId && !useRAG && !summaryContext) {
      console.log("General chat mode - no transcript");
      const answer = await callGeneralChat(query, conversationHistory || []);

      return new Response(
        JSON.stringify({
          success: true,
          answer,
          segmentsUsed: 0,
          toolUsed: toolCall.tool,
          toolConfidence: toolCall.confidence,
          toolReasoning: toolCall.reasoning,
        }),
        { headers: { ...corsHeaders, "Content-Type": "application/json" } },
      );
    }

    // Tool: adjust_summary - Modify the summary
    if (toolCall.tool === "adjust_summary" && summaryContext) {
      console.log("adjust_summary tool - modifying summary");
      
      if (!transcriptContent) {
        return new Response(
          JSON.stringify({
            success: false,
            error: "Transcript content is required for summary adjustments to ensure accuracy",
            toolUsed: toolCall.tool,
            toolConfidence: toolCall.confidence,
            toolReasoning: toolCall.reasoning,
          }),
          { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } },
        );
      }

      // Enhanced request with extracted parameters
      let enhancedRequest = query;
      if (toolCall.parameters.focusTopics?.length) {
        enhancedRequest += ` [Focus topics: ${toolCall.parameters.focusTopics.join(", ")}]`;
      }
      if (toolCall.parameters.targetLength) {
        enhancedRequest += ` [Target length: ${toolCall.parameters.targetLength}]`;
      }
      if (toolCall.parameters.outputFormat) {
        enhancedRequest += ` [Format: ${toolCall.parameters.outputFormat}]`;
      }

      const adjustedSummary = await adjustSummaryWithAI(
        enhancedRequest,
        summaryContext,
        originalSummary || summaryContext,
        transcriptContent
      );

      return new Response(
        JSON.stringify({
          success: true,
          answer: adjustedSummary,
          segmentsUsed: 0,
          toolUsed: toolCall.tool,
          toolConfidence: toolCall.confidence,
          toolReasoning: toolCall.reasoning,
        }),
        { headers: { ...corsHeaders, "Content-Type": "application/json" } },
      );
    }

    // Tool: search_summary - Find info in the current summary
    if (toolCall.tool === "search_summary" && summaryContext) {
      console.log("search_summary tool - searching within summary");
      
      // Use the summary as context for the question
      const answer = await callSummarySearch(query, summaryContext, conversationHistory || []);

      return new Response(
        JSON.stringify({
          success: true,
          answer,
          segmentsUsed: 0,
          toolUsed: toolCall.tool,
          toolConfidence: toolCall.confidence,
          toolReasoning: toolCall.reasoning,
        }),
        { headers: { ...corsHeaders, "Content-Type": "application/json" } },
      );
    }

    // REMOVED: Legacy adjustSummary flag override - now using pure AI routing

    // RAG-based tools require search credentials
    const searchEndpoint = Deno.env.get("AZURE_SEARCH_ENDPOINT");
    const searchApiKey = Deno.env.get("AZURE_SEARCH_API_KEY");
    const indexName = Deno.env.get("AZURE_SEARCH_INDEX_NAME");

    if (!searchEndpoint || !searchApiKey || !indexName) {
      throw new Error("Azure Search credentials not configured");
    }

    const isCrossTranscript = useRAG && !transcriptId;

    // Handle metadata queries (how many meetings, list projects, etc.)
    if (isCrossTranscript && isMetadataQuery(query)) {
      console.log("Metadata query mode - fetching all meeting metadata");
      const allMeetings = await fetchAllMeetingMetadata(searchEndpoint, searchApiKey, indexName, filters);
      
      const answer = await callMetadataReasoningModel(
        query,
        allMeetings,
        conversationHistory || [],
      );

      return new Response(
        JSON.stringify({
          success: true,
          answer,
          segmentsUsed: allMeetings.length,
          toolUsed: toolCall.tool,
          toolConfidence: toolCall.confidence,
          toolReasoning: toolCall.reasoning,
          segments: allMeetings.map((m) => ({
            segmentId: m.transcriptId,
            meetingTitle: m.meetingTitle,
            text: m.summaryText?.substring(0, 100) || "",
            score: 1,
            project: m.project,
            status: m.status,
          })),
        }),
        { headers: { ...corsHeaders, "Content-Type": "application/json" } },
      );
    }

    // Tool: extract_from_transcript - Generate content from transcript
    // or search_transcript - Find specific info
    let retrievedSegments: RetrievedSegment[];
    
    // For extraction, get ALL segments; for search, use vector search
    if (toolCall.tool === "extract_from_transcript" && transcriptId) {
      console.log("extract_from_transcript tool - fetching ALL segments");
      retrievedSegments = await fetchAllTranscriptSegments(
        transcriptId,
        searchEndpoint,
        searchApiKey,
        indexName,
      );
    } else if (transcriptId && !isCrossTranscript && isFullRecapQuery(query)) {
      console.log("Full recap mode - fetching ALL segments");
      retrievedSegments = await fetchAllTranscriptSegments(
        transcriptId,
        searchEndpoint,
        searchApiKey,
        indexName,
      );
    } else {
      // search_transcript: Vector search for relevant segments
      console.log(`search_transcript tool - performing vector search`);
      const queryVector = await getQueryEmbedding(query);

      retrievedSegments = await vectorSearch(
        queryVector,
        transcriptId || null,
        filters,
        searchEndpoint,
        searchApiKey,
        indexName,
        isCrossTranscript ? 10 : 5,
      );
    }

    if (retrievedSegments.length === 0) {
      const noResultMessage = isCrossTranscript
        ? "I couldn't find any relevant information in the indexed meetings. Please try rephrasing your question or make sure you have indexed some transcripts first."
        : "I couldn't find any relevant segments in the transcript for your question. Please try rephrasing or ask about a different topic.";
      return new Response(
        JSON.stringify({
          success: true,
          answer: noResultMessage,
          segmentsUsed: 0,
          toolUsed: toolCall.tool,
          toolConfidence: toolCall.confidence,
          toolReasoning: toolCall.reasoning,
        }),
        { headers: { ...corsHeaders, "Content-Type": "application/json" } },
      );
    }

    // Enrich segments with metadata if project/group is missing
    const segmentsNeedingMeta = retrievedSegments.filter((s) => !s.project && s.transcriptId);
    if (segmentsNeedingMeta.length > 0) {
      console.log(`Fetching metadata for ${segmentsNeedingMeta.length} segments without project info...`);
      const transcriptIdsForMeta = segmentsNeedingMeta.map((s) => s.transcriptId!);
      const metaMap = await fetchMetadataForTranscripts(transcriptIdsForMeta, searchEndpoint, searchApiKey, indexName);

      for (const seg of retrievedSegments) {
        if (seg.transcriptId && metaMap.has(seg.transcriptId)) {
          const meta = metaMap.get(seg.transcriptId)!;
          seg.project = seg.project || meta.project;
          seg.group = seg.group || meta.group;
          seg.status = seg.status || meta.status;
          seg.meetingTitle = seg.meetingTitle || meta.meetingTitle;
          seg.topics = seg.topics?.length ? seg.topics : meta.topics;
          seg.tags = seg.tags?.length ? seg.tags : meta.tags;
          seg.summaryText = seg.summaryText || meta.summaryText;
          seg.summaryTags = seg.summaryTags?.length ? seg.summaryTags : meta.summaryTags;
          seg.projectSummary = seg.projectSummary || meta.projectSummary;
        }
      }
    }

    // Call reasoning model with retrieved context
    const answer = await callReasoningModel(
      query,
      retrievedSegments,
      conversationHistory || [],
      summaryContext,
      isCrossTranscript,
    );

    console.log(`Tool ${toolCall.tool} response generated successfully`);

    return new Response(
      JSON.stringify({
        success: true,
        answer,
        segmentsUsed: retrievedSegments.length,
        toolUsed: toolCall.tool,
        toolConfidence: toolCall.confidence,
        toolReasoning: toolCall.reasoning,
        segments: retrievedSegments.map((s) => ({
          segmentId: s.segmentId,
          meetingTitle: s.meetingTitle,
          text: s.text.substring(0, 100) + (s.text.length > 100 ? "..." : ""),
          score: s.score,
          summaryText: s.summaryText,
          tags: s.tags,
          project: s.project,
          status: s.status,
        })),
      }),
      { headers: { ...corsHeaders, "Content-Type": "application/json" } },
    );
  } catch (error) {
    console.error("Error in transcripts-chat:", error);
    const errorMessage = error instanceof Error ? error.message : "Unknown error";
    return new Response(JSON.stringify({ error: errorMessage }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
