# CPS v0.1 API contract

All API amounts are integer CNY cents; timestamps ISO UTC. Error shape `{ error: { code, message } }`. Success collections `{ items: [...] }`. No user wallet, payments or consumer cashbacks. Local preview may use explicitly labeled demo records. Mode `demo` or `live` is server-controlled.

## Admin session
- `POST /api/admin/login` `{username,password}` -> `{user:{username},csrfToken}`, HttpOnly session cookie.
- `GET /api/admin/session` -> same shape or 401.
- `DELETE /api/admin/session` -> `{ok:true}`.
- All admin mutations except login require `X-CSRF-Token` and cookie. UI must send credentials same-origin; Vite proxies `/api`.

## Admin resources
- `GET /api/admin/overview` -> `{mode,metrics:{offers,enabledOffers,clicks,orders,estimatedCommissionCents,settledCommissionCents},daily:[{date,clicks,orders,commissionCents}],onboarding:[{id,title,status,description}],recentOrders:Order[]}`. statuses `pending`/`done` for onboarding.
- `GET /api/admin/offers` -> `{items:Offer[]}`.
- `POST /api/admin/offers` / `PATCH /api/admin/offers/:id` body: `{title,platform,category,description,benefitText,status,targetAppId,targetPath,sortOrder}`; status `draft` or `active`; platform `meituan`/`other`; category `food`/`coffee`/`travel`/`other`; optional target strings default empty. -> `{item:Offer}`.
- `GET /api/admin/channels` -> `{items:[{id,code,name,createdAt}]}`.
- `POST /api/admin/channels` `{code,name}` -> `{item:Channel}`. code 2–32 lowercase letters/digits/underscore/hyphen.
- `GET /api/admin/orders` -> `{items:Order[]}`.
- `POST /api/admin/orders/demo` `{channelCode?}` -> `{item:Order}`; demo-only, explicit simulation; live returns 403.
- `GET /api/admin/settings` -> `{mode,siteName,supportWechat,provider:{name,credentialsConfigured,apiEnabled},deployment:{publicOriginConfigured},limitations:string[]}`. Never return secrets.

`Offer`: id,title,platform,category,description,benefitText,status,targetAppId,targetPath,sortOrder,createdAt,updatedAt.
`Order`: id,externalOrderId,platform,status (`pending`/`valid`/`settled`/`invalid`),orderAmountCents,commissionCents,channelCode,orderedAt,settledAt (nullable),isDemo (boolean).

## Public mini-program
- `GET /api/public/config` -> `{siteName,mode,supportWechat,notice,categories:[{id,name}],privacyText}`.
- `GET /api/public/offers?category=&search=` -> `{items:PublicOffer[]}` active only. PublicOffer excludes targetAppId/targetPath (obtained via launch); includes id,title,platform,category,description,benefitText.
- `GET /api/public/offers/:id` -> `{item:PublicOffer}` active only.
- `POST /api/public/offers/:id/launch` `{channelCode?}` -> demo: `{mode:'demo',message}`; live: `{mode:'live',appId,path}`. Logs a click intent, NOT an order. Live only allows configured official/manual promotion targets; never returns invented target IDs.
- `GET /api/health` -> `{ok:true,mode}`.

Native mini-program imports its own config.js; default local `http://127.0.0.1:3018` for devtools. Production request domain must be HTTPS and registered in WeChat console. Consumers do not need login. No fabricated order conversion or lifetime-user attribution.
