<script setup lang="ts">
import { computed, nextTick, onMounted, reactive, ref } from 'vue'
import { api, ApiError, configureSession } from './api'
import type {
  Category,
  Channel,
  Mode,
  Offer,
  OfferInput,
  Order,
  Overview,
  Session,
  Settings,
} from './types'

type Page = 'overview' | 'offers' | 'channels' | 'orders' | 'settings'
const navigation: { id: Page; title: string; subtitle: string; icon: string }[] = [
  {
    id: 'overview',
    title: '经营概览',
    subtitle: '每一次真实消费，都值得认真记录。',
    icon: 'M3 3h7v7H3z M14 3h7v7h-7z M3 14h7v7H3z M14 14h7v7h-7z',
  },
  {
    id: 'offers',
    title: '优惠管理',
    subtitle: '精选实用优惠，维护清晰、可信的消费入口。',
    icon: 'M20 13l-7 7a2 2 0 0 1-3 0L3 13V3h10l7 7a2 2 0 0 1 0 3z M7 7h.01',
  },
  {
    id: 'channels',
    title: '渠道管理',
    subtitle: '分清每个入口，了解用户从哪里来。',
    icon: 'M12 3v6 M5 16v-4h14v4 M3 17h4v4H3z M10 3h4v4h-4z M17 17h4v4h-4z',
  },
  {
    id: 'orders',
    title: '订单与佣金',
    subtitle: '区分订单有效与结算记录，逐笔核验佣金。',
    icon: 'M6 3h12v18l-3-2-3 2-3-2-3 2z M9 8h6 M9 12h6 M9 16h3',
  },
  {
    id: 'settings',
    title: '接入设置',
    subtitle: '核对真实接入状态，准备你的第一笔真实订单。',
    icon: 'M9 3h6l1 4 4 1v8l-4 1-1 4H9l-1-4-4-1V8l4-1z M15 12a3 3 0 1 1-6 0 3 3 0 0 1 6 0',
  },
]
const page = ref<Page>('overview')
const currentPage = computed(() => navigation.find((item) => item.id === page.value)!)
const user = ref<Session['user'] | null>(null)
const booting = ref(true)
const loading = ref(false)
const saving = ref(false)
const loggingIn = ref(false)
const overview = ref<Overview | null>(null)
const settings = ref<Settings | null>(null)
const offers = ref<Offer[]>([])
const channels = ref<Channel[]>([])
const orders = ref<Order[]>([])
const orderTotal = ref(0)
const orderOffset = ref(0)
const orderLimit = 200
const ordersLoading = ref(false)
const detectedMode = ref<Mode | null>(null)
const mode = computed(() => settings.value?.mode ?? overview.value?.mode ?? detectedMode.value)
const isDemo = computed(() => mode.value === 'demo')
const error = ref('')
const loginError = ref('')
const loginNotice = ref('')
const toast = ref('')
let toastTimeout: ReturnType<typeof setTimeout> | undefined
const login = reactive({ username: '', password: '' })
const offerSearch = ref('')
const offerFilter = ref('all')
const orderFilter = ref('all')
const orderChannel = ref('all')
const orderSearch = ref('')
const modal = ref<'offer' | 'channel' | 'demo' | 'import' | null>(null)
const formError = ref('')
const editingId = ref<string | null>(null)
const channelForm = reactive({ name: '', code: '' })
const demoChannel = ref('')
const importText = ref('')
const importFileName = ref('')
const importExampleVisible = ref(false)
const importExample = JSON.stringify(
  [
    {
      externalOrderId: '请替换为联盟实际订单编号',
      platform: 'meituan',
      status: 'valid',
      orderAmountCents: 2500,
      commissionCents: 80,
      channelCode: 'qingdao-lunch-01',
      orderedAt: '2026-10-18T04:00:00.000Z',
      settledAt: null,
    },
  ],
  null,
  2,
)
const blankOffer = (): OfferInput => ({
  title: '',
  platform: 'meituan',
  category: 'food',
  description: '',
  benefitText: '',
  status: 'draft',
  targetAppId: '',
  targetPath: '',
  sortOrder: 0,
})
const offerForm = reactive<OfferInput>(blankOffer())
const categories: Record<Category, string> = {
  food: '外卖餐饮',
  coffee: '咖啡茶饮',
  travel: '出行旅行',
  other: '其他优惠',
}
const orderStates: Record<Order['status'], string> = {
  pending: '待确认',
  valid: '已有效',
  settled: '已结算',
  invalid: '已失效',
}
const platformName = (value: string) => (value === 'meituan' ? '美团' : '其他平台')
const money = (cents: number) =>
  new Intl.NumberFormat('zh-CN', {
    style: 'currency',
    currency: 'CNY',
    minimumFractionDigits: 2,
  }).format(cents / 100)
const number = (value: number) => new Intl.NumberFormat('zh-CN').format(value)
const timestamp = (value: string | null) =>
  value
    ? new Intl.DateTimeFormat('zh-CN', {
        timeZone: 'Asia/Shanghai',
        month: '2-digit',
        day: '2-digit',
        hour: '2-digit',
        minute: '2-digit',
        hour12: false,
      }).format(new Date(value))
    : '—'
const shortDate = (value: string) => value.slice(5, 10).replace('-', '.')
const messageOf = (cause: unknown) =>
  cause instanceof Error ? cause.message : '操作未完成，请稍后重试。'
const filteredOffers = computed(() =>
  offers.value.filter(
    (item) =>
      (offerFilter.value === 'all' || item.status === offerFilter.value) &&
      `${item.title} ${item.description} ${item.benefitText}`
        .toLowerCase()
        .includes(offerSearch.value.toLowerCase()),
  ),
)
const filteredOrders = computed(() =>
  orders.value.filter(
    (item) =>
      (orderFilter.value === 'all' || item.status === orderFilter.value) &&
      (orderChannel.value === 'all' || item.channelCode === orderChannel.value) &&
      `${item.externalOrderId} ${item.channelCode}`
        .toLowerCase()
        .includes(orderSearch.value.toLowerCase()),
  ),
)
const chartMax = computed(() =>
  Math.max(1, ...(overview.value?.daily.flatMap((day) => [day.clicks, day.orders]) ?? [])),
)
const chartHasActivity = computed(() =>
  overview.value?.daily.some((day) => day.clicks > 0 || day.orders > 0),
)
const channelName = (code: string) =>
  channels.value.find((item) => item.code === code)?.name ?? (code || '直接访问')

