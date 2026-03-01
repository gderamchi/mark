/**
 * Seed demo emails: fetch real Gmail emails, classify importance, generate reply drafts.
 *
 * Usage: pnpm --filter @mark/server seed-demo --user-id <uuid>
 */
import { createClient } from "@supabase/supabase-js";

import { ComposioService } from "../composio.js";
import { ComposioSyncService } from "../composioSync.js";
import { getEnvConfig } from "../env.js";

const env = getEnvConfig();

const userIdArg = (() => {
  const idx = process.argv.indexOf("--user-id");
  return idx >= 0 && process.argv[idx + 1] ? process.argv[idx + 1] : null;
})();

if (!userIdArg) {
  console.error("Usage: seed-demo --user-id <uuid>");
  process.exit(1);
}

if (!env.supabaseUrl || !env.supabaseServiceRoleKey) {
  console.error("SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY are required.");
  process.exit(1);
}

if (!env.anthropicApiKey) {
  console.error("ANTHROPIC_API_KEY is required for draft generation.");
  process.exit(1);
}

const db = createClient(env.supabaseUrl, env.supabaseServiceRoleKey, {
  auth: { persistSession: false, autoRefreshToken: false }
});

const composio = new ComposioService(env);
const composioSync = new ComposioSyncService(env, composio);

type AnthropicContentBlock = { type: string; text?: string };

async function generateDraft(prompt: string): Promise<string> {
  const response = await fetch("https://api.anthropic.com/v1/messages", {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "x-api-key": env.anthropicApiKey!,
      "anthropic-version": "2023-06-01"
    },
    body: JSON.stringify({
      model: env.anthropicModel,
      max_tokens: 300,
      messages: [{ role: "user", content: prompt }]
    })
  });

  if (!response.ok) {
    const errText = await response.text().catch(() => "");
    throw new Error(`Anthropic error ${response.status}: ${errText}`);
  }

  const data = (await response.json()) as { content?: AnthropicContentBlock[] };
  return (data.content ?? [])
    .filter((b) => b.type === "text" && b.text)
    .map((b) => b.text!)
    .join("\n")
    .trim();
}

