import type { ProviderConfig } from '../config/types'

export default abstract class LLMProvider {
  cfg: ProviderConfig
  constructor(cfg: ProviderConfig) {
    this.cfg = cfg
  }

  abstract chat(context: Ctx): Promise<any>
}