function notify(message: string) {
  toast.value = message
  if (toastTimeout) clearTimeout(toastTimeout)
  toastTimeout = setTimeout(() => {
    toast.value = ''
  }, 4500)
}
function clearSession() {
  user.value = null
  configureSession('')
  overview.value = null
  settings.value = null
  offers.value = []
  channels.value = []
  orders.value = []
  orderTotal.value = 0
  orderOffset.value = 0
  modal.value = null
}
configureSession('', () => {
  clearSession()
  loginNotice.value = '登录状态已失效，请重新登录。'
})
async function refresh() {
  if (!user.value || loading.value) return
  loading.value = true
  error.value = ''
  try {
    const [summary, offerData, channelData, orderData, config] = await Promise.all([
      api<Overview>('/admin/overview'),
      api<{ items: Offer[] }>('/admin/offers'),
      api<{ items: Channel[] }>('/admin/channels'),
      api<{ items: Order[]; total: number }>('/admin/orders?limit=200&offset=0'),
      api<Settings>('/admin/settings'),
    ])
    if (!user.value) return
    overview.value = summary
    offers.value = offerData.items
    channels.value = channelData.items
    orders.value = orderData.items
    orderTotal.value = orderData.total
    orderOffset.value = 0
    settings.value = config
  } catch (cause) {
    if (user.value) error.value = messageOf(cause)
  } finally {
    loading.value = false
  }
}
async function signIn() {
  if (loggingIn.value) return
  loggingIn.value = true
  loginError.value = ''
  try {
    const session = await api<Session>('/admin/login', { method: 'POST', body: login })
    configureSession(session.csrfToken)
    user.value = session.user
    login.password = ''
    loginNotice.value = ''
    await refresh()
  } catch (cause) {
    loginError.value = messageOf(cause)
  } finally {
    loggingIn.value = false
  }
}
async function signOut() {
  if (saving.value) return
  saving.value = true
  try {
    await api<{ ok: boolean }>('/admin/session', { method: 'DELETE' })
    clearSession()
    loginNotice.value = '已安全退出。'
  } catch (cause) {
    error.value = messageOf(cause)
  } finally {
    saving.value = false
  }
}
let previousFocus: HTMLElement | null = null
async function openModal(kind: 'offer' | 'channel' | 'demo' | 'import') {
  previousFocus = document.activeElement as HTMLElement | null
  formError.value = ''
  modal.value = kind
  if (kind === 'import') {
    importText.value = ''
    importFileName.value = ''
    importExampleVisible.value = false
  }
  await nextTick()
  document
    .querySelector<HTMLElement>('.dialog input, .dialog select, .dialog textarea, .dialog .primary')
    ?.focus()
}
function closeModal() {
  if (saving.value) return
  modal.value = null
  previousFocus?.focus()
}
function modalKeys(event: KeyboardEvent) {
  if (event.key === 'Escape') closeModal()
  if (event.key !== 'Tab') return
  const focusable = [
    ...(event.currentTarget as HTMLElement).querySelectorAll<HTMLElement>(
      'button:not(:disabled), input, textarea, select, [tabindex="0"]',
    ),
  ]
  const first = focusable[0]
  const last = focusable[focusable.length - 1]
  if (event.shiftKey && document.activeElement === first) {
    event.preventDefault()
    last?.focus()
  } else if (!event.shiftKey && document.activeElement === last) {
    event.preventDefault()
    first?.focus()
  }
}
function editOffer(item?: Offer) {
  editingId.value = item?.id ?? null
  Object.assign(
    offerForm,
    item
      ? {
          title: item.title,
          platform: item.platform,
          category: item.category,
          description: item.description,
          benefitText: item.benefitText,
          status: item.status,
          targetAppId: item.targetAppId,
          targetPath: item.targetPath,
          sortOrder: item.sortOrder,
        }
      : blankOffer(),
  )
  void openModal('offer')
}
async function saveOffer() {
  if (saving.value) return
  saving.value = true
  formError.value = ''
  try {
    await api<{ item: Offer }>(
      editingId.value ? `/admin/offers/${encodeURIComponent(editingId.value)}` : '/admin/offers',
      {
        method: editingId.value ? 'PATCH' : 'POST',
        body: {
          ...offerForm,
          title: offerForm.title.trim(),
          benefitText: offerForm.benefitText.trim(),
          targetAppId: offerForm.targetAppId.trim(),
          targetPath: offerForm.targetPath.trim(),
        },
      },
    )
    modal.value = null
    notify(editingId.value ? '优惠已更新' : '优惠已创建')
    await refresh()
  } catch (cause) {
    formError.value = messageOf(cause)
  } finally {
    saving.value = false
  }
}
async function toggleOffer(item: Offer) {
  if (saving.value) return
  saving.value = true
  error.value = ''
  try {
    const { id, isDemo: _isDemo, createdAt: _createdAt, updatedAt: _updatedAt, ...fields } = item
    await api<{ item: Offer }>(`/admin/offers/${encodeURIComponent(id)}`, {
      method: 'PATCH',
      body: { ...fields, status: item.status === 'active' ? 'draft' : 'active' },
    })
    notify(item.status === 'active' ? '优惠已下架，消费者入口将不再展示' : '优惠已上架')
    await refresh()
  } catch (cause) {
    error.value = messageOf(cause)
  } finally {
    saving.value = false
  }
}
function createChannel() {
  channelForm.name = ''
  channelForm.code = ''
  void openModal('channel')
}
async function saveChannel() {
  if (saving.value) return
  saving.value = true
  formError.value = ''
  try {
    await api<{ item: Channel }>('/admin/channels', {
      method: 'POST',
      body: { name: channelForm.name.trim(), code: channelForm.code.trim() },
    })
    modal.value = null
    notify('渠道已创建，可将渠道码用于小程序入口')
    await refresh()
  } catch (cause) {
    formError.value = messageOf(cause)
  } finally {
    saving.value = false
  }
}
async function createDemoOrder() {
  if (saving.value || !isDemo.value) return
  saving.value = true
  formError.value = ''
  try {
    await api<{ item: Order }>('/admin/orders/demo', {
      method: 'POST',
      body: demoChannel.value ? { channelCode: demoChannel.value } : {},
    })
    modal.value = null
    notify('已生成 1 笔演示订单，仅用于本地流程验证')
    await refresh()
  } catch (cause) {
    formError.value = messageOf(cause)
  } finally {
    saving.value = false
  }
}
async function copyChannel(code: string) {
  try {
    await navigator.clipboard.writeText(code)
    notify('渠道码已复制')
  } catch {
    error.value = '浏览器未允许复制，请选中渠道码手动复制。'
  }
}
async function loadOrderPage(offset: number) {
  if (ordersLoading.value) return
  ordersLoading.value = true
  error.value = ''
  try {
    const result = await api<{ items: Order[]; total: number }>(
      `/admin/orders?limit=${orderLimit}&offset=${offset}`,
    )
    if (!user.value) return
    orders.value = result.items
    orderTotal.value = result.total
    orderOffset.value = offset
  } catch (cause) {
    if (user.value) error.value = messageOf(cause)
  } finally {
    ordersLoading.value = false
  }
}
async function readImportFile(event: Event) {
  const file = (event.target as HTMLInputElement).files?.[0]
  if (!file) return
  formError.value = ''
  if (file.size > 2 * 1024 * 1024) {
    formError.value = '文件不能超过 2 MB；每次最多导入 500 笔订单。'
    return
  }
  try {
    importText.value = await file.text()
    importFileName.value = file.name
  } catch {
    formError.value = '无法读取文件，请重试或直接粘贴 JSON。'
  }
}
async function importOrders() {
  if (saving.value) return
  formError.value = ''
  let records: unknown
  try {
    const parsed = JSON.parse(importText.value)
    records = Array.isArray(parsed) ? parsed : parsed?.orders
    if (!Array.isArray(records) || records.length < 1 || records.length > 500) {
      formError.value = '请提供包含 1–500 笔订单的 JSON 数组，或包含 orders 数组的对象。'
      return
    }
  } catch {
    formError.value = 'JSON 格式无效，请检查逗号、引号和括号。'
    return
  }
  saving.value = true
  try {
    const result = await api<{ count: number }>('/admin/orders/import', {
      method: 'POST',
      body: { orders: records },
    })
    modal.value = null
    notify(`已导入 / 更新 ${result.count} 笔${isDemo.value ? '演示环境' : '正式环境'}订单记录`)
    await refresh()
  } catch (cause) {
    formError.value = messageOf(cause)
  } finally {
    saving.value = false
  }
}
onMounted(async () => {
  const [healthResult, sessionResult] = await Promise.allSettled([
    api<{ ok: boolean; mode: Mode }>('/health'),
    api<Session>('/admin/session'),
  ])
  if (healthResult.status === 'fulfilled') detectedMode.value = healthResult.value.mode
  if (sessionResult.status === 'fulfilled') {
    user.value = sessionResult.value.user
    configureSession(sessionResult.value.csrfToken)
    await refresh()
  } else if (!(sessionResult.reason instanceof ApiError && sessionResult.reason.status === 401)) {
    loginError.value = messageOf(sessionResult.reason)
  } else loginNotice.value = ''
  booting.value = false
})
</script>

