import { createClient, type SupabaseClient } from "@supabase/supabase-js";

import type { ComposioService } from "./composio.js";
import type { EnvConfig } from "./env.js";
import type { TriageInputEmail } from "./gmailInboxTriage.js";
import { GmailPriorityLlmClassifier } from "./gmailPriorityLlm.js";

export class ComposioSyncService {
  private readonly db: SupabaseClient | null;
  private readonly classifier: GmailPriorityLlmClassifier;
  private warned = false;

  constructor(
    private readonly env: EnvConfig,
    private readonly composio: ComposioService
  ) {
    this.classifier = new GmailPriorityLlmClassifier(env);
    if (env.supabaseUrl && env.supabaseServiceRoleKey) {
      this.db = createClient(env.supabaseUrl, env.supabaseServiceRoleKey, {
        auth: { persistSession: false, autoRefreshToken: false }
      });
    } else {
      this.db = null;
    }
  }

  isConfigured(): boolean {
    return Boolean(this.db) && this.composio.isConfigured();
  }

  async syncAllUsers(): Promise<void> {
    if (this.env.demoMode) {
      console.info("[composio-sync] DEMO_MODE active, skipping sync");
      return;
    }

    if (!this.db || !this.composio.isConfigured()) {
      return;
    }

    const seen = new Map<string, string>();

    // Source 1: users already known in the connections table
    const { data: rows, error } = await this.db
      .from("user_composio_connections")
      .select("user_id, composio_user_id")
      .order("synced_at", { ascending: false });

    if (error) {
      this.warnOnce(`composio sync: failed to list known users: ${error.message}`);
    }
    for (const row of rows ?? []) {
      const userId = String(row.user_id);
      if (!seen.has(userId)) {
        seen.set(userId, String(row.composio_user_id));
      }
    }

    // Source 2: all auth.users — covers first-time connections (bootstrap)
    const { data: authData, error: authError } = await this.db.auth.admin.listUsers({ perPage: 500 });
    if (authError) {
      this.warnOnce(`composio sync: failed to list auth users: ${authError.message}`);
    }
    for (const user of authData?.users ?? []) {
      if (!seen.has(user.id)) {
        seen.set(user.id, `supabase:${user.id}`);
      }
    }

    if (seen.size === 0) {
      return;
    }

    console.info(`[composio-sync] syncing ${seen.size} user(s)`);

    for (const [userId, composioUserId] of seen) {
      try {
        await this.syncUser(userId, composioUserId);
      } catch (err) {
        console.error(`[composio-sync] failed for user ${userId}:`, err);
      }
    }

    console.info("[composio-sync] sync complete");
  }

  async syncUser(userId: string, composioUserId: string): Promise<void> {
    if (!this.db || !this.composio.isConfigured()) {
      return;
    }

    await Promise.all([
      this.syncConnections(userId, composioUserId),
      this.syncTools(userId, composioUserId),
      this.syncRecentEmails(userId, composioUserId),
      this.syncRecentSlackMessages(userId, composioUserId)
    ]);
  }

  private async syncConnections(userId: string, composioUserId: string): Promise<void> {
    if (!this.db) {
      return;
    }

    const connections = await this.composio.listConnections(composioUserId);
    const now = new Date().toISOString();
    const liveIds = new Set<string>();

    for (const conn of connections) {
      liveIds.add(conn.connectedAccountId);
      const { error } = await this.db.from("user_composio_connections").upsert(
        {
          user_id: userId,
          composio_user_id: composioUserId,
          connected_account_id: conn.connectedAccountId,
          toolkit_slug: conn.toolkitSlug,
          toolkit_name: conn.toolkitName,
          status: conn.status,
          auth_scheme: null,
          synced_at: now
        },
        { onConflict: "user_id,connected_account_id" }
      );
      if (error) {
        this.warnOnce(`composio sync connections upsert: ${error.message}`);
      }
    }

    // Remove stale connections
    const { data: existing } = await this.db
      .from("user_composio_connections")
      .select("id, connected_account_id")
      .eq("user_id", userId);

    if (existing) {
      for (const row of existing) {
        if (!liveIds.has(String(row.connected_account_id))) {
          await this.db.from("user_composio_connections").delete().eq("id", row.id);
        }
      }
    }
  }

