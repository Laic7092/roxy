interface Options {
  apiKey: string
  baseURL: string
  model: string
}

export default abstract class LLMProvider {
  cfg: Options
  constructor(cfg: Options) {
    this.cfg = cfg
  }

  abstract chat(context: Ctx): Promise<any>
}
