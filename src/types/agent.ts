// Agent tool types for the 4-tool agentic design
export type AgentToolName = 
  | 'search_transcript'    // Find specific info via RAG in transcript segments
  | 'search_summary'       // Find info in current summary  
  | 'adjust_summary'       // Modify summary using transcript as source
  | 'extract_from_transcript'; // Extract/restructure specific content from transcript

export interface AgentToolCall {
  tool: AgentToolName;
  confidence: number;
  reasoning: string;
  parameters: {
    query?: string;
    focusTopics?: string[];
    excludeTopics?: string[];
    targetLength?: 'shorter' | 'longer' | 'same';
    outputFormat?: 'bullets' | 'paragraph' | 'structured';
  };
}

export interface AgentIntentResult {
  toolCall: AgentToolCall;
  fallbackUsed: boolean;
}

// Tool descriptions for the agent
export const AGENT_TOOLS = {
  search_transcript: {
    name: 'search_transcript',
    description: 'Search for specific information in transcript segments using semantic search (RAG)',
    triggers: ['what', 'who', 'when', 'where', 'how', 'why', 'did', 'was', 'find', 'search'],
  },
  search_summary: {
    name: 'search_summary', 
    description: 'Find information in the current summary without searching the full transcript',
    triggers: ['in the summary', 'summary says', 'summary mentions', 'according to summary'],
  },
  adjust_summary: {
    name: 'adjust_summary',
    description: 'Modify, shorten, expand, or filter the summary based on transcript content',
    triggers: ['shorten', 'expand', 'filter', 'only', 'focus', 'condense', 'make it', 'rewrite'],
  },
  extract_from_transcript: {
    name: 'extract_from_transcript',
    description: 'Extract or restructure specific content from the transcript (decisions, action items, etc.)',
    triggers: ['list all', 'generate', 'extract', 'create a list', 'give me all'],
  },
} as const;
