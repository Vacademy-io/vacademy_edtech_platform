import { useState, useRef, useCallback, useEffect } from 'react';
import { AI_SERVICE_URL } from '@/constants/urls';
import { getTokenFromCookie } from '@/lib/auth/sessionUtility';
import { TokenKey } from '@/constants/auth/tokens';
import { parseAiUsageLimitBody, type AiUsageLimitBody } from '@/lib/ai-usage-limit';

type ConnectionState = 'disconnected' | 'connecting' | 'connected' | 'error';

interface VoiceWebSocketCallbacks {
  onTranscriptPartial?: (text: string) => void;
  onTranscriptFinal?: (text: string) => void;
  onAiText?: (text: string, messageId: number) => void;
  onAudioChunk?: (base64Data: string) => void;
  /** One playable audio segment has finished arriving — play it now. */
  onAudioSegmentEnd?: () => void;
  /**
   * Turn is over. `reason` is "complete", "no_speech", "no_audio" or "error";
   * `detail` names the server leg that decided it (transcode / STT / length).
   */
  onAudioEnd?: (reason: string, detail?: string) => void;
  onSummary?: (data: unknown) => void;
  onError?: (message: string) => void;
  /** An AI usage limit stopped the call (`{type:'usage_limit', …}` — the HTTP 429 body). */
  onUsageLimit?: (body: AiUsageLimitBody) => void;
  onReady?: () => void;
}

interface UseVoiceWebSocketReturn {
  connect: (sessionId: string) => void;
  disconnect: () => void;
  sendConfig: (language: string, voice: string) => void;
  sendAudioChunk: (base64Data: string) => void;
  sendAudioEnd: (mimeType?: string) => void;
  /** Drop the mic audio streamed so far — the turn had no speech in it. */
  sendAudioDiscard: () => void;
  sendInterrupt: () => void;
  sendEndSession: () => void;
  connectionState: ConnectionState;
}

function buildWsUrl(sessionId: string): string {
  // AI_SERVICE_URL is like https://host/ai-service
  // Convert to wss://host/ai-service/chat-agent/session/{id}/voice
  let wsBase = AI_SERVICE_URL;
  if (wsBase.startsWith('https://')) {
    wsBase = 'wss://' + wsBase.slice('https://'.length);
  } else if (wsBase.startsWith('http://')) {
    wsBase = 'ws://' + wsBase.slice('http://'.length);
  }
  return `${wsBase}/chat-agent/session/${sessionId}/voice`;
}

/**
 * Read the access token without awaiting Capacitor storage — the socket opens
 * inside an event handler and the token has to go out as the first message.
 */
function readAccessToken(): string {
  try {
    return (
      getTokenFromCookie(TokenKey.accessToken) ||
      localStorage.getItem(TokenKey.accessToken) ||
      ''
    );
  } catch {
    return '';
  }
}

