import { request } from 'httpx'
import { log, logError } from '../utils/error-handler'
import { IncomingMessage } from 'http'

const USER_AGENT = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 14_7_2) AppleWebKit/537.36'
const MAX_REDIRECTS = 5

/**
 * 读取 HTTP 响应体
 */
function readResponse(response: IncomingMessage): Promise<string> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = []
    response.on('data', (chunk) => chunks.push(Buffer.from(chunk)))
    response.on('error', reject)
    response.on('end', () => resolve(Buffer.concat(chunks).toString('utf-8')))
  })
}

/**
 * 验证 URL：必须是 http(s) 且有有效域名
 */
function validateUrl(url: string): { valid: boolean; error?: string } {
  try {
    const parsed = new URL(url)
    // protocol 包含冒号，如 'https:'
    if (!/^https?:$/.test(parsed.protocol)) {
      return { valid: false, error: `Only http/https allowed, got '${parsed.protocol}'` }
    }
    if (!parsed.hostname) {
      return { valid: false, error: 'Missing domain' }
    }
    return { valid: true }
  } catch (e: any) {
    return { valid: false, error: e.message }
  }
}

/**
 * 去除 HTML 标签并解码实体
 */
function stripTags(html: string): string {
  return html
    .replace(/<script[\s\S]*?<\/script>/gi, '')
    .replace(/<style[\s\S]*?<\/style>/gi, '')
    .replace(/<[^>]+>/g, '')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&amp;/g, '&')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&nbsp;/g, ' ')
    .trim()
}

/**
 * 规范化空白字符
 */
function normalize(text: string): string {
  return text
    .replace(/[ \t]+/g, ' ')
    .replace(/\n{3,}/g, '\n\n')
    .trim()
}

/**
 * HTML 转 Markdown（简化版）
 */
function htmlToMarkdown(html: string): string {
  let text = html

  // 转换链接
  text = text.replace(
    /<a\s+[^>]*href=["']([^"']+)["'][^>]*>([\s\S]*?)<\/a>/gi,
    (_, href, content) => {
      return `[${stripTags(content)}](${href})`
    },
  )

  // 转换标题
  text = text.replace(/<h([1-6])[^>]*>([\s\S]*?)<\/h\1>/gi, (_, level, content) => {
    return `\n${'#'.repeat(parseInt(level))} ${stripTags(content)}\n`
  })

  // 转换列表
  text = text.replace(/<li[^>]*>([\s\S]*?)<\/li>/gi, (_, content) => {
    return `\n- ${stripTags(content)}`
  })

  // 段落和块级元素
  text = text.replace(/<\/(p|div|section|article)>/gi, '\n\n')
  text = text.replace(/<(br|hr)\s*\/?>/gi, '\n')

  return normalize(stripTags(text))
}

export interface WebToolsConfig {
  apiKey?: string
  maxResults?: number
  maxChars?: number
  proxy?: string
  rejectUnauthorized?: boolean // 是否验证 SSL 证书
}

/**
 * 创建 Web 工具（工厂函数）
 */
