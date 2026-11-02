import { Injectable, Logger } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import type { Prisma } from "@prisma/client";

/** Reference-data groups; each has a row in cache_version bumped by statement triggers on its source tables. */
export const CACHE_GROUPS = ["org", "roles", "legal-parameters", "site-policies", "shifts"] as const;
export type CacheGroup = (typeof CACHE_GROUPS)[number];
export type CacheVersions = Partial<Record<CacheGroup, string>>;
/** Source table → group. Must match the bump_cache_version triggers (backend/test/reference-cache.test.cjs checks it):
 * a reference table read through this cache without a trigger would serve stale data. */
export const CACHE_SOURCE_TABLES: Record<string, CacheGroup> = {
  org_unit: "org", org_unit_version: "org", site: "org", role: "roles",
  legal_parameter: "legal-parameters", site_policy: "site-policies", shift_definition: "shifts",
};
type Reader = Pick<Prisma.TransactionClient, "$queryRaw">;

/** Versions kept per group: a request on an older snapshot (long transaction) still hits, and an entry built inside a
 * transaction that later rolled back (its sequence value is never committed) simply ages out. */
const VERSIONS_PER_GROUP = 4;

function freeze<T>(value: T): T {
  if (value && typeof value === "object" && (Array.isArray(value) || Object.getPrototypeOf(value) === Object.prototype) && !Object.isFrozen(value)) {
    Object.freeze(value);
    for (const item of Object.values(value as Record<string, unknown>)) freeze(item);
  }
  return value;
}

/**
 * Shared, process-local cache for read-mostly reference data (add-caching-layer).
 *
 * Correctness does not rely on TTLs or on writers remembering to invalidate: every write to a source table bumps the
 * group's version in the same transaction (trigger), and a reader only uses an entry whose version equals the version
 * visible in its own snapshot. That holds across backend instances and for seeds, migrations or manual SQL.
 * Values are deep-frozen; callers must copy before mutating. Never cache personal, payroll or attendance data here.
 */
@Injectable()
export class ReferenceCacheService {
  private readonly logger = new Logger("ReferenceCache");
  private readonly enabled: boolean;
  private readonly entries = new Map<CacheGroup, Map<string, Map<string, unknown>>>();
  readonly stats = { hit: 0, miss: 0, uncached: 0 };

  constructor(config: ConfigService) {
    this.enabled = config.get<string>("CACHE_REFERENCE_ENABLED") !== "false";
    if (!this.enabled) this.logger.log("Reference cache disabled (CACHE_REFERENCE_ENABLED=false)");
  }

  get isEnabled() { return this.enabled; }

  /** One small query for every group's version, read in the caller's snapshot (pass the transaction client). */
  async versions(db: Reader): Promise<CacheVersions> {
    const rows = await db.$queryRaw<Array<{ name: string; version: bigint }>>`SELECT name, version FROM cache_version`;
    return Object.fromEntries(rows.map((row) => [row.name, row.version.toString()])) as CacheVersions;
  }

  /**
   * Returns the cached value for (group, key) at the version visible to `db`, loading it on a miss.
   * Pass `known` when the caller already read the versions in this snapshot to save the version query.
   * A value loaded outside a transaction is stored only if the version did not move while loading, so data from a
   * newer commit is never filed under an older version.
   */
  async get<T>(db: Reader, group: CacheGroup, key: string, loader: () => Promise<T>, known?: CacheVersions): Promise<T> {
    if (!this.enabled) return loader();
    const version = known?.[group] ?? (await this.versions(db))[group];
    if (version === undefined) { this.stats.uncached++; return loader(); }
    const byVersion = this.entries.get(group);
    const values = byVersion?.get(version);
    if (values?.has(key)) { this.stats.hit++; return values.get(key) as T; }
    this.stats.miss++;
    const value = await loader();
    if ((await this.versions(db))[group] !== version) { this.stats.uncached++; return value; }
    this.store(group, version, key, freeze(value));
    return value;
  }

  private store(group: CacheGroup, version: string, key: string, value: unknown) {
    let byVersion = this.entries.get(group);
    if (!byVersion) this.entries.set(group, (byVersion = new Map()));
    let values = byVersion.get(version);
    if (!values) {
      byVersion.set(version, (values = new Map()));
      while (byVersion.size > VERSIONS_PER_GROUP) byVersion.delete(byVersion.keys().next().value!);
    }
    values.set(key, value);
  }
}