export function useVoiceWebSocket(
  callbacks: VoiceWebSocketCallbacks,
): UseVoiceWebSocketReturn {
  const [connectionState, setConnectionState] = useState<ConnectionState>('disconnected');

  const wsRef = useRef<WebSocket | null>(null);
  const callbacksRef = useRef(callbacks);
  callbacksRef.current = callbacks;

  const reconnectAttemptRef = useRef(0);
  const reconnectTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const pingIntervalRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const pendingMessagesRef = useRef<Record<string, unknown>[]>([]);
  const sessionIdRef = useRef<string | null>(null);
  const intentionalCloseRef = useRef(false);

  const MAX_RECONNECT_ATTEMPTS = 3;

  const cleanupWs = useCallback(() => {
    if (pingIntervalRef.current !== null) {
      clearInterval(pingIntervalRef.current);
      pingIntervalRef.current = null;
    }
    if (reconnectTimerRef.current !== null) {
      clearTimeout(reconnectTimerRef.current);
      reconnectTimerRef.current = null;
    }
    if (wsRef.current) {
      // Remove handlers to avoid triggering reconnect
      wsRef.current.onopen = null;
      wsRef.current.onmessage = null;
      wsRef.current.onerror = null;
      wsRef.current.onclose = null;
      if (
        wsRef.current.readyState === WebSocket.OPEN ||
        wsRef.current.readyState === WebSocket.CONNECTING
      ) {
        wsRef.current.close();
      }
      wsRef.current = null;
    }
  }, []);

  const sendJson = useCallback((payload: Record<string, unknown>) => {
    if (wsRef.current && wsRef.current.readyState === WebSocket.OPEN) {
      wsRef.current.send(JSON.stringify(payload));
    } else {
      pendingMessagesRef.current.push(payload);
    }
  }, []);

  const handleMessage = useCallback((event: MessageEvent) => {
    try {
      const data = JSON.parse(event.data);
      const cb = callbacksRef.current;

      switch (data.type) {
        case 'transcript_partial':
          cb.onTranscriptPartial?.(data.text ?? data.content ?? '');
          break;
        case 'transcript_final':
          cb.onTranscriptFinal?.(data.text ?? data.content ?? '');
          break;
        case 'ai_text':
          cb.onAiText?.(data.text ?? data.content ?? '', data.message_id ?? data.id ?? 0);
          break;
        case 'audio_chunk':
          cb.onAudioChunk?.(data.data ?? '');
          break;
        case 'audio_segment_end':
          cb.onAudioSegmentEnd?.();
          break;
        case 'audio_end':
          if (data.reason && data.reason !== 'complete') {
            console.info('[voice-call] turn ended:', data.reason, data.detail ?? '');
          }
          cb.onAudioEnd?.(data.reason ?? 'complete', data.detail);
          break;
        case 'summary':
          cb.onSummary?.(data);
          break;
        case 'error':
          cb.onError?.(data.message ?? data.error ?? 'Unknown error');
          break;
        case 'usage_limit': {
          const body = parseAiUsageLimitBody(data) ?? { ...data, error: 'AI_USAGE_LIMIT' as const };
          if (cb.onUsageLimit) cb.onUsageLimit(body as AiUsageLimitBody);
          else cb.onError?.(body.message ?? 'AI usage limit reached');
          break;
        }
        case 'ready':
          // Flush any messages that were queued before the connection was ready
          pendingMessagesRef.current.forEach(msg => {
            wsRef.current?.send(JSON.stringify(msg));
          });
          pendingMessagesRef.current = [];
          cb.onReady?.();
          break;
        case 'pong':
          // Heartbeat response — no action needed
          break;
        default:
          console.warn('Unknown voice WS message type:', data.type, data);
      }
    } catch (err) {
      console.error('Failed to parse voice WS message:', err);
    }
  }, []);

  const connectInternal = useCallback(
    (sessionId: string) => {
      cleanupWs();
      intentionalCloseRef.current = false;

      const url = buildWsUrl(sessionId);
      setConnectionState('connecting');

      const ws = new WebSocket(url);
      wsRef.current = ws;

      ws.onopen = () => {
        reconnectAttemptRef.current = 0;
        setConnectionState('connected');

        // Identify the caller first: the server bills this session's institute
        // for every turn, so it refuses a token belonging to someone else.
        const token = readAccessToken();
        if (token) {
          ws.send(JSON.stringify({ type: 'auth', token }));
        }

        // Start heartbeat ping every 25 seconds to keep connection alive
        if (pingIntervalRef.current !== null) {
          clearInterval(pingIntervalRef.current);
        }
        pingIntervalRef.current = setInterval(() => {
          if (wsRef.current?.readyState === WebSocket.OPEN) {
            wsRef.current.send(JSON.stringify({ type: 'ping' }));
          }
        }, 25000);
      };

      ws.onmessage = handleMessage;

      ws.onerror = () => {
        setConnectionState('error');
        callbacksRef.current.onError?.('WebSocket connection error');
      };

      ws.onclose = () => {
        wsRef.current = null;

        if (intentionalCloseRef.current) {
          setConnectionState('disconnected');
          return;
        }

        // Auto-reconnect logic
        if (reconnectAttemptRef.current < MAX_RECONNECT_ATTEMPTS) {
          const delay = Math.pow(2, reconnectAttemptRef.current) * 1000; // 1s, 2s, 4s
          reconnectAttemptRef.current += 1;
          setConnectionState('connecting');

          reconnectTimerRef.current = setTimeout(() => {
            reconnectTimerRef.current = null;
            if (sessionIdRef.current) {
              connectInternal(sessionIdRef.current);
            }
          }, delay);
        } else {
          setConnectionState('error');
          callbacksRef.current.onError?.('WebSocket connection lost after max reconnect attempts');
        }
      };
    },
    [cleanupWs, handleMessage],
  );

  const connect = useCallback(
    (sessionId: string) => {
      sessionIdRef.current = sessionId;
      reconnectAttemptRef.current = 0;
      connectInternal(sessionId);
    },
    [connectInternal],
  );

  const disconnect = useCallback(() => {
    intentionalCloseRef.current = true;
    sessionIdRef.current = null;
    reconnectAttemptRef.current = 0;
    pendingMessagesRef.current = [];
    cleanupWs();
    setConnectionState('disconnected');
  }, [cleanupWs]);

  const sendConfig = useCallback(
    (language: string, voice: string) => {
      sendJson({ type: 'config', language, voice });
    },
    [sendJson],
  );

  const sendAudioChunk = useCallback(
    (base64Data: string) => {
      sendJson({ type: 'audio_chunk', data: base64Data });
    },
    [sendJson],
  );

  const sendAudioEnd = useCallback(
    (mimeType?: string) => {
      sendJson({ type: 'audio_end', mime: mimeType });
    },
    [sendJson],
  );

  const sendAudioDiscard = useCallback(() => {
    sendJson({ type: 'audio_discard' });
  }, [sendJson]);

  /** Abandon the reply in flight — the student started talking over it. */
  const sendInterrupt = useCallback(() => {
    sendJson({ type: 'interrupt' });
  }, [sendJson]);

  const sendEndSession = useCallback(() => {
    sendJson({ type: 'end_session' });
  }, [sendJson]);

  // Cleanup on unmount
  useEffect(() => {
    return () => {
      intentionalCloseRef.current = true;
      cleanupWs();
    };
  }, [cleanupWs]);

  return {
    connect,
    disconnect,
    sendConfig,
    sendAudioChunk,
    sendAudioEnd,
    sendAudioDiscard,
    sendInterrupt,
    sendEndSession,
    connectionState,
  };
}