<template>
  <div v-if="booting" class="boot-screen">
    <span class="brand-mark">邻</span>
    <div class="spinner"></div>
    <p>正在连接运营工作台…</p>
  </div>
  <div v-else-if="!user" class="login-shell">
    <section class="login-story">
      <div class="brand">
        <span class="brand-mark">邻</span
        ><span>邻享<span class="brand-secondary">运营工作台</span></span>
      </div>
      <div class="login-copy">
        <div class="eyebrow">LOCAL LIFE, REAL VALUE</div>
        <h1>把日常优惠，<br />做成长期信任。</h1>
        <p>一个入口，连接实用优惠与真实消费。<br />从清晰的渠道记录，到每一笔可核验的佣金。</p>
        <div class="login-art">
          <div class="art-card">
            <span>经营的第一步</span><strong>真实 · 可追踪 · 可结算</strong>
            <div class="art-line"></div>
            <div class="art-line short"></div>
            <div class="art-circles"><i></i><i></i><i></i><small>从身边的人开始</small></div>
          </div>
          <span class="floating-note">慢一点，先跑通。</span>
        </div>
      </div>
      <small class="login-foot">为一个人的认真经营而设计</small>
    </section>
    <section class="login-panel">
      <form class="login-form" @submit.prevent="signIn">
        <span class="badge" :class="isDemo ? 'demo' : 'neutral'">{{
          mode === 'demo' ? '演示环境 · 非真实收益' : mode === 'live' ? '正式模式' : '等待服务连接'
        }}</span>
        <h2>欢迎回来</h2>
        <p>登录你的运营工作台，继续今天的经营。</p>
        <div v-if="loginNotice" class="notice" role="status">{{ loginNotice }}</div>
        <div v-if="loginError" class="error-banner" role="alert">{{ loginError }}</div>
        <label
          >运营账号<input
            v-model="login.username"
            required
            autocomplete="username"
            placeholder="输入运营账号"
            maxlength="100"
        /></label>
        <label
          >密码<input
            v-model="login.password"
            required
            type="password"
            autocomplete="current-password"
            placeholder="输入密码"
            maxlength="200"
        /></label>
        <button class="primary login-submit" :disabled="loggingIn">
          {{ loggingIn ? '正在登录…' : '登录工作台' }}<span aria-hidden="true">→</span>
        </button>
        <div class="login-security">
          <svg viewBox="0 0 24 24" aria-hidden="true">
            <path d="M12 3l8 3v6c0 5-8 9-8 9s-8-4-8-9V6z M8 12l3 3 5-6" /></svg
          >使用服务端配置的运营账号。登录凭证以安全会话保存。
        </div>
      </form>
    </section>
  </div>
  <div v-else class="app-shell">
    <aside class="sidebar">
      <a class="brand" href="#" @click.prevent="page = 'overview'"
        ><span class="brand-mark">邻</span
        ><span>邻享<span class="brand-secondary">运营工作台</span></span></a
      >
      <div class="workspace-label">我的工作空间</div>
      <nav aria-label="主导航">
        <button
          v-for="item in navigation"
          :key="item.id"
          class="nav-item"
          :class="{ active: page === item.id }"
          :aria-current="page === item.id ? 'page' : undefined"
          @click="page = item.id"
        >
          <svg viewBox="0 0 24 24" aria-hidden="true"><path :d="item.icon" /></svg
          ><span>{{ item.title }}</span
          ><span v-if="page === item.id" class="nav-dot"></span>
        </button>
      </nav>
      <div class="sidebar-bottom">
        <div class="workspace-status">
          <span class="status-dot" :class="{ amber: isDemo }"></span
          ><strong>{{
            isDemo ? '当前为演示环境' : mode === 'live' ? '当前为正式模式' : '环境状态待确认'
          }}</strong>
          <p>
            {{
              isDemo ? '演示数据用于验证流程，不代表实际成交或收益。' : '以实际接口与结算状态为准。'
            }}
          </p>
          <button @click="page = 'settings'">查看接入状态 <span>↗</span></button>
        </div>
        <div class="sidebar-footer">邻享 CPS <span>v0.1</span></div>
      </div>
    </aside>
    <div class="main-shell">
      <header class="topbar">
        <div class="breadcrumb">
          运营工作台 <span>/</span> <strong>{{ currentPage.title }}</strong>
        </div>
        <div class="topbar-actions">
          <span class="badge" :class="isDemo ? 'demo' : 'neutral'">{{
            isDemo ? 'DEMO · 演示数据' : mode === 'live' ? 'LIVE · 正式模式' : '状态待确认'
          }}</span
          ><span class="account-avatar">{{ user.username.slice(0, 1).toUpperCase() }}</span
          ><span class="account-name">{{ user.username }}</span
          ><button class="text-button logout" :disabled="saving" @click="signOut">退出</button>
        </div>
      </header>
      <main>
        <div class="page-heading">
          <div>
            <div class="eyebrow">
              {{
                page === 'overview'
                  ? 'YOUR BUSINESS, AT A GLANCE'
                  : 'WORKSPACE / ' + page.toUpperCase()
              }}
            </div>
            <h1>{{ currentPage.title }}</h1>
            <p>{{ currentPage.subtitle }}</p>
          </div>
          <button class="button refresh-button" :disabled="loading" @click="refresh">
            <svg viewBox="0 0 24 24" aria-hidden="true">
              <path d="M20 7v5h-5 M4 17v-5h5 M18 7a7 7 0 0 0-12 0 M6 17a7 7 0 0 0 12 0" /></svg
            >{{ loading ? '更新中…' : '刷新数据' }}
          </button>
        </div>
        <div v-if="error" class="error-banner global-error" role="alert">
          <span>{{ error }}</span
          ><button class="text-button" @click="refresh">重试</button>
        </div>
        <div v-if="loading && !overview" class="empty-state loading-state">
          <div class="spinner"></div>
          <h3>正在读取经营数据</h3>
          <p>数据由当前连接的 API 服务提供。</p>
        </div>
        <template v-else-if="overview && settings">
          <template v-if="page === 'overview'">
            <section class="welcome-banner">
              <div>
                <span class="banner-kicker">{{ settings.siteName || '我的优惠入口' }}</span>
                <h2>
                  {{ isDemo ? '先把流程跑通，再让真实消费发生。' : '让每一份优惠，都有迹可循。' }}
                </h2>
                <p>
                  {{
                    isDemo
                      ? '现在可以管理优惠、建立渠道并验证演示订单。正式佣金接口接入后，才能核验真实成交。'
                      : '关注有效订单、真实结算与可持续的获客成本，把经营建立在数据之上。'
                  }}
                </p>
                <button @click="page = 'settings'">
                  {{ isDemo ? '查看上线准备' : '查看接入状态' }} <span>↗</span>
                </button>
              </div>
              <div class="banner-visual" aria-hidden="true">
                <div class="mini-ticket">
                  <span>DAILY VALUE</span><strong>好优惠<br />在身边。</strong><i></i
                  ><small>REAL CONNECTION</small>
                </div>
                <span class="ticket-dot"></span>
              </div>
            </section>
            <div v-if="isDemo" class="demo-notice">
              <span>i</span>
              <p>
                <strong>以下为演示环境统计</strong> · 演示订单与金额不代表真实消费、收入或到账。
              </p>
            </div>
            <section class="metric-grid" aria-label="经营指标">
              <article class="metric-card">
                <div class="metric-label">已上架优惠<span class="metric-icon">↗</span></div>
                <strong>{{ number(overview.metrics.enabledOffers) }}<small>项</small></strong>
                <p>共 {{ number(overview.metrics.offers) }} 项优惠内容</p>
              </article>
              <article class="metric-card">
                <div class="metric-label">入口点击<span class="metric-icon">⌁</span></div>
                <strong>{{ number(overview.metrics.clicks) }}<small>次</small></strong>
                <p>仅表示跳转意图，不代表成交</p>
              </article>
              <article class="metric-card">
                <div class="metric-label">
                  {{ isDemo ? '演示订单' : '记录订单' }}<span class="metric-icon">≡</span>
                </div>
                <strong>{{ number(overview.metrics.orders) }}<small>笔</small></strong>
                <p>{{ isDemo ? '用于验证订单展示流程' : '实际有效性以订单状态为准' }}</p>
              </article>
              <article class="metric-card money-card">
                <div class="metric-label">
                  {{ isDemo ? '演示预估佣金' : '预估佣金' }}<span class="metric-icon">¥</span>
                </div>
                <strong>{{ money(overview.metrics.estimatedCommissionCents) }}</strong>
                <p>
                  已结算{{ isDemo ? '演示记录金额' : '记录佣金' }}
                  <b>{{ money(overview.metrics.settledCommissionCents) }}</b>
                </p>
              </article>
            </section>
            <div class="overview-columns">
              <section class="panel chart-panel">
                <div class="panel-heading">
                  <div>
                    <h2>访问与订单趋势</h2>
                    <p>近 7 天记录 · 按北京时间统计</p>
                  </div>
                  <div class="chart-legend">
                    <span><i></i>点击</span><span><i></i>订单</span>
                  </div>
                </div>
                <div
                  v-if="overview.daily.length"
                  class="bar-chart"
                  :class="{ 'no-activity': !chartHasActivity }"
                >
                  <div v-for="day in overview.daily" :key="day.date" class="chart-day">
                    <div
                      class="bar-pair"
                      :title="`${day.date}：${day.clicks} 次点击，${day.orders} 笔订单`"
                    >
                      <div
                        class="bar clicks-bar"
                        :style="{ height: `${(day.clicks / chartMax) * 100}%` }"
                      >
                        <span v-if="day.clicks">{{ day.clicks }}</span>
                      </div>
                      <div
                        class="bar orders-bar"
                        :style="{ height: `${(day.orders / chartMax) * 100}%` }"
                      >
                        <span v-if="day.orders">{{ day.orders }}</span>
                      </div>
                    </div>
                    <small>{{ shortDate(day.date) }}</small>
                  </div>
                  <div v-if="!chartHasActivity" class="chart-zero">还没有点击或订单记录</div>
                </div>
                <div v-else class="empty-state compact">
                  <h3>趋势从第一条记录开始</h3>
                  <p>产生点击或订单后，这里将展示每日数据。</p>
                </div>
                <div class="chart-footnote">点击与订单独立记录，不据此推定转化或用户归属。</div>
              </section>
              <section class="panel checklist-panel">
                <div class="panel-heading">
                  <div>
                    <h2>上线准备</h2>
                    <p>一步一步，建立真实业务</p>
                  </div>
                  <span class="small-count"
                    >{{ overview.onboarding.filter((item) => item.status === 'done').length }}/{{
                      overview.onboarding.length
                    }}</span
                  >
                </div>
                <div class="checklist">
                  <div v-for="item in overview.onboarding" :key="item.id" class="checklist-item">
                    <span class="check-circle" :class="{ complete: item.status === 'done' }">{{
                      item.status === 'done' ? '✓' : '·'
                    }}</span>
                    <div>
                      <strong>{{ item.title }}</strong>
                      <p>{{ item.description }}</p>
                    </div>
                    <span class="tiny-status">{{
                      item.status === 'done' ? '完成' : '待完成'
                    }}</span>
                  </div>
                  <p v-if="!overview.onboarding.length" class="muted">暂未提供准备事项。</p>
                </div>
                <button class="panel-link" @click="page = 'settings'">
                  查看完整接入状态 <span>→</span>
                </button>
              </section>
            </div>
            <section class="panel">
              <div class="panel-heading">
                <div>
                  <h2>最近订单 <span v-if="isDemo" class="badge demo small-badge">演示</span></h2>
                  <p>区分预估、有效与已结算状态</p>
                </div>
                <button class="text-button" @click="page = 'orders'">查看全部 →</button>
              </div>
              <div v-if="overview.recentOrders.length" class="table-scroll">
                <table>
                  <thead>
                    <tr>
                      <th>订单编号</th>
                      <th>来源渠道</th>
                      <th>佣金</th>
                      <th>订单状态</th>
                      <th>下单时间</th>
                    </tr>
                  </thead>
                  <tbody>
                    <tr v-for="order in overview.recentOrders" :key="order.id">
                      <td>
                        <span class="order-id">{{ order.externalOrderId }}</span
                        ><span v-if="order.isDemo" class="badge demo small-badge">演示</span
                        ><span v-if="order.source === 'manual'" class="badge neutral small-badge"
                          >人工导入</span
                        >
                      </td>
                      <td>{{ channelName(order.channelCode) }}</td>
                      <td class="currency">{{ money(order.commissionCents) }}</td>
                      <td>
                        <span class="status-pill" :class="order.status">{{
                          orderStates[order.status]
                        }}</span>
                      </td>
                      <td class="muted">{{ timestamp(order.orderedAt) }}</td>
                    </tr>
                  </tbody>
                </table>
              </div>
              <div v-else class="empty-state compact">
                <div class="empty-symbol">↗</div>
                <h3>等待第一笔订单</h3>
                <p>
                  {{
                    isDemo
                      ? '可前往订单页生成明确标记的演示记录，验证流程。'
                      : '完成联盟接入后，真实订单将由服务端同步。'
                  }}
                </p>
              </div>
            </section>
          </template>

          <template v-else-if="page === 'offers'">
            <div class="section-toolbar">
              <div class="filter-tabs" aria-label="优惠状态">
                <button :class="{ selected: offerFilter === 'all' }" @click="offerFilter = 'all'">
                  全部优惠 <span>{{ offers.length }}</span></button
                ><button
                  :class="{ selected: offerFilter === 'active' }"
                  @click="offerFilter = 'active'"
                >
                  已上架</button
                ><button
                  :class="{ selected: offerFilter === 'draft' }"
                  @click="offerFilter = 'draft'"
                >
                  草稿 / 已下架
                </button>
              </div>
              <button class="primary" :disabled="saving" @click="editOffer()">
                <span>＋</span> 新增优惠
              </button>
            </div>
            <div class="panel">
              <div class="list-toolbar">
                <input
                  v-model="offerSearch"
                  class="search-input"
                  aria-label="搜索优惠"
                  placeholder="搜索优惠名称、描述或优惠说明"
                /><span class="muted">{{ filteredOffers.length }} 项内容</span>
              </div>
              <div v-if="filteredOffers.length" class="offer-list">
                <article v-for="offer in filteredOffers" :key="offer.id" class="offer-row">
                  <div class="offer-art" :class="offer.category">
                    <svg viewBox="0 0 24 24" aria-hidden="true">
                      <path
                        :d="
                          offer.category === 'coffee'
                            ? 'M5 8h12v7a5 5 0 0 1-10 0V8 M17 9h2a3 3 0 0 1 0 6h-2 M8 3v2 M12 3v2 M4 21h16'
                            : offer.category === 'travel'
                              ? 'M3 11l18-8-8 18-2-8z M11 13l10-10'
                              : 'M4 3v7a3 3 0 0 0 6 0V3 M7 3v18 M20 3c-4 2-5 7-3 9h3 M20 3v18'
                        "
                      />
                    </svg>
                  </div>
                  <div class="offer-info">
                    <div class="offer-title">
                      <h3>{{ offer.title }}</h3>
                      <span
                        class="status-pill"
                        :class="offer.status === 'active' ? 'valid' : 'pending'"
                        >{{ offer.status === 'active' ? '已上架' : '草稿' }}</span
                      >
                    </div>
                    <p>{{ offer.description || '暂无描述' }}</p>
                    <div class="offer-meta">
                      <span>{{ platformName(offer.platform) }}</span
                      ><span>{{ categories[offer.category] }}</span
                      ><span>排序 {{ offer.sortOrder }}</span
                      ><span :class="{ 'warning-text': !offer.targetAppId || !offer.targetPath }">{{
                        offer.targetAppId && offer.targetPath ? '推广目标已填写' : '推广目标待配置'
                      }}</span>
                    </div>
                  </div>
                  <div class="offer-benefit">{{ offer.benefitText || '暂无优惠说明' }}</div>
                  <div class="row-actions">
                    <button class="button small" :disabled="saving" @click="editOffer(offer)">
                      编辑</button
                    ><button
                      class="text-button"
                      :class="{ 'warning-text': offer.status === 'active' }"
                      :disabled="saving"
                      @click="toggleOffer(offer)"
                    >
                      {{ offer.status === 'active' ? '下架' : '上架' }}
                    </button>
                  </div>
                </article>
              </div>
              <div v-else class="empty-state">
                <div class="empty-symbol">◇</div>
                <h3>{{ offers.length ? '没有匹配的优惠' : '从一项实用优惠开始' }}</h3>
                <p>
                  {{
                    offers.length
                      ? '试试其他关键词或状态筛选。'
                      : '添加标题、优惠说明与官方推广目标，准备消费者入口。'
                  }}
                </p>
                <button v-if="!offers.length" class="primary" @click="editOffer()">
                  新增第一项优惠
                </button>
              </div>
            </div>
            <p class="page-note">
              上架决定是否在小程序中展示；真实跳转还需要服务端允许并正确配置的官方推广目标。
            </p>
          </template>

          <template v-else-if="page === 'channels'">
            <div class="section-toolbar">
              <div class="section-intro">
                <h2>让每个入口都有名字</h2>
                <p>建议按真实场景建渠道，例如「软件园午餐群」或「社区合作点」。</p>
              </div>
              <button class="primary" @click="createChannel()">＋ 新建渠道</button>
            </div>
            <div class="channel-notice">
              <span class="notice-icon">↳</span>
              <div>
                <strong>渠道码用于记录入口来源</strong>
                <p>
                  小程序首页路径为 pages/home/index?channel=渠道码。本地渠道码不等于联盟上游
                  sid；真实归因需额外对接与核验，不代表永久绑定用户。
                </p>
              </div>
            </div>
            <div v-if="channels.length" class="channel-grid">
              <article v-for="channel in channels" :key="channel.id" class="panel channel-card">
                <div class="channel-card-top">
                  <span class="channel-icon">↗</span><span class="badge neutral">渠道</span>
                </div>
                <h3>{{ channel.name }}</h3>
                <div class="channel-code">
                  <code>{{ channel.code }}</code
                  ><button class="text-button" @click="copyChannel(channel.code)">复制</button>
                </div>
                <div class="channel-usage">
                  <span>小程序入口路径</span
                  ><code>pages/home/index?channel={{ channel.code }}</code>
                  <p>本地渠道记录不等于联盟上游归因标识。</p>
                </div>
                <div class="channel-created">创建于 {{ timestamp(channel.createdAt) }}</div>
              </article>
              <button class="add-channel-card" @click="createChannel()">
                <span>＋</span><strong>新建一个渠道</strong>
                <p>从身边可触达的场景开始</p>
              </button>
            </div>
            <div v-else class="panel empty-state">
              <div class="empty-symbol">↳</div>
              <h3>先创建第一个渠道</h3>
              <p>为不同社群或合作点分别建码，让来源可区分。</p>
              <button class="primary" @click="createChannel()">创建渠道</button>
            </div>
          </template>

          <template v-else-if="page === 'orders'">
            <div v-if="isDemo" class="demo-notice">
              <span>i</span>
              <p><strong>演示环境</strong> · 生成的记录全部带有演示标记，不产生真实交易或收益。</p>
            </div>
            <div v-else-if="!settings.provider.apiEnabled" class="notice">
              真实订单接口尚未启用。可先导入联盟后台真实订单报表；这里不会根据点击数自动生成订单。
            </div>
            <div class="section-toolbar">
              <div class="section-intro">
                <h2>
                  订单明细 <span class="count-label">{{ orderTotal }}</span>
                </h2>
                <p>已结算状态来自订单记录，不等于已核验银行到账。</p>
              </div>
              <div class="toolbar-actions">
                <button v-if="isDemo" class="button" :disabled="saving" @click="openModal('demo')">
                  ＋ 生成演示订单</button
                ><button class="primary" :disabled="saving" @click="openModal('import')">
                  导入订单 JSON
                </button>
              </div>
            </div>
            <section class="panel">
              <div class="list-toolbar order-filters">
                <input
                  v-model="orderSearch"
                  class="search-input"
                  aria-label="搜索订单"
                  placeholder="搜索订单编号或渠道码"
                /><select v-model="orderFilter" aria-label="筛选订单状态">
                  <option value="all">全部状态</option>
                  <option v-for="(label, key) in orderStates" :key="key" :value="key">
                    {{ label }}
                  </option></select
                ><select v-model="orderChannel" aria-label="筛选渠道">
                  <option value="all">全部渠道</option>
                  <option v-for="channel in channels" :key="channel.id" :value="channel.code">
                    {{ channel.name }}
                  </option>
                </select>
              </div>
              <div v-if="filteredOrders.length" class="table-scroll">
                <table>
                  <thead>
                    <tr>
                      <th>订单 / 平台</th>
                      <th>渠道</th>
                      <th>订单金额</th>
                      <th>佣金金额</th>
                      <th>状态</th>
                      <th>下单 / 结算时间</th>
                    </tr>
                  </thead>
                  <tbody>
                    <tr v-for="order in filteredOrders" :key="order.id">
                      <td>
                        <div class="order-id">{{ order.externalOrderId }}</div>
                        <div class="cell-sub">
                          {{ platformName(order.platform) }}
                          <span
                            class="badge small-badge"
                            :class="order.isDemo ? 'demo' : 'green'"
                            >{{ order.isDemo ? '演示环境' : '正式环境' }}</span
                          ><span class="badge neutral small-badge">{{
                            order.source === 'manual' ? '人工导入' : '演示生成'
                          }}</span>
                        </div>
                      </td>
                      <td>
                        <div>{{ channelName(order.channelCode) }}</div>
                        <code class="cell-sub">{{ order.channelCode || '—' }}</code>
                      </td>
                      <td class="currency">{{ money(order.orderAmountCents) }}</td>
                      <td class="currency commission-cell">
                        {{ money(order.commissionCents)
                        }}<small v-if="order.isDemo">演示金额</small>
                      </td>
                      <td>
                        <span class="status-pill" :class="order.status">{{
                          orderStates[order.status]
                        }}</span>
                      </td>
                      <td>
                        <div>{{ timestamp(order.orderedAt) }}</div>
                        <div class="cell-sub">结算：{{ timestamp(order.settledAt) }}</div>
                      </td>
                    </tr>
                  </tbody>
                </table>
              </div>
              <div v-else class="empty-state">
                <div class="empty-symbol">≡</div>
                <h3>{{ orders.length ? '没有匹配的订单' : '暂无订单记录' }}</h3>
                <p>
                  {{
                    orders.length
                      ? '调整关键词、渠道或订单状态后重试。'
                      : isDemo
                        ? '生成一笔明确标记的演示订单，检查展示和渠道记录。'
                        : '可先导入来自联盟后台的真实订单报表；接口接入后再启用同步。'
                  }}
                </p>
              </div>
              <div class="table-footer">
                <span
                  >当前页显示 {{ filteredOrders.length }} / {{ orders.length }} 条 · 共
                  {{ orderTotal }} 条（筛选仅作用于当前页）</span
                >
                <div class="pagination">
                  <button
                    class="text-button"
                    :disabled="orderOffset === 0 || ordersLoading"
                    @click="loadOrderPage(Math.max(0, orderOffset - orderLimit))"
                  >
                    上一页</button
                  ><span
                    >{{ Math.floor(orderOffset / orderLimit) + 1 }} /
                    {{ Math.max(1, Math.ceil(orderTotal / orderLimit)) }}</span
                  ><button
                    class="text-button"
                    :disabled="orderOffset + orderLimit >= orderTotal || ordersLoading"
                    @click="loadOrderPage(orderOffset + orderLimit)"
                  >
                    下一页
                  </button>
                </div>
              </div>
              <div class="table-time-note">
                订单时间以北京时间显示 · 金额单位：人民币 · 已结算为记录状态，须另外核验到账
              </div>
            </section>
            <div class="order-flow">
              <span>待确认</span><i>→</i><span>已有效</span><i>→</i><span>已结算</span>
              <p>取消、退款或归因无效的订单可能失效；以最终结算为准。</p>
            </div>
          </template>

          <template v-else-if="page === 'settings'">
            <section class="connection-banner">
              <span class="connection-symbol">↗</span>
              <div>
                <span class="eyebrow">CONNECTION STATUS</span>
                <h2>
                  {{ settings.provider.apiEnabled ? '订单接口已启用' : '真实联盟订单接口尚未启用' }}
                </h2>
                <p>
                  {{
                    settings.provider.apiEnabled
                      ? '启用状态由服务端报告，仍需核对授权、真实订单及结算结果。'
                      : '先取得联盟资质和推广权限，再完成真实接口对接。当前系统不会把入口点击当作订单。'
                  }}
                </p>
              </div>
              <span class="badge" :class="settings.provider.apiEnabled ? 'green' : 'demo'">{{
                settings.provider.apiEnabled ? '已启用' : '待接入'
              }}</span>
            </section>
            <div class="settings-grid">
              <section class="panel settings-panel">
                <div class="panel-heading">
                  <h2>基础信息</h2>
                  <span class="badge neutral">只读</span>
                </div>
                <dl class="settings-list">
                  <div>
                    <dt>入口名称</dt>
                    <dd>{{ settings.siteName || '未配置' }}</dd>
                  </div>
                  <div>
                    <dt>运行模式</dt>
                    <dd>
                      <span class="badge" :class="isDemo ? 'demo' : 'green'">{{
                        isDemo ? '演示模式' : '正式模式'
                      }}</span>
                    </dd>
                  </div>
                  <div>
                    <dt>客服微信</dt>
                    <dd>{{ settings.supportWechat || '未配置' }}</dd>
                  </div>
                  <div>
                    <dt>公网地址</dt>
                    <dd>
                      <span
                        class="status-pill"
                        :class="settings.deployment.publicOriginConfigured ? 'valid' : 'pending'"
                        >{{
                          settings.deployment.publicOriginConfigured ? '已配置' : '未配置'
                        }}</span
                      >
                    </dd>
                  </div>
                </dl>
                <p class="settings-help">这些配置由服务端环境变量管理，本页面不展示任何密钥。</p>
              </section>
              <section class="panel settings-panel">
                <div class="panel-heading">
                  <h2>推广与订单接口</h2>
                  <span class="badge neutral">服务端状态</span>
                </div>
                <dl class="settings-list">
                  <div>
                    <dt>服务提供方</dt>
                    <dd>{{ settings.provider.name || '未设置' }}</dd>
                  </div>
                  <div>
                    <dt>接口凭据</dt>
                    <dd>
                      <span
                        class="status-pill"
                        :class="settings.provider.credentialsConfigured ? 'valid' : 'pending'"
                        >{{ settings.provider.credentialsConfigured ? '已配置' : '未配置' }}</span
                      >
                    </dd>
                  </div>
                  <div>
                    <dt>订单 API</dt>
                    <dd>
                      <span
                        class="status-pill"
                        :class="settings.provider.apiEnabled ? 'valid' : 'pending'"
                        >{{ settings.provider.apiEnabled ? '已启用' : '未启用' }}</span
                      >
                    </dd>
                  </div>
                  <div>
                    <dt>订单生成方式</dt>
                    <dd>
                      {{
                        isDemo
                          ? '演示生成 / 人工导入（均标记演示）'
                          : settings.provider.apiEnabled
                            ? '实际服务端订单记录 / 人工导入'
                            : '人工导入联盟报表'
                      }}
                    </dd>
                  </div>
                </dl>
                <p class="settings-help">
                  填写凭据不等于已取得授权或已通过联调。真实可用性需用实际业务验证。
                </p>
              </section>
            </div>
            <section class="panel limitations-panel">
              <div class="panel-heading">
                <div>
                  <h2>当前能力与边界</h2>
                  <p>以下内容由服务端报告，请作为上线前核对依据。</p>
                </div>
              </div>
              <ul v-if="settings.limitations.length" class="limitations-list">
                <li v-for="(limitation, index) in settings.limitations" :key="index">
                  <span>{{ String(index + 1).padStart(2, '0') }}</span
                  >{{ limitation }}
                </li>
              </ul>
              <div v-else class="empty-state compact"><p>服务端未提供额外限制说明。</p></div>
            </section>
            <p class="page-note">
              系统当前没有消费者钱包、收款或返现功能。演示模式与正式模式由服务端控制。
            </p>
          </template>
        </template>
        <div v-else-if="!loading" class="panel empty-state">
          <h3>经营数据暂未加载</h3>
          <p>检查 API 服务后刷新重试。</p>
          <button class="primary" @click="refresh">重新加载</button>
        </div>
        <footer class="main-footer">
          <span>邻享 · 认真经营每一次连接</span><span>真实消费，真实记录。</span>
        </footer>
      </main>
    </div>
  </div>

  <div v-if="toast && user" class="toast" role="status"><span>✓</span>{{ toast }}</div>
  <div v-if="modal && user" class="modal-backdrop" @click.self="closeModal">
    <section
      class="dialog"
      :class="{ 'wide-dialog': modal === 'offer' || modal === 'import' }"
      role="dialog"
      aria-modal="true"
      aria-labelledby="dialog-title"
      @keydown="modalKeys"
    >
      <div class="dialog-heading">
        <div>
          <span class="eyebrow">{{
            modal === 'offer'
              ? 'OFFER DETAILS'
              : modal === 'channel'
                ? 'CHANNEL DETAILS'
                : modal === 'import'
                  ? 'MANUAL ORDER IMPORT'
                  : 'DEMO RECORD'
          }}</span>
          <h2 id="dialog-title">
            {{
              modal === 'offer'
                ? editingId
                  ? '编辑优惠'
                  : '新增优惠'
                : modal === 'channel'
                  ? '新建渠道'
                  : modal === 'import'
                    ? '导入订单记录'
                    : '生成演示订单'
            }}
          </h2>
        </div>
        <button class="icon-button" aria-label="关闭弹窗" :disabled="saving" @click="closeModal">
          ×
        </button>
      </div>
      <form v-if="modal === 'offer'" @submit.prevent="saveOffer">
        <div class="dialog-body">
          <div v-if="formError" class="error-banner" role="alert">{{ formError }}</div>
          <label
            >优惠标题 <span class="required">*</span
            ><input
              v-model="offerForm.title"
              required
              minlength="2"
              maxlength="80"
              placeholder="例如：午餐外卖优惠入口"
          /></label>
          <div class="form-grid">
            <label
              >平台<select v-model="offerForm.platform">
                <option value="meituan">美团</option>
                <option value="other">其他平台</option>
              </select></label
            ><label
              >分类<select v-model="offerForm.category">
                <option v-for="(label, key) in categories" :key="key" :value="key">
                  {{ label }}
                </option>
              </select></label
            >
          </div>
          <label
            >优惠说明 <span class="required">*</span
            ><input
              v-model="offerForm.benefitText"
              required
              maxlength="120"
              placeholder="如实描述优惠条件，不承诺固定优惠金额" /></label
          ><label
            >详细描述<textarea
              v-model="offerForm.description"
              rows="3"
              maxlength="1200"
              placeholder="适用范围、活动条件及使用提示"
            />
          </label>
          <div class="form-divider">
            <strong>官方推广目标</strong><span>来自已获授权的官方推广链接 / 参数</span>
          </div>
          <label
            >目标小程序 AppID<input
              v-model="offerForm.targetAppId"
              maxlength="32"
              placeholder="未取得官方参数时可先留空存为草稿" /></label
          ><label
            >目标页面路径<textarea
              v-model="offerForm.targetPath"
              rows="2"
              maxlength="2048"
              placeholder="填写包含正确推广参数的官方页面路径"
            />
          </label>
          <p class="field-help">填写路径不代表已完成返佣归因；正式模式下还需通过服务端目标校验。</p>
          <div class="form-grid">
            <label
              >发布状态<select v-model="offerForm.status">
                <option value="draft">草稿 / 下架</option>
                <option value="active">上架展示</option>
              </select></label
            ><label
              >排序值<input
                v-model.number="offerForm.sortOrder"
                type="number"
                required
                step="1"
                min="0"
                max="9999"
            /></label>
          </div>
        </div>
        <div class="dialog-footer">
          <button type="button" class="button" :disabled="saving" @click="closeModal">取消</button
          ><button class="primary" :disabled="saving">{{ saving ? '保存中…' : '保存优惠' }}</button>
        </div>
      </form>
      <form v-else-if="modal === 'channel'" @submit.prevent="saveChannel">
        <div class="dialog-body">
          <div v-if="formError" class="error-banner" role="alert">{{ formError }}</div>
          <label
            >渠道名称 <span class="required">*</span
            ><input
              v-model="channelForm.name"
              required
              maxlength="100"
              placeholder="例如：软件园午餐群" /></label
          ><label
            >渠道码 <span class="required">*</span
            ><input
              v-model="channelForm.code"
              required
              minlength="2"
              maxlength="32"
              pattern="[a-z0-9_-]{2,32}"
              autocomplete="off"
              placeholder="例如：qingdao-lunch-01"
          /></label>
          <p class="field-help">
            2–32 位小写英文字母、数字、下划线或短横线。建议使用容易辨认的唯一编码。
          </p>
          <div class="notice">
            渠道创建后，使用 pages/home/index?channel=渠道码
            作为小程序入口。这里只创建记录，不会自动生成或分发小程序码。
          </div>
        </div>
        <div class="dialog-footer">
          <button type="button" class="button" :disabled="saving" @click="closeModal">取消</button
          ><button class="primary" :disabled="saving">{{ saving ? '创建中…' : '创建渠道' }}</button>
        </div>
      </form>
      <form v-else-if="modal === 'import'" @submit.prevent="importOrders">
        <div class="dialog-body">
          <div v-if="formError" class="error-banner" role="alert">{{ formError }}</div>
          <div class="notice">
            {{
              isDemo
                ? '当前是演示环境，人工导入记录也会带有演示标记。'
                : '当前是正式环境，请仅导入来自联盟报表的真实记录。'
            }}
            相同订单将更新已有记录，不会重复累计。已结算记录并不证明银行到账。
          </div>
          <label
            >选择 JSON 文件<input
              type="file"
              accept=".json,application/json"
              @change="readImportFile"
          /></label>
          <p v-if="importFileName" class="field-help">已读取：{{ importFileName }}</p>
          <label
            >订单 JSON <span class="required">*</span
            ><textarea
              v-model="importText"
              class="json-editor"
              rows="10"
              required
              spellcheck="false"
              placeholder='粘贴 JSON 数组，或 { "orders": [...] } 对象'
            />
          </label>
          <p class="field-help">
            每次 1–500 笔；金额使用整数分；时间使用 ISO UTC。已结算订单必须填写
            settledAt，其他状态可为 null。
          </p>
          <button
            type="button"
            class="text-button import-example-toggle"
            @click="importExampleVisible = !importExampleVisible"
          >
            {{ importExampleVisible ? '收起格式示例' : '查看格式示例（示例不是实际订单）' }}
          </button>
          <pre v-if="importExampleVisible" class="json-example">{{ importExample }}</pre>
        </div>
        <div class="dialog-footer">
          <button type="button" class="button" :disabled="saving" @click="closeModal">取消</button
          ><button class="primary" :disabled="saving || !importText.trim()">
            {{ saving ? '导入中…' : '导入 / 更新记录' }}
          </button>
        </div>
      </form>
      <form v-else @submit.prevent="createDemoOrder">
        <div class="dialog-body">
          <div v-if="formError" class="error-banner" role="alert">{{ formError }}</div>
          <div class="demo-notice">
            <span>i</span>
            <p>
              这将生成
              <strong>1 笔演示订单</strong>，用于验证列表、渠道与统计。不会创建真实消费或收益。
            </p>
          </div>
          <label
            >来源渠道<select v-model="demoChannel">
              <option value="">默认演示渠道</option>
              <option v-for="channel in channels" :key="channel.id" :value="channel.code">
                {{ channel.name }} · {{ channel.code }}
              </option>
            </select></label
          >
        </div>
        <div class="dialog-footer">
          <button type="button" class="button" :disabled="saving" @click="closeModal">取消</button
          ><button class="primary" :disabled="saving || !isDemo">
            {{ saving ? '生成中…' : '生成 1 笔演示订单' }}
          </button>
        </div>
      </form>
    </section>
  </div>
</template>
