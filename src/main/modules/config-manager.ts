import { homedir } from 'os'
import { join } from 'path'
import { readFileSync, writeFileSync, existsSync, mkdirSync, readdirSync, rmSync } from 'fs'
import { v4 as uuid } from 'uuid'
import type { ModelConfig } from '../../renderer/types'
import { IS_WIN, APP_DATA_DIR, WIN_PROFILES_DIR } from '../platform'

const HOME = homedir()
const CONFIG_DIR = APP_DATA_DIR
const CONFIG_FILE = join(CONFIG_DIR, 'configs.json')

// mac：每个 bashrc 末尾调一次状态上报（update_cc_status 由 hook 定义）
const BASHRC_HOOK_CALL = '\n# cc-switch-plus: update status\nupdate_cc_status 2>/dev/null || true\n'
// win：每个 profile 末尾调状态上报（__cc_update_status 由 hook 定义）
const PS1_HOOK_CALL = '\n# cc-switch-plus: update status\n__cc_update_status 2>$null\n'

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
    this.writeProfileFile(config)
  }

  /** 删除配置 */
  async remove(id: string): Promise<void> {
    const configs = await this.loadAll()
    const target = configs.find((c) => c.id === id)
    if (!target) return

    const p = this.profilePath(target.shortName)
    if (existsSync(p)) rmSync(p)
    // Windows 下 git-bash 用 .bashrc_xxx，一并删除
    if (IS_WIN) {
      const bashrc = join(HOME, `.bashrc_${target.shortName}`)
      if (existsSync(bashrc)) rmSync(bashrc)
    }

    this.persist(configs.filter((c) => c.id !== id))
  }

  /** 导入现有配置文件（mac: ~/.bashrc_* ；win: profiles/*.ps1） */
  async importExisting(): Promise<ModelConfig[]> {
    const existing = await this.loadAll()
    if (existing.length > 0) return existing

    const configs: ModelConfig[] = []

    if (IS_WIN) {
      if (existsSync(WIN_PROFILES_DIR)) {
        for (const file of readdirSync(WIN_PROFILES_DIR)) {
          if (!file.endsWith('.ps1')) continue
          const shortName = file.replace(/\.ps1$/, '')
          const content = readFileSync(join(WIN_PROFILES_DIR, file), 'utf-8')
          const parsed = this.parseContent(shortName, content)
          if (parsed) configs.push(parsed)
        }
      }
      // git-bash：扫描 ~/.bashrc_*（export 语法）
      for (const file of readdirSync(HOME)) {
        if (!file.startsWith('.bashrc_') || file.includes('.swp') || file.includes('~')) continue
        const shortName = file.replace('.bashrc_', '')
        if (configs.some((c) => c.shortName === shortName)) continue
        const content = readFileSync(join(HOME, file), 'utf-8')
        const parsed = this.parseContent(shortName, content)
        if (parsed) configs.push(parsed)
      }
    } else {
      const files = readdirSync(HOME).filter(
        (f) => f.startsWith('.bashrc_') && !f.includes('.swp') && !f.includes('~')
      )
      for (const file of files) {
        const shortName = file.replace('.bashrc_', '')
        const content = readFileSync(join(HOME, file), 'utf-8')
        const parsed = this.parseContent(shortName, content)
        if (parsed) configs.push(parsed)
      }
      // mac：也检查 .bash_profile 中的 GLM 默认配置
      const bashProfilePath = join(HOME, '.bash_profile')
      if (existsSync(bashProfilePath)) {
        const content = readFileSync(bashProfilePath, 'utf-8')
        if (content.includes('ANTHROPIC_BASE_URL') && !configs.some((c) => c.shortName === 'glm')) {
          const parsed = this.parseContent('glm', content)
          if (parsed) {
            parsed.name = 'GLM (智谱)'
            configs.push(parsed)
          }
        }
      }
    }

    for (const config of configs) {
      this.writeProfileFile(config)
    }
    this.persist(configs)
    return configs
  }

  /** profile 文件路径（平台分支） */
  private profilePath(shortName: string): string {
    return IS_WIN
      ? join(WIN_PROFILES_DIR, `${shortName}.ps1`)
      : join(HOME, `.bashrc_${shortName}`)
  }

  /** 生成 profile 内容（平台分支） */
  generateContent(config: ModelConfig): string {
    return IS_WIN ? this.generatePs1Content(config) : this.generateBashrcContent(config)
  }

  /** mac：生成 bashrc 内容 */
  generateBashrcContent(config: ModelConfig): string {
    const lines: string[] = []
    lines.push(`# ${config.name} - managed by cc-switch-plus`)
    lines.push(`export ANTHROPIC_AUTH_TOKEN=${config.authToken}`)
    lines.push(`export ANTHROPIC_BASE_URL=${config.baseUrl}`)
    if (config.apiTimeout) lines.push(`export API_TIMEOUT_MS=${config.apiTimeout}`)
    if (config.haikuModel) lines.push(`export ANTHROPIC_DEFAULT_HAIKU_MODEL='${config.haikuModel}'`)
    if (config.sonnetModel) lines.push(`export ANTHROPIC_DEFAULT_SONNET_MODEL='${config.sonnetModel}'`)
    if (config.opusModel) lines.push(`export ANTHROPIC_DEFAULT_OPUS_MODEL='${config.opusModel}'`)
    if (config.customVars) {
      for (const [key, val] of Object.entries(config.customVars)) {
        lines.push(`export ${key}='${val}'`)
      }
    }
    lines.push(BASHRC_HOOK_CALL)
    return lines.join('\n')
  }

  /** win：生成 PowerShell profile 内容 */
  private generatePs1Content(config: ModelConfig): string {
    const lines: string[] = []
    lines.push(`# ${config.name} - managed by cc-switch-plus`)
    lines.push(`$env:ANTHROPIC_AUTH_TOKEN = '${this.ps1Escape(config.authToken)}'`)
    lines.push(`$env:ANTHROPIC_BASE_URL = '${this.ps1Escape(config.baseUrl)}'`)
    if (config.apiTimeout) lines.push(`$env:API_TIMEOUT_MS = '${config.apiTimeout}'`)
    if (config.haikuModel) lines.push(`$env:ANTHROPIC_DEFAULT_HAIKU_MODEL = '${this.ps1Escape(config.haikuModel)}'`)
    if (config.sonnetModel) lines.push(`$env:ANTHROPIC_DEFAULT_SONNET_MODEL = '${this.ps1Escape(config.sonnetModel)}'`)
    if (config.opusModel) lines.push(`$env:ANTHROPIC_DEFAULT_OPUS_MODEL = '${this.ps1Escape(config.opusModel)}'`)
    if (config.customVars) {
      for (const [key, val] of Object.entries(config.customVars)) {
        lines.push(`$env:${key} = '${this.ps1Escape(val)}'`)
      }
    }
    lines.push(PS1_HOOK_CALL)
    return lines.join('\n')
  }

  /** PowerShell 单引号字符串转义（单引号 → 两个单引号） */
  private ps1Escape(s: string): string {
    return s.replace(/'/g, "''")
  }

  /** 写 profile 文件到磁盘（Windows：同时写 .ps1 给 PowerShell 和 .bashrc_xxx 给 git-bash） */
  private writeProfileFile(config: ModelConfig): void {
    if (IS_WIN && !existsSync(WIN_PROFILES_DIR)) {
      mkdirSync(WIN_PROFILES_DIR, { recursive: true })
    }
    writeFileSync(this.profilePath(config.shortName), this.generateContent(config), 'utf-8')
    // Windows 下额外写 git-bash 版（bash export 语法，无 $env:）
    if (IS_WIN) {
      writeFileSync(join(HOME, `.bashrc_${config.shortName}`), this.generateBashrcContent(config), 'utf-8')
    }
  }

  /** 解析 profile 内容为 ModelConfig（平台分支） */
  private parseContent(shortName: string, content: string): ModelConfig | null {
    const vars = IS_WIN ? this.extractPs1Vars(content) : this.extractBashVars(content)
    if (!vars['ANTHROPIC_AUTH_TOKEN'] && !vars['ANTHROPIC_BASE_URL']) return null

    const opus = vars['ANTHROPIC_DEFAULT_OPUS_MODEL'] || ''
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
      authToken: vars['ANTHROPIC_AUTH_TOKEN'] || '',
      baseUrl: vars['ANTHROPIC_BASE_URL'] || '',
      apiTimeout: vars['API_TIMEOUT_MS'] ? parseInt(vars['API_TIMEOUT_MS'], 10) : undefined,
      haikuModel: vars['ANTHROPIC_DEFAULT_HAIKU_MODEL'],
      sonnetModel: vars['ANTHROPIC_DEFAULT_SONNET_MODEL'],
      opusModel: opus || undefined,
      createdAt: Date.now(),
      updatedAt: Date.now()
    }
  }

  /** mac：从 bashrc 提取 export 环境变量 */
  private extractBashVars(content: string): Record<string, string> {
    const vars: Record<string, string> = {}
    for (const line of content.split('\n')) {
      const trimmed = line.trim()
      if (trimmed.startsWith('#') || !trimmed.startsWith('export ')) continue
      const expr = trimmed.slice(7)
      const eqIdx = expr.indexOf('=')
      if (eqIdx < 0) continue
      const key = expr.slice(0, eqIdx).trim()
      let val = expr.slice(eqIdx + 1).trim()
      if ((val.startsWith("'") && val.endsWith("'")) || (val.startsWith('"') && val.endsWith('"'))) {
        val = val.slice(1, -1)
      }
      vars[key] = val
    }
    return vars
  }

  /** win：从 ps1 提取 $env: 变量 */
  private extractPs1Vars(content: string): Record<string, string> {
    const vars: Record<string, string> = {}
    for (const line of content.split('\n')) {
      const trimmed = line.trim()
      if (trimmed.startsWith('#') || !trimmed.startsWith('$env:')) continue
      // $env:KEY = 'value'
      const m = trimmed.match(/^\$env:(\w+)\s*=\s*'(.*)'\s*$/)
      if (m) {
        vars[m[1]] = m[2].replace(/''/g, "'")
      }
    }
    return vars
  }

  /** 持久化配置到 configs.json */
  private persist(configs: ModelConfig[]): void {
    if (!existsSync(CONFIG_DIR)) mkdirSync(CONFIG_DIR, { recursive: true })
    writeFileSync(CONFIG_FILE, JSON.stringify(configs, null, 2), 'utf-8')
  }
}
