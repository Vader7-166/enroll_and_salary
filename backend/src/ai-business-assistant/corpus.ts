import { createHash } from "node:crypto";
import { existsSync, readFileSync } from "node:fs";
import { join, resolve } from "node:path";

// Controlled guidance corpus (AI-02, docs 24 §4): only reviewed chunks with permission metadata are ever retrievable.
export type HandbookKind = "guide" | "policy";
export type HandbookCategory = "contracts" | "attendance" | "leave" | "payroll" | "administration";
export interface HandbookMetadata { kind: HandbookKind; category: HandbookCategory; scope: string; version?: string }
export interface CorpusChunk {
  sourceId: string; title: string; section: string; roles: string[]; requiredPermissions: string[]; label: "SIMULATION" | "VERIFIED";
  effectiveFrom: string | null; effectiveTo: string | null; actions: string[]; pageKeys: string[]; keywords: string[]; text: string; hash: string;
  handbookOnly?: boolean; handbook?: HandbookMetadata;
}
export interface RouteEntry { route: string; label: string; roles: string[]; permission: string }
export interface Corpus { version: string; promptVersion: string; chunks: CorpusChunk[]; routes: Record<string, RouteEntry>; suggestions: Record<string, string[]>; warnings: string[] }

export const defaultCorpusDir = () => resolve(__dirname, "../../../docs/ai-corpus");

const HANDBOOK_CATEGORIES = ["contracts", "attendance", "leave", "payroll", "administration"] as const;

function parseHandbookMetadata(entry: Partial<CorpusChunk>, id: string, warnings: string[]): HandbookMetadata | null | undefined {
  if (entry.handbookOnly !== undefined && typeof entry.handbookOnly !== "boolean") {
    warnings.push(id + ": handbookOnly phải là boolean"); return null;
  }
  if (entry.handbook === undefined) {
    if (entry.handbookOnly) warnings.push(id + ": policy handbookOnly thiếu metadata handbook");
    return entry.handbookOnly ? null : undefined;
  }
  const handbook = entry.handbook;
  if (!handbook || typeof handbook !== "object" || !["guide", "policy"].includes(handbook.kind)
    || !HANDBOOK_CATEGORIES.includes(handbook.category) || typeof handbook.scope !== "string" || !handbook.scope.trim()
    || (handbook.version !== undefined && (typeof handbook.version !== "string" || !handbook.version.trim()))) {
    warnings.push(id + ": metadata handbook không hợp lệ"); return null;
  }
  if (handbook.kind === "policy" && (!entry.handbookOnly || entry.label !== "SIMULATION")) {
    warnings.push(id + ": policy phải handbookOnly và mang nhãn SIMULATION"); return null;
  }
  if (entry.handbookOnly && handbook.kind !== "policy") {
    warnings.push(id + ": handbookOnly chỉ dùng cho policy"); return null;
  }
  return { kind: handbook.kind, category: handbook.category, scope: handbook.scope.trim(), ...(handbook.version ? { version: handbook.version.trim() } : {}) };
}

