import { homedir } from 'os'
import { join } from 'path'
import { readFileSync, writeFileSync, existsSync, mkdirSync, readdirSync, rmSync } from 'fs'
import { v4 as uuid } from 'uuid'
import type { ModelConfig } from '../../renderer/types'

const HOME = homedir()
const CONFIG_DIR = join(HOME, '.cc-switch-plus')
const CONFIG_FILE = join(CONFIG_DIR, 'configs.json')
const BASHRC_HOOK_CALL = '\n# cc-switch-plus: update status\nupdate_cc_status 2>/dev/null || true\n'

export class ConfigManager {
  /** 加载所有配置 */
  async loadAll(): Promise<ModelConfig[]> {
    if (!existsSync(CONFIG_FILE)) return []
    const raw = readFileSync(CONFIG_FILE, 'utf-8')
    return JSON.parse(raw)
  }

  /** 保存配置（新增或更新） */
  async save(config: ModelConfig): Promise<void> {
    const configs = await this.loadAll()
    const now = Date.now()
    const idx = configs.findIndex((c) => c.id === config.id)

    if (idx >= 0) {
      configs[idx] = { ...config, updatedAt: now }
    } else {
      configs.push({ ...config, createdAt: now, updatedAt: now })
    }

    this.persist(configs)
    this.writeBashrcFile(config)
  }

  /** 删除配置 */
  async remove(id: string): Promise<void> {
    const configs = await this.loadAll()
    const target = configs.find((c) => c.id === id)
    if (!target) return

    const bashrcPath = join(HOME, `.bashrc_${target.shortName}`)
    if (existsSync(bashrcPath)) {
      rmSync(bashrcPath)
    }

    this.persist(configs.filter((c) => c.id !== id))
  }

  /** 导入现有 ~/.bashrc_* 文件 */
  async importExisting(): Promise<ModelConfig[]> {
    const existing = await this.loadAll()
    if (existing.length > 0) return existing

    const files = readdirSync(HOME).filter(
      (f) => f.startsWith('.bashrc_') && !f.includes('.swp') && !f.includes('~')
    )

    const configs: ModelConfig[] = []
    for (const file of files) {
      const shortName = file.replace('.bashrc_', '')
      const content = readFileSync(join(HOME, file), 'utf-8')
      const parsed = this.parseBashrc(shortName, content)
      if (parsed) configs.push(parsed)
    }

    // 也检查 .bash_profile 中的 GLM 默认配置
    const bashProfilePath = join(HOME, '.bash_profile')
    if (existsSync(bashProfilePath)) {
      const content = readFileSync(bashProfilePath, 'utf-8')
      if (content.includes('ANTHROPIC_BASE_URL') && !configs.some((c) => c.shortName === 'glm')) {
        const parsed = this.parseBashrc('glm', content)
        if (parsed) {
          parsed.name = 'GLM (智谱)'
          configs.push(parsed)
        }
      }
    }

    // 为每个 bashrc 文件追加 hook 调用
    for (const config of configs) {
      this.writeBashrcFile(config)
    }

    this.persist(configs)
    return configs
  }

  /** 解析 bashrc 文件内容为 ModelConfig */
  private parseBashrc(shortName: string, content: string): ModelConfig | null {
    const envVars = this.extractEnvVars(content)
    if (!envVars['ANTHROPIC_AUTH_TOKEN'] && !envVars['ANTHROPIC_BASE_URL']) return null

    const opus = envVars['ANTHROPIC_DEFAULT_OPUS_MODEL'] || ''
    const nameMap: Record<string, string> = {
      opus: 'Claude Opus',
      yunwu: 'Claude Opus (云雾)',
      deepseek: 'DeepSeek',
      gemini: 'Gemini (云雾)',
      gpt: 'GPT (云雾)',
      minimax: 'MiniMax',
      glm: 'GLM (智谱)'
    }

    return {
      id: uuid(),
      name: nameMap[shortName] || shortName.toUpperCase(),
      shortName,
      authToken: envVars['ANTHROPIC_AUTH_TOKEN'] || '',
      baseUrl: envVars['ANTHROPIC_BASE_URL'] || '',
      apiTimeout: envVars['API_TIMEOUT_MS'] ? parseInt(envVars['API_TIMEOUT_MS'], 10) : undefined,
      haikuModel: envVars['ANTHROPIC_DEFAULT_HAIKU_MODEL'],
      sonnetModel: envVars['ANTHROPIC_DEFAULT_SONNET_MODEL'],
      opusModel: opus || undefined,
      createdAt: Date.now(),
      updatedAt: Date.now()
    }
  }

  /** 从 bashrc 内容提取 export 环境变量 */
  private extractEnvVars(content: string): Record<string, string> {
    const vars: Record<string, string> = {}
    const lines = content.split('\n')

    for (const line of lines) {
      const trimmed = line.trim()
      if (trimmed.startsWith('#') || !trimmed.startsWith('export ')) continue
      const expr = trimmed.slice(7) // remove "export "
      const eqIdx = expr.indexOf('=')
      if (eqIdx < 0) continue
      const key = expr.slice(0, eqIdx).trim()
      let val = expr.slice(eqIdx + 1).trim()
      // 去掉引号
      if ((val.startsWith("'") && val.endsWith("'")) || (val.startsWith('"') && val.endsWith('"'))) {
        val = val.slice(1, -1)
      }
      vars[key] = val
    }
    return vars
  }

  /** 生成 bashrc 文件内容 */
  generateBashrcContent(config: ModelConfig): string {
    const lines: string[] = []
    lines.push(`# ${config.name} - managed by cc-switch-plus`)
    lines.push(`export ANTHROPIC_AUTH_TOKEN=${config.authToken}`)
    lines.push(`export ANTHROPIC_BASE_URL=${config.baseUrl}`)
    if (config.apiTimeout) {
      lines.push(`export API_TIMEOUT_MS=${config.apiTimeout}`)
    }
    if (config.haikuModel) {
      lines.push(`export ANTHROPIC_DEFAULT_HAIKU_MODEL='${config.haikuModel}'`)
    }
    if (config.sonnetModel) {
      lines.push(`export ANTHROPIC_DEFAULT_SONNET_MODEL='${config.sonnetModel}'`)
    }
    if (config.opusModel) {
      lines.push(`export ANTHROPIC_DEFAULT_OPUS_MODEL='${config.opusModel}'`)
    }
    if (config.customVars) {
      for (const [key, val] of Object.entries(config.customVars)) {
        lines.push(`export ${key}='${val}'`)
      }
    }
    lines.push(BASHRC_HOOK_CALL)
    return lines.join('\n')
  }

  /** 写入 bashrc 文件到磁盘 */
  private writeBashrcFile(config: ModelConfig): void {
    const bashrcPath = join(HOME, `.bashrc_${config.shortName}`)
    const content = this.generateBashrcContent(config)
    writeFileSync(bashrcPath, content, 'utf-8')
  }

  /** 持久化配置到 configs.json */
  private persist(configs: ModelConfig[]): void {
    if (!existsSync(CONFIG_DIR)) {
      mkdirSync(CONFIG_DIR, { recursive: true })
    }
    writeFileSync(CONFIG_FILE, JSON.stringify(configs, null, 2), 'utf-8')
  }
}
