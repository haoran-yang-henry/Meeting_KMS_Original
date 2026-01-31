export type IssueType = 
  | 'vague_wording' 
  | 'unclear_term' 
  | 'misspelling' 
  | 'incorrect_domain_term' 
  | 'abbreviation' 
  | 'placeholder'
  | 'omit'
  | 'other';

export type SuggestionPriority = 'context' | 'general';

export interface CorrectionSuggestion {
  suggestionId: string;
  transcriptId: string;
  segmentId: string;
  originalText: string;
  suggestedText: string;
  reasoning: string;
  confidence: number;
  issueType: IssueType;
  priority: SuggestionPriority;
}

export interface CheckTranscriptRequest {
  transcriptId: string;
  segments: {
    segmentId: string;
    transcriptId: string;
    text: string;
    startTime?: string;
    endTime?: string;
    speaker?: string;
  }[];
  additionalContext?: string;
  glossary?: string;
  projectContext?: string;
  projectMemory?: string;
}

export interface CheckTranscriptResponse {
  success: boolean;
  transcriptId: string;
  suggestions: CorrectionSuggestion[];
  totalSegmentsChecked: number;
}

export interface CorrectionAction {
  suggestionId: string;
  action: 'apply' | 'keep_as_is';
}

export interface CorrectedSegment {
  segmentId: string;
  originalText: string;
  correctedText: string;
  appliedSuggestions: string[]; // suggestionIds that were applied
}
