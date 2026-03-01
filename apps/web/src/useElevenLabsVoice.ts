import { useConversation } from "@elevenlabs/react";
import { useCallback, useEffect, useRef, useState } from "react";

import { buildApiUrl, normalizeApiBaseUrl } from "./apiBaseUrl";

const API_BASE_URL = normalizeApiBaseUrl(import.meta.env.VITE_API_BASE_URL);

export type EmailFeedItem = {
  from: string;
  subject: string;
  importance: "must_know" | "respond_needed" | "optional";
  reason: string;
  hasDraft?: boolean;
};

type ElevenLabsVoiceState = {
  status: "disconnected" | "connecting" | "connected" | "disconnecting";
  isSpeaking: boolean;
  agentTranscript: string;
  userTranscript: string;
  error: string | null;
  emailFeed: EmailFeedItem[];
};

type ElevenLabsVoiceApi = ElevenLabsVoiceState & {
  start: () => Promise<void>;
  stop: () => Promise<void>;
};

export function useElevenLabsVoice(accessToken: string | null): ElevenLabsVoiceApi {
  const [agentTranscript, setAgentTranscript] = useState("");
  const [userTranscript, setUserTranscript] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [emailFeed, setEmailFeed] = useState<EmailFeedItem[]>([]);
  const startedRef = useRef(false);
  const stoppingRef = useRef(false);
  const conversationRef = useRef<ReturnType<typeof useConversation> | null>(null);

  const conversation = useConversation({
    onConnect: () => {
      console.log("[el-voice] connected");
      setError(null);
    },
    onDisconnect: () => {
      const wasStarted = startedRef.current;
      const wasStopping = stoppingRef.current;
      console.log("[el-voice] disconnected (wasStarted=%s, wasStopping=%s)", wasStarted, wasStopping);
      startedRef.current = false;
      stoppingRef.current = false;

      // If user manually stopped, no error
      if (!wasStarted || wasStopping) return;

      // Unexpected disconnect — let user click Start again
      setError("Voice session disconnected. Click Start to reconnect.");
    },
    onError: (message: string) => {
      if (/CLOSING or CLOSED/.test(message)) return;
      console.error("[el-voice] error:", message);
      setError(message);
    },
    onMessage: (props: { source: string; message: string }) => {
      if (props.source === "ai") {
        setAgentTranscript(props.message);
      } else if (props.source === "user") {
        setUserTranscript(props.message);
      }
    },
  });

  conversationRef.current = conversation;
  const accessTokenRef = useRef(accessToken);
  accessTokenRef.current = accessToken;

  const start = useCallback(async () => {
    if (startedRef.current) return;
    const token = accessTokenRef.current;
    if (!token) {
      setError("Sign in required.");
      return;
    }

    stoppingRef.current = false;
    setError(null);
    setAgentTranscript("");
    setUserTranscript("");
    setEmailFeed([]);

    try {
      await navigator.mediaDevices.getUserMedia({ audio: true });

      const res = await fetch(buildApiUrl(API_BASE_URL, "/v1/el/signed-url"), {
        headers: { authorization: `Bearer ${token}` },
      });
      if (!res.ok) {
        const text = await res.text().catch(() => "");
        throw new Error(text || `Failed to get signed URL (${res.status})`);
      }
      const data = (await res.json()) as {
        signedUrl: string;
        userId: string;
        startupContext?: string;
        firstMessage?: string;
        emailFeed?: EmailFeedItem[];
      };
      const { signedUrl, userId, startupContext, firstMessage } = data;
      console.log("[el-voice] got signed URL, starting session (context=%d chars, firstMessage=%d chars)", startupContext?.length ?? 0, firstMessage?.length ?? 0);

      setEmailFeed(data.emailFeed ?? []);
      startedRef.current = true;

      await conversationRef.current?.startSession({
        signedUrl,
        dynamicVariables: {
          user_id: userId,
          startup_context: startupContext || "No context available yet.",
          first_message: firstMessage || "Hey! What can I do for you?",
        },
      });
      console.log("[el-voice] startSession resolved");
    } catch (err) {
      startedRef.current = false;
      const message = err instanceof Error ? err.message : String(err);
      console.error("[el-voice] start failed:", message);
      setError(message);
    }
    // No deps on conversation or accessToken — use refs instead to keep
    // the callback identity stable and avoid re-renders killing the session.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const stop = useCallback(async () => {
    if (!startedRef.current) return;
    stoppingRef.current = true;
    startedRef.current = false;
    try {
      await conversationRef.current?.endSession();
    } catch {
      // WS may already be closed
    }
  }, []);

  // Cleanup on unmount
  useEffect(() => {
    return () => {
      stoppingRef.current = true;
      if (startedRef.current) {
        startedRef.current = false;
        try {
          conversationRef.current?.endSession();
        } catch {
          // safe to ignore
        }
      }
    };
  }, []);

  // Stop when token is lost
  useEffect(() => {
    if (!accessToken && startedRef.current) {
      void stop();
    }
  }, [accessToken, stop]);

  return {
    status: conversation.status,
    isSpeaking: conversation.isSpeaking,
    agentTranscript,
    userTranscript,
    error,
    emailFeed,
    start,
    stop,
  };
}
