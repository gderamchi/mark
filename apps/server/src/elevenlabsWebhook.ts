import { Router, type Request, type Response } from "express";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";

import type { AuditService } from "./audit.js";
import type { ComposioService, AgentToolDefinition } from "./composio.js";
import type { EnvConfig } from "./env.js";

type WebhookDeps = {
  env: EnvConfig;
  composio: ComposioService;
  audit: AuditService;
};

export function createElevenLabsWebhookRouter(deps: WebhookDeps): Router {
  const { env, composio, audit } = deps;
  const router = Router();
  const secret = env.elevenLabsWebhookSecret;

  const db: SupabaseClient | null =
    env.supabaseUrl && env.supabaseServiceRoleKey
      ? createClient(env.supabaseUrl, env.supabaseServiceRoleKey, {
          auth: { persistSession: false, autoRefreshToken: false }
        })
      : null;

  function verifySecret(req: Request, res: Response): boolean {
    if (!secret) {
      return true;
    }
    const auth = req.header("authorization") ?? "";
    const token = auth.startsWith("Bearer ") ? auth.slice(7).trim() : auth.trim();
    if (token !== secret) {
      res.status(401).json({ error: "Unauthorized" });
      return false;
    }
    return true;
  }

  // POST /v1/el/composio — execute a Composio tool on behalf of a user
  router.post("/v1/el/composio", async (req: Request, res: Response) => {
    console.log("[el-webhook] POST /v1/el/composio incoming");
    if (!verifySecret(req, res)) {
      console.warn("[el-webhook] auth rejected");
      return;
    }

    const rawBody = req.body as {
      tool_name?: string;
      parameters?: Record<string, unknown> | string;
      user_id?: string;
    };
    const tool_name = rawBody.tool_name;
    const user_id = rawBody.user_id;
    console.log("[el-webhook] tool=%s user=%s params_type=%s", tool_name, user_id, typeof rawBody.parameters);

    // Parameters can come as a JSON string (from ElevenLabs) or an object (direct calls)
    let parameters: Record<string, unknown> = {};
    if (typeof rawBody.parameters === "string") {
      try {
        parameters = JSON.parse(rawBody.parameters) as Record<string, unknown>;
      } catch {
        console.warn("[el-webhook] failed to parse parameters JSON string:", rawBody.parameters);
        parameters = {};
      }
    } else if (rawBody.parameters && typeof rawBody.parameters === "object") {
      parameters = rawBody.parameters;
    }

    if (!tool_name || !user_id) {
      console.warn("[el-webhook] missing tool_name or user_id");
      res.status(400).json({ error: "tool_name and user_id are required" });
      return;
    }

    // Demo mode: intercept GMAIL_FETCH_EMAILS → return DB data
    if (env.demoMode && tool_name === "GMAIL_FETCH_EMAILS" && db) {
      console.log("[el-webhook] DEMO_MODE: intercepting GMAIL_FETCH_EMAILS from DB");
      try {
        const [emailsRes, draftsRes, calEventsRes] = await Promise.all([
          db
            .from("user_recent_emails")
            .select("message_id, from_address, to_address, subject, snippet, received_at, label_ids, importance, importance_reason")
            .eq("user_id", user_id)
            .order("received_at", { ascending: false })
            .limit(20),
          db
            .from("user_email_drafts")
            .select("message_id, draft_body")
            .eq("user_id", user_id),
          db
            .from("user_demo_calendar_events")
            .select("linked_message_id, start_time, end_time, calendly_link")
            .eq("user_id", user_id)
        ]);

        type DraftLookup = { message_id: string; draft_body: string };
        const draftLookup = new Map<string, string>();
        for (const d of (draftsRes.data ?? []) as DraftLookup[]) {
          draftLookup.set(d.message_id, d.draft_body);
        }

        type CalEventLookup = { linked_message_id: string; start_time: string; end_time: string; calendly_link: string };
        const calLookup = new Map<string, CalEventLookup>();
        for (const c of (calEventsRes.data ?? []) as CalEventLookup[]) {
          if (c.linked_message_id) calLookup.set(c.linked_message_id, c);
        }

        type DbEmail = {
          message_id: string;
          from_address: string;
          to_address: string;
          subject: string;
          snippet: string;
          received_at: string;
          label_ids: string[];
          importance: string;
          importance_reason: string;
        };

        const messages = ((emailsRes.data ?? []) as DbEmail[]).map((e) => {
          const calEvent = calLookup.get(e.message_id);
          return {
            messageId: e.message_id,
            from: e.from_address,
            to: e.to_address,
            subject: e.subject,
            date: e.received_at,
            snippet: e.snippet,
            labelIds: e.label_ids,
            importance: e.importance,
            importanceReason: e.importance_reason,
            hasDraft: draftLookup.has(e.message_id),
            draftPreview: draftLookup.get(e.message_id)?.slice(0, 200) ?? null,
            ...(calEvent ? {
              suggestedSlot: `${calEvent.start_time} - ${calEvent.end_time}`,
              calendlyLink: calEvent.calendly_link
            } : {})
          };
        });

        console.log("[el-webhook] DEMO_MODE: returning %d emails from DB", messages.length);
        res.json({ ok: true, result: { data: { messages } } });
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        console.error("[el-webhook] DEMO_MODE: DB fetch failed:", message);
        res.status(500).json({ error: message });
      }
      return;
    }

    // Demo mode: block mutating Gmail actions → simulate success
    if (env.demoMode && tool_name.startsWith("GMAIL_") && /(SEND|REPLY|CREATE|DELETE)/.test(tool_name)) {
      console.log("[el-webhook] DEMO_MODE: simulating %s", tool_name);
      res.json({ ok: true, result: { data: { success: true, message: "Action completed successfully." } } });
      return;
    }

    // Demo mode: intercept Slack READ calls → return DB data (writes pass through live)
    if (env.demoMode && tool_name.startsWith("SLACK_") && /(LIST|SEARCH|GET|FETCH)/.test(tool_name) && db) {
      console.log("[el-webhook] DEMO_MODE: intercepting %s from DB", tool_name);
      try {
        if (/LIST.*CHANNEL/i.test(tool_name)) {
          // Return distinct channels from cached messages
          const { data: channelRows } = await db
            .from("user_recent_slack_messages")
            .select("channel_id, channel_name")
            .eq("user_id", user_id);

          const seen = new Set<string>();
          const channels = (channelRows ?? [])
            .filter((r: { channel_id: string }) => {
              if (seen.has(r.channel_id)) return false;
              seen.add(r.channel_id);
              return true;
            })
            .map((r: { channel_id: string; channel_name: string }) => ({
              id: r.channel_id,
              name: r.channel_name
            }));

          console.log("[el-webhook] DEMO_MODE: returning %d channels from DB", channels.length);
          res.json({ ok: true, result: { data: { channels } } });
        } else {
          // Search / get messages → return cached messages
          const { data: msgRows } = await db
            .from("user_recent_slack_messages")
            .select("channel_name, sender_name, message_text, received_at, message_ts")
            .eq("user_id", user_id)
            .order("received_at", { ascending: false })
            .limit(20);

          const messages = (msgRows ?? []).map(
            (r: { channel_name: string; sender_name: string; message_text: string; received_at: string; message_ts: string }) => ({
              channel: r.channel_name,
              user: r.sender_name,
              text: r.message_text,
              ts: r.message_ts
            })
          );

          console.log("[el-webhook] DEMO_MODE: returning %d messages from DB", messages.length);
          res.json({ ok: true, result: { data: { messages: { matches: messages } } } });
        }
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        console.error("[el-webhook] DEMO_MODE: Slack DB fetch failed:", message);
        res.status(500).json({ error: message });
      }
      return;
    }

    // Demo mode: intercept Calendly READ calls → return pre-seeded availability from DB
    if (env.demoMode && tool_name.startsWith("CALENDLY_") && db) {
      // CREATE_SCHEDULING_LINK → return the pre-seeded calendly_link
      if (/CREATE_SCHEDULING_LINK/.test(tool_name)) {
        console.log("[el-webhook] DEMO_MODE: intercepting %s → returning pre-seeded link", tool_name);
        try {
          const { data: calRows } = await db
            .from("user_demo_calendar_events")
            .select("calendly_link, event_name")
            .eq("user_id", user_id)
            .limit(1);

          const row = calRows?.[0];
          const bookingUrl = row?.calendly_link ?? "https://calendly.com/demo/30min";
          res.json({
            ok: true,
            result: { data: { resource: { booking_url: bookingUrl } } }
          });
        } catch (err) {
          const message = err instanceof Error ? err.message : String(err);
          console.error("[el-webhook] DEMO_MODE: Calendly link DB fetch failed:", message);
          res.status(500).json({ error: message });
        }
        return;
      }

      // LIST / GET / AVAILABILITY → return pre-seeded event types from DB
      if (/(LIST|GET|AVAILABILITY)/.test(tool_name)) {
        console.log("[el-webhook] DEMO_MODE: intercepting %s → returning pre-seeded events", tool_name);
        try {
          const { data: calRows } = await db
            .from("user_demo_calendar_events")
            .select("event_name, start_time, end_time, attendee_email, calendly_link, linked_message_id")
            .eq("user_id", user_id);

          const events = (calRows ?? []).map((r: { event_name: string; start_time: string; end_time: string; attendee_email: string; calendly_link: string }) => ({
            uri: `https://api.calendly.com/event_types/demo-${user_id}`,
            name: r.event_name,
            scheduling_url: r.calendly_link || "https://calendly.com/demo/30min",
            start_time: r.start_time,
            end_time: r.end_time,
            attendee: r.attendee_email
          }));

          console.log("[el-webhook] DEMO_MODE: returning %d calendar events from DB", events.length);
          res.json({ ok: true, result: { data: { collection: events } } });
        } catch (err) {
          const message = err instanceof Error ? err.message : String(err);
          console.error("[el-webhook] DEMO_MODE: Calendly DB fetch failed:", message);
          res.status(500).json({ error: message });
        }
        return;
      }
    }

    if (!composio.isConfigured()) {
      res.status(503).json({ error: "Composio is not configured" });
      return;
    }

    try {
      const composioUserId = `supabase:${user_id}`;

      // Load the user's tools from DB first, fall back to live API
      let tool: AgentToolDefinition | null = null;
      let toolSource = "none";
      if (db) {
        const { data: rows, error: dbErr } = await db
          .from("user_composio_tools")
          .select("tool_name, tool_slug, toolkit_slug, description, input_schema, is_mutating")
          .eq("user_id", user_id)
          .eq("tool_slug", tool_name)
          .limit(1);

        if (dbErr) {
          console.error("[el-webhook] DB lookup error:", dbErr.message);
        }

        if (rows && rows.length > 0) {
          const row = rows[0];
          tool = {
            toolName: String(row.tool_name),
            toolSlug: String(row.tool_slug),
            description: String(row.description),
            toolkitSlug: String(row.toolkit_slug),
            inputSchema: (row.input_schema as Record<string, unknown>) ?? {},
            connectedAccountId: null,
            connectedAccountIds: [],
            isMutating: Boolean(row.is_mutating)
          };
          toolSource = "db";
          console.log("[el-webhook] tool found in DB:", tool.toolSlug);
        } else {
          console.log("[el-webhook] tool %s NOT in DB for user %s", tool_name, user_id);
        }
      }

      // Fallback: load from Composio API
      if (!tool) {
        console.log("[el-webhook] falling back to Composio API for tool lookup...");
        const toolsByName = await composio.listToolsByUser(composioUserId);
        tool = toolsByName[tool_name] ?? Object.values(toolsByName).find((t) => t.toolSlug === tool_name) ?? null;
        if (tool) {
          toolSource = "api";
          console.log("[el-webhook] tool found via API:", tool.toolSlug);
        } else {
          console.log("[el-webhook] tool %s NOT found in API either (API returned %d tools)", tool_name, Object.keys(toolsByName).length);
        }
      }

      // If tool was loaded from DB or API, fetch connected account IDs
      if (tool && tool.connectedAccountIds.length === 0) {
        console.log("[el-webhook] fetching connected accounts for tool...");
        const toolsByName = await composio.listToolsByUser(composioUserId);
        const liveTool = toolsByName[tool.toolName] ?? Object.values(toolsByName).find((t) => t.toolSlug === tool_name);
        if (liveTool) {
          tool.connectedAccountId = liveTool.connectedAccountId;
          tool.connectedAccountIds = liveTool.connectedAccountIds;
          console.log("[el-webhook] connected accounts: %d", tool.connectedAccountIds.length);
        } else {
          console.warn("[el-webhook] no connected accounts found for tool");
        }
      }

      // Last resort: tool not found in DB or API list, but we can still try to execute
      // it directly — Composio may support it if the user has the right connection.
      if (!tool) {
        const toolkit = tool_name.split("_")[0]?.toLowerCase() ?? "";
        tool = {
          toolName: tool_name,
          toolSlug: tool_name,
          description: "",
          toolkitSlug: toolkit,
          inputSchema: {},
          connectedAccountId: null,
          connectedAccountIds: [],
          isMutating: false
        };
        toolSource = "last-resort";
        console.log("[el-webhook] using last-resort synthetic tool for:", tool_name);
      }

      console.log("[el-webhook] executing: %s (source=%s) user=%s params=%s", tool.toolSlug, toolSource, composioUserId, JSON.stringify(parameters));
      const rawResult = await composio.executeTool(composioUserId, tool, parameters ?? {});

      // ElevenLabs has a 256KB response limit. Slim down the result.
      const result = slimResult(rawResult, tool.toolSlug);
      const resultSize = JSON.stringify(result).length;
      console.log("[el-webhook] success: %s result=%d bytes", tool.toolSlug, resultSize);

      await audit.logEvent({
        userId: user_id,
        sessionId: "elevenlabs-agent",
        eventType: "el_tool_executed",
        payload: { tool_name: tool.toolSlug, parameters: parameters ?? {} }
      });

      res.json({ ok: true, result });
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      const stack = err instanceof Error ? err.stack : "";
      console.error("[el-webhook] tool execution failed:", message);
      console.error("[el-webhook] stack:", stack);
      console.error("[el-webhook] tool:", tool_name, "user:", user_id, "params:", JSON.stringify(parameters));
      res.status(500).json({ error: message });
    }
  });

  // POST /v1/el/context — get user context for the ElevenLabs agent
  router.post("/v1/el/context", async (req: Request, res: Response) => {
    console.log("[el-webhook] POST /v1/el/context incoming");
    if (!verifySecret(req, res)) {
      console.warn("[el-webhook] context auth rejected");
      return;
    }

    const { user_id } = req.body as { user_id?: string };
    if (!user_id) {
      console.warn("[el-webhook] context missing user_id");
      res.status(400).json({ error: "user_id is required" });
      return;
    }
    console.log("[el-webhook] context for user:", user_id);

    if (!db) {
      console.warn("[el-webhook] no DB, returning empty context");
      res.json({ connections: [], recent_actions: [], recent_events: [] });
      return;
    }

    try {
      const [connectionsResult, actionsResult, eventsResult] = await Promise.all([
        db
          .from("user_composio_connections")
          .select("toolkit_slug, toolkit_name, status, synced_at")
          .eq("user_id", user_id)
          .eq("status", "ACTIVE")
          .order("toolkit_name"),
        db
          .from("agent_action_executions")
          .select("tool_slug, outcome, result_payload, created_at")
          .eq("user_id", user_id)
          .order("created_at", { ascending: false })
          .limit(10),
        db
          .from("agent_event_log")
          .select("event_type, payload, created_at")
          .eq("user_id", user_id)
          .order("created_at", { ascending: false })
          .limit(20)
      ]);

      const conns = connectionsResult.data ?? [];
      const actions = actionsResult.data ?? [];
      const events = eventsResult.data ?? [];
      console.log("[el-webhook] context response: %d connections, %d actions, %d events", conns.length, actions.length, events.length);
      res.json({
        connections: conns,
        recent_actions: actions,
        recent_events: events
      });
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      console.error("[el-webhook] context fetch failed:", message);
      res.status(500).json({ error: message });
    }
  });

  // POST /v1/el/draft — get pre-seeded email draft
  router.post("/v1/el/draft", async (req: Request, res: Response) => {
    console.log("[el-webhook] POST /v1/el/draft incoming");
    if (!verifySecret(req, res)) return;

    const { message_id, user_id } = req.body as { message_id?: string; user_id?: string };
    console.log("[el-webhook] get_email_draft: message_id=%s user=%s", message_id, user_id);

    if (!message_id || !user_id) {
      res.status(400).json({ error: "message_id and user_id are required" });
      return;
    }
    if (!db) {
      res.status(503).json({ error: "Database not configured" });
      return;
    }

    try {
      const { data: rows, error: dbErr } = await db
        .from("user_email_drafts")
        .select("draft_body, subject, thread_id")
        .eq("user_id", user_id)
        .eq("message_id", message_id)
        .limit(1);

      if (dbErr) {
        console.error("[el-webhook] get_email_draft DB error:", dbErr.message);
        res.status(500).json({ error: dbErr.message });
        return;
      }

      const row = rows?.[0];
      if (!row) {
        console.log("[el-webhook] get_email_draft: no draft found");
        res.json({ ok: true, result: { found: false, message: "No draft available for this email." } });
        return;
      }

      console.log("[el-webhook] get_email_draft: returning draft (%d chars)", row.draft_body?.length ?? 0);
      res.json({
        ok: true,
        result: {
          found: true,
          subject: row.subject,
          thread_id: row.thread_id,
          draft_body: row.draft_body
        }
      });
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      console.error("[el-webhook] get_email_draft failed:", message);
      res.status(500).json({ error: message });
    }
  });

  // POST /v1/el/send — send email reply (real send via Composio)
  router.post("/v1/el/send", async (req: Request, res: Response) => {
    console.log("[el-webhook] POST /v1/el/send incoming");
    if (!verifySecret(req, res)) return;

    const { message_id, user_id } = req.body as { message_id?: string; user_id?: string };
    console.log("[el-webhook] send_email_reply: message_id=%s user=%s", message_id, user_id);

    if (!message_id || !user_id) {
      res.status(400).json({ error: "message_id and user_id are required" });
      return;
    }
    if (!db) {
      res.status(503).json({ error: "Database not configured" });
      return;
    }

    try {
      const [draftRes, emailRes] = await Promise.all([
        db.from("user_email_drafts")
          .select("draft_body, subject, thread_id")
          .eq("user_id", user_id)
          .eq("message_id", message_id)
          .limit(1),
        db.from("user_recent_emails")
          .select("thread_id, from_address, subject")
          .eq("user_id", user_id)
          .eq("message_id", message_id)
          .limit(1)
      ]);

      const draft = draftRes.data?.[0];
      const email = emailRes.data?.[0];

      if (!draft?.draft_body) {
        console.warn("[el-webhook] send_email_reply: no draft found");
        res.json({ ok: true, result: { data: { success: false, message: "No draft found for this email." } } });
        return;
      }

      const threadId = draft.thread_id || email?.thread_id;
      const rawFrom = email?.from_address ?? "";
      // Extract bare email from "Name <email>" format
      const emailMatch = rawFrom.match(/<([^>]+)>/);
      const recipientEmail = emailMatch?.[1] ?? rawFrom.replace(/^.*<|>.*$/g, "").trim();

      console.log("[el-webhook] send_email_reply: sending via GMAIL_REPLY_TO_THREAD (thread=%s, to=%s, %d chars)", threadId, recipientEmail, draft.draft_body.length);

      const composioUserId = `supabase:${user_id}`;
      const sendResult = await composio.executeToolDirect(composioUserId, "GMAIL_REPLY_TO_THREAD", {
        thread_id: threadId,
        message_body: draft.draft_body,
        recipient_email: recipientEmail
      });
      console.log("[el-webhook] send_email_reply: Composio result:", JSON.stringify(sendResult).slice(0, 500));

      console.log("[el-webhook] send_email_reply: sent successfully");
      res.json({
        ok: true,
        result: {
          data: {
            success: true,
            message: "Email reply sent successfully.",
            sent_body: draft.draft_body,
            subject: draft.subject || email?.subject || "",
            thread_id: threadId
          }
        }
      });
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      console.error("[el-webhook] send_email_reply failed:", message);
      res.status(500).json({ error: message });
    }
  });

  return router;
}

