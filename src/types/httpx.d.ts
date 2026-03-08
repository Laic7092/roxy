declare module 'httpx' {
  import { IncomingMessage } from 'http'

  interface RequestOptions {
    method?: string
    headers?: Record<string, string>
    timeout?: number
    followRedirect?: boolean
    maxRedirects?: number
    proxy?: string
    data?: any
  }

  interface HttpResponse extends IncomingMessage {
    statusCode: number
    headers: Record<string, string | string[] | undefined>
    url?: string
  }

  function request(url: string, opts?: RequestOptions): Promise<HttpResponse>

  export { request, RequestOptions, HttpResponse }
  export default request
}
