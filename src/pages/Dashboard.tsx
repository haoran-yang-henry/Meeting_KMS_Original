import { useMemo } from "react";
import { useParams } from "react-router-dom";
import { Sidebar } from "@/components/Sidebar";
import { LayeredAgentSummary } from "@/components/dashboard/LayeredAgentSummary";
import { HierarchicalSummaryLayers } from "@/components/dashboard/HierarchicalSummaryLayers";
import { OutputIntegration } from "@/components/dashboard/OutputIntegration";
import { TopicMapTimeline } from "@/components/dashboard/TopicMapTimeline";
import { ScrollArea } from "@/components/ui/scroll-area";
import { useTranscriptFilter } from "@/hooks/useTranscriptFilter";

interface DashboardProps {
  viewType?: "timeline" | "project" | "group" | "topic";
  viewName?: string;
}

const Dashboard = ({ viewType, viewName }: DashboardProps) => {
  const { topicName, projectName, groupName, slug } = useParams();
  
  // Decode URL params to get original values
  const decodedTopic = topicName ? decodeURIComponent(topicName) : undefined;
  const decodedProject = projectName ? decodeURIComponent(projectName) : undefined;
  const decodedGroup = groupName ? decodeURIComponent(groupName) : undefined;
  const decodedSlug = slug ? decodeURIComponent(slug) : undefined;
  
  // Build filter params based on view type and URL params
  const filterParams = useMemo(() => {
    const params: {
      project?: string;
      group?: string;
      topic?: string;
      timeline?: "today" | "week" | "month";
      unassigned?: boolean;
    } = {};
    
    const projectValue = decodedProject || decodedSlug || viewName;
    
    if (viewType === "project") {
      // Check if this is the unassigned meetings view
      if (projectValue === "unassigned") {
        params.unassigned = true;
      } else {
        params.project = projectValue;
      }
    } else if (viewType === "group") {
      params.group = decodedGroup || viewName;
    } else if (viewType === "topic") {
      params.topic = decodedTopic;
    } else if (viewType === "timeline" && viewName) {
      if (viewName === "Today") params.timeline = "today";
      else if (viewName === "This Week") params.timeline = "week";
      else if (viewName === "This Month") params.timeline = "month";
    }
    
    return params;
  }, [viewType, viewName, decodedTopic, decodedProject, decodedGroup, decodedSlug]);
  
  const { transcripts, isLoading, refetch } = useTranscriptFilter(filterParams);
  
  // Derive display name from URL params or viewName
  const displayName = useMemo(() => {
    if (decodedTopic) return decodedTopic;
    if (decodedProject) return decodedProject;
    if (decodedGroup) return decodedGroup;
    if (decodedSlug) return decodedSlug;
    return viewName;
  }, [decodedTopic, decodedProject, decodedGroup, decodedSlug, viewName]);

  return (
    <div className="flex h-screen bg-background w-full">
      <Sidebar />
      <main className="flex-1 min-w-0 overflow-x-hidden overflow-y-auto flex flex-col">
        <div className="p-6 space-y-6 w-full max-w-full">
          {/* Layered Agent Summary */}
          <LayeredAgentSummary 
            transcripts={transcripts} 
            isLoading={isLoading}
            viewName={displayName}
          />
          
          {/* Hierarchical Summary Layers */}
          <HierarchicalSummaryLayers 
            transcripts={transcripts} 
            isLoading={isLoading}
            viewType={viewType}
            projectName={displayName}
            onSummaryUpdated={refetch}
          />
          
          {/* Bottom Grid: Output & Timeline */}
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
            <OutputIntegration filterContext={filterParams} />
            <TopicMapTimeline filterContext={filterParams} />
          </div>
        </div>
      </main>
    </div>
  );
};

export default Dashboard;
