"use client";

import {
  createContext,
  useCallback,
  useContext,
  useRef,
  useState,
  type ReactNode,
} from "react";
import { useRouter } from "next/navigation";
import { isLocalEvrenUrl, buildEvrenRequestBody, getEvrenEvalsUrl } from "@/lib/evren";
import type { TestCase } from "@/lib/types";

function playCompletionSound() {
  try {
    const ctx = new (window.AudioContext || (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext)();
    const playTone = (freq: number, startTime: number, duration: number) => {
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      osc.connect(gain);
      gain.connect(ctx.destination);
      osc.frequency.value = freq;
      osc.type = "sine";
      gain.gain.setValueAtTime(0.15, startTime);
      gain.gain.exponentialRampToValueAtTime(0.01, startTime + duration);
      osc.start(startTime);
      osc.stop(startTime + duration);
    };
    playTone(523.25, 0, 0.15);
    playTone(659.25, 0.2, 0.2);
  } catch {
    /* ignore */
  }
}

function showCompletionNotification() {
  if (typeof window === "undefined" || !("Notification" in window)) return;
  try {
    if (Notification.permission === "granted") {
      new Notification("Evaluation complete", {
        body: "All test cases finished. Session ready to view.",
        icon: "/favicon.ico",
      });
    }
  } catch {
    /* ignore */
  }
}

export type EvalProgress = {
  stage: string;
  index?: number;
  total?: number;
  test_case_id?: string;
  message?: string;
};

export type EvalRunState = {
  sessionId: string | null;
  total: number;
  progress: EvalProgress | null;
  loading: boolean;
  completed: boolean;
  error: string | null;
};

const initialState: EvalRunState = {
  sessionId: null,
  total: 0,
  progress: null,
  loading: false,
  completed: false,
  error: null,
};

type EvalRunContextValue = {
  runState: EvalRunState;
  startRun: (params: {
    evren_model_api_url: string;
    model_name?: string;
    summarizer_model?: string;
  }) => Promise<void>;
  cancelRun: () => void;
  clearRunState: () => void;
};

const EvalRunContext = createContext<EvalRunContextValue | null>(null);

export function EvalRunProvider({ children }: { children: ReactNode }) {
  const router = useRouter();
  const [runState, setRunState] = useState<EvalRunState>(initialState);
  const abortControllerRef = useRef<AbortController | null>(null);

  const clearRunState = useCallback(() => {
    setRunState(initialState);
  }, []);

  const cancelRun = useCallback(() => {
    abortControllerRef.current?.abort();
  }, []);

  const startRun = useCallback(
    async (params: {
      evren_model_api_url: string;
      model_name?: string;
      summarizer_model?: string;
    }) => {
      abortControllerRef.current?.abort();
      const controller = new AbortController();
      abortControllerRef.current = controller;
      const evrenUrl = params.evren_model_api_url.trim();
      setRunState({
        ...initialState,
        loading: true,
      });

      try {
        let evrenOutputsById: Record<string, { evren_response: string; detected_states: string }[]> = {};

        if (isLocalEvrenUrl(evrenUrl)) {
          setRunState((prev) => ({
            ...prev,
            progress: { stage: "evren", message: "Fetching test cases…", total: 0 },
          }));
          const tcRes = await fetch("/api/evaluate/run/enabled-test-cases", {
            signal: controller.signal,
          });
          if (!tcRes.ok) {
            const data = await tcRes.json().catch(() => ({}));
            setRunState((prev) => ({
              ...prev,
              loading: false,
              error: (data as { error?: string }).error ?? "Failed to load test cases",
            }));
            return;
          }
          const { test_cases: testCases } = (await tcRes.json()) as { test_cases: TestCase[] };
          if (!Array.isArray(testCases) || testCases.length === 0) {
            setRunState((prev) => ({
              ...prev,
              loading: false,
              error: "No enabled test cases",
            }));
            return;
          }
          const evrenEvalsUrl = getEvrenEvalsUrl(evrenUrl);
          for (let i = 0; i < testCases.length; i++) {
            const tc = testCases[i]!;
            setRunState((prev) => ({
              ...prev,
              total: testCases.length,
              progress: {
                stage: "evren",
                index: i,
                total: testCases.length,
                test_case_id: tc.test_case_id,
                message: `Calling Evren for ${tc.test_case_id}…`,
              },
            }));
            const body = buildEvrenRequestBody(tc);
            if (body.messages.length === 0) {
              evrenOutputsById[tc.test_case_id] = [{ evren_response: "", detected_states: "" }];
              continue;
            }
            const evrenRes = await fetch(evrenEvalsUrl, {
              method: "POST",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify(body),
              signal: controller.signal,
            });
            if (!evrenRes.ok) {
              const text = await evrenRes.text();
              setRunState((prev) => ({
                ...prev,
                loading: false,
                error: `Evren error for ${tc.test_case_id}: ${evrenRes.status} ${text.slice(0, 80)}`,
              }));
              return;
            }
            const data = (await evrenRes.json()) as { evren_responses?: Array<{ response?: string; detected_flags?: string }> };
            const responses = data.evren_responses;
            evrenOutputsById[tc.test_case_id] = Array.isArray(responses)
              ? responses.map((item) => ({
                  evren_response: String(item?.response ?? ""),
                  detected_states: String(item?.detected_flags ?? ""),
                }))
              : [{ evren_response: "", detected_states: "" }];
          }
        }

        const res = await fetch("/api/evaluate/run/stream", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            evren_model_api_url: evrenUrl,
            model_name: params.model_name || undefined,
            summarizer_model: params.summarizer_model || undefined,
            ...(Object.keys(evrenOutputsById).length > 0 ? { evren_outputs_by_id: evrenOutputsById } : {}),
          }),
          signal: controller.signal,
        });

        if (!res.ok) {
          const data = await res.json().catch(() => ({}));
          setRunState((prev) => ({
            ...prev,
            loading: false,
            error: (data as { error?: string }).error ?? `Request failed (${res.status})`,
          }));
          return;
        }

        const reader = res.body?.getReader();
        const decoder = new TextDecoder();
        if (!reader) {
          setRunState((prev) => ({
            ...prev,
            loading: false,
            error: "No response body",
          }));
          return;
        }

        let buffer = "";
        while (true) {
          const { done, value } = await reader.read();
          if (done) break;
          buffer += decoder.decode(value, { stream: true });
          const lines = buffer.split("\n\n");
          buffer = lines.pop() ?? "";
          for (const chunk of lines) {
            const match = chunk.match(/^data:\s*(.+)/m);
            if (!match) continue;
            try {
              const data = JSON.parse(match[1].trim()) as {
                type: string;
                stage?: string;
                message?: string;
                index?: number;
                total?: number;
                test_case_id?: string;
                test_session_id?: string;
                error?: string;
              };
              if (data.type === "progress" && data.stage != null) {
                const stage = data.stage;
                setRunState((prev) => ({
                  ...prev,
                  sessionId: data.test_session_id ?? prev.sessionId,
                  total: data.total ?? prev.total,
                  progress: {
                    stage,
                    index: data.index,
                    total: data.total,
                    test_case_id: data.test_case_id,
                    message: data.message,
                  },
                }));
              } else if (data.type === "complete" && data.test_session_id) {
                playCompletionSound();
                showCompletionNotification();
                setRunState({
                  ...initialState,
                  loading: false,
                  completed: true,
                  sessionId: data.test_session_id,
                });
                router.push(`/sessions/${data.test_session_id}`);
                return;
              } else if (data.type === "error" && data.error) {
                setRunState((prev) => ({
                  ...prev,
                  loading: false,
                  error: data.error ?? null,
                  progress: null,
                }));
              }
            } catch {
              /* ignore parse errors */
            }
          }
        }
      } catch (e) {
        if (e instanceof Error && e.name === "AbortError") {
          setRunState(initialState);
        } else {
          setRunState((prev) => ({
            ...prev,
            loading: false,
            error: e instanceof Error ? e.message : "Something went wrong",
            progress: null,
          }));
        }
      } finally {
        abortControllerRef.current = null;
      }
    },
    [router]
  );

  const value: EvalRunContextValue = {
    runState,
    startRun,
    cancelRun,
    clearRunState,
  };

  return (
    <EvalRunContext.Provider value={value}>{children}</EvalRunContext.Provider>
  );
}

export function useEvalRun() {
  const ctx = useContext(EvalRunContext);
  if (!ctx) throw new Error("useEvalRun must be used within EvalRunProvider");
  return ctx;
}
