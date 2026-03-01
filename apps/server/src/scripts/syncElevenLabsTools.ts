/**
 * Standalone script to sync Composio tools from DB to ElevenLabs agent.
 *
 * Usage: pnpm sync-el-tools [--user-id <uuid>]
 *
 * Creates a single "execute_tool" webhook + "get_context" webhook,
 * and puts available tool descriptions in the agent system prompt.
 */
import { createClient } from "@supabase/supabase-js";

import { getEnvConfig } from "../env.js";
import { ElevenLabsAgentService } from "../elevenlabsAgent.js";

const env = getEnvConfig();

if (!env.supabaseUrl || !env.supabaseServiceRoleKey) {
  console.error("SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY are required.");
  process.exit(1);
}

if (!env.elevenLabsApiKey || !env.elevenLabsAgentId) {
  console.error("ELEVENLABS_API_KEY and ELEVENLABS_AGENT_ID are required.");
  process.exit(1);
}

if (!env.elevenLabsWebhookSecret) {
  console.error("ELEVENLABS_WEBHOOK_SECRET is required.");
  process.exit(1);
}

if (!env.publicServerUrl) {
  console.error("PUBLIC_SERVER_URL is required (e.g. https://mark.example.com).");
  process.exit(1);
}

// Only describe essential tools in the agent prompt.
const ESSENTIAL_TOOL_SLUGS = new Set([
  "GMAIL_FETCH_EMAILS",
  "GMAIL_FETCH_MESSAGE_BY_THREAD_ID",
  "GMAIL_SEND_EMAIL",
  "GMAIL_REPLY_TO_THREAD",
  "GMAIL_CREATE_EMAIL_DRAFT",
  "GMAIL_LIST_LABELS",
  "GOOGLECALENDAR_FIND_EVENT",
  "GOOGLECALENDAR_CREATE_EVENT",
  "GOOGLECALENDAR_LIST_CALENDARS",
  "SLACK_SENDS_A_MESSAGE_TO_A_SLACK_CHANNEL",
  "SLACK_LIST_SLACK_CHANNELS",
  "SLACK_SEARCH_FOR_MESSAGES_MATCHING_A_QUERY_IN_SLACK",
  "CALENDLY_LIST_EVENT_TYPES",
  "CALENDLY_GET_EVENT_TYPE",
  "CALENDLY_CREATE_SCHEDULING_LINK",
]);

const userIdArg = (() => {
  const idx = process.argv.indexOf("--user-id");
  return idx >= 0 && process.argv[idx + 1] ? process.argv[idx + 1] : null;
})();

const db = createClient(env.supabaseUrl, env.supabaseServiceRoleKey, {
  auth: { persistSession: false, autoRefreshToken: false }
});

const el = new ElevenLabsAgentService(env);
const webhookUrl = `${env.publicServerUrl}/v1/el/composio`;
const draftUrl = `${env.publicServerUrl}/v1/el/draft`;
const sendUrl = `${env.publicServerUrl}/v1/el/send`;
const contextUrl = `${env.publicServerUrl}/v1/el/context`;
const secret = env.elevenLabsWebhookSecret;

