// FE-G2: Transcript view component
import { ScrollArea } from "@/components/ui/scroll-area";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { FileText, Clock } from "lucide-react";
import { TranscriptSegment, TranscriptionSession } from "@/types/transcription";
import { cn } from "@/lib/utils";

interface TranscriptViewProps {
  segments?: TranscriptSegment[];
  session?: TranscriptionSession;
  title?: string;
  duration?: number;
  isLive?: boolean;
  maxHeight?: string;
  showTimestamps?: boolean;
  className?: string;
}

function formatTime(seconds: number): string {
  const mins = Math.floor(seconds / 60);
  const secs = Math.floor(seconds % 60);
  return `${mins.toString().padStart(2, '0')}:${secs.toString().padStart(2, '0')}`;
}

function formatTimestamp(time?: string | number): string {
  if (time === undefined || time === null) return '--:--';
  
  // If it's already a string timestamp, return it
  if (typeof time === 'string') {
    // Handle HH:MM:SS.mmm or HH:MM:SS format
    const match = time.match(/(\d{2}):(\d{2}):(\d{2})/);
    if (match) {
      const hours = parseInt(match[1]);
      const mins = match[2];
      const secs = match[3];
      return hours > 0 ? `${hours}:${mins}:${secs}` : `${parseInt(mins)}:${secs}`;
    }
    return time;
  }
  
  const hours = Math.floor(time / 3600);
  const mins = Math.floor((time % 3600) / 60);
  const secs = Math.floor(time % 60);
  
  if (hours > 0) {
    return `${hours}:${mins.toString().padStart(2, '0')}:${secs.toString().padStart(2, '0')}`;
  }
  return `${mins}:${secs.toString().padStart(2, '0')}`;
}

export function TranscriptView({
  segments = [],
  session,
  title,
  duration,
  isLive = false,
  maxHeight = "300px",
  showTimestamps = true,
  className,
}: TranscriptViewProps) {
  const displaySegments = session?.segments || segments;
  const displayTitle = session?.title || title || "Transcript";
  const displayDuration = session?.duration || duration || 0;

  const hasContent = displaySegments.length > 0;

  return (
    <Card className={cn("overflow-hidden", className)}>
      <CardHeader className="py-3 px-4 border-b bg-muted/30">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <FileText className="h-4 w-4 text-muted-foreground" />
            <CardTitle className="text-sm font-medium">{displayTitle}</CardTitle>
          </div>
          <div className="flex items-center gap-2">
            {isLive && (
              <Badge variant="destructive" className="text-xs animate-pulse">
                <div className="w-1.5 h-1.5 rounded-full bg-destructive-foreground mr-1" />
                LIVE
              </Badge>
            )}
            {displayDuration > 0 && (
              <Badge variant="outline" className="text-xs">
                <Clock className="h-3 w-3 mr-1" />
                {formatTime(displayDuration)}
              </Badge>
            )}
          </div>
        </div>
      </CardHeader>
      <CardContent className="p-0">
        <ScrollArea style={{ height: maxHeight }}>
          <div className="p-4 space-y-3">
            {!hasContent ? (
              <div className="text-center py-8 text-muted-foreground">
                <FileText className="h-8 w-8 mx-auto mb-2 opacity-50" />
                <p className="text-sm">
                  {isLive ? "Waiting for transcription..." : "No transcript available"}
                </p>
              </div>
            ) : (
              displaySegments.map((segment, index) => (
                <TranscriptSegmentItem
                  key={segment.segmentId || index}
                  segment={segment}
                  showTimestamp={showTimestamps}
                  isLast={index === displaySegments.length - 1 && isLive}
                />
              ))
            )}
          </div>
        </ScrollArea>
      </CardContent>
    </Card>
  );
}

interface TranscriptSegmentItemProps {
  segment: TranscriptSegment;
  showTimestamp: boolean;
  isLast?: boolean;
}

function TranscriptSegmentItem({ segment, showTimestamp, isLast }: TranscriptSegmentItemProps) {
  return (
    <div className="group flex gap-3">
      {showTimestamp && (
        <div className="flex-shrink-0 w-14 text-xs text-muted-foreground font-mono pt-0.5">
          {formatTimestamp(segment.startTime)}
        </div>
      )}
      <div className="flex-1 space-y-1">
        {segment.speaker && (
          <span className="text-xs font-medium text-primary">{segment.speaker}</span>
        )}
        <p className={cn(
          "text-sm leading-relaxed",
          isLast && "after:content-['▌'] after:animate-pulse after:text-primary"
        )}>
          {segment.text}
        </p>
        {segment.confidence !== undefined && segment.confidence < 0.8 && (
          <span className="text-xs text-muted-foreground italic">
            (low confidence)
          </span>
        )}
      </div>
    </div>
  );
}

// Preview component for uploaded content
interface TranscriptPreviewProps {
  content: string;
  fileName: string;
  className?: string;
}

export function TranscriptPreview({ content, fileName, className }: TranscriptPreviewProps) {
  const previewLines = content.split('\n').slice(0, 20);
  const hasMore = content.split('\n').length > 20;

  return (
    <Card className={cn("overflow-hidden", className)}>
      <CardHeader className="py-3 px-4 border-b bg-muted/30">
        <div className="flex items-center gap-2">
          <FileText className="h-4 w-4 text-muted-foreground" />
          <CardTitle className="text-sm font-medium truncate">{fileName}</CardTitle>
        </div>
      </CardHeader>
      <CardContent className="p-0">
        <ScrollArea className="h-[200px]">
          <div className="p-4">
            <pre className="text-sm whitespace-pre-wrap font-sans text-muted-foreground">
              {previewLines.join('\n')}
              {hasMore && (
                <span className="text-primary">
                  {'\n'}... (more content)
                </span>
              )}
            </pre>
          </div>
        </ScrollArea>
      </CardContent>
    </Card>
  );
}
