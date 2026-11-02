/**
 * Process-wide query counters fed by Prisma query events when QUERY_METRICS=true (add-caching-layer, measurement).
 * Per-request figures are deltas of these counters, so they are exact only when requests do not overlap (benchmarks).
 */
export const queryMetrics = { queries: 0, queryMs: 0 };
export const queryMetricsEnabled = () => process.env.QUERY_METRICS === "true";
