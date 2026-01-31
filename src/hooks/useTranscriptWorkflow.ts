import { useState, useCallback, useEffect, useRef } from 'react';
import { useToast } from '@/hooks/use-toast';
import { supabase } from '@/integrations/supabase/client';
import { CorrectionSuggestion } from '@/types/correction';
import { parseTranscript as parseTranscriptUtil } from '@/lib/transcript-parser';

const STORAGE_KEY = 'transcript-workflow-state';

export interface TranscriptSegment {
  segmentId: string;
  text: string;
  startTime?: string;
  endTime?: string;
}

export interface TranscriptMetadata {
  project?: string;
  group?: string;
  topic?: string;
}

export interface UploadedTranscript {
  id: string;
  fileName: string;
  meetingName: string;
  content: string;
  segments: TranscriptSegment[];
  uploadedAt: Date;
  metadata?: TranscriptMetadata;
}

export interface GeneratedSummary {
  summaryText: string;
  topicTags?: string[];
}

// Agent intent info for display
export interface AgentIntent {
  tool: 'search_transcript' | 'search_summary' | 'adjust_summary' | 'extract_from_transcript';
  confidence: number;
  reasoning: string;
}

export interface WorkflowSystemMessage {
  id: string;
  type: 'upload' | 'system' | 'user-summary' | 'assistant-summary' | 'summary-generated' | 'summary-adjusted';
  content: string;
  fileName?: string;
  timestamp: Date;
  summaryText?: string;
  agentIntent?: AgentIntent; // Tool routing info for display
}

// Workflow status to track where we are in the process
export type WorkflowStatus = 'idle' | 'uploading' | 'checking' | 'ready' | 'indexed';

interface PersistedState {
  transcript: UploadedTranscript | null;
  suggestions: CorrectionSuggestion[];
  summary: GeneratedSummary | null;
  isIndexed: boolean;
  correctedSegments: [string, string][];
  metadata: TranscriptMetadata;
  systemMessages: WorkflowSystemMessage[];
  workflowStatus: WorkflowStatus;
  isGeneratingSummary: boolean;
  isChecking: boolean;
}

// Load persisted state from localStorage
const loadPersistedState = (): Partial<PersistedState> => {
  try {
    const stored = localStorage.getItem(STORAGE_KEY);
    if (stored) {
      const parsed = JSON.parse(stored);
      // Restore Date objects
      if (parsed.transcript?.uploadedAt) {
        parsed.transcript.uploadedAt = new Date(parsed.transcript.uploadedAt);
      }
      if (parsed.systemMessages) {
        parsed.systemMessages = parsed.systemMessages.map((msg: any) => ({
          ...msg,
          timestamp: new Date(msg.timestamp),
        }));
      }
      return parsed;
    }
  } catch (err) {
    console.error('Failed to load persisted state:', err);
  }
  return {};
};

// Save state to localStorage
const persistState = (state: PersistedState) => {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
  } catch (err) {
    console.error('Failed to persist state:', err);
  }
};

// Clear persisted state
const clearPersistedState = () => {
  try {
    localStorage.removeItem(STORAGE_KEY);
  } catch (err) {
    console.error('Failed to clear persisted state:', err);
  }
};

