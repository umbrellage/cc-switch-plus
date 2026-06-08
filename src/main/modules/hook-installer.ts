import { readFileSync, writeFileSync, existsSync } from 'fs'
import { homedir } from 'os'
import { join } from 'path'

const HOME = homedir()
const BASHRC_PATH = join(HOME, '.bashrc')
const HOOK_BEGIN = '# >>> cc-switch-plus hook >>>'
const HOOK_END = '# <<< cc-switch-plus hook <<<'

const HOOK_SNIPPET = `${HOOK_BEGIN}
# SIGWINCH 信号处理器：收到信号时读取 pending 文件并执行命令
# SIGWINCH 默认行为是忽略，未安装 hook 时不会造成任何副作用
_cc_winch_handler() {
    local _csf="/tmp/cc-pending/$(tty | tr '/' '_')"
    if [ -f "$_csf" ]; then
        local _cmd=$(cat "$_csf")
        rm -f "$_csf"
        eval "$_cmd"
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

export class HookInstaller {
  /** 检查 Hook 是否已安装 */
  async isInstalled(): Promise<boolean> {
    if (!existsSync(BASHRC_PATH)) return false
    const content = readFileSync(BASHRC_PATH, 'utf-8')
    return content.includes(HOOK_BEGIN) && content.includes(HOOK_END)
  }

  /** 安装 Hook 到 ~/.bashrc */
  async install(): Promise<void> {
    const content = existsSync(BASHRC_PATH)
      ? readFileSync(BASHRC_PATH, 'utf-8')
      : ''

    // 如果已安装，先移除旧的
    const cleaned = this.removeHookBlock(content)
    const updated = cleaned + '\n' + HOOK_SNIPPET + '\n'
    writeFileSync(BASHRC_PATH, updated, 'utf-8')
  }

  /** 卸载 Hook */
  async uninstall(): Promise<void> {
    if (!existsSync(BASHRC_PATH)) return
    const content = readFileSync(BASHRC_PATH, 'utf-8')
    const cleaned = this.removeHookBlock(content)
    writeFileSync(BASHRC_PATH, cleaned, 'utf-8')
  }

  /** 从内容中移除 Hook 代码块 */
  private removeHookBlock(content: string): string {
    const beginIdx = content.indexOf(HOOK_BEGIN)
    const endIdx = content.indexOf(HOOK_END)
    if (beginIdx < 0 || endIdx < 0) return content

    const blockEnd = endIdx + HOOK_END.length
    let result = content.slice(0, beginIdx) + content.slice(blockEnd)
    result = result.replace(/\n{3,}/g, '\n\n').trim() + '\n'
    return result
  }
}
