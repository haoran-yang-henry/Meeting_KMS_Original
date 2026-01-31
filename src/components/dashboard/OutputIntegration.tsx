import { useState, useEffect } from "react";
import { useTranslation } from "react-i18next";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Download, Loader2 } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "@/hooks/use-toast";

interface MeetingData {
  id: string;
  title: string;
  date?: string;
  project?: string;
  group?: string;
  topics?: string[];
  tags?: string[];
  summaryText?: string;
  transcript?: string;
}

interface OutputIntegrationProps {
  filterContext?: {
    project?: string;
    group?: string;
    topic?: string;
  };
}

export const OutputIntegration = ({ filterContext }: OutputIntegrationProps) => {
  const { t } = useTranslation();
  const [format, setFormat] = useState("markdown");
  const [selectedMeetingId, setSelectedMeetingId] = useState<string>("all");
  const [meetings, setMeetings] = useState<MeetingData[]>([]);
  const [isLoadingMeetings, setIsLoadingMeetings] = useState(false);
  const [isExporting, setIsExporting] = useState(false);
  const [includeSummaries, setIncludeSummaries] = useState(true);
  const [includeTags, setIncludeTags] = useState(true);
  
  // Fetch meetings based on current filter context
  useEffect(() => {
    const fetchMeetings = async () => {
      setIsLoadingMeetings(true);
      try {
        const { data, error } = await supabase.functions.invoke("transcripts-search", {
          body: {
            query: "*",
            top: 100,
            project: filterContext?.project,
            group: filterContext?.group,
            topic: filterContext?.topic,
          },
        });

        if (error) {
          console.error("Error fetching meetings:", error);
          return;
        }

        const results = data?.results || [];
        setMeetings(results.filter((item: any) => item.id && item.title));
      } catch (err) {
        console.error("Error:", err);
      } finally {
        setIsLoadingMeetings(false);
      }
    };

    fetchMeetings();
  }, [filterContext?.project, filterContext?.group, filterContext?.topic]);

  // Get meetings to export based on selection
  const getMeetingsToExport = (): MeetingData[] => {
    if (selectedMeetingId === "all") {
      return meetings;
    }
    return meetings.filter(m => m.id === selectedMeetingId);
  };

  // Generate Markdown content
  const generateMarkdown = (data: MeetingData[]): string => {
    let content = `# Meeting Export\n\n`;
    content += `Generated: ${new Date().toISOString()}\n\n`;
    
    data.forEach((meeting) => {
      content += `## ${meeting.title}\n\n`;
      content += `**Date:** ${meeting.date || 'N/A'}\n`;
      if (meeting.project) content += `**Project:** ${meeting.project}\n`;
      if (meeting.group) content += `**Group:** ${meeting.group}\n`;
      content += `\n`;

      if (includeTags) {
        if (meeting.topics?.length) {
          content += `**Topics:** ${meeting.topics.join(', ')}\n`;
        }
        if (meeting.tags?.length) {
          content += `**Tags:** ${meeting.tags.join(', ')}\n`;
        }
        content += `\n`;
      }

      if (includeSummaries && meeting.summaryText) {
        content += `### Summary\n\n${meeting.summaryText}\n\n`;
      }

      content += `---\n\n`;
    });

    return content;
  };

  // Generate JSON content
  const generateJSON = (data: MeetingData[]): string => {
    const exportData = data.map((meeting) => {
      const item: Record<string, any> = {
        id: meeting.id,
        title: meeting.title,
        date: meeting.date,
        project: meeting.project,
        group: meeting.group,
      };

      if (includeTags) {
        item.topics = meeting.topics || [];
        item.tags = meeting.tags || [];
      }

      if (includeSummaries) {
        item.summary = meeting.summaryText || '';
      }

      return item;
    });

    return JSON.stringify({ exportedAt: new Date().toISOString(), meetings: exportData }, null, 2);
  };

  // Generate CSV content
  const generateCSV = (data: MeetingData[]): string => {
    const headers = ['ID', 'Title', 'Date', 'Project', 'Group'];
    if (includeTags) headers.push('Topics', 'Tags');
    if (includeSummaries) headers.push('Summary');

    const escapeCSV = (val: string | undefined): string => {
      if (!val) return '';
      const escaped = val.replace(/"/g, '""');
      return `"${escaped}"`;
    };

    const rows = data.map((meeting) => {
      const row = [
        escapeCSV(meeting.id),
        escapeCSV(meeting.title),
        escapeCSV(meeting.date),
        escapeCSV(meeting.project),
        escapeCSV(meeting.group),
      ];

      if (includeTags) {
        row.push(escapeCSV(meeting.topics?.join('; ')));
        row.push(escapeCSV(meeting.tags?.join('; ')));
      }

      if (includeSummaries) {
        row.push(escapeCSV(meeting.summaryText));
      }

      return row.join(',');
    });

    return [headers.join(','), ...rows].join('\n');
  };

  // Handle export
  const handleExport = () => {
    const dataToExport = getMeetingsToExport();
    
    if (dataToExport.length === 0) {
      toast({
        title: t('outputIntegration.noMeetingsToExport'),
        description: t('outputIntegration.selectMeetingsToExport'),
        variant: "destructive",
      });
      return;
    }

    setIsExporting(true);

    try {
      let content: string;
      let mimeType: string;
      let extension: string;

      switch (format) {
        case 'json':
          content = generateJSON(dataToExport);
          mimeType = 'application/json';
          extension = 'json';
          break;
        case 'csv':
          content = generateCSV(dataToExport);
          mimeType = 'text/csv';
          extension = 'csv';
          break;
        default:
          content = generateMarkdown(dataToExport);
          mimeType = 'text/markdown';
          extension = 'md';
      }

      // Create and trigger download
      const blob = new Blob([content], { type: mimeType });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `meeting-export-${new Date().toISOString().split('T')[0]}.${extension}`;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      URL.revokeObjectURL(url);

      toast({
        title: t('outputIntegration.exportSuccess'),
        description: t('outputIntegration.exportedMeetings', { count: dataToExport.length, format: extension.toUpperCase() }),
      });
    } catch (err) {
      console.error("Export error:", err);
      toast({
        title: t('outputIntegration.exportFailed'),
        description: t('outputIntegration.exportError'),
        variant: "destructive",
      });
    } finally {
      setIsExporting(false);
    }
  };
  
  return (
    <Card className="h-full">
      <CardHeader className="pb-4">
        <CardTitle className="text-lg">{t('outputIntegration.title')}</CardTitle>
        <CardDescription>
          {t('outputIntegration.description')}
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="grid grid-cols-2 gap-4">
          <div className="space-y-4">
            <div>
              <label className="text-sm text-muted-foreground mb-2 block">{t('outputIntegration.selectMeeting')}</label>
              <Select value={selectedMeetingId} onValueChange={setSelectedMeetingId} disabled={isLoadingMeetings}>
                <SelectTrigger>
                  <SelectValue placeholder={isLoadingMeetings ? t('outputIntegration.loading') : t('outputIntegration.selectMeeting')} />
                </SelectTrigger>
                <SelectContent className="bg-popover">
                  <SelectItem value="all">{t('outputIntegration.allMeetings')} ({meetings.length})</SelectItem>
                  {meetings.map((meeting) => (
                    <SelectItem key={meeting.id} value={meeting.id}>
                      {meeting.title}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            
            <div>
              <label className="text-sm text-muted-foreground mb-2 block">{t('outputIntegration.outputFormat')}</label>
              <Select value={format} onValueChange={setFormat}>
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent className="bg-popover">
                  <SelectItem value="markdown">Markdown (.md)</SelectItem>
                  <SelectItem value="json">JSON (.json)</SelectItem>
                  <SelectItem value="csv">CSV (.csv)</SelectItem>
                </SelectContent>
              </Select>
            </div>
          </div>
          
          <div>
            <label className="text-sm text-muted-foreground mb-2 block">{t('outputIntegration.includeInPackage')}</label>
            <div className="space-y-2">
              <div className="flex items-center gap-2">
                <Checkbox 
                  id="summaries" 
                  checked={includeSummaries} 
                  onCheckedChange={(c) => setIncludeSummaries(!!c)} 
                />
                <label htmlFor="summaries" className="text-sm">{t('outputIntegration.summaries')}</label>
              </div>
              <div className="flex items-center gap-2">
                <Checkbox 
                  id="tags" 
                  checked={includeTags} 
                  onCheckedChange={(c) => setIncludeTags(!!c)} 
                />
                <label htmlFor="tags" className="text-sm">{t('outputIntegration.topicTagsKeywords')}</label>
              </div>
            </div>
          </div>
        </div>
        
        <div className="pt-4 flex items-center justify-between">
          <span className="text-xs text-muted-foreground">{t('outputIntegration.schemaInfo')}</span>
          <Button onClick={handleExport} disabled={isExporting || meetings.length === 0}>
            {isExporting ? (
              <Loader2 className="mr-2 h-4 w-4 animate-spin" />
            ) : (
              <Download className="mr-2 h-4 w-4" />
            )}
            {t('outputIntegration.exportPackage')}
          </Button>
        </div>
      </CardContent>
    </Card>
  );
};