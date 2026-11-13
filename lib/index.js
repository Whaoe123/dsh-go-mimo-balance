// 小米开放平台余额：状态条常驻一行，点开面板看明细。
// 运行在 DSH 引擎（Node）里；App 只按 package.json 的 dshGo 声明来画。
import { readFileSync } from 'node:fs'
import { homedir } from 'node:os'
import { join } from 'node:path'

export const name = 'local-mimo-balance'

const KEY_ENV = 'CUSTOM_XIAOMIMIMO_API_KEY'
const DEFAULT_URL = 'https://api.xiaomimimo.com/v1/platform/balance'
const BALANCE_URL = process.env.MIMO_BALANCE_URL || DEFAULT_URL
const CACHE_TTL = 60_000                 // 余额准实时（平台口径 5 分钟内延迟），一分钟缓存够用
const POLL_MS = Number(process.env.MIMO_BALANCE_POLL_MS) || 5 * 60_000
const PANEL_REFRESH_MS = 60_000          // 面板打开期间每分钟跟随缓存刷新一次
const WARN_BELOW = Number(process.env.MIMO_BALANCE_WARN_BELOW ?? 5)  // 自有余额（现金+赠金）低于此值时预警

let cached = null        // { at, data } | null
let inflight = null      // Promise | null

// 只匹配行首的键，避免 yaml 换行写法把下一行的值误读成密钥
const KEY_LINE = new RegExp(`^[ \\t]*${KEY_ENV}[ \\t]*[:=][ \\t]*([^\\r\\n#]+)`, 'm')

function credentialsPath() {
  const home = process.env.DSH_HOME && process.env.DSH_HOME.length > 0
    ? process.env.DSH_HOME
    : join(homedir(), '.dsh')
  return [join(home, '.credentials.yaml'), join(home, '.credentials.yml')]
}

