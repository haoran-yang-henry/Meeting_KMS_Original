import { useState, useRef, useEffect } from "react";
import { useTranslation } from "react-i18next";
import { Sidebar } from "@/components/Sidebar";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Send, Trash2, Search, MessageSquare, Loader2 } from "lucide-react";
import { useToast } from "@/hooks/use-toast";
import { supabase } from "@/integrations/supabase/client";
import { MarkdownRenderer } from "@/components/MarkdownRenderer";

const SEARCH_CHAT_SESSION_KEY = 'search-chat-messages';

interface ChatMessage {
  id: string;
  role: 'user' | 'assistant';
  content: string;
  timestamp: Date;
  segmentsUsed?: number;
  meetingsSources?: string[];
}

function loadMessagesFromSession(): ChatMessage[] {
  try {
    const stored = sessionStorage.getItem(SEARCH_CHAT_SESSION_KEY);
    if (stored) {
      const parsed = JSON.parse(stored);
      return parsed.map((msg: any) => ({
        ...msg,
        timestamp: new Date(msg.timestamp),
      }));
    }
  } catch (e) {
    console.error('Failed to load search chat messages:', e);
  }
  return [];
}

const SearchPage = () => {
  const { t } = useTranslation();
  const [messages, setMessages] = useState<ChatMessage[]>(() => loadMessagesFromSession());
  const [inputValue, setInputValue] = useState("");
  const [isLoading, setIsLoading] = useState(false);
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const { toast } = useToast();

  // Persist messages to sessionStorage
  useEffect(() => {
    try {
      sessionStorage.setItem(SEARCH_CHAT_SESSION_KEY, JSON.stringify(messages));
    } catch (e) {
      console.error('Failed to save search chat messages:', e);
    }
  }, [messages]);

  // Auto-scroll to bottom when messages change
  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages]);

  const sendMessage = async () => {
    const query = inputValue.trim();
    if (!query || isLoading) return;

    // Add user message
    const userMessage: ChatMessage = {
      id: `user_${Date.now()}`,
      role: 'user',
      content: query,
      timestamp: new Date(),
    };
    setMessages(prev => [...prev, userMessage]);
    setInputValue("");
    setIsLoading(true);

    try {
      // Build conversation history
      const conversationHistory = messages.map(msg => ({
        role: msg.role,
        content: msg.content,
      }));

      const { data, error } = await supabase.functions.invoke('transcripts-chat', {
        body: {
          query,
          useRAG: true, // Enable cross-transcript RAG search
          conversationHistory,
        },
      });

      if (error) throw error;

      if (!data.success) {
        throw new Error(data.error || 'Failed to get response');
      }

      // Extract unique meeting titles from segments
      const meetingsSources = data.segments
        ?.map((s: { meetingTitle?: string }) => s.meetingTitle)
        .filter((title: string | undefined, idx: number, arr: (string | undefined)[]) => 
          title && arr.indexOf(title) === idx
        ) || [];

      // Add assistant message
      const assistantMessage: ChatMessage = {
        id: `assistant_${Date.now()}`,
        role: 'assistant',
        content: data.answer,
        timestamp: new Date(),
        segmentsUsed: data.segmentsUsed,
        meetingsSources,
      };
      setMessages(prev => [...prev, assistantMessage]);

    } catch (err) {
      console.error('Chat error:', err);
      const errorMessage = err instanceof Error ? err.message : 'Failed to send message';
      
      const errorResponse: ChatMessage = {
        id: `error_${Date.now()}`,
        role: 'assistant',
        content: `Sorry, I encountered an error: ${errorMessage}`,
        timestamp: new Date(),
      };
      setMessages(prev => [...prev, errorResponse]);
      
      toast({
        variant: 'destructive',
        title: t('common.error'),
        description: errorMessage,
      });
    } finally {
      setIsLoading(false);
    }
  };

  const handleKeyPress = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      sendMessage();
    }
  };

  const clearHistory = () => {
    setMessages([]);
    sessionStorage.removeItem(SEARCH_CHAT_SESSION_KEY);
  };

  return (
    <div className="flex h-screen bg-background overflow-hidden">
      <Sidebar />
      <main className="flex-1 overflow-hidden p-4">
        <Card className="h-full flex flex-col">
          <CardHeader className="flex-shrink-0 flex flex-row items-center justify-between pb-2">
            <div className="flex items-center gap-2">
              <Search className="h-5 w-5 text-primary" />
              <CardTitle className="text-lg">{t('search.title')}</CardTitle>
            </div>
            {messages.length > 0 && (
              <Button
                variant="ghost"
                size="sm"
                onClick={clearHistory}
                className="text-muted-foreground hover:text-foreground"
              >
                <Trash2 className="h-4 w-4 mr-1" />
                {t('search.clear')}
              </Button>
            )}
          </CardHeader>
          <CardContent className="flex-1 flex flex-col min-h-0 pt-0">
            <ScrollArea className="flex-1 pr-4">
              {messages.length === 0 ? (
                <div className="flex flex-col items-center justify-center h-full py-12 text-center">
                  <div className="rounded-full bg-primary/10 p-4 mb-4">
                    <MessageSquare className="h-8 w-8 text-primary" />
                  </div>
                  <h3 className="text-lg font-medium mb-2">{t('search.emptyTitle')}</h3>
                  <p className="text-muted-foreground max-w-md">
                    {t('search.emptyDescription')}
                  </p>
                  <div className="mt-6 grid gap-2 text-sm text-muted-foreground">
                    <p className="italic">{t('search.exampleQueries.decisions')}</p>
                    <p className="italic">{t('search.exampleQueries.budget')}</p>
                    <p className="italic">{t('search.exampleQueries.feature')}</p>
                  </div>
                </div>
              ) : (
                <div className="space-y-4 pb-4">
                  {messages.map((msg) => (
                    <MessageBubble key={msg.id} message={msg} />
                  ))}
                  {isLoading && (
                    <div className="flex items-center gap-2 text-muted-foreground">
                      <Loader2 className="h-4 w-4 animate-spin" />
                      <span className="text-sm">{t('search.searching')}</span>
                    </div>
                  )}
                  <div ref={messagesEndRef} />
                </div>
              )}
            </ScrollArea>
            
            {/* Input area */}
            <div className="flex-shrink-0 pt-4 border-t mt-4">
              <div className="flex gap-2">
                <Input
                  value={inputValue}
                  onChange={(e) => setInputValue(e.target.value)}
                  onKeyDown={handleKeyPress}
                  placeholder={t('search.placeholder')}
                  disabled={isLoading}
                  className="flex-1"
                />
                <Button
                  onClick={sendMessage}
                  disabled={!inputValue.trim() || isLoading}
                  size="icon"
                >
                  <Send className="h-4 w-4" />
                </Button>
              </div>
            </div>
          </CardContent>
        </Card>
      </main>
    </div>
  );
};

// Message bubble component
const MessageBubble = ({ message }: { message: ChatMessage }) => {
  const { t } = useTranslation();
  const isUser = message.role === 'user';
  
  return (
    <div className={`flex ${isUser ? 'justify-end' : 'justify-start'}`}>
      <div
        className={`max-w-[85%] rounded-lg px-4 py-2 ${
          isUser
            ? 'bg-primary text-primary-foreground'
            : 'bg-muted text-foreground'
        }`}
      >
        {isUser ? (
          <p className="whitespace-pre-wrap text-sm">{message.content}</p>
        ) : (
          <MarkdownRenderer content={message.content} />
        )}
        {!isUser && message.segmentsUsed !== undefined && message.segmentsUsed > 0 && (
          <div className="mt-2 pt-2 border-t border-border/50 text-xs text-muted-foreground">
            <span>{t('common.basedOn')} {message.segmentsUsed} {t('common.segments')}</span>
            {message.meetingsSources && message.meetingsSources.length > 0 && (
              <span> {t('common.from')}: {message.meetingsSources.join(', ')}</span>
            )}
          </div>
        )}
      </div>
    </div>
  );
};

export default SearchPage;
