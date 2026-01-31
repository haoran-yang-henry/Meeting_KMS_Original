import { useMemo } from 'react';
import { useTranslation } from 'react-i18next';
import { WorkflowStep, WorkflowStepStatus } from '@/components/WorkflowStatusIndicator';

interface WorkflowStepsInput {
  isUploading: boolean;
  isChecking: boolean;
  isGeneratingSummary: boolean;
  isSavingTranscript: boolean;
  hasTranscript: boolean;
  hasSuggestions: boolean;
  hasSummary: boolean;
  isIndexed: boolean;
  isApplyingAll?: boolean;
}

export function useWorkflowSteps({
  isUploading,
  isChecking,
  isGeneratingSummary,
  isSavingTranscript,
  hasTranscript,
  hasSuggestions,
  hasSummary,
  isIndexed,
  isApplyingAll = false,
}: WorkflowStepsInput): WorkflowStep[] {
  const { t } = useTranslation();

  return useMemo(() => {
    // Only show steps when there's activity
    const isActive = isUploading || isChecking || isGeneratingSummary || isSavingTranscript || isApplyingAll;
    
    if (!isActive && !hasTranscript) {
      return [];
    }

    // Helper to determine step status
    const getStatus = (
      isRunning: boolean,
      isComplete: boolean,
      dependsOnPrior: boolean = true
    ): WorkflowStepStatus => {
      if (isRunning) return 'active';
      if (isComplete) return 'completed';
      if (dependsOnPrior) return 'pending';
      return 'pending';
    };

    // Build steps based on current workflow state
    const steps: WorkflowStep[] = [];

    // During upload phase
    if (isUploading || (!hasTranscript && !hasSummary)) {
      steps.push({
        id: 'upload',
        name: t('workflowSteps.uploading'),
        status: isUploading ? 'active' : (hasTranscript ? 'completed' : 'pending'),
      });
      
      steps.push({
        id: 'parse',
        name: t('workflowSteps.parsing'),
        status: isUploading && hasTranscript ? 'active' : (hasTranscript ? 'completed' : 'pending'),
      });

      steps.push({
        id: 'index-initial',
        name: t('workflowSteps.indexing'),
        status: isUploading && hasTranscript ? 'active' : (isIndexed ? 'completed' : 'pending'),
      });
    }

    // Check step
    if (isChecking || hasSuggestions || (hasTranscript && !isUploading)) {
      steps.push({
        id: 'check',
        name: t('workflowSteps.checking'),
        status: getStatus(isChecking, hasSuggestions || (!isChecking && hasTranscript && !isUploading)),
        details: isChecking ? undefined : undefined,
      });
    }

    // Summary generation step
    if (isGeneratingSummary || hasSummary || (hasTranscript && !isUploading)) {
      steps.push({
        id: 'summary',
        name: t('workflowSteps.generatingSummary'),
        status: getStatus(isGeneratingSummary, hasSummary),
      });
    }

    // Apply all corrections step (only show during apply all)
    if (isApplyingAll) {
      steps.push({
        id: 'apply-corrections',
        name: t('workflowSteps.applyingCorrections'),
        status: 'active',
      });
    }

    // Saving step (only show during save)
    if (isSavingTranscript) {
      steps.push({
        id: 'save-summary',
        name: t('workflowSteps.savingSummary'),
        status: 'active',
      });
      
      steps.push({
        id: 'update-index',
        name: t('workflowSteps.updatingIndex'),
        status: 'pending',
      });
    }

    // Filter out steps that are all pending (not started yet)
    const hasActiveOrCompleted = steps.some(s => s.status === 'active' || s.status === 'completed');
    if (!hasActiveOrCompleted) {
      return [];
    }

    return steps;
  }, [
    t,
    isUploading,
    isChecking,
    isGeneratingSummary,
    isSavingTranscript,
    hasTranscript,
    hasSuggestions,
    hasSummary,
    isIndexed,
    isApplyingAll,
  ]);
}
