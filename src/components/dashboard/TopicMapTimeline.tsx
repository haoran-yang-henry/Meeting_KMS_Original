import { useState, useMemo, useEffect } from "react";
import { useTranslation } from "react-i18next";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Checkbox } from "@/components/ui/checkbox";
import { supabase } from "@/integrations/supabase/client";

interface TopicMapTimelineProps {
  filterContext?: {
    project?: string;
    group?: string;
    topic?: string;
  };
}

interface MeetingData {
  id: string;
  title: string;
  meetingDate: string;
  project?: string;
  group?: string;
  topics?: string[];
}

interface TimelineItem {
  name: string;
  startWeek: number;
  endWeek: number;
  color: string;
}

// Color palette for items
const colorPalette = [
  "bg-emerald-500",
  "bg-blue-500",
  "bg-violet-500",
  "bg-amber-500",
  "bg-rose-500",
  "bg-cyan-500",
  "bg-indigo-500",
  "bg-pink-500",
];

const getColor = (index: number) => colorPalette[index % colorPalette.length];

interface MeetingDataExtended extends MeetingData {
  tags?: string[];
}

export const TopicMapTimeline = ({ filterContext }: TopicMapTimelineProps) => {
  const { t } = useTranslation();
  const [showTopic, setShowTopic] = useState(true);
  const [showKeywords, setShowKeywords] = useState(false);
  const [showProject, setShowProject] = useState(false);
  const [meetings, setMeetings] = useState<MeetingDataExtended[]>([]);
  const [isLoading, setIsLoading] = useState(true);

  // Fetch meetings from Azure AI Search
  useEffect(() => {
    const fetchMeetings = async () => {
      setIsLoading(true);
      try {
        const { data, error } = await supabase.functions.invoke('transcripts-search', {
          body: { 
            query: '*',
            top: 100,
            project: filterContext?.project,
            group: filterContext?.group,
            topic: filterContext?.topic
          }
        });

        if (error) throw error;

        const results = data?.results || [];
        setMeetings(results.map((r: any) => ({
          id: r.id,
          title: r.title,
          meetingDate: r.date || r.meetingDate,
          project: r.project,
          group: r.group,
          topics: r.topics || [],
          tags: r.tags || []
        })));
      } catch (err) {
        console.error('Failed to fetch meetings for timeline:', err);
      } finally {
        setIsLoading(false);
      }
    };

    fetchMeetings();
  }, [filterContext]);

  // Calculate timeline data from meetings based on selected checkboxes
  const { timelineData, weekRange } = useMemo(() => {
    if (!meetings.length) {
      return { timelineData: [], weekRange: { min: 1, max: 6 } };
    }

    // Get all dates and calculate week numbers relative to earliest date
    const dates = meetings
      .map(m => m.meetingDate ? new Date(m.meetingDate) : null)
      .filter((d): d is Date => d !== null && !isNaN(d.getTime()));

    if (!dates.length) {
      return { timelineData: [], weekRange: { min: 1, max: 6 } };
    }

    const minDate = new Date(Math.min(...dates.map(d => d.getTime())));
    const maxDate = new Date(Math.max(...dates.map(d => d.getTime())));

    const getWeekNumber = (date: Date) => {
      const diffTime = date.getTime() - minDate.getTime();
      const diffWeeks = Math.floor(diffTime / (1000 * 60 * 60 * 24 * 7));
      return diffWeeks + 1;
    };

    const totalWeeks = Math.max(getWeekNumber(maxDate), 1);
    const displayWeeks = Math.min(Math.max(totalWeeks, 4), 12);

    // Group by selected categories (Topic, Keywords, Project)
    const groups: Record<string, { weeks: number[], color: string, type: string }> = {};
    let colorIndex = 0;

    meetings.forEach((meeting) => {
      if (!meeting.meetingDate) return;
      const date = new Date(meeting.meetingDate);
      if (isNaN(date.getTime())) return;

      const week = getWeekNumber(date);
      const keysToAdd: { key: string; type: string }[] = [];

      // Add keys based on selected checkboxes
      if (showTopic && meeting.topics?.length) {
        meeting.topics.forEach(t => keysToAdd.push({ key: t, type: 'topic' }));
      }
      if (showKeywords && meeting.tags?.length) {
        // Filter out status: prefixed tags
        const keywords = meeting.tags.filter(t => !t.startsWith('status:'));
        keywords.forEach(k => keysToAdd.push({ key: k, type: 'keyword' }));
      }
      if (showProject && meeting.project) {
        keysToAdd.push({ key: meeting.project, type: 'project' });
      }

      // If no checkbox selected, default to topics
      if (keysToAdd.length === 0 && meeting.topics?.length) {
        meeting.topics.forEach(t => keysToAdd.push({ key: t, type: 'topic' }));
      }

      keysToAdd.forEach(({ key, type }) => {
        const groupKey = `${type}:${key}`;
        if (!groups[groupKey]) {
          groups[groupKey] = { weeks: [], color: getColor(colorIndex++), type };
        }
        groups[groupKey].weeks.push(week);
      });
    });

    const items: TimelineItem[] = Object.entries(groups).map(([groupKey, data]) => ({
      name: groupKey.split(':').slice(1).join(':'), // Remove type prefix for display
      startWeek: Math.min(...data.weeks),
      endWeek: Math.max(...data.weeks),
      color: data.color,
    })).slice(0, 10);

    return { 
      timelineData: items, 
      weekRange: { min: 1, max: displayWeeks } 
    };
  }, [meetings, showTopic, showKeywords, showProject]);

  // Generate week labels
  const weekLabels = useMemo(() => {
    return Array.from({ length: weekRange.max }, (_, i) => i + 1);
  }, [weekRange.max]);

  return (
    <Card className="h-full">
      <CardHeader className="pb-4">
        <CardTitle className="text-lg">{t('topicMapTimeline.title')}</CardTitle>
        <CardDescription>
          {t('topicMapTimeline.description')}
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        
        {/* Gantt Chart */}
        <div className="border rounded-lg p-4 bg-muted/30">
          <div className="flex items-center text-xs text-muted-foreground mb-3">
            <span className="w-32">{t('topicMapTimeline.weeks')}</span>
            {weekLabels.map((week) => (
              <span key={week} className="flex-1 text-center">{week}</span>
            ))}
          </div>
          
          {isLoading ? (
            <div className="text-sm text-muted-foreground py-4 text-center">{t('topicMapTimeline.loading')}</div>
          ) : timelineData.length === 0 ? (
            <div className="text-sm text-muted-foreground py-4 text-center">{t('topicMapTimeline.noMeetings')}</div>
          ) : (
            <div className="space-y-3">
              {timelineData.map((item, idx) => (
                <div key={idx} className="flex items-center">
                  <span className="w-32 text-sm truncate pr-2" title={item.name}>{item.name}</span>
                  <div className="flex-1 relative h-6">
                    <div 
                      className={`absolute h-full ${item.color} rounded opacity-80`}
                      style={{
                        left: `${((item.startWeek - 1) / weekRange.max) * 100}%`,
                        width: `${(Math.max(item.endWeek - item.startWeek + 1, 1) / weekRange.max) * 100}%`,
                      }}
                    />
                  </div>
                  <span className="w-28 text-xs text-muted-foreground text-right">
                    {t('topicMapTimeline.week')} {item.startWeek} → {t('topicMapTimeline.week')} {item.endWeek}
                  </span>
                </div>
              ))}
            </div>
          )}
        </div>
        
        <div className="flex items-center gap-4 pt-2">
          <span className="text-sm text-muted-foreground">{t('topicMapTimeline.show')}</span>
          <div className="flex items-center gap-2">
            <Checkbox 
              id="topic" 
              checked={showTopic} 
              onCheckedChange={(c) => setShowTopic(!!c)} 
            />
            <label htmlFor="topic" className="text-sm">{t('topicMapTimeline.topic')}</label>
          </div>
          <div className="flex items-center gap-2">
            <Checkbox 
              id="keywords" 
              checked={showKeywords} 
              onCheckedChange={(c) => setShowKeywords(!!c)} 
            />
            <label htmlFor="keywords" className="text-sm">{t('topicMapTimeline.keywords')}</label>
          </div>
          <div className="flex items-center gap-2">
            <Checkbox 
              id="project" 
              checked={showProject} 
              onCheckedChange={(c) => setShowProject(!!c)} 
            />
            <label htmlFor="project" className="text-sm">{t('topicMapTimeline.project')}</label>
          </div>
        </div>
      </CardContent>
    </Card>
  );
};