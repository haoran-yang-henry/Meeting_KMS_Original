import { useTranslation } from "react-i18next";
import { FileText, FileUp, Loader2, MessageSquare } from "lucide-react";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { useTeamsIntegration } from "@/hooks/useTeamsIntegration";

interface EmptyStateUploadProps {
  onUploadTranscript: () => void;
}

export const EmptyStateUpload = ({ onUploadTranscript }: EmptyStateUploadProps) => {
  const { t } = useTranslation();
  const { status, isStatusLoading, isSyncing, connect, disconnect, sync } = useTeamsIntegration();

  return (
    <div className="flex flex-col items-center justify-center h-full p-8">
      <div className="text-center mb-8">
        <h2 className="text-xl font-semibold text-foreground mb-2">
          {t('addPage.emptyState.title', 'Add to this chat')}
        </h2>
        <p className="text-sm text-muted-foreground">
          {t('addPage.emptyState.subtitle', 'Get started by uploading a transcript')}
        </p>
      </div>

      <div className="w-full max-w-sm space-y-3">
        {/* Upload transcript - Active */}
        <button
          onClick={onUploadTranscript}
          className={cn(
            "w-full flex items-center gap-3 px-4 py-3 rounded-lg border-2 transition-all",
            "border-primary bg-background hover:bg-accent/50",
            "text-left group cursor-pointer"
          )}
        >
          <FileText className="h-5 w-5 text-primary shrink-0" />
          <span className="font-medium text-foreground">
            {t('addPage.emptyState.uploadTranscript', 'Upload transcript')}
          </span>
        </button>

        {/* Upload context file - Coming Soon */}
        <div
          className={cn(
            "w-full flex items-center justify-between gap-3 px-4 py-3 rounded-lg border transition-all",
            "border-muted bg-muted/30",
            "text-left cursor-not-allowed opacity-60"
          )}
        >
          <div className="flex items-center gap-3">
            <FileUp className="h-5 w-5 text-muted-foreground shrink-0" />
            <span className="font-medium text-muted-foreground">
              {t('addPage.emptyState.uploadContext', 'Upload context file')}
            </span>
          </div>
          <span className="text-xs text-muted-foreground bg-muted px-2 py-0.5 rounded">
            {t('addPage.emptyState.comingSoon', 'Coming Soon')}
          </span>
        </div>

        {/* Microsoft Teams */}
        {status?.connected ? (
          // Connected: show account + sync action
          <div className="w-full px-4 py-3 rounded-lg border-2 border-primary/50 bg-background space-y-2">
            <div className="flex items-center justify-between gap-3">
              <div className="flex items-center gap-3 min-w-0">
                <MessageSquare className="h-5 w-5 text-primary shrink-0" />
                <div className="min-w-0">
                  <span className="font-medium text-foreground block">
                    {t('addPage.emptyState.microsoftTeams', 'Microsoft Teams')}
                  </span>
                  {status.accountEmail && (
                    <span className="text-xs text-muted-foreground block truncate">
                      {status.accountEmail}
                    </span>
                  )}
                </div>
              </div>
              <button
                onClick={disconnect}
                className="text-xs text-muted-foreground hover:text-destructive shrink-0"
              >
                {t('teams.disconnect', 'Disconnect')}
              </button>
            </div>
            <Button size="sm" className="w-full" onClick={sync} disabled={isSyncing}>
              {isSyncing ? (
                <>
                  <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                  {t('teams.syncing', 'Importing…')}
                </>
              ) : (
                t('teams.sync', 'Import recent Teams transcripts')
              )}
            </Button>
          </div>
        ) : (
          // Start OAuth. If the status request failed, connect still gives the
          // backend a chance to return a concrete error/toast.
          <button
            onClick={connect}
            disabled={isStatusLoading}
            className={cn(
              "w-full flex items-center gap-3 px-4 py-3 rounded-lg border-2 transition-all text-left group",
              isStatusLoading
                ? "border-muted bg-muted/20 cursor-wait opacity-70"
                : "border-primary bg-background hover:bg-accent/50 cursor-pointer"
            )}
          >
            {isStatusLoading ? (
              <Loader2 className="h-5 w-5 text-muted-foreground shrink-0 animate-spin" />
            ) : (
              <MessageSquare className="h-5 w-5 text-primary shrink-0" />
            )}
            <span className="font-medium text-foreground">
              {isStatusLoading
                ? t('common.loading', 'Loading...')
                : t('teams.connect', 'Connect Microsoft Teams')}
            </span>
          </button>
        )}
      </div>
    </div>
  );
};
