export class ApiError extends Error {
  constructor(
    public status: number,
    public code: string,
    message: string,
  ) {
    super(message)
    this.name = 'ApiError'
  }
}

let csrfToken = ''
let onUnauthorized: (() => void) | undefined
export function configureSession(token: string, handler?: () => void) {
  csrfToken = token
  if (handler) onUnauthorized = handler
}

export async function api<T>(
  path: string,
  options: { method?: string; body?: unknown } = {},
): Promise<T> {
  const method = options.method ?? 'GET'
  const headers: Record<string, string> = { Accept: 'application/json' }
  if (options.body !== undefined) headers['Content-Type'] = 'application/json'
  if (method !== 'GET' && path !== '/admin/login') headers['X-CSRF-Token'] = csrfToken
  let response: Response
  try {
    response = await fetch(`/api${path}`, {
      method,
      headers,
      credentials: 'same-origin',
      body: options.body === undefined ? undefined : JSON.stringify(options.body),
    })
  } catch {
    throw new ApiError(0, 'NETWORK_ERROR', '暂时连接不上服务，请确认 API 已启动后重试。')
  }
  let data: unknown
  try {
    data = await response.json()
  } catch {
    if (response.status === 401 && path !== '/admin/login') onUnauthorized?.()
    throw new ApiError(response.status, 'INVALID_RESPONSE', '服务没有返回有效数据，请稍后重试。')
  }
  if (!response.ok) {
    if (response.status === 401 && path !== '/admin/login') onUnauthorized?.()
    const detail = (data as { error?: { code?: string; message?: string } })?.error
    throw new ApiError(
      response.status,
      detail?.code ?? 'REQUEST_FAILED',
      detail?.message ?? `请求失败（${response.status}），请重试。`,
    )
  }
  return data as T
}
