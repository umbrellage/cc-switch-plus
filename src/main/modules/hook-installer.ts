import { readFileSync, writeFileSync, existsSync, mkdirSync } from 'fs'
import { homedir } from 'os'
import { join, dirname } from 'path'
import { IS_WIN } from '../platform'

const HOME = homedir()

// mac
const BASHRC_PATH = join(HOME, '.bashrc')
const HOOK_VERSION_MAC = 2
const HOOK_BEGIN = '# >>> cc-switch-plus hook >>>'
const HOOK_END = '# <<< cc-switch-plus hook <<<'

const HOOK_SNIPPET = `${HOOK_BEGIN}
# hook-version: ${HOOK_VERSION_MAC}
# SIGWINCH 信号处理器：收到信号时读取 pending 文件并执行命令
# SIGWINCH 默认行为是忽略，未安装 hook 时不会造成任何副作用
_cc_winch_handler() {
    local _csf="/tmp/cc-pending/$(tty | tr '/' '_')"
    local _log="/tmp/cc-switch-plus.log"
    echo "[$(date '+%H:%M:%S')] TRAP_FIRED tty=$(tty) file=$_csf exists=$([ -f "$_csf" ] && echo y || echo n)" >> "$_log"
    if [ -f "$_csf" ]; then
        local _cmd=$(cat "$_csf")
        echo "[$(date '+%H:%M:%S')] CMD=$_cmd" >> "$_log"
        rm -f "$_csf"
        eval "$_cmd" 2>>"$_log"
        local _rc=$?
        echo "[$(date '+%H:%M:%S')] EVAL_RC=$_rc" >> "$_log"
    fi
}
trap _cc_winch_handler WINCH

# 状态上报：将当前模型信息写入 /tmp/cc-status
update_cc_status() {
    mkdir -p /tmp/cc-status
    echo "MODEL=\${ANTHROPIC_DEFAULT_OPUS_MODEL:-unknown} URL=\${ANTHROPIC_BASE_URL:-unknown}" > "/tmp/cc-status/$(tty | tr '/' '_')"
}

# 注册 PROMPT_COMMAND：每次回到提示符时更新状态
_cc_prompt_hook() {
    update_cc_status
}
case ":$PROMPT_COMMAND:" in
    *:_cc_prompt_hook:*) ;;
    *) PROMPT_COMMAND="_cc_prompt_hook;$PROMPT_COMMAND" ;;
esac

# 初始化
update_cc_status
${HOOK_END}`

// win —— PowerShell profile（PS5 + PS7 两个位置都装）
const HOOK_VERSION_WIN = 1
const PS5_PROFILE = join(HOME, 'Documents', 'WindowsPowerShell', 'Microsoft.PowerShell_profile.ps1')
const PS7_PROFILE = join(HOME, 'Documents', 'PowerShell', 'Microsoft.PowerShell_profile.ps1')

const PS_HOOK_BEGIN = '# >>> cc-switch-plus hook >>>'
const PS_HOOK_END = '# <<< cc-switch-plus hook <<<'
const PS_HOOK_SNIPPET = `${PS_HOOK_BEGIN}
# hook-version: ${HOOK_VERSION_WIN}
# Windows 无信号机制：通过 prompt 函数每次回到提示符时检查 pending + 上报状态
$__cc_dir = Join-Path \$env:USERPROFILE '.cc-switch-plus'
function __cc_key() { "pid_\$PID" }
function __cc_exec_pending() {
    \$f = Join-Path \$__cc_dir ('pending\\' + (__cc_key))
    if (Test-Path \$f) {
        \$cmd = Get-Content \$f -Raw
        Remove-Item \$f -Force -ErrorAction SilentlyContinue
        if (\$cmd) { Invoke-Expression \$cmd }
    }
}
function __cc_update_status() {
    \$d = Join-Path \$__cc_dir 'status'
    if (-not (Test-Path \$d)) { New-Item -ItemType Directory -Force -Path \$d | Out-Null }
    \$model = if (\$env:ANTHROPIC_DEFAULT_OPUS_MODEL) { \$env:ANTHROPIC_DEFAULT_OPUS_MODEL } else { 'unknown' }
    \$url   = if (\$env:ANTHROPIC_BASE_URL) { \$env:ANTHROPIC_BASE_URL } else { 'unknown' }
    "MODEL=\$model URL=\$url" | Set-Content (Join-Path \$d (__cc_key)) -Encoding UTF8
}
# 包装 prompt：检查 pending + 上报状态 + 原 prompt
if (-not (Test-Path Function:\__cc_orig_prompt)) {
    if (Test-Path Function:prompt) { \${function:__cc_orig_prompt} = \${function:prompt} } else { \${function:__cc_orig_prompt} = { 'PS> ' } }
}
function prompt {
    __cc_exec_pending
    __cc_update_status
    & \${function:__cc_orig_prompt}
}
__cc_update_status
${PS_HOOK_END}`

