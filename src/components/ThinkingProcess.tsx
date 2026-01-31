import { useState } from "react";
import { useTranslation } from "react-i18next";
import { ChevronDown, ChevronUp, Sparkles, Search, FileText, Scissors, ListTree } from "lucide-react";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible";
import { Badge } from "@/components/ui/badge";
import type { AgentToolName } from "@/types/agent";

interface ThinkingProcessProps {
  tool: AgentToolName;
  reasoning: string;
  confidence: number;
  isExpanded?: boolean;
}

const TOOL_CONFIG: Record<AgentToolName, { icon: React.ElementType; label: string; thinkingTitle: string }> = {
  search_transcript: {
    icon: Search,
    label: 'Search Transcript',
    thinkingTitle: 'Searching Through Transcript',
  },
  search_summary: {
    icon: FileText,
    label: 'Search Summary',
    thinkingTitle: 'Analyzing Summary Content',
  },
  adjust_summary: {
    icon: Scissors,
    label: 'Adjust Summary',
    thinkingTitle: 'Refining Summary Structure',
  },
  extract_from_transcript: {
    icon: ListTree,
    label: 'Extract Content',
    thinkingTitle: 'Extracting Key Information',
  },
};

export const ThinkingProcess = ({ 
  tool, 
  reasoning, 
  confidence,
  isExpanded: defaultExpanded = false 
}: ThinkingProcessProps) => {
  const { t } = useTranslation();
  const [isOpen, setIsOpen] = useState(defaultExpanded);
  
  const config = TOOL_CONFIG[tool];
  const Icon = config.icon;
  
  // Split reasoning into sections for better display
  const reasoningSections = reasoning.split(/(?=\n\n|\. (?=[A-Z]))/g).filter(s => s.trim());
  
  return (
    <Collapsible open={isOpen} onOpenChange={setIsOpen} className="w-full">
      <CollapsibleTrigger className="flex items-center gap-2 w-full group hover:opacity-80 transition-opacity">
        <Sparkles className="h-4 w-4 text-blue-500" />
        <Badge 
          variant="secondary" 
          className="bg-blue-500/10 text-blue-600 dark:text-blue-400 border-blue-500/20 hover:bg-blue-500/20 cursor-pointer"
        >
          <Icon className="h-3 w-3 mr-1.5" />
          {config.thinkingTitle}
          {isOpen ? (
            <ChevronUp className="h-3 w-3 ml-1.5" />
          ) : (
            <ChevronDown className="h-3 w-3 ml-1.5" />
          )}
        </Badge>
        <span className="text-xs text-muted-foreground">
          {Math.round(confidence * 100)}% confident
        </span>
      </CollapsibleTrigger>
      
      <CollapsibleContent className="mt-3">
        <div className="bg-muted/50 rounded-lg p-4 border border-border/50 space-y-3">
          <div className="flex items-center gap-2 text-sm font-medium text-foreground/80">
            <Icon className="h-4 w-4 text-blue-500" />
            <span>Using: {config.label}</span>
          </div>
          
          <div className="space-y-2 text-sm text-muted-foreground italic">
            {reasoningSections.length > 1 ? (
              reasoningSections.map((section, index) => (
                <p key={index} className="leading-relaxed">
                  {section.trim()}
                </p>
              ))
            ) : (
              <p className="leading-relaxed">{reasoning}</p>
            )}
          </div>
          
          <div className="flex items-center gap-2 pt-2 border-t border-border/30">
            <span className="text-xs text-muted-foreground">
              Tool: <code className="bg-background/50 px-1.5 py-0.5 rounded text-blue-600 dark:text-blue-400">{tool}</code>
            </span>
          </div>
        </div>
      </CollapsibleContent>
    </Collapsible>
  );
};