export function useTranscriptWorkflow() {
  // Initialize state from localStorage
  const initialState = loadPersistedState();

  // Keep a stable initial Map instance so refs + state start in sync
  const initialCorrectedSegments = new Map<string, string>(initialState.correctedSegments || []);

  const [transcript, setTranscript] = useState<UploadedTranscript | null>(initialState.transcript || null);
  const [suggestions, setSuggestions] = useState<CorrectionSuggestion[]>(initialState.suggestions || []);
  const [summary, setSummary] = useState<GeneratedSummary | null>(initialState.summary || null);
  const [isChecking, setIsChecking] = useState(initialState.isChecking || false);
  const [isUploading, setIsUploading] = useState(false);
  const [isGeneratingSummary, setIsGeneratingSummary] = useState(initialState.isGeneratingSummary || false);
  const [isSavingTranscript, setIsSavingTranscript] = useState(false);
  const [isIndexed, setIsIndexed] = useState(initialState.isIndexed || false);
  const [correctedSegments, setCorrectedSegments] = useState<Map<string, string>>(initialCorrectedSegments);
  const [metadata, setMetadata] = useState<TranscriptMetadata>(initialState.metadata || {});
  const [systemMessages, setSystemMessages] = useState<WorkflowSystemMessage[]>(initialState.systemMessages || []);
  const [workflowStatus, setWorkflowStatus] = useState<WorkflowStatus>(initialState.workflowStatus || 'idle');
  const [usedProjectMemory, setUsedProjectMemory] = useState(false);

  // Refs to avoid stale closures in long-running async handlers (e.g. Apply all → Save)
  const abortControllerRef = useRef<AbortController | null>(null);
  const transcriptRef = useRef<UploadedTranscript | null>(initialState.transcript || null);
  const correctedSegmentsRef = useRef<Map<string, string>>(initialCorrectedSegments);
  const metadataRef = useRef<TranscriptMetadata>(initialState.metadata || {});
  const summaryRef = useRef<GeneratedSummary | null>(initialState.summary || null);

  const { toast } = useToast();

  useEffect(() => {
    transcriptRef.current = transcript;
  }, [transcript]);

  useEffect(() => {
    correctedSegmentsRef.current = correctedSegments;
  }, [correctedSegments]);

  useEffect(() => {
    metadataRef.current = metadata;
  }, [metadata]);

  useEffect(() => {
    summaryRef.current = summary;
  }, [summary]);

  // Persist state whenever it changes
  useEffect(() => {
    persistState({
      transcript,
      suggestions,
      summary,
      isIndexed,
      correctedSegments: Array.from(correctedSegments.entries()),
      metadata,
      systemMessages,
      workflowStatus,
      isGeneratingSummary,
      isChecking,
    });
  }, [transcript, suggestions, summary, isIndexed, correctedSegments, metadata, systemMessages, workflowStatus, isGeneratingSummary, isChecking]);

  // Track if we've already resumed to prevent duplicate calls
  const hasResumedRef = useRef(false);

  // Reset stale loading states on mount - if states say "loading" but workflow is "ready", reset them
  useEffect(() => {
    // If workflow is ready but loading states are still true, it means the page was refreshed
    // after operations completed - reset them
    if (workflowStatus === 'ready' || workflowStatus === 'indexed') {
      if (isChecking) setIsChecking(false);
      if (isGeneratingSummary) setIsGeneratingSummary(false);
    }
    // If workflow was 'checking' but we already have data, don't resume
    if (workflowStatus === 'checking' && (suggestions.length > 0 || summary)) {
      setWorkflowStatus('ready');
      setIsChecking(false);
      setIsGeneratingSummary(false);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []); // Only run on mount

  // Auto-resume operations if workflow was interrupted during processing
  useEffect(() => {
    // Only resume if workflow status indicates we were mid-process AND we have a transcript
    // AND we haven't already resumed AND we don't already have results
    if (
      workflowStatus === 'checking' && 
      transcript && 
      !hasResumedRef.current &&
      suggestions.length === 0 &&
      !summary
    ) {
      hasResumedRef.current = true;
      
      // Create abort controller for resume operation
      const controller = new AbortController();
      abortControllerRef.current = controller;
      
      // Resume both check and summary generation
      const resumeOperations = async () => {
        setIsChecking(true);
        setIsGeneratingSummary(true);
        
        try {
          const [checkResult, summaryResult] = await Promise.all([
            supabase.functions.invoke('transcripts-check', {
              body: {
                transcriptId: transcript.id,
                segments: transcript.segments,
              },
            }),
            supabase.functions.invoke('transcripts-generate-summary', {
              body: {
                transcriptId: transcript.id,
                transcriptContent: transcript.content,
                includeDecisions: true,
                includeActionItems: true,
                includeTopicTags: true,
              },
            }),
          ]);

          if (controller.signal.aborted) return;
          
          if (checkResult.error) {
            console.error('Resume check error:', checkResult.error);
          } else if (checkResult.data?.suggestions) {
            // Show all suggestions (no limit)
            setSuggestions(checkResult.data.suggestions);
          }

          if (summaryResult.error) {
            console.error('Resume summary error:', summaryResult.error);
          } else if (summaryResult.data) {
            setSummary({
              summaryText: summaryResult.data.summaryText || '',
              topicTags: summaryResult.data.topicTags || [],
            });
          }

          setWorkflowStatus('ready');
        } catch (err) {
          if (controller.signal.aborted) return;
          console.error('Resume operations error:', err);
          setWorkflowStatus('ready');
        } finally {
          if (!controller.signal.aborted) {
            setIsChecking(false);
            setIsGeneratingSummary(false);
          }
        }
      };
      
      resumeOperations();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []); // Only run on mount, not on state changes

  // Update metadata (project, group, topic)
  const updateMetadata = useCallback((newMetadata: Partial<TranscriptMetadata>) => {
    setMetadata(prev => ({ ...prev, ...newMetadata }));
    if (transcript) {
      setTranscript(prev => prev ? { ...prev, metadata: { ...prev.metadata, ...newMetadata } } : null);
    }
  }, [transcript]);

  // Update meeting name
  const updateMeetingName = useCallback((name: string) => {
    if (transcript) {
      setTranscript(prev => prev ? { ...prev, meetingName: name } : null);
    }
  }, [transcript]);

  // Extract meeting name from file name (remove extension)
  const extractMeetingName = (fileName: string): string => {
    return fileName.replace(/\.[^/.]+$/, '');
  };

  // Check if transcript with same title already exists
  const findExistingTranscript = async (meetingTitle: string): Promise<string | null> => {
    try {
      const { data, error } = await supabase.functions.invoke('transcripts-find-by-title', {
        body: { meetingTitle },
      });

      if (error) {
        console.error('Find by title error:', error);
        return null;
      }

      if (data?.found && data?.transcriptId) {
        console.log(`Found existing transcript: ${data.transcriptId}`);
        return data.transcriptId;
      }

      return null;
    } catch (err) {
      console.error('Find existing transcript error:', err);
      return null;
    }
  };

  // Parse transcript content into segments
  // IMPORTANT: Use shared parser (supports SRT/VTT/JSON) and keeps timestamps.
  const parseUploadedTranscript = (content: string, fileName: string, meetingName: string, existingId?: string): UploadedTranscript => {
    const transcriptId = existingId || `transcript_${Date.now()}`;
    const parsed = parseTranscriptUtil(content, fileName, transcriptId);

    return {
      id: transcriptId,
      fileName,
      meetingName,
      content,
      segments: parsed.segments.map(seg => ({
        segmentId: seg.segmentId,
        text: seg.text,
        startTime: seg.startTime,
        endTime: seg.endTime,
      })),
      uploadedAt: new Date(),
    };
  };

  // Generate summary from transcript content
  const generateSummary = async (transcriptId: string, content: string): Promise<GeneratedSummary | null> => {
    try {
      const { data, error } = await supabase.functions.invoke('transcripts-generate-summary', {
        body: {
          transcriptId,
          transcriptContent: content,
          includeDecisions: true,
          includeActionItems: true,
          includeTopicTags: true,
        },
      });

      if (error) throw error;

      return {
        summaryText: data?.summaryText || '',
        topicTags: data?.topicTags || [],
      };
    } catch (err) {
      console.error('Summary generation error:', err);
      return null;
    }
  };

  // Upload and process transcript
  const uploadTranscript = useCallback(async (file: File, additionalContext?: string, customMeetingName?: string): Promise<boolean> => {
    // Create new abort controller for this operation
    abortControllerRef.current = new AbortController();
    const signal = abortControllerRef.current.signal;
    
    setIsUploading(true);
    setSummary(null);
    setWorkflowStatus('uploading');
    
    try {
      const content = await file.text();
      const meetingName = customMeetingName || extractMeetingName(file.name);
      
      // Check if aborted before continuing
      if (signal.aborted) return false;
      
      // Check if transcript with same filename already exists
      const existingId = await findExistingTranscript(meetingName);
      if (signal.aborted) return false;
      
      if (existingId) {
        toast({
          title: 'Updating existing transcript',
          description: `Found existing transcript for "${meetingName}". Updating content.`,
        });
      }
      
      const parsed = parseUploadedTranscript(content, file.name, meetingName, existingId || undefined);
      setTranscript(parsed);
      setSuggestions([]);
      setCorrectedSegments(new Map());
      
      // Step 1.5: Immediately index raw transcript to Azure AI Search
      console.log(`Parsed ${parsed.segments.length} segments, indexing raw version immediately...`);
      
      toast({
        title: 'Indexing transcript...',
        description: `${parsed.segments.length} segments being indexed.`,
      });
      
      // Index raw segments immediately
      const segmentsToIndex = parsed.segments.map(seg => ({
        segmentId: seg.segmentId,
        transcriptId: parsed.id,
        text: seg.text,
        startTime: seg.startTime,
        endTime: seg.endTime,
      }));
      
      // Use ref to get the latest metadata (avoids stale closure issue)
      const currentMetadata = metadataRef.current;
      
      const { data: indexResult, error: indexError } = await supabase.functions.invoke('transcripts-add-to-index', {
        body: {
          transcriptId: parsed.id,
          segments: segmentsToIndex,
          metadata: {
            meetingTitle: meetingName,
            meetingDate: new Date().toISOString(),
            project: currentMetadata.project || '',
            group: currentMetadata.group || '',
            tags: [],
            topics: currentMetadata.topic ? [currentMetadata.topic] : [],
          },
          isCorrected: false,
        },
      });
      
      if (indexError) {
        console.error('Initial index error:', indexError);
        toast({
          variant: 'destructive',
          title: 'Index Error',
          description: 'Failed to index transcript, but continuing with review.',
        });
      } else {
        console.log(`Raw transcript indexed: ${indexResult?.segmentsIndexed || 0} segments`);
        setIsIndexed(true);
        toast({
          title: 'Transcript indexed',
          description: `${indexResult?.segmentsIndexed || 0} segments indexed. Ready for review.`,
        });
      }
      
      if (signal.aborted) return false;
      
      // Step 2: Fetch project memory for context-aware corrections
      let projectMemory: string | null = null;
      const projectForMemory = metadataRef.current.project;
      
      if (projectForMemory && projectForMemory.toLowerCase() !== 'unassigned') {
        try {
          console.log('Fetching project memory for:', projectForMemory);
          const { data: searchData, error: searchError } = await supabase.functions.invoke('transcripts-search', {
            body: { 
              query: '', // Empty query to get all for this project
              project: projectForMemory,
              limit: 10,
            },
          });
          
          if (!searchError && searchData?.results?.length > 0) {
            // Find a document with projectSummary
            const withMemory = searchData.results.find((r: any) => r.projectSummary);
            if (withMemory?.projectSummary) {
              projectMemory = withMemory.projectSummary;
              console.log('Found project memory for correction context');
              setUsedProjectMemory(true);
            }
          }
        } catch (err) {
          console.warn('Failed to fetch project memory for corrections:', err);
        }
      }
      
      if (signal.aborted) return false;
      
      // Step 3: Check + Generate summary in parallel (after indexing)
      setWorkflowStatus('checking');
      setIsChecking(true);
      setIsGeneratingSummary(true);
      
      // Client-side batching for check to avoid payload size limits
      const batchSize = 30;
      const segmentsForCheck = parsed.segments.map(seg => ({
        segmentId: seg.segmentId,
        text: seg.text,
        startTime: seg.startTime,
        endTime: seg.endTime,
      }));
      
      const totalBatches = Math.ceil(segmentsForCheck.length / batchSize);
      console.log(`Checking ${segmentsForCheck.length} segments in ${totalBatches} client-side batches`);
      
      // Process check batches and summary in parallel
      const checkBatchPromises: Promise<any>[] = [];
      for (let i = 0; i < segmentsForCheck.length; i += batchSize) {
        const batch = segmentsForCheck.slice(i, i + batchSize);
        const batchNum = Math.floor(i / batchSize) + 1;
        console.log(`Queuing check batch ${batchNum}/${totalBatches}`);
        
        checkBatchPromises.push(
          supabase.functions.invoke('transcripts-check', {
            body: {
              transcriptId: parsed.id,
              segments: batch,
              additionalContext: additionalContext || undefined,
              projectMemory: projectMemory || undefined,
            },
          })
        );
      }
      
      // Use parsed segment texts for summary (not raw content which may include VTT timestamps)
      const parsedSegmentTexts = parsed.segments.map(seg => seg.text).join('\n\n');
      
      // Re-fetch metadata ref for auto-save (in case it was updated)
      const projectNameForSave = metadataRef.current.project;
      
      const [checkResults, summaryResult] = await Promise.all([
        Promise.all(checkBatchPromises),
        generateSummary(parsed.id, parsedSegmentTexts),
      ]);

      // Check if aborted before updating state
      if (signal.aborted) return false;

      // Aggregate suggestions from all batches
      const allSuggestions: CorrectionSuggestion[] = [];
      for (const result of checkResults) {
        if (result.error) {
          console.error('Check batch error:', result.error);
          continue;
        }
        if (result.data?.suggestions) {
          allSuggestions.push(...result.data.suggestions);
        }
      }
      
      // Sort by priority (context first) - show all suggestions
      allSuggestions.sort((a, b) => {
        if (a.priority === 'context' && b.priority !== 'context') return -1;
        if (a.priority !== 'context' && b.priority === 'context') return 1;
        return (b.confidence || 0) - (a.confidence || 0);
      });
      
      console.log(`Total suggestions from all batches: ${allSuggestions.length}`);
      setSuggestions(allSuggestions);

      if (summaryResult) {
        setSummary(summaryResult);
        
        // AUTO-SAVE: Immediately save the initial summary to backend
        // This ensures the summary is persisted even if user doesn't apply corrections
        // Use ref to get latest metadata (avoid stale closure)
        const latestMetadata = metadataRef.current;
        console.log('Auto-saving initial summary to backend with project:', latestMetadata.project);
        try {
          const { error: saveError } = await supabase.functions.invoke('transcripts-save-summary', {
            body: {
              transcriptId: parsed.id,
              summaryText: summaryResult.summaryText,
              keywords: summaryResult.topicTags || [],
              project: latestMetadata.project || '',
              topic: latestMetadata.topic || '',
            },
          });
          
          if (saveError) {
            console.error('Initial summary save error:', saveError);
          } else {
            console.log('Initial summary saved successfully');
            toast({
              title: 'Summary auto-saved',
              description: 'Initial summary has been saved to your meeting.',
            });
            
            // Auto-update project memory if project is assigned
            const projectValue = latestMetadata.project;
            if (projectValue && projectValue.trim() && projectValue.toLowerCase() !== 'unassigned') {
              console.log('Auto-updating project memory after initial save for:', projectValue);
              // Wait 2 seconds for Azure Search to index the summary
              await new Promise(resolve => setTimeout(resolve, 2000));
              try {
                const { data: projectData, error: projectError } = await supabase.functions.invoke('transcripts-generate-project-summary', {
                  body: { project: projectValue },
                });

                if (projectError) {
                  console.error('Failed to update project memory:', projectError);
                } else if (projectData?.success) {
                  console.log('Project memory updated successfully');
                  toast({
                    title: 'Project memory updated',
                    description: `Memory for "${projectValue}" has been refreshed.`,
                  });
                }
              } catch (projectErr) {
                console.error('Error updating project memory:', projectErr);
              }
            }
          }
        } catch (saveErr) {
          console.error('Failed to save initial summary:', saveErr);
        }
      }

      // Mark workflow as ready after successful processing
      setWorkflowStatus('ready');
      return true;
    } catch (err) {
      // Don't show error if operation was aborted
      if (signal.aborted) return false;
      
      console.error('Upload error:', err);
      setWorkflowStatus('ready'); // Still allow saving even on error
      toast({
        variant: 'destructive',
        title: 'Upload Error',
        description: err instanceof Error ? err.message : 'Failed to process transcript',
      });
      return false;
    } finally {
      if (!signal.aborted) {
        setIsUploading(false);
        setIsChecking(false);
        setIsGeneratingSummary(false);
      }
    }
  }, [toast, metadata]);

  // Recheck transcript with additional context (with batching)
  const recheckWithContext = useCallback(async (additionalContext: string) => {
    if (!transcript) return;
    
    // Create abort controller for this operation
    const controller = new AbortController();
    abortControllerRef.current = controller;
    
    setIsChecking(true);
    setSuggestions([]);
    setUsedProjectMemory(false);
    
    try {
      // Fetch project memory for context-aware corrections
      let projectMemory: string | null = null;
      const projectName = metadataRef.current.project;
      
      if (projectName && projectName.toLowerCase() !== 'unassigned') {
        try {
          console.log('Fetching project memory for recheck:', projectName);
          const { data: searchData, error: searchError } = await supabase.functions.invoke('transcripts-search', {
            body: { 
              query: '',
              project: projectName,
              limit: 10,
            },
          });
          
          if (!searchError && searchData?.results?.length > 0) {
            const withMemory = searchData.results.find((r: any) => r.projectSummary);
            if (withMemory?.projectSummary) {
              projectMemory = withMemory.projectSummary;
              console.log('Found project memory for recheck context');
              setUsedProjectMemory(true);
            }
          }
        } catch (err) {
          console.warn('Failed to fetch project memory for recheck:', err);
        }
      }
      
      // Client-side batching for recheck
      const batchSize = 30;
      const segmentsForCheck = transcript.segments.map(seg => ({
        segmentId: seg.segmentId,
        text: seg.text,
        startTime: seg.startTime,
        endTime: seg.endTime,
      }));
      
      const totalBatches = Math.ceil(segmentsForCheck.length / batchSize);
      console.log(`Rechecking ${segmentsForCheck.length} segments in ${totalBatches} batches with context`);
      
      const checkBatchPromises: Promise<any>[] = [];
      for (let i = 0; i < segmentsForCheck.length; i += batchSize) {
        const batch = segmentsForCheck.slice(i, i + batchSize);
        checkBatchPromises.push(
          supabase.functions.invoke('transcripts-check', {
            body: {
              transcriptId: transcript.id,
              segments: batch,
              additionalContext: additionalContext || undefined,
              projectMemory: projectMemory || undefined,
            },
          })
        );
      }
      
      const checkResults = await Promise.all(checkBatchPromises);

      if (controller.signal.aborted) return;

      // Aggregate suggestions from all batches
      const allSuggestions: CorrectionSuggestion[] = [];
      for (const result of checkResults) {
        if (result.error) {
          console.error('Recheck batch error:', result.error);
          continue;
        }
        if (result.data?.suggestions) {
          allSuggestions.push(...result.data.suggestions);
        }
      }
      
      // Sort by priority - show all suggestions
      allSuggestions.sort((a, b) => {
        if (a.priority === 'context' && b.priority !== 'context') return -1;
        if (a.priority !== 'context' && b.priority === 'context') return 1;
        return (b.confidence || 0) - (a.confidence || 0);
      });
      
      setSuggestions(allSuggestions);
      
      toast({
        title: 'Recheck complete',
        description: allSuggestions.length > 0 
          ? `Found ${allSuggestions.length} suggestion(s) with your context.`
          : 'No issues found with your context.',
      });
    } catch (err) {
      if (controller.signal.aborted) return;
      console.error('Recheck error:', err);
      toast({
        variant: 'destructive',
        title: 'Recheck Error',
        description: err instanceof Error ? err.message : 'Failed to recheck transcript',
      });
    } finally {
      if (!controller.signal.aborted) {
        setIsChecking(false);
      }
    }
  }, [transcript, toast]);

  // Apply a correction suggestion - replace originalText with suggestedText in the segment
  const applySuggestion = useCallback((suggestion: CorrectionSuggestion) => {
    const currentTranscript = transcriptRef.current;
    const currentMap = correctedSegmentsRef.current;

    // Get the current text for this segment (either already corrected or original)
    const segment = currentTranscript?.segments.find(s => s.segmentId === suggestion.segmentId);
    const currentText = currentMap.get(suggestion.segmentId) || segment?.text || '';

    // Replace the original text with the suggested text within the full segment
    let correctedText = currentText;
    if (currentText.includes(suggestion.originalText)) {
      correctedText = currentText.split(suggestion.originalText).join(suggestion.suggestedText);
      console.log(`Applied correction: "${suggestion.originalText}" → "${suggestion.suggestedText}"`);
    } else {
      // Try case-insensitive match as fallback
      const regex = new RegExp(suggestion.originalText.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'gi');
      correctedText = currentText.replace(regex, suggestion.suggestedText);
      console.log(`Applied correction (case-insensitive): "${suggestion.originalText}" → "${suggestion.suggestedText}"`);
    }

    console.log(`Segment ${suggestion.segmentId} corrected:`, {
      before: currentText.substring(0, 100),
      after: correctedText.substring(0, 100),
    });

    const updated = new Map(currentMap);
    updated.set(suggestion.segmentId, correctedText);

    // Update ref synchronously so a subsequent Save call (even via a stale closure) sees latest corrections
    correctedSegmentsRef.current = updated;
    setCorrectedSegments(updated);

    setSuggestions(prev => prev.filter(s => s.suggestionId !== suggestion.suggestionId));
  }, []);

  // Keep original text
  const keepAsIs = useCallback((suggestion: CorrectionSuggestion) => {
    setSuggestions(prev => prev.filter(s => s.suggestionId !== suggestion.suggestionId));
  }, []);

  // Save transcript: regenerate summary with corrections, then UPDATE existing index
  const saveTranscript = useCallback(async () => {
    const currentTranscript = transcriptRef.current;
    const currentCorrectedSegments = correctedSegmentsRef.current;
    const currentMetadata = metadataRef.current;
    const currentSummary = summaryRef.current;

    if (!currentTranscript) return;

    setIsSavingTranscript(true);

    const corrections = Array.from(currentCorrectedSegments.entries());
    const hasCorrected = corrections.length > 0;
    console.log('Saving transcript with corrections:', corrections);

    // Build segments with corrected text
    const segmentsToIndex = currentTranscript.segments.map(seg => ({
      segmentId: seg.segmentId,
      transcriptId: currentTranscript.id,
      text: currentCorrectedSegments.get(seg.segmentId) || seg.text,
      startTime: seg.startTime,
      endTime: seg.endTime,
    }));

    // Get the corrected content for summary
    const correctedContent = segmentsToIndex.map(s => s.text).join('\n');

    // Log for debugging - check if corrections are in content
    console.log('Corrected segments map:', Array.from(currentCorrectedSegments.entries()));
    console.log('Corrected content sample (first 500 chars):', correctedContent.substring(0, 500));

    try {
      // ALWAYS regenerate summary with corrected content before indexing
      // This ensures the summary reflects any corrections made
      toast({
        title: 'Regenerating summary...',
        description: hasCorrected
          ? 'Updating summary with corrected transcript.'
          : 'Generating final summary for indexing.',
      });

      setIsGeneratingSummary(true);
      const newSummary = await generateSummary(currentTranscript.id, correctedContent);
      if (newSummary) {
        summaryRef.current = newSummary;
        setSummary(newSummary);
      }
      setIsGeneratingSummary(false);

      // Use the newly generated summary for indexing, not a potentially stale state snapshot
      const summaryForIndex = newSummary || currentSummary;

      toast({
        title: 'Updating index...',
        description: hasCorrected 
          ? 'Overwriting with corrected content and new embeddings.'
          : 'Finalizing index with summary.',
      });

      // FR3 - Update transcript in index (overwrites existing documents)
      // Uses "upload" action which replaces existing docs with same ID
      const { data: indexResult, error: indexError } = await supabase.functions.invoke('transcripts-add-to-index', {
        body: {
          transcriptId: currentTranscript.id,
          segments: segmentsToIndex,
          metadata: {
            meetingTitle: currentTranscript.meetingName,
            meetingDate: currentTranscript.uploadedAt.toISOString(),
            project: currentTranscript.metadata?.project || currentMetadata.project || '',
            group: currentTranscript.metadata?.group || currentMetadata.group || '',
            tags: summaryForIndex?.topicTags || [],
            topics: currentTranscript.metadata?.topic ? [currentTranscript.metadata.topic] : [],
          },
          isCorrected: hasCorrected,
        },
      });

      if (indexError) throw indexError;

      console.log('Index update result:', indexResult);

      setIsIndexed(true); // Mark as indexed after successful indexing

      // Auto-save summary after indexing
      if (summaryForIndex?.summaryText) {
        console.log('Auto-saving summary...');
        const projectValue = currentTranscript.metadata?.project || currentMetadata.project || '';
        const { error: summaryError } = await supabase.functions.invoke('transcripts-save-summary', {
          body: {
            transcriptId: currentTranscript.id,
            summaryText: summaryForIndex.summaryText,
            keywords: summaryForIndex.topicTags || [],
            project: projectValue,
            topic: currentTranscript.metadata?.topic || currentMetadata.topic || '',
          },
        });

        if (summaryError) {
          console.error('Auto-save summary error:', summaryError);
        } else {
          console.log('Summary auto-saved successfully');
          
          // Auto-update project memory if project is assigned
          // Add delay to allow Azure Search to index the saved summary
          if (projectValue && projectValue.trim() && projectValue.toLowerCase() !== 'unassigned') {
            console.log('Auto-updating project memory for:', projectValue);
            // Wait 2 seconds for Azure Search to index the summary
            await new Promise(resolve => setTimeout(resolve, 2000));
            try {
              const { data: projectData, error: projectError } = await supabase.functions.invoke('transcripts-generate-project-summary', {
                body: { project: projectValue },
              });

              if (projectError) {
                console.error('Failed to update project memory:', projectError);
              } else if (projectData?.success) {
                console.log('Project memory updated successfully');
                toast({
                  title: 'Project memory updated',
                  description: `Memory for "${projectValue}" has been refreshed.`,
                });
              }
            } catch (projectErr) {
              console.error('Error updating project memory:', projectErr);
            }
          }
        }
      }

      toast({
        title: 'Transcript updated',
        description: `${indexResult?.segmentsIndexed || 0} segments updated with ${hasCorrected ? 'corrections' : 'final summary'}.`,
      });
    } catch (err) {
      console.error('Index update error:', err);
      toast({
        variant: 'destructive',
        title: 'Update Failed',
        description: err instanceof Error ? err.message : 'Failed to update transcript.',
      });
    } finally {
      setIsSavingTranscript(false);
    }
  }, [toast]);

  // Get corrected content
  const getCorrectedContent = useCallback(() => {
    if (!transcript) return '';
    
    return transcript.segments.map(seg => {
      return correctedSegments.get(seg.segmentId) || seg.text;
    }).join('\n');
  }, [transcript, correctedSegments]);

  // Save summary to Azure AI Search with metadata
  // keywords = AI-generated tags, topic = user-defined topic
  const saveSummary = useCallback(async (summaryText: string, keywords: string[], project: string, topic: string) => {
    if (!transcript) return false;

    try {
      const { data, error } = await supabase.functions.invoke('transcripts-save-summary', {
        body: {
          transcriptId: transcript.id,
          summaryText,
          keywords, // AI-generated keywords (was summaryTags)
          project,
          topic, // User-defined topic
        },
      });

      if (error) throw error;

      toast({
        title: 'Summary saved',
        description: 'Your summary and metadata have been saved to the index.',
      });

      // Auto-update project memory if project is assigned
      // Add delay to allow Azure Search to index the saved summary
      if (project && project.trim() && project.toLowerCase() !== 'unassigned') {
        console.log('Auto-updating project memory for:', project);
        // Wait 2 seconds for Azure Search to index the summary
        await new Promise(resolve => setTimeout(resolve, 2000));
        try {
          const { data: projectData, error: projectError } = await supabase.functions.invoke('transcripts-generate-project-summary', {
            body: { project },
          });

          if (projectError) {
            console.error('Failed to update project memory:', projectError);
          } else if (projectData?.success) {
            console.log('Project memory updated successfully');
            toast({
              title: 'Project memory updated',
              description: `Memory for "${project}" has been refreshed.`,
            });
          }
        } catch (projectErr) {
          console.error('Error updating project memory:', projectErr);
          // Don't fail the save operation if project memory update fails
        }
      }

      return true;
    } catch (err) {
      console.error('Save summary error:', err);
      toast({
        variant: 'destructive',
        title: 'Save Failed',
        description: err instanceof Error ? err.message : 'Failed to save summary.',
      });
      return false;
    }
  }, [transcript, toast]);

  // Get summary context for chat
  const getSummaryContext = useCallback(() => {
    if (!summary) return undefined;
    
    let context = `Meeting Summary:\n${summary.summaryText}`;
    return context;
  }, [summary]);

  // Update summary from external source (e.g., chat adjustments)
  const updateSummary = useCallback((newSummary: GeneratedSummary) => {
    setSummary(newSummary);
  }, []);

  // Regenerate summary with current corrected content
  const regenerateSummary = useCallback(async () => {
    const currentTranscript = transcriptRef.current;
    const currentCorrectedSegments = correctedSegmentsRef.current;

    if (!currentTranscript) return;

    // Create abort controller for this operation
    const controller = new AbortController();
    abortControllerRef.current = controller;

    setIsGeneratingSummary(true);
    try {
      // Get corrected content
      const correctedContent = currentTranscript.segments
        .map(seg => currentCorrectedSegments.get(seg.segmentId) || seg.text)
        .join('\n');

      const newSummary = await generateSummary(currentTranscript.id, correctedContent);
      if (controller.signal.aborted) return;

      if (newSummary) {
        summaryRef.current = newSummary;
        setSummary(newSummary);
        toast({
          title: 'Summary regenerated',
          description: 'Summary updated with current transcript content.',
        });
      }
    } catch (err) {
      if (controller.signal.aborted) return;
      console.error('Regenerate summary error:', err);
      toast({
        variant: 'destructive',
        title: 'Regeneration Failed',
        description: err instanceof Error ? err.message : 'Failed to regenerate summary.',
      });
    } finally {
      if (!controller.signal.aborted) {
        setIsGeneratingSummary(false);
      }
    }
  }, [toast]);

  // Clear transcript and persisted state, abort ongoing operations
  const clearTranscript = useCallback(() => {
    // Abort any ongoing operations
    if (abortControllerRef.current) {
      abortControllerRef.current.abort();
      abortControllerRef.current = null;
    }
    
    // Reset all loading states
    setIsUploading(false);
    setIsChecking(false);
    setIsGeneratingSummary(false);
    setIsSavingTranscript(false);
    
    // Clear all data
    setTranscript(null);
    setSuggestions([]);
    setSummary(null);
    setCorrectedSegments(new Map());
    setMetadata({});
    setIsIndexed(false);
    setSystemMessages([]);
    setWorkflowStatus('idle');
    setUsedProjectMemory(false);
    clearPersistedState();
    
    toast({
      title: 'Session cleared',
      description: 'All data and ongoing operations have been stopped.',
    });
  }, [toast]);

  // Add a system message to the chat
  const addSystemMessage = useCallback((message: Omit<WorkflowSystemMessage, 'id' | 'timestamp'>) => {
    const newMessage: WorkflowSystemMessage = {
      ...message,
      id: `${message.type}_${Date.now()}`,
      timestamp: new Date(),
    };
    setSystemMessages(prev => [...prev, newMessage]);
  }, []);

  // Clear system messages
  const clearSystemMessages = useCallback(() => {
    setSystemMessages([]);
  }, []);

  return {
    transcript,
    suggestions,
    summary,
    isChecking,
    isUploading,
    isGeneratingSummary,
    isSavingTranscript,
    isIndexed,
    correctedSegments,
    metadata,
    systemMessages,
    workflowStatus,
    usedProjectMemory,
    uploadTranscript,
    applySuggestion,
    keepAsIs,
    saveTranscript,
    saveSummary,
    getCorrectedContent,
    getSummaryContext,
    updateSummary,
    updateMetadata,
    updateMeetingName,
    clearTranscript,
    recheckWithContext,
    regenerateSummary,
    addSystemMessage,
    clearSystemMessages,
  };
}
