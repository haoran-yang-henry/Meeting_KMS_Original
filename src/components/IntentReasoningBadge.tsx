import { Badge } from "@/components/ui/badge";
import { Brain, Search, FileText, Wand2, Sparkles } from "lucide-react";
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import type { AgentToolName } from "@/types/agent";

interface IntentReasoningBadgeProps {
  tool: AgentToolName;
  reasoning: string;
  confidence: number;
}

const toolConfig: Record<AgentToolName, { icon: typeof Brain; label: string; color: string }> = {
  search_transcript: {
    icon: Search,
    label: 'RAG Search',
    color: 'bg-blue-500/10 text-blue-600 border-blue-500/20',
  },
  search_summary: {
    icon: FileText,
    label: 'Summary Search',
    color: 'bg-green-500/10 text-green-600 border-green-500/20',
  },
  adjust_summary: {
    icon: Wand2,
    label: 'Adjust Summary',
    color: 'bg-purple-500/10 text-purple-600 border-purple-500/20',
  },
  extract_from_transcript: {
    icon: Sparkles,
    label: 'Extract Content',
    color: 'bg-amber-500/10 text-amber-600 border-amber-500/20',
  },
};

export function IntentReasoningBadge({ tool, reasoning, confidence }: IntentReasoningBadgeProps) {
  const config = toolConfig[tool];
  const Icon = config.icon;

  return (
    <TooltipProvider>
      <Tooltip delayDuration={300}>
        <TooltipTrigger asChild>
          <Badge 
            variant="outline" 
            className={`${config.color} text-xs gap-1 cursor-help`}
          >
            <Icon className="h-3 w-3" />
            {config.label}
            <span className="opacity-60">({Math.round(confidence * 100)}%)</span>
          </Badge>
        </TooltipTrigger>
        <TooltipContent side="top" className="max-w-xs">
          <div className="space-y-1">
            <p className="font-medium flex items-center gap-1">
              <Brain className="h-3 w-3" />
              AI Reasoning
            </p>
            <p className="text-xs text-muted-foreground">{reasoning}</p>
          </div>
        </TooltipContent>
      </Tooltip>
    </TooltipProvider>
  );
}
