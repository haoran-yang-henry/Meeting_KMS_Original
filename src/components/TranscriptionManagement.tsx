// Transcription Management - Upload, Check, Index workflow
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Progress } from "@/components/ui/progress";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Upload, Plus, Loader2, ChevronDown, CheckCircle, Search, FileCheck } from "lucide-react";
import { useState, useRef } from "react";
import { useToast } from "@/hooks/use-toast";
import { supabase } from "@/integrations/supabase/client";
import { TranscriptPreview } from "@/components/TranscriptView";
import { useTranscriptCheck } from "@/hooks/useTranscriptCheck";
import { useTranscriptIndex } from "@/hooks/useTranscriptIndex";
import { CorrectionSuggestions } from "@/components/CorrectionSuggestions";
import { 
  TranscriptionErrorCode, 
  SUPPORTED_FILE_TYPES, 
  MAX_FILE_SIZE,
  ERROR_MESSAGES,
  TranscriptSegment,
  TranscriptState,
} from "@/types/transcription";
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from "@/components/ui/collapsible";

interface ParsedResult {
  transcriptId: string;
  segments: TranscriptSegment[];
  hasTimestamps: boolean;
}

export const TranscriptionManagement = () => {
  // UI state
  const [uploadProgress, setUploadProgress] = useState(0);
  const [uploadingFile, setUploadingFile] = useState<string | null>(null);
  const [selectedFile, setSelectedFile] = useState<File | null>(null);
  const [fileContent, setFileContent] = useState<string | null>(null);
  const [isUploading, setIsUploading] = useState(false);
  const [showMetadata, setShowMetadata] = useState(false);
  
  // Workflow state
  const [transcriptState, setTranscriptState] = useState<TranscriptState>('uploaded_raw');
  const [parsedResult, setParsedResult] = useState<ParsedResult | null>(null);
  const [currentSegments, setCurrentSegments] = useState<TranscriptSegment[]>([]);
  const [hasCorrectedVersion, setHasCorrectedVersion] = useState(false);
  const [totalSuggestions, setTotalSuggestions] = useState(0);
  
  // Metadata fields
  const [metadata, setMetadata] = useState({
    title: '',
    group: '',
    project: '',
    topic: '',
    keywords: '',
  });
  
  const fileInputRef = useRef<HTMLInputElement>(null);
  const { toast } = useToast();
  
  // FR2 - Check transcript hook
  const { 
    suggestions, 
    isChecking, 
    correctedSegments,
    checkTranscript, 
    applySuggestion, 
    keepAsIs,
    clearSuggestions,
  } = useTranscriptCheck();
  
  // FR3 - Index transcript hook
  const { isIndexing, indexResult, addToIndex, clearResult } = useTranscriptIndex();

  // FR1.4: File selection and validation
  const handleFileSelect = (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    if (!file) return;
    processSelectedFile(file);
  };

  const processSelectedFile = async (file: File) => {
    const fileExt = '.' + file.name.split('.').pop()?.toLowerCase();
    if (!SUPPORTED_FILE_TYPES.includes(fileExt as any)) {
      toast({
        variant: "destructive",
        title: "Unsupported File Type",
        description: ERROR_MESSAGES[TranscriptionErrorCode.UNSUPPORTED_FORMAT],
      });
      return;
    }

    if (file.size > MAX_FILE_SIZE) {
      toast({
        variant: "destructive",
        title: "File Too Large",
        description: ERROR_MESSAGES[TranscriptionErrorCode.UPLOAD_TOO_LARGE],
      });
      return;
    }

    setSelectedFile(file);
    setUploadingFile(file.name);
    setUploadProgress(0);

    try {
      for (let i = 0; i <= 100; i += 20) {
        await new Promise(resolve => setTimeout(resolve, 50));
        setUploadProgress(i);
      }

      const text = await file.text();
      
      if (!text || text.trim().length === 0) {
        throw new Error(ERROR_MESSAGES[TranscriptionErrorCode.FILE_EMPTY]);
      }

      setFileContent(text);
      setMetadata(prev => ({
        ...prev,
        title: file.name.replace(/\.[^/.]+$/, ''),
      }));

      toast({
        title: "File Ready",
        description: "Review the content and proceed with the workflow.",
      });
    } catch (err) {
      toast({
        variant: "destructive",
        title: "Upload Failed",
        description: err instanceof Error ? err.message : "Unable to read file.",
      });
      setSelectedFile(null);
    } finally {
      setUploadingFile(null);
      setUploadProgress(0);
    }
  };

  // FR1 - Parse transcript (upload without indexing)
  const handleParseTranscript = async () => {
    if (!selectedFile || !fileContent) return;

    setIsUploading(true);
    try {
      const fileExt = '.' + selectedFile.name.split('.').pop()?.toLowerCase();
      
      // Call upload function to parse only
      const { data, error } = await supabase.functions.invoke('transcripts-upload', {
        body: {
          transcript: fileContent,
          title: metadata.title || selectedFile.name.replace(/\.[^/.]+$/, ''),
          date: new Date().toISOString(),
          duration: 0,
          group: metadata.group,
          project: metadata.project,
          keywords: metadata.keywords,
          topic: metadata.topic,
          fileType: fileExt,
          state: 'uploaded_raw',
        }
      });

      if (error) throw error;

      // Create segments from the parsed content
      const transcriptId = data.transcriptId;
      const segmentCount = data.segmentCount || 1;
      
      // Generate segments locally for the workflow
      const lines = fileContent.split('\n').filter(l => l.trim());
      const segments: TranscriptSegment[] = lines.map((line, idx) => ({
        segmentId: `seg_${idx}`,
        transcriptId,
        text: line.trim(),
      }));

      setParsedResult({
        transcriptId,
        segments,
        hasTimestamps: data.hasTimestamps || false,
      });
      setCurrentSegments(segments);
      setTranscriptState('uploaded_raw');
      setHasCorrectedVersion(false);

      toast({
        title: "Transcript Parsed",
        description: `${segments.length} segments ready. You can now Check or Add to Index.`,
      });

    } catch (err) {
      toast({
        variant: "destructive",
        title: "Parse Failed",
        description: err instanceof Error ? err.message : "Failed to parse transcript.",
      });
    } finally {
      setIsUploading(false);
    }
  };

  // FR2 - Check transcript for corrections
  const handleCheckTranscript = async () => {
    if (!parsedResult || currentSegments.length === 0) return;

    const result = await checkTranscript(
      parsedResult.transcriptId,
      currentSegments,
      {
        additionalContext: metadata.topic,
        projectContext: metadata.project,
      }
    );

    if (result) {
      setTotalSuggestions(result.suggestions?.length || 0);
      if (result.suggestions?.length === 0) {
        toast({
          title: "No Issues Found",
          description: "The transcript looks good. You can proceed to indexing.",
        });
      }
    }
  };

  // Handle applying a correction suggestion
  const handleApplySuggestion = (suggestion: any) => {
    applySuggestion(suggestion);
    setHasCorrectedVersion(true);
  };

  // Save corrected version and move to checked state
  const handleSaveCorrected = () => {
    if (correctedSegments.size > 0) {
      // Merge corrections into current segments
      const updatedSegments = currentSegments.map(seg => {
        const correction = correctedSegments.get(seg.segmentId);
        if (correction) {
          return { ...seg, text: correction.correctedText };
        }
        return seg;
      });
      setCurrentSegments(updatedSegments);
      setTranscriptState('checked');
      clearSuggestions();
      setTotalSuggestions(0);
      
      toast({
        title: "Corrections Saved",
        description: "Using corrected version for indexing.",
      });
    }
  };

  // FR3 - Add to index
  const handleAddToIndex = async () => {
    if (!parsedResult) return;

    const result = await addToIndex(
      parsedResult.transcriptId,
      currentSegments,
      {
        meetingTitle: metadata.title,
        meetingDate: new Date().toISOString(),
        project: metadata.project || undefined,
        group: metadata.group || undefined,
        tags: metadata.keywords ? metadata.keywords.split(',').map(k => k.trim()) : [],
        topics: metadata.topic ? [metadata.topic] : [],
      },
      hasCorrectedVersion || transcriptState === 'checked'
    );

    if (result?.success) {
      setTranscriptState('indexed');
    }
  };

  // Reset entire workflow
  const handleReset = () => {
    setSelectedFile(null);
    setFileContent(null);
    setParsedResult(null);
    setCurrentSegments([]);
    setTranscriptState('uploaded_raw');
    setHasCorrectedVersion(false);
    setMetadata({ title: '', group: '', project: '', topic: '', keywords: '' });
    clearSuggestions();
    clearResult();
    if (fileInputRef.current) fileInputRef.current.value = '';
  };

  // Drag and drop handlers
  const handleDragOver = (e: React.DragEvent) => {
    e.preventDefault();
    e.currentTarget.classList.add('border-primary', 'bg-primary/5');
  };

  const handleDragLeave = (e: React.DragEvent) => {
    e.preventDefault();
    e.currentTarget.classList.remove('border-primary', 'bg-primary/5');
  };

  const handleDrop = (e: React.DragEvent) => {
    e.preventDefault();
    e.currentTarget.classList.remove('border-primary', 'bg-primary/5');
    const file = e.dataTransfer.files[0];
    if (file) processSelectedFile(file);
  };

  // State badge helper
  const getStateBadge = () => {
    switch (transcriptState) {
      case 'uploaded_raw':
        return <Badge variant="secondary">Raw</Badge>;
      case 'checked':
        return <Badge variant="default" className="bg-amber-500">Checked</Badge>;
      case 'indexed':
        return <Badge variant="default" className="bg-green-500">Indexed</Badge>;
    }
  };

  return (
    <Card>
      <CardHeader>
        <div className="flex items-center justify-between">
          <div>
            <CardTitle>Transcription Management</CardTitle>
          </div>
          <div className="flex items-center gap-2">
            {parsedResult && getStateBadge()}
          </div>
        </div>
      </CardHeader>
      <CardContent className="space-y-6">
        {/* Upload Section */}
        {!parsedResult && (
          <div className="space-y-3">
            {uploadingFile ? (
              <div className="space-y-2">
                <p className="text-sm font-medium">Processing: {uploadingFile}</p>
                <Progress value={uploadProgress} />
              </div>
            ) : selectedFile && fileContent ? (
              <div className="space-y-4">
                <TranscriptPreview content={fileContent} fileName={selectedFile.name} />
                
                {/* Metadata fields */}
                <Collapsible open={showMetadata} onOpenChange={setShowMetadata}>
                  <CollapsibleTrigger asChild>
                    <Button variant="ghost" size="sm" className="w-full justify-between">
                      <span>Metadata (optional)</span>
                      <ChevronDown className={`h-4 w-4 transition-transform ${showMetadata ? 'rotate-180' : ''}`} />
                    </Button>
                  </CollapsibleTrigger>
                  <CollapsibleContent className="space-y-3 pt-3">
                    <div className="grid grid-cols-2 gap-3">
                      <div className="space-y-1.5">
                        <Label htmlFor="title" className="text-xs">Title</Label>
                        <Input
                          id="title"
                          value={metadata.title}
                          onChange={(e) => setMetadata(prev => ({ ...prev, title: e.target.value }))}
                          placeholder="Meeting title"
                          className="h-8 text-sm"
                        />
                      </div>
                      <div className="space-y-1.5">
                        <Label htmlFor="group" className="text-xs">Group</Label>
                        <Input
                          id="group"
                          value={metadata.group}
                          onChange={(e) => setMetadata(prev => ({ ...prev, group: e.target.value }))}
                          placeholder="Team/Department"
                          className="h-8 text-sm"
                        />
                      </div>
                      <div className="space-y-1.5">
                        <Label htmlFor="project" className="text-xs">Project</Label>
                        <Input
                          id="project"
                          value={metadata.project}
                          onChange={(e) => setMetadata(prev => ({ ...prev, project: e.target.value }))}
                          placeholder="Project name"
                          className="h-8 text-sm"
                        />
                      </div>
                      <div className="space-y-1.5">
                        <Label htmlFor="topic" className="text-xs">Topic</Label>
                        <Input
                          id="topic"
                          value={metadata.topic}
                          onChange={(e) => setMetadata(prev => ({ ...prev, topic: e.target.value }))}
                          placeholder="Discussion topic"
                          className="h-8 text-sm"
                        />
                      </div>
                    </div>
                    <div className="space-y-1.5">
                      <Label htmlFor="keywords" className="text-xs">Keywords</Label>
                      <Input
                        id="keywords"
                        value={metadata.keywords}
                        onChange={(e) => setMetadata(prev => ({ ...prev, keywords: e.target.value }))}
                        placeholder="Comma-separated keywords"
                        className="h-8 text-sm"
                      />
                    </div>
                  </CollapsibleContent>
                </Collapsible>

                {/* Parse button */}
                <div className="flex gap-2">
                  <Button 
                    className="flex-1"
                    onClick={handleParseTranscript}
                    disabled={isUploading}
                  >
                    {isUploading ? (
                      <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                    ) : (
                      <Upload className="mr-2 h-4 w-4" />
                    )}
                    {isUploading ? "Parsing..." : "Parse Transcript (FR1)"}
                  </Button>
                  <Button 
                    variant="outline"
                    onClick={() => {
                      setSelectedFile(null);
                      setFileContent(null);
                      if (fileInputRef.current) fileInputRef.current.value = '';
                    }}
                  >
                    Cancel
                  </Button>
                </div>
              </div>
            ) : (
              <>
                <div 
                  className="border-2 border-dashed rounded-lg p-6 text-center hover:border-primary transition-colors cursor-pointer"
                  onClick={() => fileInputRef.current?.click()}
                  onDragOver={handleDragOver}
                  onDragLeave={handleDragLeave}
                  onDrop={handleDrop}
                >
                  <Upload className="h-8 w-8 mx-auto mb-2 text-muted-foreground" />
                  <p className="text-sm font-medium mb-1">Choose File or Drag & Drop</p>
                  <p className="text-xs text-muted-foreground">No file chosen</p>
                </div>
                <input
                  ref={fileInputRef}
                  type="file"
                  accept={SUPPORTED_FILE_TYPES.join(',')}
                  onChange={handleFileSelect}
                  className="hidden"
                />
              </>
            )}
            
            <p className="text-xs text-muted-foreground">
              Supported: VTT, SRT, DOCX, PDF, XLSX, TXT, JSON, MD (max 50MB)
            </p>
          </div>
        )}

        {/* Workflow Section - After parsing */}
        {parsedResult && (
          <div className="space-y-4">
            {/* Transcript info */}
            <div className="p-3 rounded-lg bg-muted/50">
              <div className="flex items-center justify-between mb-2">
                <span className="text-sm font-medium">{metadata.title || 'Transcript'}</span>
                {getStateBadge()}
              </div>
              <p className="text-xs text-muted-foreground">
                {currentSegments.length} segments • ID: {parsedResult.transcriptId.slice(0, 20)}...
              </p>
            </div>

            {/* FR2 - Check suggestions */}
            {(suggestions.length > 0 || isChecking) && (
              <CorrectionSuggestions
                suggestions={suggestions}
                isChecking={isChecking}
                onApply={handleApplySuggestion}
                onKeepAsIs={keepAsIs}
                onSaveTranscript={handleSaveCorrected}
                totalSuggestions={totalSuggestions}
              />
            )}

            {/* Workflow buttons */}
            {indexResult?.state !== 'indexed' && (
              <div className="grid grid-cols-2 gap-3">
                {/* FR2 - Check button */}
                <Button
                  variant="outline"
                  onClick={handleCheckTranscript}
                  disabled={isChecking}
                >
                  {isChecking ? (
                    <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                  ) : (
                    <FileCheck className="mr-2 h-4 w-4" />
                  )}
                  {isChecking ? "Checking..." : "Check (FR2)"}
                </Button>

                {/* FR3 - Add to Index button */}
                <Button
                  onClick={handleAddToIndex}
                  disabled={isIndexing}
                >
                  {isIndexing ? (
                    <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                  ) : (
                    <Search className="mr-2 h-4 w-4" />
                  )}
                  {isIndexing ? "Indexing..." : "Add to Index (FR3)"}
                </Button>
              </div>
            )}

            {/* Indexed success */}
            {transcriptState === 'indexed' && indexResult && (
              <div className="p-4 rounded-lg bg-green-500/10 border border-green-500/20">
                <div className="flex items-center gap-2 text-green-600 mb-2">
                  <CheckCircle className="h-5 w-5" />
                  <span className="font-medium">Transcript Indexed</span>
                </div>
                <p className="text-sm text-muted-foreground">
                  {indexResult.segmentsIndexed}/{indexResult.totalSegments} segments indexed successfully.
                  {indexResult.isCorrected && " Using corrected version."}
                </p>
              </div>
            )}

            {/* Reset button */}
            <Button variant="ghost" onClick={handleReset} className="w-full">
              Start New Upload
            </Button>
          </div>
        )}
      </CardContent>
    </Card>
  );
};
