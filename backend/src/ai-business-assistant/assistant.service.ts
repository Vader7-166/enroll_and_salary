import { BadRequestException, ForbiddenException, HttpException, Injectable, Logger, UnauthorizedException } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import { createHash, randomUUID } from "node:crypto";
import { AuditService } from "../audit/audit.service";
import type { AuthUser } from "../auth/auth.types";
import { businessDate } from "../auth/business-date";
import { PrismaService } from "../database/prisma.service";
import { effectiveAt } from "../organization/scope.service";
import { fold, loadCorpus, permitted, retrieve, type Corpus, type CorpusChunk } from "./corpus";
import { buildHandbookCatalog } from "./handbook";
import { GeminiProvider, ProviderError, buildPrompt } from "./gemini.provider";
import { detectPii, validateAnswer } from "./guards";

const LABEL = "AI hướng dẫn từ tài liệu hệ thống";
const CACHE_MS = 10 * 60_000;
const key = (value: Date) => value.toISOString().slice(0, 10);
const flag = (value: unknown) => String(value ?? "false").toLowerCase() === "true";

/**
 * AI-02 role-based business assistant (docs 24): answers only from the permitted, versioned guidance corpus; never reads
 * business data, never writes; every failure degrades to static guidance and never blocks attendance or payroll.
 */
@Injectable()
export class BusinessAssistantService {
  private readonly logger = new Logger(BusinessAssistantService.name);
  private readonly corpus: Corpus;
  private readonly provider: GeminiProvider | null;
  private readonly cache = new Map<string, { at: number; value: Record<string, unknown> }>();
  private readonly calls = new Map<string, number[]>();
  private budget = { day: "", used: 0 };
  readonly settings: { enabled: boolean; model: string; maxQuestionChars: number; ratePerHour: number; dailyBudget: number };

  constructor(private readonly prisma: PrismaService, private readonly audit: AuditService, config: ConfigService) {
    this.corpus = loadCorpus(config.get<string>("AI_CORPUS_DIR") || undefined);
    for (const warning of this.corpus.warnings) this.logger.warn("Corpus: " + warning);
    this.settings = { enabled: flag(config.get("AI_BUSINESS_ASSISTANT_ENABLED")), model: config.get<string>("GEMINI_MODEL") || "gemini-2.5-flash",
      maxQuestionChars: Number(config.get("AI_MAX_QUESTION_CHARS") ?? 500), ratePerHour: Number(config.get("AI_RATE_LIMIT_PER_HOUR") ?? 20), dailyBudget: Number(config.get("AI_DAILY_REQUEST_BUDGET") ?? 500) };
    const apiKey = config.get<string>("GEMINI_API_KEY");
    this.provider = apiKey ? new GeminiProvider({ apiKey, model: this.settings.model, baseUrl: config.get<string>("GEMINI_API_BASE") || "https://generativelanguage.googleapis.com",
      timeoutMs: Number(config.get("AI_TIMEOUT_MS") ?? 8000), maxOutputTokens: Number(config.get("AI_MAX_OUTPUT_TOKENS") ?? 1024) }) : null;
  }

  /** Recomputed from the database (not the request object) so a permission change during a request is noticed. */
  async scopeVersion(userId: string) {
    const today = businessDate();
    const [assignments, exclusions] = await Promise.all([
      this.prisma.roleAssignment.findMany({ where: { userAccountId: userId, ...effectiveAt(today), userAccount: { status: "ACTIVE" } }, include: { role: { select: { permissions: true } } }, orderBy: { id: "asc" } }),
      this.prisma.employeeExclusion.findMany({ where: { userAccountId: userId, ...effectiveAt(today) }, select: { employeeId: true }, orderBy: { employeeId: "asc" } }),
    ]);
    return createHash("sha256").update(JSON.stringify({ assignments: assignments.map(row => [row.roleCode, row.scopeOrgUnitId, [...row.role.permissions].sort()]), exclusions: exclusions.map(row => row.employeeId) })).digest("hex").slice(0, 16);
  }

  private guide(chunks: CorpusChunk[], pageKey: string | null) {
    const ranked = [...chunks].sort((left, right) => Number(right.pageKeys.includes(pageKey ?? "")) - Number(left.pageKeys.includes(pageKey ?? "")));
    return ranked.slice(0, 3).map(chunk => ({ sourceId: chunk.sourceId, title: chunk.title, label: chunk.label, text: chunk.text, actions: this.links(chunk.actions) }));
  }