type EmailMessage = {
  messageId?: string;
  messageText?: string;
  messageTimestamp?: string;
  labelIds?: string[];
  payload?: {
    headers?: Array<{ name: string; value: string }>;
    [key: string]: unknown;
  };
  [key: string]: unknown;
};

/**
 * Slim down Composio results to stay within ElevenLabs' 256KB response limit.
 * For email results, strip heavy headers/payload and keep only essential fields.
 */
function slimResult(raw: unknown, toolSlug: string): unknown {
  if (!raw || typeof raw !== "object") return raw;

  const data = raw as Record<string, unknown>;

  // Handle email results
  if (toolSlug.startsWith("GMAIL_") && data.data && typeof data.data === "object") {
    const inner = data.data as Record<string, unknown>;
    const messages = inner.messages as EmailMessage[] | undefined;
    if (Array.isArray(messages)) {
      inner.messages = messages.map((msg) => {
        const headers = msg.payload?.headers ?? [];
        const getHeader = (name: string) => headers.find((h) => h.name === name)?.value ?? "";
        return {
          messageId: msg.messageId,
          from: getHeader("From"),
          to: getHeader("To"),
          subject: getHeader("Subject"),
          date: msg.messageTimestamp || getHeader("Date"),
          snippet: (msg.messageText ?? "").slice(0, 300),
          labelIds: msg.labelIds
        };
      });
      return data;
    }
  }

  // Generic: truncate if too large
  const json = JSON.stringify(raw);
  if (json.length > 200_000) {
    return { summary: "Result too large. Showing truncated version.", data: json.slice(0, 100_000) };
  }

  return raw;
}
