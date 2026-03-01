import { useEffect, useMemo, useRef, useState } from "react";
import type { Session } from "@supabase/supabase-js";

import type {
  ActionHistoryItem,
  AuthMeResponse,
  ComposioCatalogItem,
  ComposioConnectionItem,
  ComposioConnectLinkResponse
} from "@mark/contracts";

import { supabase } from "./supabase";
import { useVoiceAgent } from "./useVoiceAgent";

const API_BASE_URL = import.meta.env.VITE_API_BASE_URL ?? "http://localhost:4000";

export function App() {
  const [session, setSession] = useState<Session | null>(null);
  const [user, setUser] = useState<AuthMeResponse | null>(null);
  const [catalog, setCatalog] = useState<ComposioCatalogItem[]>([]);
  const [connections, setConnections] = useState<ComposioConnectionItem[]>([]);
  const [history, setHistory] = useState<ActionHistoryItem[]>([]);
  const [catalogSearch, setCatalogSearch] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [loadingCatalog, setLoadingCatalog] = useState(false);
  const [connectingAuthConfigId, setConnectingAuthConfigId] = useState<string | null>(null);
  const [connectedBanner, setConnectedBanner] = useState<string | null>(null);

  const audioRef = useRef<HTMLAudioElement | null>(null);
  const accessToken = session?.access_token ?? null;

  const agent = useVoiceAgent(audioRef.current, accessToken);

  useEffect(() => {
    if (!supabase) {
      return;
    }

    void supabase.auth.getSession().then(({ data }) => {
      setSession(data.session ?? null);
    });

    const { data } = supabase.auth.onAuthStateChange((_event, nextSession) => {
      setSession(nextSession);
    });

    return () => {
      data.subscription.unsubscribe();
    };
  }, []);

  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    if (params.get("connected") === "1") {
      setConnectedBanner("Connection completed successfully.");
      window.history.replaceState({}, document.title, window.location.pathname);
    }
  }, []);

  useEffect(() => {
    if (!accessToken) {
      setUser(null);
      setCatalog([]);
      setConnections([]);
      setHistory([]);
      return;
    }

    void refreshAuthedData(accessToken);
  }, [accessToken]);

  useEffect(() => {
    if (!accessToken) {
      return;
    }
    const interval = window.setInterval(() => {
      void loadConnections(accessToken);
    }, 15_000);
    return () => window.clearInterval(interval);
  }, [accessToken]);

  const filteredCatalog = useMemo(() => {
    const needle = catalogSearch.trim().toLowerCase();
    if (!needle) {
      return catalog;
    }
    return catalog.filter((item) => {
      return (
        item.name.toLowerCase().includes(needle) ||
        item.toolkitName.toLowerCase().includes(needle) ||
        item.toolkitSlug.toLowerCase().includes(needle)
      );
    });
  }, [catalog, catalogSearch]);

  const connectionsByAuthConfigId = useMemo(() => {
    const map = new Map<string, ComposioConnectionItem>();
    for (const connection of connections) {
      if (connection.authConfigId) {
        map.set(connection.authConfigId, connection);
      }
    }
    return map;
  }, [connections]);

  const orbScale = 1 + Math.min(0.42, agent.audioLevel * 2.1);

  const signInWithGoogle = async (): Promise<void> => {
    if (!supabase) {
      setError("Supabase is not configured in the web app.");
      return;
    }
    const { error: signInError } = await supabase.auth.signInWithOAuth({
      provider: "google",
      options: {
        redirectTo: window.location.origin
      }
    });
    if (signInError) {
      setError(signInError.message);
    }
  };

  const signOut = async (): Promise<void> => {
    if (!supabase) {
      return;
    }
    await agent.stop();
    const { error: signOutError } = await supabase.auth.signOut();
    if (signOutError) {
      setError(signOutError.message);
    }
  };

  const connectApp = async (authConfigId: string): Promise<void> => {
    if (!accessToken) {
      return;
    }
    setConnectingAuthConfigId(authConfigId);
    try {
      const payload = await authedFetch<ComposioConnectLinkResponse>(`/v1/composio/connect-link`, accessToken, {
        method: "POST",
        headers: {
          "content-type": "application/json"
        },
        body: JSON.stringify({ authConfigId })
      });
      window.location.href = payload.redirectUrl;
    } catch (err) {
      setError(toErrorMessage(err));
      setConnectingAuthConfigId(null);
    }
  };

  async function refreshAuthedData(token: string): Promise<void> {
    setLoadingCatalog(true);
    setError(null);
    try {
      const [me, nextCatalog, nextConnections, nextHistory] = await Promise.all([
        authedFetch<AuthMeResponse>("/v1/auth/me", token),
        authedFetch<ComposioCatalogItem[]>("/v1/composio/catalog", token),
        authedFetch<ComposioConnectionItem[]>("/v1/composio/connections", token),
        authedFetch<{ items: ActionHistoryItem[] }>("/v1/actions/history", token)
      ]);

      setUser(me);
      setCatalog(nextCatalog);
      setConnections(nextConnections);
      setHistory(nextHistory.items);
    } catch (err) {
      setError(toErrorMessage(err));
    } finally {
      setLoadingCatalog(false);
    }
  }

  async function loadConnections(token: string): Promise<void> {
    try {
      const nextConnections = await authedFetch<ComposioConnectionItem[]>("/v1/composio/connections", token);
      setConnections(nextConnections);
    } catch {
      // keep last successful snapshot
    }
  }

  return (
    <div className="page">
      <div className="ambient ambient-a" />
      <div className="ambient ambient-b" />
      <div className="grain" />

      <main className="shell">
        <header className="topbar glass">
          <div>
            <p className="overline">Mark Agent</p>
            <h1>Voice + Action Runtime</h1>
            <p className="subtitle">Speechmatics STT • Anthropic • Composio • Supabase • ElevenLabs</p>
          </div>
          <div className="actions">
            {session ? (
              <>
                <span className="auth-pill">{user?.email ?? "authenticated"}</span>
                <button className="btn" onClick={() => void signOut()}>
                  Sign Out
                </button>
              </>
            ) : (
              <button className="btn btn-primary" onClick={() => void signInWithGoogle()}>
                Sign In With Google
              </button>
            )}
          </div>
        </header>

        {!session ? (
          <section className="auth-guard glass">
            <h2>Authentication Required</h2>
            <p>
              Sign in to unlock voice actions, app connections, and approval-gated execution. The voice loop remains
              protected by Supabase access tokens.
            </p>
            <button className="btn btn-primary" onClick={() => void signInWithGoogle()}>
              Continue With Google
            </button>
            {!supabase ? <p className="error">Missing `VITE_SUPABASE_URL` or `VITE_SUPABASE_ANON_KEY`.</p> : null}
          </section>
        ) : (
          <>
            <section className="status-row glass">
              <span>
                Socket: <strong>{agent.connected ? "connected" : "disconnected"}</strong>
              </span>
              <span>
                State: <strong>{agent.voiceState}</strong>
              </span>
              <span>
                STT: <strong>{agent.sttStatus?.code ?? "n/a"}</strong>
              </span>
              <span>
                Session: <strong>{agent.sessionId ?? "pending"}</strong>
              </span>
            </section>

            <div className="workspace">
              <section className="voice-stack">
                <article className="control-box glass">
                  <div className="actions">
                    {!agent.isRunning ? (
                      <button className="btn btn-primary" onClick={() => void agent.start()}>
                        Start Listening
                      </button>
                    ) : (
                      <button className="btn" onClick={() => void agent.stop()}>
                        Stop
                      </button>
                    )}
                    <button className="btn" onClick={agent.resetMemory} disabled={!agent.connected}>
                      Reset Memory
                    </button>
                  </div>
                  <p className="minor">
                    Approval policy: read tools auto-run. Mutating tools remain in draft until you approve or reject.
                  </p>
                </article>

                <section className="center">
                  <div className={`orb-wrap state-${agent.voiceState}`}>
                    <div className="orb-glow" />
                    <div className="orb" style={{ transform: `scale(${orbScale.toFixed(3)})` }}>
                      <span>{agent.voiceState}</span>
                    </div>
                  </div>
                </section>

                <section className="lanes">
                  <article className="lane glass">
                    <header>
                      <h2>Your Voice</h2>
                      <small>live transcript</small>
                    </header>
                    <p className="final-text">{agent.userFinal || "Speak to begin..."}</p>
                    <p className="partial-text">{agent.userPartial}</p>
                  </article>

                  <article className="lane glass">
                    <header>
                      <h2>Agent Voice</h2>
                      <small>live response</small>
                    </header>
                    <p className="final-text">{agent.agentFinal || "Waiting for your first prompt."}</p>
                    <p className="partial-text">{agent.agentPartial}</p>
                  </article>
                </section>
              </section>

              <aside className="side-stack">
                <section className="panel glass">
                  <header className="panel-head">
                    <h3>Connect Apps</h3>
                    <small>{catalog.length} auth configs</small>
                  </header>
                  <input
                    className="input"
                    placeholder="Search by app or toolkit"
                    value={catalogSearch}
                    onChange={(event) => setCatalogSearch(event.target.value)}
                  />
                  <div className="list">
                    {loadingCatalog ? <p className="minor">Loading catalog...</p> : null}
                    {!loadingCatalog && filteredCatalog.length === 0 ? <p className="minor">No matching apps.</p> : null}
                    {filteredCatalog.map((item) => {
                      const connection = connectionsByAuthConfigId.get(item.authConfigId);
                      const isActive = connection?.status.toUpperCase() === "ACTIVE";
                      return (
                        <article className="list-item" key={item.authConfigId}>
                          <div>
                            <p className="list-title">{item.toolkitName}</p>
                            <p className="list-meta">
                              {item.name} · {item.authScheme ?? "oauth"}
                            </p>
                          </div>
                          <div className="list-actions">
                            <span className={`pill ${isActive ? "pill-ok" : "pill-warn"}`}>
                              {connection ? connection.status.toLowerCase() : "not connected"}
                            </span>
                            <button
                              className="btn btn-xs"
                              onClick={() => void connectApp(item.authConfigId)}
                              disabled={connectingAuthConfigId === item.authConfigId}
                            >
                              {connectingAuthConfigId === item.authConfigId ? "Connecting..." : "Connect"}
                            </button>
                          </div>
                        </article>
                      );
                    })}
                  </div>
                </section>

                <section className="panel glass">
                  <header className="panel-head">
                    <h3>Pending Action</h3>
                    <small>{agent.pendingAction ? "awaiting decision" : "none"}</small>
                  </header>
                  {agent.pendingAction ? (
                    <div className="pending">
                      <p className="pending-title">{agent.pendingAction.toolSlug}</p>
                      <p className="minor">{agent.pendingAction.summary}</p>
                      <pre>{JSON.stringify(agent.pendingAction.arguments, null, 2)}</pre>
                      <div className="actions">
                        <button className="btn btn-primary" onClick={agent.approvePending}>
                          Approve
                        </button>
                        <button className="btn" onClick={() => agent.rejectPending("Rejected from UI.")}>
                          Reject
                        </button>
                      </div>
                      <p className="minor">
                        Voice edits are enabled. You can keep revising naturally, then approve when it matches intent.
                      </p>
                    </div>
                  ) : (
                    <p className="minor">No pending draft. Ask for a write action (send/create/update) to open one.</p>
                  )}
                </section>

                <section className="panel glass">
                  <header className="panel-head">
                    <h3>Action Timeline</h3>
                    <small>latest events first</small>
                  </header>
                  <div className="timeline">
                    {agent.actionTimeline.slice(0, 16).map((item) => (
                      <article className="timeline-item" key={item.id}>
                        <p className="timeline-type">{item.type}</p>
                        <p>{item.message}</p>
                        <time>{new Date(item.createdAt).toLocaleString()}</time>
                      </article>
                    ))}
                    {agent.actionTimeline.length === 0 && history.slice(0, 16).map((item) => (
                      <article className="timeline-item" key={item.id}>
                        <p className="timeline-type">{item.eventType}</p>
                        <p>{summarizePayload(item.payload)}</p>
                        <time>{new Date(item.createdAt).toLocaleString()}</time>
                      </article>
                    ))}
                    {agent.actionTimeline.length === 0 && history.length === 0 ? (
                      <p className="minor">No action events yet.</p>
                    ) : null}
                  </div>
                </section>
              </aside>
            </div>

            <section className="footer-strip glass">
              <span>
                Providers:
                {agent.health
                  ? ` STT ${agent.health.sttConfigured ? "ready" : "missing"} · LLM ${agent.health.llmConfigured ? "ready" : "missing"} · Composio ${agent.health.composioConfigured ? "ready" : "missing"} · Auth ${agent.health.authConfigured ? "ready" : "missing"} · TTS ${agent.health.ttsConfigured ? "ready" : "missing"}`
                  : " checking..."}
              </span>
              <span>{agent.sttStatus?.message ?? "No status yet."}</span>
              {connectedBanner ? <span className="ok">{connectedBanner}</span> : null}
              {agent.error || error ? <span className="error">{agent.error ?? error}</span> : null}
            </section>
          </>
        )}
      </main>

      <audio ref={audioRef} hidden playsInline />
    </div>
  );
}

async function authedFetch<T>(path: string, accessToken: string, init?: RequestInit): Promise<T> {
  const response = await fetch(`${API_BASE_URL}${path}`, {
    ...init,
    headers: {
      authorization: `Bearer ${accessToken}`,
      ...(init?.headers ?? {})
    }
  });
  if (!response.ok) {
    const text = await response.text().catch(() => "");
    throw new Error(text || `Request failed with status ${response.status}`);
  }
  return (await response.json()) as T;
}

function summarizePayload(payload: Record<string, unknown>): string {
  const keys = Object.keys(payload);
  if (keys.length === 0) {
    return "Event logged.";
  }
  return keys
    .slice(0, 4)
    .map((key) => `${key}: ${preview(payload[key])}`)
    .join(" · ");
}

function preview(value: unknown): string {
  if (typeof value === "string") {
    return value.length > 48 ? `${value.slice(0, 45)}...` : value;
  }
  if (typeof value === "number" || typeof value === "boolean") {
    return String(value);
  }
  return "[structured]";
}

function toErrorMessage(err: unknown): string {
  if (err instanceof Error) {
    return err.message;
  }
  return "Unknown error";
}
