export type RiskLevel = 'normal' | 'attention' | 'warning' | 'impact'
export interface Tenant { id:string; name:string; type:string; lon:number; lat:number; risk:RiskLevel; lightningDistance:number; stormDistance:number; eta?:number; maxDbz:number; lightning10m:number; polygon:number[][]; devices:{name:string;lon:number;lat:number;type:string}[] }
export interface LightningStrike { id:string;lon:number;lat:number;ageMinutes:number;polarity:'positive'|'negative';intensity:number }
export interface RadarCell { lon:number;lat:number;dbz:number;size:number }
export interface StormCell { id:string;name:string;lon:number;lat:number;direction:number;speed:number;radius:number;targetTenantId?:string }