/** Loads and validates the manifest; chunks without permissions/roles or with a missing file are dropped with a warning. */
export function loadCorpus(dir = defaultCorpusDir()): Corpus {
  const manifest = JSON.parse(readFileSync(join(dir, "manifest.json"), "utf8")) as { promptVersion: string; chunks: Array<Partial<CorpusChunk> & { file?: string }>; routes: Record<string, RouteEntry>; suggestions: Record<string, string[]> };
  const warnings: string[] = [];
  const chunks: CorpusChunk[] = [];
  for (const entry of manifest.chunks) {
    const id = entry.sourceId ?? "(không mã)";
    if (!entry.sourceId || !entry.title || !entry.file) { warnings.push(id + ": thiếu sourceId/tiêu đề/tệp"); continue; }
    if (!Array.isArray(entry.requiredPermissions) || !entry.requiredPermissions.length || !Array.isArray(entry.roles) || !entry.roles.length) { warnings.push(id + ": thiếu metadata quyền/vai trò — loại khỏi corpus"); continue; }
    if (!["SIMULATION", "VERIFIED"].includes(entry.label ?? "")) { warnings.push(id + ": nhãn phải là SIMULATION hoặc VERIFIED"); continue; }
    const handbook = parseHandbookMetadata(entry, id, warnings);
    if (handbook === null) continue;
    const file = join(dir, entry.file);
    if (!existsSync(file)) { warnings.push(id + ": không có tệp " + entry.file); continue; }
    const unknown = (entry.actions ?? []).filter(action => !manifest.routes[action]);
    if (unknown.length) { warnings.push(id + ": actionKey không có trong route registry: " + unknown.join(", ")); continue; }
    const text = readFileSync(file, "utf8").trim();
    chunks.push({ sourceId: entry.sourceId, title: entry.title, section: entry.section ?? "", roles: entry.roles, requiredPermissions: entry.requiredPermissions, label: entry.label as CorpusChunk["label"],
      effectiveFrom: entry.effectiveFrom ?? null, effectiveTo: entry.effectiveTo ?? null, actions: entry.actions ?? [], pageKeys: entry.pageKeys ?? [], keywords: entry.keywords ?? [], text,
      hash: createHash("sha256").update(text).digest("hex"), ...(entry.handbookOnly ? { handbookOnly: true } : {}), ...(handbook ? { handbook } : {}) });
  }
  const version = createHash("sha256").update(JSON.stringify({ prompt: manifest.promptVersion, chunks: chunks.map(chunk => [chunk.sourceId, chunk.hash, chunk.roles, chunk.requiredPermissions, chunk.effectiveFrom, chunk.effectiveTo, chunk.label, chunk.actions, chunk.pageKeys, chunk.handbookOnly, chunk.handbook]), routes: manifest.routes })).digest("hex").slice(0, 16);
  return { version, promptVersion: manifest.promptVersion, chunks, routes: manifest.routes, suggestions: manifest.suggestions ?? {}, warnings };
}

export function fold(value: string) {
  return value.normalize("NFD").replace(/\p{Diacritic}/gu, "").replace(/đ/gi, "d").toLowerCase();
}

/** Role, every required permission, and inclusive effective-date predicate shared by AI and handbook views. */
export function hasChunkVisibility(chunk: CorpusChunk, user: { roles: readonly string[]; permissions: readonly string[] }, today: string) {
  return chunk.roles.some(role => user.roles.includes(role)) && chunk.requiredPermissions.every(permission => user.permissions.includes(permission))
    && (!chunk.effectiveFrom || chunk.effectiveFrom <= today) && (!chunk.effectiveTo || chunk.effectiveTo >= today);
}

/** Chunks the session may read today: role + every required permission + in force. handbookOnly material never enters AI flows. */
export function permitted(corpus: Corpus, user: { roles: readonly string[]; permissions: readonly string[] }, today: string) {
  return corpus.chunks.filter(chunk => !chunk.handbookOnly && hasChunkVisibility(chunk, user, today));
}

const STOP = new Set(["la", "va", "cua", "cho", "the", "nao", "gi", "thi", "toi", "co", "khong", "can", "o", "dau", "ra", "sao", "lam", "nhu", "mot", "cac", "nhung", "duoc", "khi", "de", "hay", "voi", "bi", "da", "nay", "ky"]);
const tokens = (value: string) => fold(value).split(/[^a-z0-9]+/).filter(token => token.length > 1 && !STOP.has(token));

/**
 * Keyword/heading scoring over the permitted chunks. Curated keyword phrases (word-bounded) carry the weight; title words
 * count only when rare in the corpus, so generic words ("công", "đồng") cannot pull in an unrelated chunk. The page key
 * only nudges ranking.
 */
export function retrieve(chunks: CorpusChunk[], question: string, pageKey: string | null, limit = 3, threshold = 4) {
  const words = new Set(tokens(question));
  const phrase = (value: string) => " " + fold(value).replace(/[^a-z0-9]+/g, " ").trim() + " ";
  const folded = phrase(question);
  const frequency = new Map<string, number>();
  for (const chunk of chunks) for (const word of new Set(tokens(chunk.title))) frequency.set(word, (frequency.get(word) ?? 0) + 1);
  const scored = chunks.map(chunk => {
    let score = 0;
    for (const keyword of chunk.keywords) if (folded.includes(phrase(keyword))) score += 4;
    for (const word of new Set(tokens(chunk.title))) if (words.has(word) && (frequency.get(word) ?? 0) <= 2) score += 1.5;
    const body = new Set(tokens(chunk.text));
    for (const word of words) if (body.has(word)) score += 0.25;
    if (pageKey && chunk.pageKeys.includes(pageKey)) score += 0.5;
    return { chunk, score };
  }).filter(item => item.score >= threshold).sort((left, right) => right.score - left.score);
  return scored.slice(0, limit);
}