export class HookInstaller {
  /** 检查 Hook 是否已安装 */
  async isInstalled(): Promise<boolean> {
    if (IS_WIN) {
      return (await this.checkFile(PS5_PROFILE)) || (await this.checkFile(PS7_PROFILE))
    }
    return await this.checkFile(BASHRC_PATH)
  }

  private async checkFile(path: string): Promise<boolean> {
    if (!existsSync(path)) return false
    const content = readFileSync(path, 'utf-8')
    const begin = IS_WIN ? PS_HOOK_BEGIN : HOOK_BEGIN
    const end = IS_WIN ? PS_HOOK_END : HOOK_END
    return content.includes(begin) && content.includes(end)
  }

  /** 安装 Hook */
  async install(): Promise<void> {
    if (IS_WIN) {
      this.installPsProfile(PS5_PROFILE)
      this.installPsProfile(PS7_PROFILE)
    } else {
      this.installBash()
    }
  }

  private installBash(): void {
    const content = existsSync(BASHRC_PATH) ? readFileSync(BASHRC_PATH, 'utf-8') : ''
    const cleaned = this.removeBlock(content, HOOK_BEGIN, HOOK_END)
    writeFileSync(BASHRC_PATH, cleaned + '\n' + HOOK_SNIPPET + '\n', 'utf-8')
  }

  private installPsProfile(path: string): void {
    mkdirSync(dirname(path), { recursive: true })
    const content = existsSync(path) ? readFileSync(path, 'utf-8') : ''
    const cleaned = this.removeBlock(content, PS_HOOK_BEGIN, PS_HOOK_END)
    writeFileSync(path, cleaned + '\n' + PS_HOOK_SNIPPET + '\n', 'utf-8')
  }

  /** 卸载 Hook */
  async uninstall(): Promise<void> {
    if (IS_WIN) {
      for (const p of [PS5_PROFILE, PS7_PROFILE]) {
        if (!existsSync(p)) continue
        const content = readFileSync(p, 'utf-8')
        writeFileSync(p, this.removeBlock(content, PS_HOOK_BEGIN, PS_HOOK_END), 'utf-8')
      }
    } else {
      if (!existsSync(BASHRC_PATH)) return
      const content = readFileSync(BASHRC_PATH, 'utf-8')
      writeFileSync(BASHRC_PATH, this.removeBlock(content, HOOK_BEGIN, HOOK_END), 'utf-8')
    }
  }

  /** 检查是否需要升级 */
  async needsUpgrade(): Promise<boolean> {
    const paths = IS_WIN ? [PS5_PROFILE, PS7_PROFILE] : [BASHRC_PATH]
    const want = IS_WIN ? HOOK_VERSION_WIN : HOOK_VERSION_MAC
    for (const p of paths) {
      if (!existsSync(p)) continue
      const content = readFileSync(p, 'utf-8')
      const begin = IS_WIN ? PS_HOOK_BEGIN : HOOK_BEGIN
      if (!content.includes(begin)) continue
      const match = content.match(/# hook-version:\s*(\d+)/)
      const current = match ? parseInt(match[1], 10) : 0
      if (current < want) return true
    }
    return false
  }

  /** 升级 Hook（重新安装） */
  async upgrade(): Promise<void> {
    return this.install()
  }

  private removeBlock(content: string, begin: string, end: string): string {
    const beginIdx = content.indexOf(begin)
    const endIdx = content.indexOf(end)
    if (beginIdx < 0 || endIdx < 0) return content
    const blockEnd = endIdx + end.length
    let result = content.slice(0, beginIdx) + content.slice(blockEnd)
    result = result.replace(/\n{3,}/g, '\n\n').trim() + '\n'
    return result
  }
}
