import { useTranslation } from "react-i18next";
import { FileText, FileUp, MessageSquare } from "lucide-react";
import { cn } from "@/lib/utils";

interface EmptyStateUploadProps {
  onUploadTranscript: () => void;
}

export const EmptyStateUpload = ({ onUploadTranscript }: EmptyStateUploadProps) => {
  const { t } = useTranslation();

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

        {/* Microsoft Teams - Coming Soon */}
        <div
          className={cn(
            "w-full flex items-center justify-between gap-3 px-4 py-3 rounded-lg border transition-all",
            "border-muted bg-muted/30",
            "text-left cursor-not-allowed opacity-60"
          )}
        >
          <div className="flex items-center gap-3">
            <MessageSquare className="h-5 w-5 text-muted-foreground shrink-0" />
            <span className="font-medium text-muted-foreground">
              {t('addPage.emptyState.microsoftTeams', 'Microsoft Teams')}
            </span>
          </div>
          <span className="text-xs text-muted-foreground bg-muted px-2 py-0.5 rounded">
            {t('addPage.emptyState.comingSoon', 'Coming Soon')}
          </span>
        </div>
      </div>
    </div>
  );
};
