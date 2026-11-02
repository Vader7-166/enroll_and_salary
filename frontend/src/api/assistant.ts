import { api } from "./client";

export interface AssistantLink { actionKey: string; label: string; route: string }
export interface AssistantGuideItem { sourceId: string; title: string; label: string; text: string; actions: AssistantLink[] }
export interface AssistantAnswer {
  status: "ANSWERED" | "INSUFFICIENT_SOURCE" | "UNAVAILABLE"; requestId: string; label: string; answer: string; reason?: string; cached?: boolean;
  steps: Array<{ text: string; sourceIds: string[] }>; citations: Array<{ sourceId: string; title: string; section: string; label: string }>;
  actions: AssistantLink[]; limitations: string[]; corpusVersion: string; model: string; scopeVersion: string;
  fallback?: { label: string; items: AssistantGuideItem[] };
}
export const assistantApi = {
  context: (pageKey: string) => api<{ enabled: boolean; label: string; roles: string[]; suggestions: string[]; maxQuestionChars: number }>("/api/ai/business-assistant/context?pageKey=" + pageKey),
  guide: (pageKey: string) => api<{ label: string; items: AssistantGuideItem[] }>("/api/ai/business-assistant/guide?pageKey=" + pageKey),
  ask: (question: string, pageKey: string) => api<AssistantAnswer>("/api/ai/business-assistant/answers", { method: "POST", body: JSON.stringify({ question, pageKey }) }),
};