async function main() {
  // 1. Load tools from DB
  let query = db.from("user_composio_tools").select("tool_name, tool_slug, toolkit_slug, description, input_schema");
  if (userIdArg) {
    query = query.eq("user_id", userIdArg);
  }
  const { data: dbTools, error } = await query;
  if (error) {
    console.error("Failed to load tools from DB:", error.message);
    process.exit(1);
  }

  if (!dbTools || dbTools.length === 0) {
    console.log("No tools found in DB. Make sure the Composio sync has run at least once.");
    return;
  }

  // Deduplicate and filter
  const uniqueTools = new Map<string, (typeof dbTools)[number]>();
  for (const tool of dbTools) {
    const slug = String(tool.tool_slug);
    if (!uniqueTools.has(slug) && ESSENTIAL_TOOL_SLUGS.has(slug)) {
      uniqueTools.set(slug, tool);
    }
  }

  console.log(`Found ${dbTools.length} total tools, ${uniqueTools.size} essential.`);

  // Build tool descriptions for the system prompt
  const toolDescriptions = [...uniqueTools.values()].map((t) => {
    const slug = String(t.tool_slug);
    const desc = String(t.description).slice(0, 200);
    const schema = t.input_schema as Record<string, unknown> | null;
    const props = schema?.properties as Record<string, unknown> | undefined;
    const params = props ? Object.keys(props).join(", ") : "none";
    return `- ${slug}: ${desc} [params: ${params}]`;
  }).join("\n");

  // 2. List existing ElevenLabs tools
  const existingTools = await el.listTools();
  const existingByName = new Map(existingTools.map((t) => [t.tool_config?.name, t]));
  const toolIds: string[] = [];

  // 3. Create/update "execute_tool" webhook
  const execToolName = "execute_tool";
  const execDescription = "Execute a Composio tool. Pass tool_name (exact slug) and parameters as a JSON object.";
  const execSchema = {
    type: "object",
    properties: {
      tool_name: { type: "string", description: "Exact tool slug, e.g. GMAIL_FETCH_EMAILS" },
      parameters: { type: "string", description: "JSON string of tool parameters, e.g. {\"query\": \"newer_than:1h\"}" },
      user_id: { type: "string", default: "{{user_id}}", description: "User ID (auto-injected)" }
    },
    required: ["tool_name", "parameters", "user_id"]
  };

  const existingExec = existingByName.get(execToolName);
  if (existingExec) {
    console.log("  Updating tool: execute_tool");
    const updated = await el.updateTool(existingExec.id, {
      name: execToolName,
      description: execDescription,
      webhookUrl,
      secret,
      requestBodySchema: execSchema
    });
    toolIds.push(updated.id);
  } else {
    console.log("  Creating tool: execute_tool");
    const created = await el.createTool({
      name: execToolName,
      description: execDescription,
      webhookUrl,
      secret,
      requestBodySchema: execSchema
    });
    toolIds.push(created.id);
  }

  // 3b. Create/update "get_email_draft" webhook
  const draftToolName = "get_email_draft";
  const draftDescription = "Get a pre-prepared email draft for a specific email. Returns the full draft body ready to read to the user.";
  const draftSchema = {
    type: "object",
    properties: {
      message_id: { type: "string", description: "The message_id of the email to get the draft for" },
      user_id: { type: "string", default: "{{user_id}}", description: "User ID (auto-injected)" }
    },
    required: ["message_id", "user_id"]
  };

  const existingDraft = existingByName.get(draftToolName);
  if (existingDraft) {
    console.log("  Updating tool: get_email_draft");
    const updated = await el.updateTool(existingDraft.id, {
      name: draftToolName,
      description: draftDescription,
      webhookUrl: draftUrl,
      secret,
      requestBodySchema: draftSchema
    });
    toolIds.push(updated.id);
  } else {
    console.log("  Creating tool: get_email_draft");
    const created = await el.createTool({
      name: draftToolName,
      description: draftDescription,
      webhookUrl: draftUrl,
      secret,
      requestBodySchema: draftSchema
    });
    toolIds.push(created.id);
  }

  // 3c. Create/update "send_email_reply" webhook
  const sendToolName = "send_email_reply";
  const sendDescription = "Send an email reply. Fetches the prepared draft and simulates sending it. Always call get_email_draft first and read the draft to the user before calling this.";
  const sendSchema = {
    type: "object",
    properties: {
      message_id: { type: "string", description: "The message_id of the email to reply to" },
      user_id: { type: "string", default: "{{user_id}}", description: "User ID (auto-injected)" }
    },
    required: ["message_id", "user_id"]
  };

  const existingSend = existingByName.get(sendToolName);
  if (existingSend) {
    console.log("  Updating tool: send_email_reply");
    const updated = await el.updateTool(existingSend.id, {
      name: sendToolName,
      description: sendDescription,
      webhookUrl: sendUrl,
      secret,
      requestBodySchema: sendSchema
    });
    toolIds.push(updated.id);
  } else {
    console.log("  Creating tool: send_email_reply");
    const created = await el.createTool({
      name: sendToolName,
      description: sendDescription,
      webhookUrl: sendUrl,
      secret,
      requestBodySchema: sendSchema
    });
    toolIds.push(created.id);
  }

  // 4. Create/update "get_context" webhook
  const ctxName = "get_context";
  const ctxDescription = "Get user context: active connections, recent actions, and event history.";
  const ctxSchema = {
    type: "object",
    properties: {
      user_id: { type: "string", default: "{{user_id}}", description: "User ID (auto-injected)" }
    },
    required: ["user_id"]
  };

  const existingCtx = existingByName.get(ctxName);
  if (existingCtx) {
    console.log("  Updating tool: get_context");
    const updated = await el.updateTool(existingCtx.id, {
      name: ctxName,
      description: ctxDescription,
      webhookUrl: contextUrl,
      secret,
      requestBodySchema: ctxSchema
    });
    toolIds.push(updated.id);
  } else {
    console.log("  Creating tool: get_context");
    const created = await el.createTool({
      name: ctxName,
      description: ctxDescription,
      webhookUrl: contextUrl,
      secret,
      requestBodySchema: ctxSchema
    });
    toolIds.push(created.id);
  }

  // 5. Update agent: set tool IDs and embed tool catalog in the prompt
  const basePrompt = `You are Mark, a voice-first action assistant.
You speak English only. Always respond in English.

The current user ID is: {{user_id}}
Always pass this user_id when calling any tool.

Startup context (pre-loaded from the user's data):
{{startup_context}}

Startup behavior:
- You already have the user's connected apps and recent emails above. DO NOT call get_context or GMAIL_FETCH_EMAILS at the start — the data is already provided.
- Your first message is already set via dynamic variable. Just follow up naturally based on what the user says.

Rules:
- Use tools whenever they can provide concrete data.
- For reads (search, list, get): call the tool and summarize clearly.
- If the request is ambiguous between multiple apps, ask a short clarifying question.
- Keep responses short (1-3 sentences), natural, and easy to listen to.
- Never make up data.
- When showing emails, read the sender, subject, and a brief snippet. Ask what the user wants to do.
- When the user asks to "process" or "go through" emails, read each one briefly and ask what to do: reply, archive, skip, draft a response, etc.
- Pass tool parameters as a JSON string to the execute_tool function.
- For Calendly: use CALENDLY_LIST_EVENT_TYPES, CALENDLY_GET_EVENT_TYPE, or CALENDLY_CREATE_SCHEDULING_LINK to check availability or generate scheduling links.

Email reply flow (IMPORTANT — follow this exact sequence):
1. Look up the message_id from the startup context above (each email has [message_id: xxx]). Use the EXACT message_id string — do NOT invent or guess IDs.
2. Call get_email_draft with that exact message_id to retrieve the prepared draft.
3. Read the draft aloud to the user in a natural way. Summarize it briefly, don't read it word for word.
4. Ask the user: "Should I send this?" or "Want me to send it?"
5. Only after the user confirms, call send_email_reply with the same message_id.
6. Confirm to the user that the reply was sent.
- NEVER skip step 2. Always fetch the draft first.
- NEVER send without explicit user confirmation.
- NEVER invent a message_id. Only use IDs from the startup context.

Available tools:
${toolDescriptions}`;

  console.log(`\nUpdating agent with ${toolIds.length} tool(s) and ${uniqueTools.size} tool descriptions in prompt...`);
  await el.updateAgent({
    conversation_config: {
      agent: {
        first_message: "{{first_message}}",
        language: "en",
        prompt: {
          prompt: basePrompt,
          tool_ids: toolIds
        }
      },
      conversation: {
        max_duration_seconds: 1800
      },
      turn: {
        turn_timeout: 10
      }
    },
    platform_settings: {
      overrides: {
        conversation_config_override: {
          agent: {
            first_message: true
          }
        }
      }
    }
  });

  console.log("Done. Agent updated.");
}

main().catch((err) => {
  console.error("Fatal error:", err);
  process.exit(1);
});
