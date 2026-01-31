import { useState, useCallback, useEffect } from 'react';
import { useToast } from '@/hooks/use-toast';
import { supabase } from '@/integrations/supabase/client';
import type { AgentToolName } from '@/types/agent';

const SESSION_STORAGE_KEY = 'transcript-chat-messages';

// Intent information from the agent
export interface AgentIntent {
  tool: AgentToolName;
  confidence: number;
  reasoning: string;
}

// FR4.3 - Conversation message
export interface ChatMessage {
  id: string;
  role: 'user' | 'assistant';
  content: string;
  timestamp: Date;
  segmentsUsed?: number;
  sourceMeetings?: SourceMeeting[];
  agentIntent?: AgentIntent; // New: shows which tool the agent used
}

export interface SourceMeeting {
  meetingTitle: string;
  summaryText?: string;
  tags?: string[];
  project?: string;
  status?: string;
}

interface ChatFilters {
  project?: string;
  group?: string;
  dateFrom?: string;
  dateTo?: string;
}

interface ChatResponse {
  success: boolean;
  answer: string;
  segmentsUsed: number;
  // Agent tool information
  toolUsed?: AgentToolName;
  toolConfidence?: number;
  toolReasoning?: string;
  segments?: Array<{
    segmentId: string;
    meetingTitle?: string;
    text: string;
    score: number;
    summaryText?: string;
    tags?: string[];
    project?: string;
    status?: string;
  }>;
  error?: string;
}

function loadMessagesFromSession(): ChatMessage[] {
  try {
    const stored = sessionStorage.getItem(SESSION_STORAGE_KEY);
    if (stored) {
      const parsed = JSON.parse(stored);
      return parsed.map((msg: any) => ({
        ...msg,
        timestamp: new Date(msg.timestamp),
      }));
    }
  } catch (e) {
    console.error('Failed to load chat messages from session:', e);
  }
  return [];
}

function saveMessagesToSession(messages: ChatMessage[]) {
  try {
    sessionStorage.setItem(SESSION_STORAGE_KEY, JSON.stringify(messages));
  } catch (e) {
    console.error('Failed to save chat messages to session:', e);
  }
}

export function useTranscriptChat() {
  const [messages, setMessages] = useState<ChatMessage[]>(() => loadMessagesFromSession());
  const [isLoading, setIsLoading] = useState(false);
  const { toast } = useToast();

  // Persist messages to sessionStorage whenever they change
  useEffect(() => {
    saveMessagesToSession(messages);
  }, [messages]);

  /**
   * FR4.2 - Send a chat query (supports both transcript-based and general chat)
   */
  const sendMessage = useCallback(async (
    query: string,
    transcriptId?: string,
    options?: {
      filters?: ChatFilters;
      summaryContext?: string;
    }
  ): Promise<ChatMessage | null> => {
    if (!query.trim()) {
      toast({
        variant: 'destructive',
        title: 'Error',
        description: 'Please provide a query.',
      });
      return null;
    }

    // Add user message immediately
    const userMessage: ChatMessage = {
      id: `user_${Date.now()}`,
      role: 'user',
      content: query,
      timestamp: new Date(),
    };
    
    setMessages(prev => [...prev, userMessage]);
    setIsLoading(true);

    try {
      // FR4.3 - Build conversation history from existing messages
      const conversationHistory = messages.map(msg => ({
        role: msg.role,
        content: msg.content,
      }));

      const { data, error } = await supabase.functions.invoke('transcripts-chat', {
        body: {
          query,
          transcriptId,
          conversationHistory,
          filters: options?.filters,
          summaryContext: options?.summaryContext,
        },
      });

      if (error) throw error;

      const response = data as ChatResponse;

      if (!response.success) {
        throw new Error(response.error || 'Failed to get response');
      }

      // Extract unique source meetings with their metadata
      const sourceMeetings: SourceMeeting[] = [];
      const seenMeetings = new Set<string>();
      
      if (response.segments) {
        for (const seg of response.segments) {
          if (seg.meetingTitle && !seenMeetings.has(seg.meetingTitle)) {
            seenMeetings.add(seg.meetingTitle);
            sourceMeetings.push({
              meetingTitle: seg.meetingTitle,
              summaryText: seg.summaryText,
              tags: seg.tags,
              project: seg.project,
              status: seg.status,
            });
          }
        }
      }

      // Add assistant message with agent intent
      const assistantMessage: ChatMessage = {
        id: `assistant_${Date.now()}`,
        role: 'assistant',
        content: response.answer,
        timestamp: new Date(),
        segmentsUsed: response.segmentsUsed,
        sourceMeetings: sourceMeetings.length > 0 ? sourceMeetings : undefined,
        agentIntent: response.toolUsed ? {
          tool: response.toolUsed,
          confidence: response.toolConfidence || 0.8,
          reasoning: response.toolReasoning || 'Intent classified by agent',
        } : undefined,
      };

      setMessages(prev => [...prev, assistantMessage]);
      return assistantMessage;

    } catch (err) {
      console.error('Chat error:', err);
      const errorMessage = err instanceof Error ? err.message : 'Failed to send message';
      
      // Add error message as assistant response
      const errorResponse: ChatMessage = {
        id: `error_${Date.now()}`,
        role: 'assistant',
        content: `Sorry, I encountered an error: ${errorMessage}`,
        timestamp: new Date(),
      };
      
      setMessages(prev => [...prev, errorResponse]);
      
      toast({
        variant: 'destructive',
        title: 'Chat Error',
        description: errorMessage,
      });
      
      return null;
    } finally {
      setIsLoading(false);
    }
  }, [messages, toast]);

  /**
   * FR4.3 - Clear conversation history
   */
  const clearHistory = useCallback(() => {
    setMessages([]);
    sessionStorage.removeItem(SESSION_STORAGE_KEY);
  }, []);

  /**
   * Get messages for display
   */
  const getMessages = useCallback(() => messages, [messages]);

  return {
    messages,
    isLoading,
    sendMessage,
    clearHistory,
    getMessages,
  };
}
