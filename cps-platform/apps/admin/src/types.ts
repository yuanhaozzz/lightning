export type Mode = 'demo' | 'live'
export type OfferStatus = 'draft' | 'active'
export type Platform = 'meituan' | 'other'
export type Category = 'food' | 'coffee' | 'travel' | 'other'
export interface OfferInput {
  title: string
  platform: Platform
  category: Category
  description: string
  benefitText: string
  status: OfferStatus
  targetAppId: string
  targetPath: string
  sortOrder: number
}
export interface Offer extends OfferInput {
  id: string
  isDemo: boolean
  createdAt: string
  updatedAt: string
}
export interface Channel {
  id: string
  code: string
  name: string
  createdAt: string
}
export interface Order {
  id: string
  externalOrderId: string
  platform: Platform
  status: 'pending' | 'valid' | 'settled' | 'invalid'
  orderAmountCents: number
  commissionCents: number
  channelCode: string
  orderedAt: string
  settledAt: string | null
  isDemo: boolean
  source: 'manual' | 'demo'
}
export interface Overview {
  mode: Mode
  metrics: {
    offers: number
    enabledOffers: number
    clicks: number
    orders: number
    estimatedCommissionCents: number
    settledCommissionCents: number
  }
  daily: { date: string; clicks: number; orders: number; commissionCents: number }[]
  onboarding: { id: string; title: string; status: 'pending' | 'done'; description: string }[]
  recentOrders: Order[]
}
export interface Settings {
  mode: Mode
  siteName: string
  supportWechat: string
  provider: { name: string; credentialsConfigured: boolean; apiEnabled: boolean }
  deployment: { publicOriginConfigured: boolean }
  limitations: string[]
}
export interface Session {
  user: { username: string }
  csrfToken: string
}