  private async syncTools(userId: string, composioUserId: string): Promise<void> {
    if (!this.db) {
      return;
    }

    const toolsByName = await this.composio.listToolsByUser(composioUserId);
    const now = new Date().toISOString();
    const liveSlugs = new Set<string>();

    for (const tool of Object.values(toolsByName)) {
      liveSlugs.add(tool.toolSlug);
      const { error } = await this.db.from("user_composio_tools").upsert(
        {
          user_id: userId,
          tool_name: tool.toolName,
          tool_slug: tool.toolSlug,
          toolkit_slug: tool.toolkitSlug ?? "unknown",
          description: tool.description,
          input_schema: tool.inputSchema,
          is_mutating: tool.isMutating,
          synced_at: now
        },
        { onConflict: "user_id,tool_slug" }
      );
      if (error) {
        this.warnOnce(`composio sync tools upsert: ${error.message}`);
      }
    }

    // Remove stale tools
    const { data: existing } = await this.db
      .from("user_composio_tools")
      .select("id, tool_slug")
      .eq("user_id", userId);

    if (existing) {
      for (const row of existing) {
        if (!liveSlugs.has(String(row.tool_slug))) {
          await this.db.from("user_composio_tools").delete().eq("id", row.id);
        }
      }
    }
  }

  private async syncRecentEmails(userId: string, composioUserId: string): Promise<void> {
    if (!this.db) {
      return;
    }

    // Check if user has Gmail connected
    const { data: gmailConns } = await this.db
      .from("user_composio_connections")
      .select("toolkit_slug")
      .eq("user_id", userId)
      .eq("toolkit_slug", "gmail")
      .eq("status", "ACTIVE")
      .limit(1);

    if (!gmailConns || gmailConns.length === 0) {
      console.log("[composio-sync] user %s has no active Gmail, skipping email sync", userId);
      return;
    }

    try {
      console.log("[composio-sync] fetching emails for user %s...", userId);
      const result = await this.composio.executeToolDirect(composioUserId, "GMAIL_FETCH_EMAILS", {
        query: "newer_than:1d",
        max_results: 20
      });

      type RawMessage = {
        messageId?: string;
        threadId?: string;
        messageText?: string;
        messageTimestamp?: string;
        labelIds?: string[];
        payload?: {
          headers?: Array<{ name: string; value: string }>;
        };
      };

      const messages = (result as { data?: { messages?: RawMessage[] } })?.data?.messages ?? [];
      if (messages.length === 0) {
        console.log("[composio-sync] no emails found for user %s", userId);
        return;
      }
      console.log("[composio-sync] fetched %d emails for user %s", messages.length, userId);

      const now = new Date().toISOString();
      const liveMessageIds = new Set<string>();

      for (const msg of messages) {
        const msgId = msg.messageId ?? "";
        if (!msgId) continue;
        liveMessageIds.add(msgId);

        const headers = msg.payload?.headers ?? [];
        const getH = (name: string) => headers.find((h) => h.name === name)?.value ?? "";

        await this.db.from("user_recent_emails").upsert(
          {
            user_id: userId,
            message_id: msgId,
            thread_id: msg.threadId ?? null,
            from_address: getH("From"),
            to_address: getH("To"),
            subject: getH("Subject"),
            snippet: (msg.messageText ?? "").slice(0, 500),
            received_at: msg.messageTimestamp ?? null,
            label_ids: msg.labelIds ?? [],
            synced_at: now
          },
          { onConflict: "user_id,message_id" }
        );
      }

      // Remove emails older than what we just fetched (keep DB clean)
      const oldestFetched = messages
        .map((m) => m.messageTimestamp)
        .filter(Boolean)
        .sort()[0];

      if (oldestFetched) {
        await this.db
          .from("user_recent_emails")
          .delete()
          .eq("user_id", userId)
          .lt("received_at", oldestFetched);
      }

      // Classify email importance via LLM
      if (this.classifier.isConfigured() && messages.length > 0) {
        try {
          const triageInputs: TriageInputEmail[] = messages
            .filter((m) => m.messageId)
            .map((m) => {
              const headers = m.payload?.headers ?? [];
              const getH = (name: string) => headers.find((h) => h.name === name)?.value ?? "";
              return {
                id: m.messageId!,
                from: getH("From"),
                subject: getH("Subject"),
                timestamp: m.messageTimestamp ?? null,
                snippet: (m.messageText ?? "").slice(0, 500),
                labelIds: m.labelIds ?? []
              };
            });

          console.log("[composio-sync] classifying %d emails for user %s", triageInputs.length, userId);
          const decisions = await this.classifier.classify(triageInputs);

          for (const [msgId, decision] of Object.entries(decisions)) {
            await this.db
              .from("user_recent_emails")
              .update({ importance: decision.category, importance_reason: decision.reason })
              .eq("user_id", userId)
              .eq("message_id", msgId);
          }
          console.log("[composio-sync] classified %d/%d emails for user %s", Object.keys(decisions).length, triageInputs.length, userId);
        } catch (classifyErr) {
          const msg = classifyErr instanceof Error ? classifyErr.message : String(classifyErr);
          console.warn(`[composio-sync] email classification failed for ${userId}: ${msg}`);
        }
      }
    } catch (err) {
      // Non-fatal: email sync might fail if Gmail isn't fully connected
      const msg = err instanceof Error ? err.message : String(err);
      console.warn(`[composio-sync] email sync failed for ${userId}: ${msg}`);
    }
  }