function loadKey() {
  const fromEnv = process.env[KEY_ENV]
  if (fromEnv && fromEnv.trim().length > 0) return fromEnv.trim()
  for (const fp of credentialsPath()) {
    let raw
    try { raw = readFileSync(fp, 'utf8') } catch { continue }
    const m = raw.match(KEY_LINE)
    if (!m) continue
    const v = m[1].trim().replace(/^["']|["']$/g, '').trim()
    if (v) return v
  }
  return null
}

function failure(code, detail) {
  const err = new Error(code)
  err.code = code
  if (detail) err.detail = detail
  return err
}

const num = (v) => {
  const n = Number(v)
  return Number.isFinite(n) ? n : 0
}

async function requestBalance(signal) {
  const key = loadKey()
  if (!key) throw failure('no_key')

  const ctrl = new AbortController()
  let timedOut = false
  const timer = setTimeout(() => { timedOut = true; ctrl.abort() }, 15_000)
  const onAbort = () => ctrl.abort()
  if (signal) {
    if (signal.aborted) ctrl.abort()
    else signal.addEventListener('abort', onAbort, { once: true })
  }

  try {
    let res
    try {
      res = await fetch(BALANCE_URL, {
        headers: { Authorization: `Bearer ${key}` },
        signal: ctrl.signal,
      })
    } catch {
      if (timedOut) throw failure('timeout')
      throw failure(signal && signal.aborted ? 'aborted' : 'network')
    }

    // 把状态码翻成人能看懂的失败原因，面板据此给不同的提示
    if (res.status === 401 || res.status === 403) throw failure('unauthorized')
    if (res.status === 429) throw failure('rate_limited')
    if (res.status === 404) throw failure('not_found')
    if (!res.ok) throw failure(`http_${res.status}`)

    let body
    try {
      body = await res.json()
    } catch {
      throw failure('bad_body')
    }
    const info = Array.isArray(body && body.balance_infos) ? body.balance_infos[0] : null
    if (!info) throw failure('bad_body')

    const cash = num(info.cash_balance)
    const gift = num(info.gift_balance)
    return {
      available: body.is_available !== false,
      currency: info.currency || 'CNY',
      total: num(info.total_available),
      cash,
      gift,
      frozen: num(info.frozen_balance),
      creditLimit: num(info.credit_limit),
      creditAvailable: num(info.credit_available),
      own: cash + gift,     // 自有余额：总可用 = 自有 + 可用授信，拆开才不会“数字对不上”
      at: Date.now(),
    }
  } finally {
    clearTimeout(timer)
    if (signal) signal.removeEventListener('abort', onAbort)
  }
}

function getBalance({ force = false, signal } = {}) {
  if (!force && cached && Date.now() - cached.at < CACHE_TTL) return Promise.resolve(cached.data)
  if (inflight) return inflight
  inflight = requestBalance(signal)
    .then((data) => {
      cached = { at: data.at, data }
      return data
    })
    .finally(() => { inflight = null })
  return inflight
}

const SYMBOLS = { CNY: '¥', USD: '$', HKD: 'HK$', EUR: '€' }

function money(n, currency = 'CNY') {
  const symbol = SYMBOLS[currency]
  return symbol ? `${symbol}${n.toFixed(2)}` : `${n.toFixed(2)} ${currency}`
}

const ERROR_TEXT = {
  no_key: '未配置密钥',
  unauthorized: '密钥无效',
  rate_limited: '请求过于频繁',
  timeout: '请求超时',
  network: '网络异常',
  not_found: '接口地址无效',
  bad_body: '响应格式异常',
}

const ERROR_HINT = {
  no_key: `在 ~/.dsh/.credentials.yaml 配置 ${KEY_ENV}`,
  unauthorized: `检查 ${KEY_ENV} 是否为有效的普通 API Key（sk- 开头）`,
  rate_limited: '稍后重试，或调大 MIMO_BALANCE_POLL_MS',
  network: '检查本机网络或代理设置',
  not_found: '接口地址可能已变更，检查 MIMO_BALANCE_URL',
  bad_body: '接口返回结构变化，可反馈作者',
}

const errorText = (err) => ERROR_TEXT[err && err.code] || '查询失败'
const errorHint = (err) => ERROR_HINT[err && err.code] || ''

function clock(at) {
  const now = new Date(at || Date.now())
  const hh = String(now.getHours()).padStart(2, '0')
  const mm = String(now.getMinutes()).padStart(2, '0')
  return `${hh}:${mm}`
}

function toPatch(b) {
  return {
    total: money(b.total, b.currency),
    cash: money(b.cash, b.currency),
    gift: money(b.gift, b.currency),
    creditAvailable: money(b.creditAvailable, b.currency),
    creditLimit: money(b.creditLimit, b.currency),
    frozen: money(b.frozen, b.currency),
    status: b.available ? '正常' : '不可用',
    updated: `更新于 ${clock(b.at)} · ${b.currency}`,
    caption: b.creditAvailable > 0
      ? `自有 ${money(b.own, b.currency)} + 可用授信 ${money(b.creditAvailable, b.currency)}`
      : `自有余额 ${money(b.own, b.currency)}`,
  }
}

function toErrorPatch(err) {
  return {
    total: '—',
    cash: '—',
    gift: '—',
    creditAvailable: '—',
    creditLimit: '—',
    frozen: '—',
    status: errorText(err),
    updated: errorHint(err),
    caption: '',
  }
}

export function apply(ctx) {
  ctx.inject(['dshGo'], (ctx) => {
    // 状态条：输入框上方常驻一行余额
    ctx.dshGo.strip('mimo-balance-strip', (scope, emit, caps) => {
      const zh = !String(caps && caps.locale).startsWith('en')
      let stopped = false
      const tick = async () => {
        try {
          const b = await getBalance()
          if (stopped) return
          const tone = !b.available ? 'bad' : (b.own < WARN_BELOW ? 'warn' : undefined)
          emit({
            text: zh ? `小米余额 ${money(b.total, b.currency)}` : `MiMo ${money(b.total, b.currency)}`,
            icon: 'wallet',
            ...(tone ? { tone } : {}),
          })
        } catch (err) {
          if (stopped) return
          emit({
            text: zh ? '小米余额 —' : 'MiMo —',
            icon: 'wallet',
            ...(err && err.code === 'aborted' ? {} : { tone: 'bad' }),
          })
        }
      }
      tick()
      const timer = setInterval(tick, POLL_MS)
      return () => { stopped = true; clearInterval(timer) }
    })

    // 面板：余额明细
    ctx.dshGo.panel('mimo-balance', {
      view: (scope, caps) => ({
        type: 'stack',
        title: '小米账户余额',
        children: [
          {
            type: 'metric',
            label: '总可用',
            value: { $: 'data.total' },
            caption: { $: 'data.caption' },
          },
          {
            type: 'keyValue',
            items: [
              ['现金余额', { $: 'data.cash' }],
              ['赠送余额', { $: 'data.gift' }],
              ['可用授信', { $: 'data.creditAvailable' }],
              ['授信额度', { $: 'data.creditLimit' }],
              ['冻结金额', { $: 'data.frozen' }],
              ['账户状态', { $: 'data.status' }],
            ],
          },
          { type: 'callout', text: '总可用 = 现金 + 赠送 + 可用授信（已加回冻结部分）。数据来自小米开放平台余额接口，赠送余额过期时间以控制台为准。', tone: 'info' },
          { type: 'actions', items: [{ label: '刷新', action: 'refresh', icon: 'refresh' }] },
        ],
      }),
      data: (scope, emit, caps) => {
        let stopped = false
        const push = async () => {
          try {
            const b = await getBalance()
            if (!stopped) emit(toPatch(b))
          } catch (err) {
            if (!stopped && err && err.code !== 'aborted') emit(toErrorPatch(err))
          }
        }
        push()
        // 打开期间跟随缓存自动刷新，避免数字“冻住”在打开那一刻
        const timer = setInterval(push, PANEL_REFRESH_MS)
        return () => { stopped = true; clearInterval(timer) }
      },
      actions: {
        refresh: () => ({
          pending: { label: '正在查询余额', timeoutMs: 20_000 },
          result: async (signal) => {
            try {
              const b = await getBalance({ force: true, signal })
              return { patch: toPatch(b) }
            } catch (err) {
              if (err && err.code === 'aborted') return { toast: '已取消' }
              const hint = errorHint(err)
              return { toast: hint ? `${errorText(err)}：${hint}` : '查询失败，请稍后再试' }
            }
          },
        }),
      },
    })
  })
}