  private links(actions: string[]) {
    return actions.map(action => ({ actionKey: action, label: this.corpus.routes[action].label, route: "#/" + this.corpus.routes[action].route }));
  }

  /** Static guidance filtered by permission: always available, also when the AI is off or failing. */
  staticGuide(user: AuthUser, pageKey: string | null) {
    return { label: "Hướng dẫn tĩnh từ tài liệu hệ thống", corpusVersion: this.corpus.version, items: this.guide(permitted(this.corpus, user, key(businessDate())), pageKey) };
  }

  /** Complete read-only catalogue uses this service's already-loaded corpus and never touches business records. */
  handbookCatalog(user: AuthUser) {
    return buildHandbookCatalog(this.corpus, user, key(businessDate()));
  }

  context(user: AuthUser, pageKey: string | null) {
    const allowed = permitted(this.corpus, user, key(businessDate()));
    const suggestions = user.roles.flatMap(role => this.corpus.suggestions[role] ?? []).filter(question => retrieve(allowed, question, pageKey, 1).length > 0);
    return { enabled: this.settings.enabled, label: LABEL, roles: user.roles, pageKey, suggestions, corpusVersion: this.corpus.version, maxQuestionChars: this.settings.maxQuestionChars };
  }

  private rate(userId: string) {
    const now = Date.now(), window = (this.calls.get(userId) ?? []).filter(time => now - time < 3_600_000);
    if (window.length >= this.settings.ratePerHour) return false;
    window.push(now); this.calls.set(userId, window); return true;
  }
  private spend() {
    const today = key(businessDate());
    if (this.budget.day !== today) this.budget = { day: today, used: 0 };
    if (this.budget.used >= this.settings.dailyBudget) return false;
    this.budget.used++; return true;
  }

  private async record(user: AuthUser, requestId: string, outcome: string, meta: Record<string, unknown>) {
    // Metadata only: the question and the answer text are not stored (docs 24 §6).
    await this.audit.record({ actorId: user.id, entityType: "ai_business_assistant", entityId: requestId, action: "ASK", result: outcome, scopeOrgUnitId: null,
      newValue: JSON.parse(JSON.stringify({ roles: user.roles, corpusVersion: this.corpus.version, promptVersion: this.corpus.promptVersion, model: this.settings.model, ...meta })) }).catch(error => this.logger.error("AI audit failed: " + error));
  }