  private async syncRecentSlackMessages(userId: string, composioUserId: string): Promise<void> {
    if (!this.db) {
      return;
    }

    // Check if user has Slack connected
    const { data: slackConns } = await this.db
      .from("user_composio_connections")
      .select("toolkit_slug")
      .eq("user_id", userId)
      .eq("toolkit_slug", "slack")
      .eq("status", "ACTIVE")
      .limit(1);

    if (!slackConns || slackConns.length === 0) {
      console.log("[composio-sync] user %s has no active Slack, skipping slack sync", userId);
      return;
    }

    try {
      console.log("[composio-sync] fetching Slack channels for user %s...", userId);
      const channelsResult = await this.composio.executeToolDirect(composioUserId, "SLACK_LIST_SLACK_CHANNELS", {
        limit: 20
      });

      type RawChannel = { id?: string; name?: string; num_members?: number };
      const channels = (
        (channelsResult as { data?: { channels?: RawChannel[] } })?.data?.channels ?? []
      )
        .filter((ch): ch is RawChannel & { id: string; name: string } => Boolean(ch.id && ch.name))
        .sort((a, b) => (b.num_members ?? 0) - (a.num_members ?? 0))
        .slice(0, 5);

      if (channels.length === 0) {
        console.log("[composio-sync] no Slack channels found for user %s", userId);
        return;
      }

      console.log("[composio-sync] searching messages in %d Slack channels for user %s", channels.length, userId);

      const now = new Date().toISOString();

      for (const channel of channels) {
        try {
          const searchResult = await this.composio.executeToolDirect(
            composioUserId,
            "SLACK_SEARCH_FOR_MESSAGES_MATCHING_A_QUERY_IN_SLACK",
            { query: `in:#${channel.name}`, count: 10 }
          );

          type RawSlackMatch = {
            ts?: string;
            text?: string;
            username?: string;
            user?: string;
          };
          const matches =
            (searchResult as { data?: { messages?: { matches?: RawSlackMatch[] } } })?.data?.messages?.matches ?? [];

          for (const msg of matches) {
            const ts = msg.ts ?? "";
            if (!ts) continue;

            await this.db.from("user_recent_slack_messages").upsert(
              {
                user_id: userId,
                message_ts: ts,
                channel_id: channel.id,
                channel_name: channel.name,
                sender_name: msg.username ?? "",
                sender_id: msg.user ?? "",
                message_text: (msg.text ?? "").slice(0, 2000),
                received_at: ts ? new Date(Number(ts.split(".")[0]) * 1000).toISOString() : null,
                synced_at: now
              },
              { onConflict: "user_id,channel_id,message_ts" }
            );
          }

          console.log(
            "[composio-sync] synced %d messages from #%s for user %s",
            matches.length,
            channel.name,
            userId
          );
        } catch (channelErr) {
          const msg = channelErr instanceof Error ? channelErr.message : String(channelErr);
          console.warn(`[composio-sync] slack channel #${channel.name} sync failed: ${msg}`);
        }
      }
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      console.warn(`[composio-sync] slack sync failed for ${userId}: ${msg}`);
    }
  }

  private warnOnce(message: string): void {
    if (this.warned) {
      return;
    }
    this.warned = true;
    console.warn(message);
  }
}
