import { useState } from "react";
import { useTranslation } from "react-i18next";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { ChevronLeft, ChevronRight, Loader2 } from "lucide-react";
import { MeetingCard } from "./MeetingCard";
import { TranscriptItem } from "@/hooks/useTranscriptFilter";

interface LayeredAgentSummaryProps {
  transcripts: TranscriptItem[];
  isLoading: boolean;
  viewName?: string;
}

// Helper to format date
const formatDateTime = (dateStr: string | undefined) => {
  if (!dateStr) return "Unknown date";
  const date = new Date(dateStr);
  const now = new Date();
  const yesterday = new Date(now);
  yesterday.setDate(yesterday.getDate() - 1);
  
  if (date.toDateString() === now.toDateString()) {
    return `Today · ${date.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}`;
  }
  if (date.toDateString() === yesterday.toDateString()) {
    return `Yesterday · ${date.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}`;
  }
  return `${date.toLocaleDateString([], { weekday: 'short' })} · ${date.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}`;
};

// Helper to get letter from title
const getLetterFromTitle = (title: string) => {
  return title?.charAt(0).toUpperCase() || "M";
};

// Helper to extract topics from transcript
const extractTopics = (transcript: TranscriptItem): string[] => {
  // Use topics array from Azure AI Search
  if (transcript.topics && transcript.topics.length > 0) {
    return transcript.topics;
  }
  // Fallback to topic field if topics array is empty
  if (transcript.topic) {
    return [transcript.topic];
  }
  return [];
};

// Helper to extract keywords from tags (filtering out status: prefixed tags)
const extractKeywords = (transcript: TranscriptItem): string[] => {
  // Use tags field from Azure AI Search, filter out status tags
  if (transcript.tags && transcript.tags.length > 0) {
    const keywords = transcript.tags.filter(t => !t.startsWith('status:'));
    if (keywords.length > 0) {
      return keywords.slice(0, 5);
    }
  }
  // Fallback to keywords field if available
  if (transcript.keywords && transcript.keywords.length > 0) {
    return transcript.keywords.slice(0, 5);
  }
  return [];
};

export const LayeredAgentSummary = ({ transcripts, isLoading, viewName }: LayeredAgentSummaryProps) => {
  const { t } = useTranslation();
  const [autoUpdate, setAutoUpdate] = useState(true);
  const [scrollIndex, setScrollIndex] = useState(0);
  
  const handleScrollLeft = () => {
    setScrollIndex(Math.max(0, scrollIndex - 1));
  };
  
  const handleScrollRight = () => {
    setScrollIndex(Math.min(transcripts.length - 1, scrollIndex + 1));
  };
  
  return (
    <Card className="w-full">
      <CardHeader className="pb-4 relative overflow-visible">
        <div className="pr-48">
          <CardTitle className="text-lg">{t('layeredAgentSummary.title')}</CardTitle>
          <CardDescription className="text-sm text-muted-foreground truncate">
            {t('layeredAgentSummary.description')}
            {viewName && <span className="text-primary"> · {viewName}</span>}
          </CardDescription>
        </div>
        <div className="absolute top-6 right-6 flex items-center gap-2 bg-card">
          <span className="text-sm whitespace-nowrap">
            {t('layeredAgentSummary.autoUpdate')}: <span className="text-primary font-medium">{autoUpdate ? t('layeredAgentSummary.on') : t('layeredAgentSummary.off')}</span>
          </span>
          <div className="flex gap-1">
            <Button 
              variant="outline" 
              size="icon" 
              className="h-8 w-8"
              onClick={handleScrollLeft}
              disabled={scrollIndex === 0}
            >
              <ChevronLeft className="h-4 w-4" />
            </Button>
            <Button 
              variant="outline" 
              size="icon" 
              className="h-8 w-8"
              onClick={handleScrollRight}
              disabled={scrollIndex >= transcripts.length - 1}
            >
              <ChevronRight className="h-4 w-4" />
            </Button>
          </div>
        </div>
      </CardHeader>
      <CardContent className="overflow-x-auto">
        {isLoading ? (
          <div className="flex items-center justify-center py-8">
            <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
            <span className="ml-2 text-muted-foreground">{t('layeredAgentSummary.loading')}</span>
          </div>
        ) : transcripts.length === 0 ? (
          <div className="text-center py-8 text-muted-foreground">
            {t('layeredAgentSummary.noTranscripts')}
          </div>
        ) : (
          <div className="flex gap-4 overflow-x-auto pb-2">
            {transcripts.map((transcript, idx) => (
              <MeetingCard 
                key={transcript.id || idx}
                transcriptId={transcript.id}
                letter={getLetterFromTitle(transcript.title)}
                title={transcript.title || `Meeting ${idx + 1}`}
                dateTime={formatDateTime(transcript.date)}
                topics={extractTopics(transcript)}
                keywords={extractKeywords(transcript)}
                project={transcript.project}
              />
            ))}
          </div>
        )}
      </CardContent>
    </Card>
  );
};
