export interface HealthResponse {
  status: 'ok' | 'error';
  service: 'hrtp-api';
  database: { status: 'up' | 'down' };
  checkedAt: string;
}

export interface HealthResult {
  health: HealthResponse;
  httpStatus: number;
}

export async function fetchHealth(signal: AbortSignal): Promise<HealthResult> {
  const response = await fetch('/api/health', {
    signal: AbortSignal.any([signal, AbortSignal.timeout(8000)]),
    cache: 'no-store',
    headers: { Accept: 'application/json' },
  });
  if (response.status !== 200 && response.status !== 503) {
    throw new Error('API trả HTTP ' + response.status + '. Kiểm tra tiến trình backend và cấu hình proxy.');
  }
  const health = await response.json() as HealthResponse;
  const healthy = response.status === 200 && health.status === 'ok' && health.database?.status === 'up';
  const unavailable = response.status === 503 && health.status === 'error' && health.database?.status === 'down';
  if (health.service !== 'hrtp-api' || (!healthy && !unavailable) || !Number.isFinite(Date.parse(health.checkedAt))) {
    throw new Error('Phản hồi API không đúng hợp đồng kiểm tra kết nối.');
  }
  return { health, httpStatus: response.status };
}
