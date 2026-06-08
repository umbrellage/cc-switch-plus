# CC Switch Plus

一个 macOS 桌面应用，用于在所有终端应用中一键切换 Claude Code 模型。

支持 **iTerm2、Terminal.app、IntelliJ IDEA、Cursor、VS Code、Warp** 等所有运行 bash 的终端。

## 为什么需要这个工具？

如果你在多个终端窗口中运行 Claude Code，不同场景可能需要不同模型（Opus、Sonnet、Haiku、第三方 API 等）。手动 `source ~/.bashrc_xxx` 切换很麻烦，CC Switch Plus 让你通过可视化界面一键切换。

## 功能

- 🔍 **自动检测**所有终端 shell 会话（跨应用）
- 🔄 **一键切换**模型，即时生效
- 📋 **管理模型配置**（增删改查 + 导入已有配置）
- 🖥️ **跨终端通用**（iTerm2 / Terminal / IDEA / Cursor / VS Code / Warp...）
- 🛡️ **安全**：不干扰正在运行的 Claude Code 会话，退出后自动切换

## 安装

### 下载

从 [Releases](../../releases) 下载对应架构的 DMG：

| 文件 | 适用机型 |
|------|---------|
| `CC Switch Plus-1.0.0-arm64.dmg` | Apple Silicon (M1/M2/M3/M4) |
| `CC Switch Plus-1.0.0.dmg` | Intel Mac |

### 安装步骤

1. 双击 DMG → 拖动到「应用程序」
2. 首次打开：系统提示"无法验证开发者" → 右键点击应用 → 选择「打开」
3. 打开应用

> 也可以通过命令行移除隔离属性：`xattr -cr "/Applications/CC Switch Plus.app"`

## 使用

### 1. 安装 Hook（必须）

应用启动后，进入 **Hook** 标签页，点击「安装」。

这会在 `~/.bashrc` 中添加一个 SIGWINCH 信号处理器，让终端能接收切换指令。

> 安装后新开的终端自动生效。已打开的旧终端需要执行一次 `source ~/.bashrc`。

### 2. 导入已有配置

进入 **Config** 标签页，点击「导入已有」。应用会自动扫描 `~/.bashrc_*` 文件并导入。

### 3. 切换模型

在 **Sessions** 标签页中：
- 查看所有终端会话及其当前模型
- 从下拉菜单选择目标模型
- 立即生效 ✅

### 工作原理

```
用户点击切换
    │
    ├─ 写入 pending 文件 /tmp/cc-pending/{tty}
    ├─ 发送 SIGWINCH 信号到目标 shell
    │
    ├─ Shell 空闲 → trap 立即触发 → source ~/.bashrc_xxx ✅
    └─ Claude 运行中 → trap 排队等待 → Claude 退出后自动执行 ✅
```

**SIGWINCH 的优势**：默认行为是忽略（不是终止），即使 Hook 未安装也不会影响终端。

## 模型配置文件

每个模型配置对应一个 `~/.bashrc_{shortName}` 文件，内容示例：

```bash
export ANTHROPIC_AUTH_TOKEN="sk-xxx"
export ANTHROPIC_BASE_URL="https://api.example.com/anthropic"
export ANTHROPIC_DEFAULT_OPUS_MODEL="claude-opus-4-8"
export ANTHROPIC_DEFAULT_SONNET_MODEL="claude-sonnet-4-6"
export ANTHROPIC_DEFAULT_HAIKU_MODEL="claude-haiku-4-5-20251001"
```

配置元数据存储在 `~/.cc-switch-plus/configs.json`。

## 故障排查

### 切换模型无效

1. 确认 Hook 已安装（Hook 标签页显示绿色状态点）
2. 确认终端已执行过 `source ~/.bashrc`
3. 在终端中验证：`trap -p WINCH`，应显示 `trap -- '_cc_winch_handler' WINCH`

### IDEA / Cursor / VS Code 终端无法切换

这些终端依赖 Hook 机制。确保：
1. Hook 已安装
2. 在对应终端里执行过 `source ~/.bashrc`

### 某个终端没有出现在列表中

点击 Sessions 标签页的刷新按钮，应用会重新扫描所有 shell 会话。

### 切换后 Claude Code 仍使用旧模型

检查 Claude Code 的配置文件 `~/.claude/settings.json`，如果其中配置了模型信息（如 `model`、`apiBaseUrl` 等），这些设置会覆盖环境变量。请将相关配置注释或删除后重试。

## 系统要求

- macOS 12+ (Monterey)
- Bash shell

## 文件结构

```
~/.cc-switch-plus/
  └── configs.json           # 模型配置元数据
~/.bashrc                    # 包含 Hook（trap SIGWINCH）
~/.bashrc_glm                # GLM 配置
~/.bashrc_opus               # Opus 配置
~/.bashrc_deepseek           # DeepSeek 配置
...
/tmp/cc-pending/             # 待执行的切换命令
/tmp/cc-status/              # 每个终端的当前模型状态
```

## 开发

```bash
npm install
npm run dev         # 开发模式
npm run build       # 构建
npm run dist        # 打 DMG
```

### 技术栈

- **Electron** + **React** + **Vite** (electron-vite)
- **TypeScript**
- **SIGWINCH** 信号机制（跨终端通用）

## License

MIT
