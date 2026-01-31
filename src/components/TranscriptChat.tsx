// FR4 - Chat with Transcript component
import { useState, useRef, useEffect } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Send, Loader2, MessageSquare, Trash2, AlertCircle } from "lucide-react";
import { useTranscriptChat, ChatMessage, SourceMeeting } from "@/hooks/useTranscriptChat";

interface TranscriptChatProps {
  transcriptId?: string;
  isIndexed: boolean;
  meetingTitle?: string;
  summaryContext?: string;
  filters?: {
    project?: string;
    group?: string;
  };
}

export const TranscriptChat = ({
  transcriptId,
  isIndexed,
  meetingTitle,
  summaryContext,
  filters,
}: TranscriptChatProps) => {
  const [inputValue, setInputValue] = useState("");
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const { messages, isLoading, sendMessage, clearHistory } = useTranscriptChat();

  // Auto-scroll to bottom when new messages arrive
  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages, isLoading]);

  const handleSend = async () => {
    if (!inputValue.trim() || isLoading) return;
    
    const query = inputValue;
    setInputValue("");
    
    await sendMessage(query, transcriptId, {
      filters,
      summaryContext,
    });
  };

  const handleKeyPress = (e: React.KeyboardEvent) => {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      handleSend();
    }
  };

  // Determine if we're in transcript mode or general chat mode
  const hasTranscript = isIndexed && transcriptId;

  return (
    <Card className="flex flex-col h-full overflow-hidden">
      <CardHeader className="py-3 px-4 shrink-0">
        <div className="flex items-center justify-between">
          <div>
            <CardTitle className="text-base flex items-center gap-2">
              <MessageSquare className="h-4 w-4" />
              Chat with Transcript
            </CardTitle>
            {hasTranscript && meetingTitle && (
              <p className="text-xs text-muted-foreground mt-1 truncate max-w-[200px]">
                {meetingTitle}
              </p>
            )}
          </div>
          <div className="flex items-center gap-2">
            {messages.length > 0 && (
              <Button
                variant="ghost"
                size="icon"
                className="h-7 w-7"
                onClick={clearHistory}
                title="Clear chat history"
              >
                <Trash2 className="h-3.5 w-3.5" />
              </Button>
            )}
            <Badge variant="outline" className="text-xs">FR4</Badge>
          </div>
        </div>
      </CardHeader>
      
      <CardContent className="flex-1 flex flex-col overflow-hidden p-3 pt-0 min-h-0">
        {/* Messages Area */}
        <ScrollArea className="flex-1 pr-2">
          <div className="space-y-3 py-2">
            {messages.length === 0 ? (
              <div className="flex items-center justify-center h-32 text-muted-foreground">
                <div className="text-center space-y-2">
                  <MessageSquare className="h-8 w-8 mx-auto opacity-50" />
                  <p className="text-sm">
                    {hasTranscript 
                      ? "Ask questions about the transcript content."
                      : "Chat with the AI assistant."}
                  </p>
                </div>
              </div>
            ) : (
              messages.map((message) => (
                <MessageBubble key={message.id} message={message} />
              ))
            )}
            
            {/* Loading indicator */}
            {isLoading && (
              <div className="flex justify-start">
                <div className="bg-muted rounded-lg px-4 py-3 max-w-[85%]">
                  <div className="flex items-center gap-2 text-muted-foreground">
                    <Loader2 className="h-4 w-4 animate-spin" />
                    <span className="text-sm">{hasTranscript ? "Searching transcript..." : "Thinking..."}</span>
                  </div>
                </div>
              </div>
            )}
            
            {/* Scroll anchor */}
            <div ref={messagesEndRef} />
          </div>
        </ScrollArea>

        {/* Input Area */}
        <div className="pt-3 border-t mt-2 shrink-0">
          <div className="flex gap-2">
            <Input
              placeholder={hasTranscript ? "Ask about the transcript..." : "Ask anything..."}
              value={inputValue}
              onChange={(e) => setInputValue(e.target.value)}
              onKeyPress={handleKeyPress}
              disabled={isLoading}
              className="flex-1 h-9 text-sm"
            />
            <Button 
              size="icon" 
              onClick={handleSend} 
              disabled={!inputValue.trim() || isLoading}
              className="shrink-0 h-9 w-9"
            >
              {isLoading ? (
                <Loader2 className="h-4 w-4 animate-spin" />
              ) : (
                <Send className="h-4 w-4" />
              )}
            </Button>
          </div>
          <p className="text-xs text-muted-foreground mt-2">
            {hasTranscript 
              ? "Uses vector search to find relevant segments and AI to answer your questions."
              : "Chat directly with the AI assistant."}
          </p>
        </div>
      </CardContent>
    </Card>
  );
};

// Message bubble component
const MessageBubble = ({ message }: { message: ChatMessage }) => {
  const isUser = message.role === 'user';
  
  return (
    <div className={`flex ${isUser ? 'justify-end' : 'justify-start'}`}>
      <div
        className={`rounded-lg px-4 py-2.5 max-w-[85%] ${
          isUser
            ? 'bg-primary text-primary-foreground'
            : 'bg-muted'
        }`}
      >
        <p className="text-sm whitespace-pre-wrap">{message.content}</p>
        
        {/* Source meetings with metadata */}
        {!isUser && message.sourceMeetings && message.sourceMeetings.length > 0 && (
          <div className="mt-3 pt-2 border-t border-border/50 space-y-2">
            <p className="text-xs font-medium opacity-70">Sources:</p>
            {message.sourceMeetings.map((source, idx) => (
              <SourceMeetingCard key={idx} source={source} />
            ))}
          </div>
        )}
        
        {!isUser && message.segmentsUsed !== undefined && !message.sourceMeetings && (
          <p className="text-xs mt-1.5 opacity-60">
            Based on {message.segmentsUsed} transcript segment{message.segmentsUsed !== 1 ? 's' : ''}
          </p>
        )}
      </div>
    </div>
  );
};

// Source meeting card component
const SourceMeetingCard = ({ source }: { source: SourceMeeting }) => {
  const statusColors: Record<string, string> = {
    ongoing: 'bg-blue-500/20 text-blue-700 dark:text-blue-400',
    positive: 'bg-green-500/20 text-green-700 dark:text-green-400',
    negative: 'bg-amber-500/20 text-amber-700 dark:text-amber-400',
    warning: 'bg-red-500/20 text-red-700 dark:text-red-400',
  };
  
  return (
    <div className="bg-background/50 rounded p-2 text-xs space-y-1">
      <div className="flex items-center gap-2 flex-wrap">
        <span className="font-medium truncate max-w-[180px]">{source.meetingTitle}</span>
        {source.project && (
          <Badge variant="outline" className="text-[10px] h-4 px-1">
            {source.project}
          </Badge>
        )}
        {source.status && (
          <span className={`text-[10px] px-1.5 py-0.5 rounded ${statusColors[source.status] || 'bg-muted'}`}>
            {source.status}
          </span>
        )}
      </div>
      {source.summaryText && (
        <p className="text-muted-foreground line-clamp-2">{source.summaryText}</p>
      )}
      {source.tags && source.tags.length > 0 && (
        <div className="flex flex-wrap gap-1 mt-1">
          {source.tags.slice(0, 5).map((tag, i) => (
            <span key={i} className="text-[10px] bg-primary/10 text-primary px-1.5 py-0.5 rounded">
              {tag}
            </span>
          ))}
          {source.tags.length > 5 && (
            <span className="text-[10px] text-muted-foreground">+{source.tags.length - 5}</span>
          )}
        </div>
      )}
    </div>
  );
};
