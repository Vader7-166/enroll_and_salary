import { api } from "./client";

export type HandbookKind = "guide" | "policy";
export type HandbookCategory = "contracts" | "attendance" | "leave" | "payroll" | "administration";
export interface HandbookAction {
  actionKey: string;
  label: string;
  route: string;
  roles: string[];
}
export interface HandbookArticle {
  id: string;
  title: string;
  kind: HandbookKind;
  category: HandbookCategory;
  roles: string[];
  label: "SIMULATION" | "VERIFIED";
  version: string;
  scope: string;
  effectiveFrom: string | null;
  effectiveTo: string | null;
  sourceReference: string;
  overview: string;
  steps: string[];
  notes: string[];
  keywords: string[];
  actions: HandbookAction[];
}
export interface HandbookCatalog {
  corpusVersion: string;
  asOf: string;
  roles: string[];
  items: HandbookArticle[];
}

export const handbookApi = {
  catalog: () => api<HandbookCatalog>("/api/handbook"),
};
