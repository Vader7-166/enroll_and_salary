import type { AuthUser } from "../auth/auth.types";
import { type Corpus, type CorpusChunk, type HandbookCategory, hasChunkVisibility } from "./corpus";

const CATALOG_ROLES = ["TT", "QD", "KT", "AD"] as const;
type CatalogRole = typeof CATALOG_ROLES[number];

type HandbookUser = Pick<AuthUser, "roles" | "permissions">;

function isCatalogRole(role: string): role is CatalogRole {
  return (CATALOG_ROLES as readonly string[]).includes(role);
}

function canOpenRoute(user: HandbookUser, route: string): boolean {
  const has = (permission: string) => user.permissions.includes(permission);
  switch (route) {
    case "attendance": return has("attendance.read");
    case "shifts": return has("shift.read");
    case "overtime": return has("overtime.read");
    case "leave": return has("leave.read") || has("leave.balance.read");
    case "payroll": return user.roles.includes("KT") && (has("payroll.read") || has("contract.read"));
    case "contracts": return user.roles.includes("KT") && has("contract.read");
    case "periods": return has("period.read");
    case "accounts": return has("accounts.manage");
    case "settings": return has("settings.manage");
    case "audit": return has("audit.read");
    default: return false;
  }
}

function guideCategory(pageKeys: string[]): HandbookCategory {
  if (pageKeys.includes("contracts")) return "contracts";
  if (pageKeys.some(pageKey => ["attendance", "shifts", "overtime", "periods"].includes(pageKey))) return "attendance";
  if (pageKeys.includes("leave")) return "leave";
  if (pageKeys.includes("payroll")) return "payroll";
  return "administration";
}

function parseContent(text: string) {
  const paragraphs = text.split(/\r?\n/).map(line => line.trim()).filter(Boolean);
  const firstStep = paragraphs.findIndex(paragraph => /^\d+\.\s+/.test(paragraph));
  const overview = (firstStep < 0 ? paragraphs : paragraphs.slice(0, firstStep)).join("\n");
  const rest = firstStep < 0 ? [] : paragraphs.slice(firstStep);
  return {
    overview,
    steps: rest.filter(paragraph => /^\d+\.\s+/.test(paragraph)).map(paragraph => paragraph.replace(/^\d+\.\s+/, "")),
    notes: rest.filter(paragraph => !/^\d+\.\s+/.test(paragraph)).map(paragraph => paragraph.replace(/^[-*]\s+/, "")),
  };
}

function actions(corpus: Corpus, chunk: CorpusChunk, user: HandbookUser) {
  return chunk.actions.flatMap(actionKey => {
    const action = corpus.routes[actionKey];
    if (!action || !user.permissions.includes(action.permission) || !canOpenRoute(user, action.route)) return [];
    const roles = action.roles.filter(role => isCatalogRole(role) && chunk.roles.includes(role) && user.roles.includes(role));
    return roles.length ? [{ actionKey, label: action.label, route: action.route, roles }] : [];
  });
}

/** Builds the read-only handbook catalogue from already-loaded controlled corpus content. */
export function buildHandbookCatalog(corpus: Corpus, user: HandbookUser, asOf: string) {
  const roles = user.roles.filter(isCatalogRole);
  const items = corpus.chunks
    .filter(chunk => hasChunkVisibility(chunk, user, asOf) && chunk.roles.some(role => isCatalogRole(role) && roles.includes(role)))
    .map(chunk => {
      const content = parseContent(chunk.text);
      return {
        id: chunk.sourceId,
        title: chunk.title,
        kind: chunk.handbook?.kind ?? "guide",
        category: chunk.handbook?.category ?? guideCategory(chunk.pageKeys),
        roles: chunk.roles.filter(role => isCatalogRole(role) && roles.includes(role)),
        label: chunk.label,
        version: chunk.handbook?.version ?? chunk.hash.slice(0, 12),
        scope: chunk.handbook?.scope ?? "Hướng dẫn thao tác theo vai trò và quyền truy cập",
        effectiveFrom: chunk.effectiveFrom,
        effectiveTo: chunk.effectiveTo,
        sourceReference: chunk.section,
        overview: content.overview,
        steps: content.steps,
        notes: content.notes,
        keywords: chunk.keywords,
        actions: actions(corpus, chunk, user),
      };
    });
  return { corpusVersion: corpus.version, asOf, roles, items };
}