export function createWebTools(config: WebToolsConfig = {}) {
  const apiKey = config.apiKey || process.env.BRAVE_API_KEY || ''
  const maxResults = config.maxResults || 5
  const maxChars = config.maxChars || 50000
  const proxy = config.proxy
  const rejectUnauthorized = config.rejectUnauthorized ?? true // 默认验证证书

  return [
    {
      name: 'web_search',
      description: 'Search the web using Brave Search API. Returns titles, URLs, and snippets.',
      parameters: {
        type: 'object',
        properties: {
          query: {
            type: 'string',
            description: 'Search query',
          },
          count: {
            type: 'number',
            description: 'Number of results (1-10)',
            minimum: 1,
            maximum: 10,
          },
        },
        required: ['query'],
      },
      execute: async (args: { query: string; count?: number }): Promise<string> => {
        const { query, count } = args

        if (!apiKey) {
          return (
            'Error: Brave Search API key not configured. Set it in ' +
            '~/.roxy/config.json under tools.web.search.apiKey ' +
            '(or export BRAVE_API_KEY), then restart the gateway.'
          )
        }

        try {
          const n = Math.min(Math.max(count || maxResults, 1), 10)
          log('debug', `WebSearch: ${proxy ? 'proxy enabled' : 'direct connection'}`, 'WebTools')

          const url = new URL('https://api.search.brave.com/res/v1/web/search')
          url.searchParams.set('q', query)
          url.searchParams.set('count', n.toString())

          const response = await request(url.toString(), {
            method: 'GET',
            headers: {
              Accept: 'application/json',
              'X-Subscription-Token': apiKey,
              'User-Agent': USER_AGENT,
            },
            timeout: 10000,
            proxy,
            rejectUnauthorized,
          })

          if (response.statusCode !== 200) {
            throw new Error(`Brave API returned ${response.statusCode}`)
          }

          // 读取响应体
          const body = await readResponse(response)
          const data = JSON.parse(body)
          const results = (data.web?.results || []).slice(0, n)

          if (results.length === 0) {
            return `No results for: ${query}`
          }

          const lines = [`Results for: ${query}\n`]
          for (let i = 0; i < results.length; i++) {
            const item = results[i]
            lines.push(`${i + 1}. ${item.title || ''}`)
            lines.push(`   ${item.url || ''}`)
            if (item.description) {
              lines.push(`   ${item.description}`)
            }
          }

          return lines.join('\n')
        } catch (error: any) {
          logError(error, 'error', 'WebTools')
          if (error.message?.includes('proxy')) {
            return `Proxy error: ${error.message}`
          }
          return `Error: ${error.message}`
        }
      },
    },
    {
      name: 'web_fetch',
      description: 'Fetch URL and extract readable content (HTML → markdown/text).',
      parameters: {
        type: 'object',
        properties: {
          url: {
            type: 'string',
            description: 'URL to fetch',
          },
          extractMode: {
            type: 'string',
            description: 'Extraction mode: "markdown" or "text"',
            enum: ['markdown', 'text'],
          },
          maxChars: {
            type: 'number',
            description: 'Maximum characters to return',
            minimum: 100,
          },
        },
        required: ['url'],
      },
      execute: async (args: {
        url: string
        extractMode?: 'markdown' | 'text'
        maxChars?: number
      }): Promise<string> => {
        const { url, extractMode = 'markdown', maxChars: userMaxChars } = args
        const limit = userMaxChars || maxChars

        // 验证 URL
        const validation = validateUrl(url)
        if (!validation.valid) {
          return JSON.stringify({
            error: `URL validation failed: ${validation.error}`,
            url,
          })
        }

        try {
          log('debug', `WebFetch: ${proxy ? 'proxy enabled' : 'direct connection'}`, 'WebTools')

          const response = await request(url, {
            method: 'GET',
            headers: {
              'User-Agent': USER_AGENT,
            },
            timeout: 30000,
            followRedirect: true,
            maxRedirects: MAX_REDIRECTS,
            proxy,
            rejectUnauthorized,
          })

          if (response.statusCode !== 200) {
            throw new Error(`HTTP ${response.statusCode}`)
          }

          const contentType = response.headers?.['content-type'] || ''
          const body = await readResponse(response)
          let text: string
          let extractor: string

          // JSON 响应
          if (contentType.includes('application/json')) {
            text = JSON.stringify(JSON.parse(body), null, 2)
            extractor = 'json'
          }
          // HTML 响应
          else if (
            contentType.includes('text/html') ||
            body.slice(0, 256).toLowerCase().startsWith('<!doctype') ||
            body.slice(0, 256).toLowerCase().startsWith('<html')
          ) {
            const htmlContent = body
            // 简化版 Readability：提取主要内容
            const content = extractMainContent(htmlContent)
            const title = extractTitle(htmlContent)

            if (extractMode === 'markdown') {
              text = title ? `# ${title}\n\n${htmlToMarkdown(content)}` : htmlToMarkdown(content)
            } else {
              text = title ? `# ${title}\n\n${stripTags(content)}` : stripTags(content)
            }
            extractor = 'readability'
          }
          // 其他类型：原始内容
          else {
            text = body
            extractor = 'raw'
          }

          const truncated = text.length > limit
          if (truncated) {
            text = text.slice(0, limit)
          }

          return JSON.stringify({
            url,
            finalUrl: response.url || url,
            status: response.statusCode,
            extractor,
            truncated,
            length: text.length,
            text,
          })
        } catch (error: any) {
          logError(error, 'error', 'WebTools')
          if (error.message?.includes('proxy')) {
            return JSON.stringify({ error: `Proxy error: ${error.message}`, url })
          }
          return JSON.stringify({ error: error.message, url })
        }
      },
    },
  ]
}

/**
 * 提取 HTML 标题
 */
function extractTitle(html: string): string {
  const match = html.match(/<title[^>]*>([\s\S]*?)<\/title>/i)
  return match ? stripTags(match[1]).trim() : ''
}

/**
 * 提取 HTML 主要内容（简化版）
 */
function extractMainContent(html: string): string {
  // 尝试提取 <main>, <article>, 或 <body> 内容
  const patterns = [
    /<main[^>]*>([\s\S]*?)<\/main>/i,
    /<article[^>]*>([\s\S]*?)<\/article>/i,
    /<body[^>]*>([\s\S]*?)<\/body>/i,
  ]

  for (const pattern of patterns) {
    const match = html.match(pattern)
    if (match) {
      return match[1]
    }
  }

  // 回退：移除 script/style 后的整个文档
  return html
}
