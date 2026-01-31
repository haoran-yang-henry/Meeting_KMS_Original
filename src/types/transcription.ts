// FR1 - Transcript data model with states and segments

export type TranscriptionSource = 'upload';

// FR1.4 - Transcript lifecycle states
export type TranscriptState = 'uploaded_raw' | 'checked' | 'indexed';

// FR1.3 - Segment structure with timestamps
export interface TranscriptSegment {
  segmentId: string;
  transcriptId: string;
  text: string;
  startTime?: string; // Optional timestamp
  endTime?: string;   // Optional timestamp
  speaker?: string;
  confidence?: number;
}

// FR1.2 - File classification
export type FileClassification = 'transcript' | 'context';

export interface ParsedTranscript {
  segments: TranscriptSegment[];
  rawText: string;
  classification: FileClassification;
  hasTimestamps: boolean;
  detectedFormat: string;
}

export interface TranscriptionSession {
  id: string;
  userId?: string;
  createdAt: string;
  updatedAt: string;
  source: TranscriptionSource;
  state: TranscriptState;
  language: string;
  title: string;
  duration: number;
  segments: TranscriptSegment[];
  rawText: string;
  correctedText?: string;
  metadata?: TranscriptMetadata;
}

// FR5 - Summary fields for Azure Search
export interface TranscriptMetadata {
  meetingTitle?: string;
  meetingDate?: string;
  group?: string;
  project?: string;
  topic?: string;
  keywords?: string[];
  tags?: string[];
  summaryText?: string;
  summaryTags?: string[];
  summaryUpdatedAt?: string;
}

// BE-G4: Error code scheme
export enum TranscriptionErrorCode {
  // Upload errors
  UPLOAD_TOO_LARGE = 'UPLOAD_TOO_LARGE',
  UNSUPPORTED_FORMAT = 'UNSUPPORTED_FORMAT',
  FILE_PARSE_FAILED = 'FILE_PARSE_FAILED',
  FILE_EMPTY = 'FILE_EMPTY',
  ENCODING_ERROR = 'ENCODING_ERROR',
  
  // Storage errors
  BLOB_WRITE_FAILED = 'BLOB_WRITE_FAILED',
  BLOB_READ_FAILED = 'BLOB_READ_FAILED',
  
  // Processing errors
  EMBEDDING_FAILED = 'EMBEDDING_FAILED',
  INDEXING_FAILED = 'INDEXING_FAILED',
  
  // General errors
  UNKNOWN_ERROR = 'UNKNOWN_ERROR',
}

export interface TranscriptionError {
  code: TranscriptionErrorCode;
  message: string;
  details?: string;
  timestamp: string;
}

// Human-friendly error messages
export const ERROR_MESSAGES: Record<TranscriptionErrorCode, string> = {
  [TranscriptionErrorCode.UPLOAD_TOO_LARGE]: 'File is too large. Maximum size is 50MB.',
  [TranscriptionErrorCode.UNSUPPORTED_FORMAT]: 'Unsupported file format. Please use VTT, DOCX, PDF, XLSX, TXT, JSON, or MD.',
  [TranscriptionErrorCode.FILE_PARSE_FAILED]: 'Failed to parse the uploaded file. Please check the file format.',
  [TranscriptionErrorCode.FILE_EMPTY]: 'The uploaded file is empty.',
  [TranscriptionErrorCode.ENCODING_ERROR]: 'File encoding not supported. Please save as UTF-8.',
  [TranscriptionErrorCode.BLOB_WRITE_FAILED]: 'Failed to save transcript. Please try again.',
  [TranscriptionErrorCode.BLOB_READ_FAILED]: 'Failed to load transcript.',
  [TranscriptionErrorCode.EMBEDDING_FAILED]: 'Failed to generate embeddings. Please try again.',
  [TranscriptionErrorCode.INDEXING_FAILED]: 'Failed to index transcript. Please try again.',
  [TranscriptionErrorCode.UNKNOWN_ERROR]: 'An unexpected error occurred. Please try again.',
};

// Supported file types for upload
export const SUPPORTED_FILE_TYPES = ['.vtt', '.srt', '.docx', '.pdf', '.xlsx', '.txt', '.json', '.md'] as const;
export type SupportedFileType = typeof SUPPORTED_FILE_TYPES[number];

export const MAX_FILE_SIZE = 50 * 1024 * 1024; // 50MB
