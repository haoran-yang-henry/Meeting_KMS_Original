import { useState, useEffect, useCallback } from "react";
import { supabase } from "@/integrations/supabase/client";

export interface TranscriptItem {
  id: string;
  title: string;
  date: string;
  duration?: string;
  group?: string;
  project?: string;
  topic?: string;
  topics?: string[];
  keywords?: string[];
  tags?: string[];
  transcript?: string;
  summaryText?: string;  // Group summary - initial + after corrections
  personalSummary?: string;  // Personal summary - user-adjusted via adjust_summary tool
  summaryTags?: string[];
  status?: 'ongoing' | 'positive' | 'negative' | 'warning';
}

// Status is now stored directly in 'status' field in Azure AI Search

interface FilterParams {
  project?: string;
  group?: string;
  topic?: string;
  timeline?: "today" | "week" | "month";
  unassigned?: boolean;
}

export const useTranscriptFilter = (filters: FilterParams) => {
  const [transcripts, setTranscripts] = useState<TranscriptItem[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const fetchTranscripts = useCallback(async () => {
    setIsLoading(true);
    setError(null);
    // Keep previous data visible during loading for smoother UI (stale-while-revalidate pattern)

    try {
      const { data, error: fnError } = await supabase.functions.invoke("transcripts-search", {
        body: {
          query: "*",
          top: 20,
          project: filters.project,
          group: filters.group,
          topic: filters.topic,
          unassigned: filters.unassigned,
        },
      });

      if (fnError) {
        console.error("Function error:", fnError);
        // Don't throw, just set empty results
        setTranscripts([]);
        return;
      }

      if (data?.error) {
        console.error("Search error:", data.error);
        setTranscripts([]);
        return;
      }

      let results = data?.results || [];

      // Status is now directly available from Azure AI Search 'status' field

      // Apply timeline filter on client side (date-based)
      if (filters.timeline) {
        const now = new Date();
        results = results.filter((t: TranscriptItem) => {
          if (!t.date) return true;
          const transcriptDate = new Date(t.date);
          
          switch (filters.timeline) {
            case "today":
              return transcriptDate.toDateString() === now.toDateString();
            case "week": {
              const weekAgo = new Date(now);
              weekAgo.setDate(now.getDate() - 7);
              return transcriptDate >= weekAgo;
            }
            case "month": {
              const monthAgo = new Date(now);
              monthAgo.setMonth(now.getMonth() - 1);
              return transcriptDate >= monthAgo;
            }
            default:
              return true;
          }
        });
      }

      setTranscripts(results);
    } catch (err) {
      console.error("Error fetching transcripts:", err);
      setError(err instanceof Error ? err.message : "Failed to fetch transcripts");
      setTranscripts([]);
    } finally {
      setIsLoading(false);
    }
  }, [filters.project, filters.group, filters.topic, filters.timeline, filters.unassigned]);

  useEffect(() => {
    fetchTranscripts();
  }, [fetchTranscripts]);

  return { transcripts, isLoading, error, refetch: fetchTranscripts };
};