async function main() {
  const userId = userIdArg!;
  const composioUserId = `supabase:${userId}`;

  // 1. Sync emails (fetch + classify)
  console.log("[seed-demo] Syncing emails for user %s...", userId);
  await composioSync.syncUser(userId, composioUserId);
  console.log("[seed-demo] Sync complete.");

  // 2. Read important emails from DB
  const { data: emails, error } = await db
    .from("user_recent_emails")
    .select("message_id, thread_id, from_address, subject, snippet, importance, importance_reason")
    .eq("user_id", userId)
    .in("importance", ["must_know", "respond_needed"])
    .order("received_at", { ascending: false });

  if (error) {
    console.error("[seed-demo] Failed to read emails:", error.message);
    process.exit(1);
  }

  if (!emails || emails.length === 0) {
    console.log("[seed-demo] No important emails found. Nothing to draft.");
    return;
  }

  console.log("[seed-demo] Found %d important emails. Generating drafts...", emails.length);

  // 3. Generate drafts for each important email
  let draftCount = 0;
  for (const email of emails) {
    try {
      const prompt = `Draft a concise and professional reply to this email.
From: ${email.from_address}
Subject: ${email.subject}
Snippet: ${email.snippet ?? ""}
Reply in English, direct and actionable tone, 3-5 sentences max.`;

      const draftBody = await generateDraft(prompt);

      if (!draftBody) {
        console.warn("[seed-demo] Empty draft for message %s, skipping.", email.message_id);
        continue;
      }

      // 4. Upsert draft into user_email_drafts
      const { error: upsertError } = await db.from("user_email_drafts").upsert(
        {
          user_id: userId,
          message_id: email.message_id,
          thread_id: email.thread_id ?? null,
          subject: email.subject ?? "",
          draft_body: draftBody
        },
        { onConflict: "user_id,message_id" }
      );

      if (upsertError) {
        console.warn("[seed-demo] Failed to upsert draft for %s: %s", email.message_id, upsertError.message);
        continue;
      }

      draftCount++;
      console.log("[seed-demo] Draft %d/%d: %s", draftCount, emails.length, email.subject);
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      console.warn("[seed-demo] Draft generation failed for %s: %s", email.message_id, msg);
    }
  }

  console.log("[seed-demo] Done. Seeded %d emails, %d drafts generated.", emails.length, draftCount);

  // --- 3a. Slack sync summary ---
  console.log("\n[seed-demo] === Slack Messages ===");
  const { data: slackMessages, error: slackErr } = await db
    .from("user_recent_slack_messages")
    .select("channel_name, sender_name, message_text, received_at")
    .eq("user_id", userId)
    .order("received_at", { ascending: false })
    .limit(15);

  if (slackErr) {
    console.warn("[seed-demo] Failed to read Slack messages:", slackErr.message);
  } else if (slackMessages && slackMessages.length > 0) {
    console.log("[seed-demo] %d Slack messages in cache:", slackMessages.length);
    for (const msg of slackMessages) {
      const preview = (msg.message_text ?? "").slice(0, 80).replace(/\n/g, " ");
      console.log("  - #%s — %s: %s", msg.channel_name, msg.sender_name || "unknown", preview);
    }
  } else {
    console.log("[seed-demo] No Slack messages cached (Slack may not be connected).");
  }

  // --- 3b. Seed Calendly event linked to Nvidia email ---
  console.log("\n[seed-demo] === Calendly Event Seed ===");

  // Find the Nvidia email (or any "respond_needed" email as fallback)
  const nvidiaEmail = emails.find((e) =>
    /nvidia/i.test(e.from_address) || /nvidia/i.test(e.subject)
  ) ?? emails.find((e) => e.importance === "respond_needed");

  if (nvidiaEmail) {
    // Check if Calendly is connected
    const { data: calendlyConns } = await db
      .from("user_composio_connections")
      .select("toolkit_slug")
      .eq("user_id", userId)
      .eq("toolkit_slug", "calendly")
      .eq("status", "ACTIVE")
      .limit(1);

    if (calendlyConns && calendlyConns.length > 0) {
      try {
        // Get Calendly event types to find scheduling URL
        console.log("[seed-demo] Fetching Calendly event types...");
        const eventTypesResult = await composio.executeToolDirect(composioUserId, "CALENDLY_LIST_EVENT_TYPES", {});
        type CalendlyEventType = { uri?: string; name?: string; scheduling_url?: string };
        const eventTypes =
          (eventTypesResult as { data?: { collection?: CalendlyEventType[] } })?.data?.collection ?? [];

        let calendlyLink = "";
        if (eventTypes.length > 0) {
          const eventType = eventTypes[0];
          calendlyLink = eventType?.scheduling_url ?? "";

          // Try to create a one-time scheduling link
          if (eventType?.uri) {
            try {
              console.log("[seed-demo] Creating Calendly scheduling link...");
              const linkResult = await composio.executeToolDirect(
                composioUserId,
                "CALENDLY_CREATE_SCHEDULING_LINK",
                {
                  max_event_count: 1,
                  owner: eventType.uri,
                  owner_type: "EventType"
                }
              );
              const oneTimeLink =
                (linkResult as { data?: { resource?: { booking_url?: string } } })?.data?.resource?.booking_url;
              if (oneTimeLink) {
                calendlyLink = oneTimeLink;
              }
            } catch (linkErr) {
              const msg = linkErr instanceof Error ? linkErr.message : String(linkErr);
              console.warn("[seed-demo] Calendly scheduling link creation failed, using base URL:", msg);
            }
          }
        }

        // Extract sender info
        const senderEmail = extractEmail(nvidiaEmail.from_address);
        const senderName = extractName(nvidiaEmail.from_address);

        // Compute a proposed time slot: tomorrow 14h-14h30
        const tomorrow = new Date();
        tomorrow.setDate(tomorrow.getDate() + 1);
        tomorrow.setHours(14, 0, 0, 0);
        const endTime = new Date(tomorrow);
        endTime.setMinutes(30);

        const { error: calUpsertErr } = await db.from("user_demo_calendar_events").upsert(
          {
            user_id: userId,
            linked_message_id: nvidiaEmail.message_id,
            event_name: `${nvidiaEmail.subject.replace(/^(re|fwd?):\s*/gi, "").trim().slice(0, 60)}`,
            event_description: `Follow-up meeting re: email from ${senderName}`,
            start_time: tomorrow.toISOString(),
            end_time: endTime.toISOString(),
            attendee_email: senderEmail,
            calendly_link: calendlyLink || null
          },
          { onConflict: "user_id,linked_message_id" }
        );

        if (calUpsertErr) {
          console.warn("[seed-demo] Calendly event upsert failed:", calUpsertErr.message);
        } else {
          console.log(
            "[seed-demo] Calendly event seeded: '%s' with %s — link: %s",
            nvidiaEmail.subject.slice(0, 50),
            senderEmail,
            calendlyLink || "(no link)"
          );

          // Re-generate draft for this email with Calendly slot + link
          const tomorrowDate = tomorrow.toLocaleDateString("en-US", { weekday: "long", month: "long", day: "numeric" });
          const enrichedPrompt = `Draft a concise and professional reply to this email.
From: ${nvidiaEmail.from_address}
Subject: ${nvidiaEmail.subject}
Snippet: ${nvidiaEmail.snippet ?? ""}
The user is available tomorrow ${tomorrowDate} from 2:00 PM to 2:30 PM.
Suggest this time slot in your reply and include the Calendly link: ${calendlyLink || "https://calendly.com/demo/30min"}
Reply in English, direct and actionable tone, 3-5 sentences max.`;

          try {
            const enrichedDraft = await generateDraft(enrichedPrompt);
            if (enrichedDraft) {
              const { error: draftUpsertErr } = await db.from("user_email_drafts").upsert(
                {
                  user_id: userId,
                  message_id: nvidiaEmail.message_id,
                  thread_id: nvidiaEmail.thread_id ?? null,
                  subject: nvidiaEmail.subject ?? "",
                  draft_body: enrichedDraft
                },
                { onConflict: "user_id,message_id" }
              );

              if (draftUpsertErr) {
                console.warn("[seed-demo] Enriched draft upsert failed:", draftUpsertErr.message);
              } else {
                console.log("[seed-demo] Draft re-generated with Calendly slot for: %s", nvidiaEmail.subject.slice(0, 50));
              }
            }
          } catch (draftErr) {
            const draftMsg = draftErr instanceof Error ? draftErr.message : String(draftErr);
            console.warn("[seed-demo] Enriched draft generation failed:", draftMsg);
          }
        }
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        console.warn("[seed-demo] Calendly seed failed:", msg);
      }
    } else {
      console.log("[seed-demo] Calendly not connected, skipping event seed.");
    }
  } else {
    console.log("[seed-demo] No target email found for Calendly event seed.");
  }
}

function extractEmail(fromAddress: string): string {
  const match = fromAddress.match(/<([^>]+@[^>]+)>/);
  if (match?.[1]) return match[1].trim();
  const simple = fromAddress.match(/[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/i);
  return simple?.[0]?.trim() ?? fromAddress;
}

function extractName(fromAddress: string): string {
  const match = fromAddress.match(/^([^<]+)</);
  if (match?.[1]) return match[1].trim().replace(/^["']|["']$/g, "");
  const local = fromAddress.match(/^([^@]+)/);
  return local?.[1]?.trim() ?? fromAddress;
}

main().catch((err) => {
  console.error("[seed-demo] Fatal error:", err);
  process.exit(1);
});