  async ask(user: AuthUser, sessionId: string, dto: { question: string; pageKey?: string }) {
    const requestId = randomUUID(), started = Date.now();
    const pageKey = dto.pageKey && /^[a-z-]{1,40}$/.test(dto.pageKey) ? dto.pageKey : null;
    const scopeVersion = await this.scopeVersion(user.id);
    const base = { requestId, label: LABEL, corpusVersion: this.corpus.version, promptVersion: this.corpus.promptVersion, model: this.settings.model, scopeVersion };
    const fallback = (status: "UNAVAILABLE" | "INSUFFICIENT_SOURCE", reason: string) => ({ ...base, status, reason, answer: status === "INSUFFICIENT_SOURCE" ? "Chưa có tài liệu phù hợp để trả lời." : "Trợ lý AI tạm thời không khả dụng.",
      steps: [], citations: [], actions: [], limitations: [], fallback: this.staticGuide(user, pageKey) });
    if (!this.settings.enabled) { await this.record(user, requestId, "DISABLED", { pageKey, scopeVersion }); throw new ForbiddenException({ code: "AI_DISABLED", message: "Trợ lý AI đang tắt; dùng hướng dẫn tĩnh." }); }
    const question = (dto.question ?? "").trim();
    if (question.length < 3 || question.length > this.settings.maxQuestionChars) throw new BadRequestException({ code: "QUESTION_LENGTH", message: "Câu hỏi dài 3–" + this.settings.maxQuestionChars + " ký tự." });
    const pii = detectPii(question);
    if (pii.length) { await this.record(user, requestId, "PII_BLOCKED", { pageKey, scopeVersion, pii }); throw new BadRequestException({ code: "PII_DETECTED", message: "Câu hỏi có thông tin cá nhân (" + pii.join(", ") + "). Không nhập CCCD, MST, số tài khoản, điện thoại, email; hỏi về quy trình chung." }); }
    if (!this.rate(user.id)) { await this.record(user, requestId, "RATE_LIMITED", { pageKey, scopeVersion }); throw new HttpException({ code: "RATE_LIMITED", message: "Bạn đã hỏi quá số lần cho phép trong giờ; thử lại sau." }, 429); }
    // Permission filtering happens before retrieval and before anything can reach the provider.
    const allowed = permitted(this.corpus, user, key(businessDate()));
    const hits = retrieve(allowed, question, pageKey);
    if (!hits.length) { await this.record(user, requestId, "INSUFFICIENT_SOURCE", { pageKey, scopeVersion, latencyMs: Date.now() - started }); return fallback("INSUFFICIENT_SOURCE", "NO_PERMITTED_SOURCE"); }
    const sent = hits.map(hit => hit.chunk);
    const cacheKey = [scopeVersion, this.corpus.version, this.corpus.promptVersion, this.settings.model, pageKey, fold(question).replace(/\s+/g, " ")].join("|");
    const cached = this.cache.get(cacheKey);
    if (cached && Date.now() - cached.at < CACHE_MS) { await this.record(user, requestId, "CACHE_HIT", { pageKey, scopeVersion, sourceIds: sent.map(chunk => chunk.sourceId) }); return { ...cached.value, requestId, cached: true }; }
    if (!this.provider) { await this.record(user, requestId, "UNAVAILABLE", { pageKey, scopeVersion, reason: "MISSING_KEY" }); return fallback("UNAVAILABLE", "MISSING_KEY"); }
    if (!this.spend()) { await this.record(user, requestId, "UNAVAILABLE", { pageKey, scopeVersion, reason: "BUDGET" }); return fallback("UNAVAILABLE", "BUDGET_EXHAUSTED"); }
    let result;
    try { result = await this.provider.generate(buildPrompt(question, sent, user.roles)); }
    catch (error) {
      const reason = error instanceof ProviderError ? error.code : "PROVIDER_ERROR";
      await this.record(user, requestId, "UNAVAILABLE", { pageKey, scopeVersion, reason, latencyMs: Date.now() - started, sourceIds: sent.map(chunk => chunk.sourceId) });
      return fallback("UNAVAILABLE", reason);
    }
    // The session and permissions are checked again before anything is returned (AC-AI02-10).
    const session = await this.prisma.webSession.findUnique({ where: { id: sessionId }, select: { expiresAt: true, absoluteExpiresAt: true } });
    if (!session || session.expiresAt <= new Date() || session.absoluteExpiresAt <= new Date()) { await this.record(user, requestId, "SESSION_REVOKED", { pageKey, scopeVersion }); throw new UnauthorizedException({ code: "AUTH_REQUIRED", message: "Phiên đã kết thúc." }); }
    if (await this.scopeVersion(user.id) !== scopeVersion) { await this.record(user, requestId, "SCOPE_CHANGED", { pageKey, scopeVersion }); throw new HttpException({ code: "SCOPE_CHANGED", message: "Quyền của bạn vừa thay đổi; hỏi lại." }, 409); }
    const checked = validateAnswer(result.answer, sent, this.corpus, user);
    const cited = sent.filter(chunk => checked.steps.some(step => step.sourceIds.includes(chunk.sourceId)));
    const limitations = [...checked.limitations, ...(cited.some(chunk => chunk.label === "SIMULATION") ? ["Một phần nguồn là tài liệu/số liệu mô phỏng, chưa phải căn cứ pháp lý đã xác nhận."] : []),
      "Trợ lý không xem dữ liệu thực tế của kỳ/hồ sơ/lương; hãy mở màn hình để kiểm tra."];
    const response = checked.status === "INSUFFICIENT_SOURCE" ? fallback("INSUFFICIENT_SOURCE", "MODEL_FOUND_NO_ANSWER") : {
      ...base, status: "ANSWERED", answer: checked.answer, steps: checked.steps,
      citations: cited.map(chunk => ({ sourceId: chunk.sourceId, title: chunk.title, section: chunk.section, label: chunk.label, hash: chunk.hash })),
      actions: this.links(checked.actions), limitations: [...new Set(limitations)] };
    if (response.status === "ANSWERED") this.cache.set(cacheKey, { at: Date.now(), value: response });
    await this.record(user, requestId, response.status, { pageKey, scopeVersion, sourceIds: sent.map(chunk => chunk.sourceId), sourceHashes: sent.map(chunk => chunk.hash), cited: cited.map(chunk => chunk.sourceId),
      dropped: checked.dropped, latencyMs: Date.now() - started, inputTokens: result.usage.inputTokens, outputTokens: result.usage.outputTokens });
    return response;
  }
}
