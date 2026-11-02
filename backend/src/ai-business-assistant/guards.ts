import type { Corpus, CorpusChunk } from "./corpus";

// Input/output guards (AC-AI02-06, 08, 09). Regexes are a best effort, not a guarantee of anonymity.
const PII: Array<[string, RegExp]> = [
  ["EMAIL", /[\w.+-]+@[\w-]+\.[\w.]+/],
  ["PHONE", /(?:\+84|\b0)(?:[\s.-]?\d){9}\b/],
  ["ID_NUMBER", /\b\d{12}\b/],
  ["TAX_CODE", /\b\d{10}(?:-\d{3})?\b/],
  ["ACCOUNT_NUMBER", /\b\d{9,19}\b/],
];
export function detectPii(question: string) { return PII.filter(([, pattern]) => pattern.test(question)).map(([kind]) => kind); }

export interface ModelAnswer { status?: string; answer?: string; steps?: Array<{ text?: string; sourceIds?: string[] }>; actions?: string[]; limitations?: string[] }
const URL_OR_HTML = /(https?:\/\/\S+|www\.\S+|<[^>]+>)/gi;
const clean = (value: string) => value.replace(URL_OR_HTML, "").replace(/\s{2,}/g, " ").trim();

/**
 * Keeps only what the sources support structurally: steps citing sources that were actually sent, action keys from the
 * registry the user may open; URLs/HTML the model produced are stripped. Nothing left → INSUFFICIENT_SOURCE.
 */
export function validateAnswer(raw: ModelAnswer, sent: CorpusChunk[], corpus: Corpus, user: { roles: string[]; permissions: string[] }) {
  const ids = new Set(sent.map(chunk => chunk.sourceId));
  const dropped: string[] = [];
  const steps = (Array.isArray(raw.steps) ? raw.steps : []).flatMap(step => {
    const text = typeof step?.text === "string" ? clean(step.text) : "";
    const sourceIds = (Array.isArray(step?.sourceIds) ? step.sourceIds : []).filter(id => ids.has(id));
    if ((step?.sourceIds ?? []).some(id => !ids.has(id))) dropped.push("SOURCE_NOT_SENT");
    if (!text || !sourceIds.length) { dropped.push("STEP_WITHOUT_SOURCE"); return []; }
    return [{ text, sourceIds: [...new Set(sourceIds)] }];
  });
  const allowedActions = new Set(sent.flatMap(chunk => chunk.actions));
  const actions = [...new Set(Array.isArray(raw.actions) ? raw.actions : [])].filter(action => {
    const route = corpus.routes[action];
    const ok = !!route && allowedActions.has(action) && route.roles.some(role => user.roles.includes(role)) && user.permissions.includes(route.permission);
    if (!ok) dropped.push("ACTION_REJECTED:" + action);
    return ok;
  });
  const status = raw.status === "INSUFFICIENT_SOURCE" || !steps.length ? "INSUFFICIENT_SOURCE" : "ANSWERED";
  const limitations = (Array.isArray(raw.limitations) ? raw.limitations : []).filter((item): item is string => typeof item === "string").map(clean).filter(Boolean).slice(0, 5);
  return { status, answer: typeof raw.answer === "string" ? clean(raw.answer).slice(0, 2000) : "", steps: steps.slice(0, 8), actions, limitations, dropped };
}
