import { useState } from "react";
import { useTranslation } from "react-i18next";
import { ChevronDown, ChevronUp, Check, Loader2, Circle } from "lucide-react";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible";

export type WorkflowStepStatus = 'pending' | 'active' | 'completed' | 'error';

export interface WorkflowStep {
  id: string;
  name: string;
  status: WorkflowStepStatus;
  details?: string;
  substeps?: {
    name: string;
    status: WorkflowStepStatus;
    details?: string;
  }[];
}

interface WorkflowStatusIndicatorProps {
  steps: WorkflowStep[];
  isVisible?: boolean;
}

const StepIcon = ({ status }: { status: WorkflowStepStatus }) => {
  switch (status) {
    case 'completed':
      return <Check className="h-3.5 w-3.5 text-green-500" />;
    case 'active':
      return <Loader2 className="h-3.5 w-3.5 animate-spin text-primary" />;
    case 'error':
      return <Circle className="h-3.5 w-3.5 text-destructive fill-destructive" />;
    default:
      return <Circle className="h-3.5 w-3.5 text-muted-foreground/40" />;
  }
};

export const WorkflowStatusIndicator = ({ 
  steps, 
  isVisible = true 
}: WorkflowStatusIndicatorProps) => {
  const { t } = useTranslation();
  const [isExpanded, setIsExpanded] = useState(false);

  if (!isVisible || steps.length === 0) {
    return null;
  }

  // Find the current active step or the last completed step
  const activeStep = steps.find(s => s.status === 'active');
  const lastCompletedIndex = steps.reduce((acc, step, idx) => 
    step.status === 'completed' ? idx : acc, -1);
  const currentStep = activeStep || (lastCompletedIndex >= 0 ? steps[lastCompletedIndex] : steps[0]);

  // Find current step position (1-indexed)
  const activeStepIndex = steps.findIndex(s => s.status === 'active');
  const currentStepNumber = activeStepIndex >= 0 
    ? activeStepIndex + 1 
    : (lastCompletedIndex >= 0 ? lastCompletedIndex + 1 : 1);
  const hasActiveStep = activeStepIndex >= 0;

  return (
    <div className="flex justify-start">
      <div className="bg-muted/50 border border-border/50 rounded-lg px-3 py-2 max-w-[90%] min-w-[200px]">
        <Collapsible open={isExpanded} onOpenChange={setIsExpanded}>
          {/* Collapsed View - Shows current step */}
          <div className="flex items-center justify-between gap-3">
            <div className="flex items-center gap-2 min-w-0 flex-1">
              <StepIcon status={currentStep?.status || 'pending'} />
              <span className="text-sm text-foreground truncate">
                {currentStep?.name}
              </span>
              {hasActiveStep && currentStep?.details && (
                <span className="text-xs text-muted-foreground truncate hidden sm:inline">
                  {currentStep.details}
                </span>
              )}
            </div>
            <div className="flex items-center gap-2 shrink-0">
              <span className="text-xs text-muted-foreground">
                {currentStepNumber}/{steps.length}
              </span>
              <CollapsibleTrigger asChild>
                <Button 
                  variant="ghost" 
                  size="sm" 
                  className="h-6 w-6 p-0 hover:bg-muted"
                >
                  {isExpanded ? (
                    <ChevronUp className="h-3.5 w-3.5" />
                  ) : (
                    <ChevronDown className="h-3.5 w-3.5" />
                  )}
                </Button>
              </CollapsibleTrigger>
            </div>
          </div>

          {/* Expanded View - Shows all steps */}
          <CollapsibleContent className="mt-2 pt-2 border-t border-border/50">
            <div className="space-y-1.5">
              {steps.map((step, index) => (
                <div key={step.id}>
                  {/* Main step */}
                  <div 
                    className={cn(
                      "flex items-start gap-2 py-1 px-1 rounded transition-colors",
                      step.status === 'active' && "bg-primary/5"
                    )}
                  >
                    <div className="mt-0.5">
                      <StepIcon status={step.status} />
                    </div>
                    <div className="flex-1 min-w-0">
                      <div className={cn(
                        "text-sm",
                        step.status === 'completed' && "text-muted-foreground",
                        step.status === 'active' && "text-foreground font-medium",
                        step.status === 'pending' && "text-muted-foreground/60",
                        step.status === 'error' && "text-destructive"
                      )}>
                        {step.name}
                      </div>
                      {step.details && step.status === 'active' && (
                        <div className="text-xs text-muted-foreground mt-0.5">
                          {step.details}
                        </div>
                      )}
                    </div>
                  </div>

                  {/* Substeps */}
                  {step.substeps && step.substeps.length > 0 && (
                    <div className="ml-5 mt-1 space-y-1 border-l border-border/30 pl-3">
                      {step.substeps.map((substep, subIndex) => (
                        <div 
                          key={`${step.id}-sub-${subIndex}`}
                          className="flex items-center gap-2 py-0.5"
                        >
                          <StepIcon status={substep.status} />
                          <span className={cn(
                            "text-xs",
                            substep.status === 'completed' && "text-muted-foreground",
                            substep.status === 'active' && "text-foreground",
                            substep.status === 'pending' && "text-muted-foreground/60"
                          )}>
                            {substep.name}
                          </span>
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              ))}
            </div>
          </CollapsibleContent>
        </Collapsible>
      </div>
    </div>
  );
};
