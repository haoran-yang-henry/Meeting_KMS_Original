// Pull Teams meeting transcripts via Microsoft Graph and feed them into the
// normal ingestion pipeline. Delegated flow: acts as the connected user.
import { createClient } from "jsr:@supabase/supabase-js@2";
import { serveWithAuth } from "../_shared/auth.ts";
import { json } from "../_shared/cors.ts";
import { graphGet, refreshAccessToken } from "../_shared/msgraph.ts";
import { ingestTranscript } from "../_shared/ingest.ts";

const LOOKBACK_DAYS = 14;
const MAX_IMPORTS_PER_RUN = 5; // keep well inside the edge-function time budget

function serviceClient() {
  return createClient(
    Deno.env.get("SUPABASE_URL")!,
    Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
  );
}

interface CalendarEvent {
  subject?: string;
  start?: { dateTime?: string };
  end?: { dateTime?: string };
  onlineMeeting?: { joinUrl?: string };
}

function toIso(graphDateTime?: string): string {
  if (!graphDateTime) return new Date().toISOString();
  try {
    // calendarView returns UTC without a zone suffix
    return new Date(
      graphDateTime.endsWith("Z") ? graphDateTime : `${graphDateTime}Z`,
    ).toISOString();
  } catch {
    return new Date().toISOString();
  }
}

serveWithAuth(async ({ user, supabase }) => {
  const service = serviceClient();

  // 1. Load the stored connection (table is invisible to clients by design)
  const { data: connection } = await service
    .from("ms_connections")
    .select("refresh_token")
    .eq("user_id", user.id)
    .maybeSingle();

  if (!connection) {
    return json({ error: "Microsoft Teams is not connected", code: "not_connected" }, 400);
  }

  // 2. Fresh access token (rotate the refresh token if Microsoft returns a new one)
  let accessToken: string;
  try {
    const tokens = await refreshAccessToken(connection.refresh_token);
    accessToken = tokens.access_token;
    if (tokens.refresh_token && tokens.refresh_token !== connection.refresh_token) {
      await service.from("ms_connections")
        .update({ refresh_token: tokens.refresh_token, updated_at: new Date().toISOString() })
        .eq("user_id", user.id);
    }
  } catch (error) {
    console.error("Token refresh failed:", error);
    return json({ error: "Microsoft session expired, please reconnect", code: "reconnect" }, 401);
  }

  // 3. Recent calendar events that carry a Teams join link
  const now = new Date();
  const start = new Date(now.getTime() - LOOKBACK_DAYS * 24 * 3600 * 1000);
  const calendarPath = `/me/calendarView?startDateTime=${start.toISOString()}&endDateTime=${now.toISOString()}` +
    `&$select=subject,start,end,onlineMeeting&$orderby=start/dateTime desc&$top=50`;
  const calendarResponse = await graphGet(accessToken, calendarPath);
  if (!calendarResponse.ok) {
    console.error("calendarView error:", calendarResponse.status, (await calendarResponse.text()).slice(0, 300));
    return json({ error: "Failed to read calendar" }, 502);
  }
  const events: CalendarEvent[] = (await calendarResponse.json()).value ?? [];
  const teamsEvents = events.filter((e) => e.onlineMeeting?.joinUrl);
  console.log(`Found ${teamsEvents.length}/${events.length} Teams meetings in the last ${LOOKBACK_DAYS} days`);

  // 4. Already-imported transcript ids (dedupe)
  const { data: importedRows } = await service
    .from("imported_meetings")
    .select("provider_transcript_id")
    .eq("user_id", user.id)
    .eq("provider", "teams");
  const imported = new Set((importedRows ?? []).map((r) => r.provider_transcript_id));

  const results: Array<{ title: string; transcriptId: string }> = [];
  let skipped = 0;

  for (const event of teamsEvents) {
    if (results.length >= MAX_IMPORTS_PER_RUN) break;

    // 5. Resolve joinUrl → onlineMeeting id
    const filter = encodeURIComponent(`JoinWebUrl eq '${event.onlineMeeting!.joinUrl}'`);
    const meetingResponse = await graphGet(accessToken, `/me/onlineMeetings?$filter=${filter}`);
    if (!meetingResponse.ok) {
      console.error("onlineMeetings lookup failed:", meetingResponse.status);
      continue;
    }
    const meetingId = (await meetingResponse.json()).value?.[0]?.id;
    if (!meetingId) continue;

    // 6. Transcripts for this meeting
    const listResponse = await graphGet(accessToken, `/me/onlineMeetings/${meetingId}/transcripts`);
    if (!listResponse.ok) {
      console.error("transcripts list failed:", listResponse.status);
      continue;
    }
    const transcripts: Array<{ id: string }> = (await listResponse.json()).value ?? [];

    for (const t of transcripts) {
      if (results.length >= MAX_IMPORTS_PER_RUN) break;
      if (imported.has(t.id)) {
        skipped++;
        continue;
      }

      // 7. Fetch VTT content and run the normal ingestion pipeline
      const contentResponse = await graphGet(
        accessToken,
        `/me/onlineMeetings/${meetingId}/transcripts/${t.id}/content?$format=text/vtt`,
        "text/vtt",
      );
      if (!contentResponse.ok) {
        console.error("transcript content failed:", contentResponse.status);
        continue;
      }
      const vtt = await contentResponse.text();

      const startIso = toIso(event.start?.dateTime);
      const durationMinutes = event.end?.dateTime && event.start?.dateTime
        ? Math.max(0, Math.round((new Date(toIso(event.end.dateTime)).getTime() -
            new Date(startIso).getTime()) / 60000))
        : 0;

      try {
        const result = await ingestTranscript(supabase, user.id, vtt, {
          title: event.subject || "Teams Meeting",
          date: startIso,
          duration: durationMinutes,
          fileType: "vtt",
          state: "uploaded_raw",
        });

        await service.from("imported_meetings").insert({
          user_id: user.id,
          provider: "teams",
          provider_transcript_id: t.id,
          transcript_id: result.transcriptId,
          meeting_subject: event.subject ?? null,
        });

        imported.add(t.id);
        results.push({ title: event.subject || "Teams Meeting", transcriptId: result.transcriptId });
      } catch (error) {
        console.error(`Ingestion failed for "${event.subject}":`, error);
      }
    }
  }

  return json({
    success: true,
    meetingsScanned: teamsEvents.length,
    imported: results.length,
    skippedAlreadyImported: skipped,
    results,
  });
});
