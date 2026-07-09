import { useCallback, useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";

interface TeamsStatus {
  available: boolean;
  connected: boolean;
  accountEmail?: string | null;
}

// Base URL of the running app (origin + Vite base path), used as the
// post-OAuth return address. Must match the backend allowlist.
const appBaseUrl = () => window.location.origin + import.meta.env.BASE_URL;

export const useTeamsIntegration = () => {
  const { t } = useTranslation();
  const [status, setStatus] = useState<TeamsStatus | null>(null);
  const [isStatusLoading, setIsStatusLoading] = useState(true);
  const [statusError, setStatusError] = useState<string | null>(null);
  const [isSyncing, setIsSyncing] = useState(false);

  const refreshStatus = useCallback(async () => {
    setIsStatusLoading(true);
    const { data, error } = await supabase.functions.invoke("teams-integration", {
      body: { action: "status" },
    });

    if (error) {
      setStatusError(error.message);
      setStatus(null);
    } else if (data) {
      setStatus(data as TeamsStatus);
      setStatusError(null);
    }
    setIsStatusLoading(false);
  }, []);

  useEffect(() => {
    refreshStatus();
  }, [refreshStatus]);

  // Handle the ?teams=<result> param set by the OAuth callback redirect
  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const result = params.get("teams");
    if (!result) return;

    if (result === "connected") {
      toast.success(t("teams.connected", "Microsoft Teams connected"));
    } else if (result === "denied") {
      toast.error(t("teams.denied", "Microsoft sign-in was cancelled"));
    } else {
      toast.error(t("teams.error", "Failed to connect Microsoft Teams"));
    }

    params.delete("teams");
    const query = params.toString();
    window.history.replaceState({}, "", window.location.pathname + (query ? `?${query}` : ""));
    refreshStatus();
  }, [refreshStatus, t]);

  const connect = useCallback(async () => {
    const { data, error } = await supabase.functions.invoke("teams-integration", {
      body: { action: "connect", appUrl: appBaseUrl() },
    });
    if (error || !data?.url) {
      toast.error(t("teams.notConfigured", "Teams integration is not configured yet"));
      return;
    }
    window.location.href = data.url as string;
  }, [t]);

  const disconnect = useCallback(async () => {
    await supabase.functions.invoke("teams-integration", { body: { action: "disconnect" } });
    toast.success(t("teams.disconnected", "Microsoft Teams disconnected"));
    refreshStatus();
  }, [refreshStatus, t]);

  const sync = useCallback(async () => {
    setIsSyncing(true);
    const { data, error } = await supabase.functions.invoke("teams-sync", { body: {} });
    setIsSyncing(false);

    if (error || !data?.success) {
      toast.error(t("teams.syncError", "Sync failed — try reconnecting Teams"));
      refreshStatus();
      return;
    }

    if (data.imported > 0) {
      toast.success(t("teams.syncResult", "Imported {{count}} meeting transcript(s)", { count: data.imported }));
      // Imported meetings should appear everywhere (sidebar, dashboard)
      setTimeout(() => window.location.reload(), 1200);
    } else {
      toast.info(t("teams.syncNothing", "No new transcripts found in the last 14 days"));
    }
  }, [refreshStatus, t]);

  return { status, isStatusLoading, statusError, isSyncing, connect, disconnect, sync };
};
