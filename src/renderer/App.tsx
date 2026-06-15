import { useState, useEffect, useCallback } from 'react'
import type { ModelConfig, TerminalSession } from './types'
import ModelPicker from './components/ModelPicker'

/** Windows 不支持热切换（无信号机制） */
const IS_WIN = /Win/i.test(navigator.platform)

type Tab = 'sessions' | 'config' | 'hook'

export default function App() {
  const [activeTab, setActiveTab] = useState<Tab>('sessions')
  const [sessions, setSessions] = useState<TerminalSession[]>([])
  const [configs, setConfigs] = useState<ModelConfig[]>([])
  const [hookInstalled, setHookInstalled] = useState(false)
  const [hookNeedsUpgrade, setHookNeedsUpgrade] = useState(false)
  const [switchingId, setSwitchingId] = useState<string | null>(null)
  const [pendingModel, setPendingModel] = useState<Record<string, string>>({})
  const [detecting, setDetecting] = useState(false)
  const [hotSwitchSet, setHotSwitchSet] = useState<Set<string>>(new Set())
  /** Windows 暖切换提示：sessionId → 目标 shortName（claude 退出后续接，需用户手动 Ctrl+C） */
  const [warmHint, setWarmHint] = useState<Record<string, string>>({})
  const [appVersion, setAppVersion] = useState('')

  const loadSessions = useCallback(async () => {
    try {
      const list = await window.ccSwitch.session.list()
      setSessions(list)
    } catch {
      // 终端可能未运行
    }
  }, [])

  const loadConfigs = useCallback(async () => {
    const list = await window.ccSwitch.config.list()
    if (list.length === 0) {
      const imported = await window.ccSwitch.config.importExisting()
      setConfigs(imported)
    } else {
      setConfigs(list)
    }
  }, [])

  const loadHookStatus = useCallback(async () => {
    const installed = await window.ccSwitch.hook.check()
    setHookInstalled(installed)
    if (installed) {
      setHookNeedsUpgrade(await window.ccSwitch.hook.needsUpgrade())
    }
  }, [])

  useEffect(() => {
    loadConfigs()
    loadHookStatus()
    loadSessions()
    window.ccSwitch.app.getVersion().then(setAppVersion)
  }, [loadConfigs, loadHookStatus, loadSessions])

  useEffect(() => {
    const timer = setInterval(loadSessions, 3000)
    return () => clearInterval(timer)
  }, [loadSessions])

  // 暖切换：检测到目标模型已生效时自动清除提示
  useEffect(() => {
    if (Object.keys(warmHint).length === 0) return
    setWarmHint((prev) => {
      const next = { ...prev }
      let changed = false
      for (const [sid, target] of Object.entries(next)) {
        const session = sessions.find((s) => s.sessionId === sid)
        if (!session) continue
        const targetCfg = configs.find((c) => c.shortName === target)
        if (targetCfg && session.currentModel && session.currentModel === targetCfg.opusModel) {
          delete next[sid]
          changed = true
        }
      }
      return changed ? next : prev
    })
  }, [sessions, configs, warmHint])

  const handleSwitchModel = async (sessionId: string, shortName: string, tty: string) => {
    if (!shortName) return
    const hotSwitch = hotSwitchSet.has(sessionId)
    setPendingModel((prev) => ({ ...prev, [sessionId]: shortName }))
    setSwitchingId(sessionId)
    try {
      await window.ccSwitch.session.switchModel(sessionId, shortName, tty, hotSwitch)
      // 热切换需 3-7 秒（claude 退出 + 重启），保持视觉反馈 + 持续刷新状态
      if (hotSwitch) {
        // Windows 暖切换：无法自动中断 claude，提示用户按 Ctrl+C；待检测到目标模型后清除
        if (IS_WIN) setWarmHint((prev) => ({ ...prev, [sessionId]: shortName }))
        for (let i = 0; i < 8; i++) {
          await new Promise((r) => setTimeout(r, 500))
          loadSessions()
        }
      } else {
        loadSessions()
      }
    } catch (err) {
      setPendingModel((prev) => {
        const next = { ...prev }
        delete next[sessionId]
        return next
      })
      alert(`切换失败: ${(err as Error).message}`)
    } finally {
      setSwitchingId(null)
    }
  }

  const toggleHotSwitch = (sessionId: string) => {
    setHotSwitchSet((prev) => {
      const next = new Set(prev)
      if (next.has(sessionId)) next.delete(sessionId)
      else next.add(sessionId)
      return next
    })
  }

  const handleDetectModels = async () => {
    setDetecting(true)
    try {
      await window.ccSwitch.session.detectModels()
      setTimeout(loadSessions, 1500)
    } catch (err) {
      alert(`检测失败: ${(err as Error).message}`)
    } finally {
      setDetecting(false)
    }
  }

  return (
    <div className="app">
      <header className="header">
        <div className="header-left">
          <Logo />
          <h1 className="title">CC Switch Plus</h1>
        </div>
        <nav className="tabs">
          {([
            { key: 'sessions' as Tab, label: '会话' },
            { key: 'config' as Tab, label: '配置' },
            { key: 'hook' as Tab, label: '设置' }
          ]).map(({ key, label }) => (
            <button
              key={key}
              className={`tab ${activeTab === key ? 'active' : ''}`}
              onClick={() => setActiveTab(key)}
            >
              {label}
            </button>
          ))}
        </nav>
      </header>

      <main className="main">
        {activeTab === 'sessions' && (
          <SessionsTab
            sessions={sessions}
            configs={configs}
            switchingId={switchingId}
            pendingModel={pendingModel}
            hotSwitchSet={hotSwitchSet}
            warmHint={warmHint}
            hookInstalled={hookInstalled}
            detecting={detecting}
            onSwitch={handleSwitchModel}
            onToggleHotSwitch={toggleHotSwitch}
            onDismissWarmHint={(sid) => setWarmHint((prev) => {
              const next = { ...prev }; delete next[sid]; return next
            })}
            onRefresh={loadSessions}
            onDetect={handleDetectModels}
          />
        )}
        {activeTab === 'config' && (
          <ConfigTab configs={configs} onRefresh={loadConfigs} />
        )}
        {activeTab === 'hook' && (
          <HookTab
            installed={hookInstalled}
            needsUpgrade={hookNeedsUpgrade}
            onInstall={async () => {
              await window.ccSwitch.hook.install()
              setHookInstalled(true)
              setHookNeedsUpgrade(false)
            }}
            onUninstall={async () => {
              await window.ccSwitch.hook.uninstall()
              setHookInstalled(false)
              setHookNeedsUpgrade(false)
            }}
            onUpgrade={async () => {
              await window.ccSwitch.hook.upgrade()
              setHookNeedsUpgrade(false)
            }}
          />
        )}
      </main>
      <footer className="app-footer">
        <span>CC Switch Plus v{appVersion}</span>
      </footer>
    </div>
  )
}

function Logo() {
  return (
    <svg className="logo" viewBox="0 0 1024 1024" width="22" height="22">
      <defs>
        <linearGradient id="blueGrad" x1="0%" y1="0%" x2="100%" y2="100%">
          <stop offset="0%" stopColor="#50C8FF" />
          <stop offset="100%" stopColor="#7BA8FF" />
        </linearGradient>
        <linearGradient id="purpleGrad" x1="0%" y1="0%" x2="100%" y2="100%">
          <stop offset="0%" stopColor="#B482FF" />
          <stop offset="100%" stopColor="#D49EFF" />
        </linearGradient>
      </defs>
      {/* 上方弧形箭头（蓝）*/}
      <path
        d="M 200,512 A 312,312 0 0 1 824,512 L 760,512 A 248,248 0 0 0 264,512 Z"
        fill="url(#blueGrad)"
      />
      <polygon points="824,512 768,460 768,564" fill="url(#blueGrad)" />
      {/* 下方弧形箭头（紫）*/}
      <path
        d="M 824,512 A 312,312 0 0 1 200,512 L 264,512 A 248,248 0 0 0 760,512 Z"
        fill="url(#purpleGrad)"
      />
      <polygon points="200,512 256,564 256,460" fill="url(#purpleGrad)" />
      {/* 中心点（橙）*/}
      <circle cx="512" cy="512" r="36" fill="#FFA050" />
    </svg>
  )
}

/* ========== Sessions Tab ========== */
interface SessionsTabProps {
  sessions: TerminalSession[]
  configs: ModelConfig[]
  switchingId: string | null
  pendingModel: Record<string, string>
  hotSwitchSet: Set<string>
  warmHint: Record<string, string>
  hookInstalled: boolean
  detecting: boolean
  onSwitch: (sessionId: string, shortName: string, tty: string) => void
  onToggleHotSwitch: (sessionId: string) => void
  onDismissWarmHint: (sessionId: string) => void
  onRefresh: () => void
  onDetect: () => void
}

function SessionsTab({
  sessions, configs, switchingId, pendingModel, hotSwitchSet, warmHint, hookInstalled, detecting,
  onSwitch, onToggleHotSwitch, onDismissWarmHint, onRefresh, onDetect
}: SessionsTabProps) {
  return (
    <div className="panel">
      {!hookInstalled && (
        <div className="tip">
          💡 Hook 未安装，模型状态不会自动更新。
          <button className="tip-link" onClick={onDetect} disabled={detecting}>
            {detecting ? '检测中...' : '手动检测'}
          </button>
        </div>
      )}

      <div className="toolbar">
        <span className="count">{sessions.length} 个会话</span>
        <div className="toolbar-actions">
          <button className="btn ghost" onClick={onDetect} disabled={detecting}>
            {detecting ? '检测中...' : '检测模型'}
          </button>
          <button className="btn ghost" onClick={onRefresh}>刷新</button>
        </div>
      </div>

      {sessions.length === 0 ? (
        <div className="empty">
          <p>未检测到终端会话</p>
        </div>
      ) : (
        <div className="session-list">
          {sessions.map((session) => {
            const optimistic = pendingModel[session.sessionId]
            const matched = configs.find((c) => c.opusModel === session.currentModel)?.shortName ?? ''
            const selected = optimistic || matched
            const isSwitching = switchingId === session.sessionId
            const hotSwitch = hotSwitchSet.has(session.sessionId)
            const disabled = isSwitching || (session.isBusy && !hotSwitch)
            const warmTarget = warmHint[session.sessionId]
            const hotLabel = IS_WIN ? (hotSwitch ? '🔥 暖切换' : '暖切换') : (hotSwitch ? '🔥 热切换' : '热切换')

            return (
              <div key={session.sessionId} className={`session-card ${isSwitching ? 'switching' : ''}`}>
                <div className="session-info">
                  <div className="session-top">
                    <span className="app-tag">{session.appName || '终端'}</span>
                    <span className={`status ${session.isBusy ? 'busy' : 'idle'}`}>
                      {session.isBusy ? '● claude 运行中' : '● 空闲'}
                    </span>
                    {isSwitching && (
                      <span className="switch-hint pending">
                        {hotSwitch ? (IS_WIN ? '暖切换中' : '热切换中') : '切换中'}
                        <span className="switch-dots" />
                      </span>
                    )}
                  </div>
                  <div className="session-path" title={session.name}>
                    {session.name || session.tty}
                  </div>
                  <div className="session-tty">{session.tty ? session.tty.replace('/dev/', '') : session.sessionId}</div>
                  {warmTarget && (
                    <div className="warm-hint">
                      <span>已发送切换到 <b>{warmTarget}</b>，请按一次 <kbd>Ctrl+C</kbd> 退出 claude 以续接新模型</span>
                      <button className="warm-dismiss" onClick={() => onDismissWarmHint(session.sessionId)}>✕</button>
                    </div>
                  )}
                </div>
                <div className="session-action">
                  <div className="action-row">
                    <button
                      className={`hot-switch ${hotSwitch ? 'on' : 'off'}`}
                      onClick={() => onToggleHotSwitch(session.sessionId)}
                      disabled={isSwitching || !session.isBusy}
                      title={!session.isBusy
                        ? '仅 claude 运行中可用'
                        : IS_WIN
                          ? '暖切换：claude 退出后自动续接到新模型（Windows 需手动 Ctrl+C）'
                          : '热切换：claude 退出后自动续接到新模型'}
                    >
                      {hotLabel}
                    </button>
                    <ModelPicker
                      configs={configs}
                      value={selected}
                      placeholder={disabled ? 'claude 运行中' : (session.currentModel && !selected ? `${session.currentModel} · 未匹配` : '选择模型...')}
                      disabled={disabled}
                      onChange={(shortName) => onSwitch(session.sessionId, shortName, session.tty)}
                    />
                  </div>
                </div>
              </div>
            )
          })}
        </div>
      )}
    </div>
  )
}

/* ========== Config Tab ========== */
function ConfigTab({ configs, onRefresh }: { configs: ModelConfig[]; onRefresh: () => void }) {
  const [editing, setEditing] = useState<ModelConfig | null>(null)
  const [showForm, setShowForm] = useState(false)
  const [saveError, setSaveError] = useState('')

  const handleSave = async (config: ModelConfig) => {
    setSaveError('')
    try {
      await window.ccSwitch.config.save(config)
      setShowForm(false)
      setEditing(null)
      onRefresh()
    } catch (err) {
      // 保存失败：保留表单可编辑，显示错误，不关闭弹窗
      setSaveError(`保存失败: ${(err as Error).message}`)
    }
  }

  const handleDelete = async (id: string) => {
    if (!confirm('确定删除？对应的 ~/.bashrc_xxx 文件也会删除。')) return
    await window.ccSwitch.config.delete(id)
    onRefresh()
  }

  const handleImport = async () => {
    await window.ccSwitch.config.importExisting()
    onRefresh()
  }

  return (
    <div className="panel">
      <div className="toolbar">
        <span className="count">{configs.length} 个配置</span>
        <div className="toolbar-actions">
          <button className="btn ghost" onClick={handleImport}>导入现有</button>
          <button className="btn primary" onClick={() => { setEditing(null); setShowForm(true) }}>+ 新增</button>
        </div>
      </div>

      {showForm && (
        <ConfigForm
          config={editing}
          saveError={saveError}
          onSave={handleSave}
          onCancel={() => { setShowForm(false); setEditing(null); setSaveError('') }}
        />
      )}

      <div className="config-list">
        {configs.map((cfg) => (
          <div key={cfg.id} className="config-card">
            <div className="config-info">
              <div className="config-name">{cfg.name}</div>
              <div className="config-meta">
                {cfg.opusModel && <span className="config-model">{cfg.opusModel}</span>}
                <span className="config-url">{cfg.baseUrl.replace(/^https?:\/\//, '').split('/')[0]}</span>
              </div>
            </div>
            <div className="config-actions">
              <button className="btn ghost sm" onClick={() => { setEditing(cfg); setShowForm(true) }}>编辑</button>
              <button className="btn danger sm" onClick={() => handleDelete(cfg.id)}>删除</button>
            </div>
          </div>
        ))}
      </div>
    </div>
  )
}

/* ========== Config Form ========== */

/** 内置预设：选厂商自动填充 baseUrl/模型名，用户只需补 token。
 *  新增预设：在此追加一项即可（需提供真实可用的 baseUrl 与模型 id）。 */
const PRESETS: Array<Partial<ModelConfig> & { key: string; label: string }> = [
  {
    key: 'glm', label: 'GLM 智谱',
    name: 'GLM-5.1 (智谱)', shortName: 'glm',
    baseUrl: 'https://open.bigmodel.cn/api/anthropic',
    opusModel: 'GLM-5.1', sonnetModel: 'glm-5', haikuModel: 'glm-4.7', apiTimeout: 300000
  }
]

function ConfigForm({
  config, saveError, onSave, onCancel
}: {
  config: ModelConfig | null
  saveError: string
  onSave: (c: ModelConfig) => void
  onCancel: () => void
}) {
  const isEdit = !!config
  const [form, setForm] = useState<ModelConfig>(
    config ?? {
      id: crypto.randomUUID(), name: '', shortName: '', authToken: '', baseUrl: '',
      apiTimeout: 300000, haikuModel: '', sonnetModel: '', opusModel: '',
      createdAt: Date.now(), updatedAt: Date.now()
    }
  )
  const [errors, setErrors] = useState<Record<string, string>>({})

  const handleChange = (field: keyof ModelConfig, value: string | number) => {
    setForm((prev) => ({ ...prev, [field]: value }))
    // 输入即清掉该字段错误
    if (errors[field]) setErrors((prev) => ({ ...prev, [field]: '' }))
  }

  /** 应用预设：仅编辑/新增态可用，覆盖 name/shortName/baseUrl/模型名，保留 token */
  const applyPreset = (preset: typeof PRESETS[number]) => {
    setForm((prev) => ({
      ...prev,
      name: preset.name ?? prev.name,
      shortName: preset.shortName ?? prev.shortName,
      baseUrl: preset.baseUrl ?? prev.baseUrl,
      opusModel: preset.opusModel ?? prev.opusModel,
      sonnetModel: preset.sonnetModel ?? prev.sonnetModel,
      haikuModel: preset.haikuModel ?? prev.haikuModel,
      apiTimeout: preset.apiTimeout ?? prev.apiTimeout
    }))
    setErrors({})
  }

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault()
    const next: Record<string, string> = {}
    if (!form.name) next.name = '必填'
    if (!form.shortName) next.shortName = '必填'
    if (!form.authToken) next.authToken = '必填'
    if (!form.baseUrl) next.baseUrl = '必填'
    else if (!/^https?:\/\//.test(form.baseUrl)) next.baseUrl = '需以 http(s):// 开头'
    if (form.shortName && !/^[a-zA-Z0-9_-]+$/.test(form.shortName)) {
      next.shortName = '仅允许字母、数字、下划线、连字符'
    }
    if (Object.keys(next).length > 0) {
      setErrors(next)
      return
    }
    setErrors({})
    onSave(form)
  }

  return (
    <div className="overlay">
      <div className="modal">
        <h3>{isEdit ? '编辑配置' : '新增配置'}</h3>
        {!isEdit && (
          <div className="preset-row">
            <span className="preset-label">内置预设</span>
            {PRESETS.map((p) => (
              <button
                key={p.key}
                type="button"
                className={`chip ${form.shortName === p.shortName ? 'active' : ''}`}
                onClick={() => applyPreset(p)}
              >
                {p.label}
              </button>
            ))}
          </div>
        )}
        <form onSubmit={handleSubmit}>
          <div className="fields">
            <label>名称 *
              <input value={form.name} onChange={(e) => handleChange('name', e.target.value)} placeholder="GLM-5.1 (智谱)" />
              {errors.name && <span className="field-err">{errors.name}</span>}
            </label>
            <label>标识 * <span className="sub">→ profile 文件名</span>
              <input value={form.shortName} onChange={(e) => handleChange('shortName', e.target.value)} placeholder="glm" disabled={isEdit} />
              {errors.shortName && <span className="field-err">{errors.shortName}</span>}
            </label>
            <label className="w2">Auth Token *
              <input value={form.authToken} onChange={(e) => handleChange('authToken', e.target.value)} placeholder="ANTHROPIC_AUTH_TOKEN" />
              {errors.authToken && <span className="field-err">{errors.authToken}</span>}
            </label>
            <label className="w2">Base URL *
              <input value={form.baseUrl} onChange={(e) => handleChange('baseUrl', e.target.value)} placeholder="https://open.bigmodel.cn/api/anthropic" />
              {errors.baseUrl && <span className="field-err">{errors.baseUrl}</span>}
            </label>
            <label>Opus 模型
              <input value={form.opusModel || ''} onChange={(e) => handleChange('opusModel', e.target.value)} placeholder="GLM-5.1" />
            </label>
            <label>Sonnet 模型
              <input value={form.sonnetModel || ''} onChange={(e) => handleChange('sonnetModel', e.target.value)} placeholder="glm-5" />
            </label>
            <label>Haiku 模型
              <input value={form.haikuModel || ''} onChange={(e) => handleChange('haikuModel', e.target.value)} placeholder="glm-4.7" />
            </label>
            <label>Timeout (ms)
              <input type="number" value={form.apiTimeout || 300000} onChange={(e) => handleChange('apiTimeout', parseInt(e.target.value, 10))} />
            </label>
          </div>
          {saveError && <div className="form-err">{saveError}</div>}
          <div className="form-btns">
            <button type="button" className="btn ghost" onClick={onCancel}>取消</button>
            <button type="submit" className="btn primary">保存</button>
          </div>
        </form>
      </div>
    </div>
  )
}

function HookTab({ installed, needsUpgrade, onInstall, onUninstall, onUpgrade }: {
  installed: boolean
  needsUpgrade: boolean
  onInstall: () => Promise<void>
  onUninstall: () => Promise<void>
  onUpgrade: () => Promise<void>
}) {
  return (
    <div className="panel">
      <div className="hook-card">
        <div className="hook-status">
          <span className={`dot ${installed ? (needsUpgrade ? 'upgrade' : 'on') : 'off'}`} />
          <div>
            <div className="hook-label">
              Shell Hook {installed ? (needsUpgrade ? '需要升级' : '已安装') : '未安装'}
            </div>
            <div className="hook-desc">
              {needsUpgrade
                ? '有新版本可用，升级后新终端窗口生效。'
                : installed
                  ? '每个新终端会自动上报当前模型状态。'
                  : '安装后终端会自动上报模型状态，无需手动检测。'}
            </div>
          </div>
        </div>
        <div className="hook-btns">
          {needsUpgrade && (
            <button className="btn primary" onClick={onUpgrade}>升级</button>
          )}
          <button className="btn primary" onClick={onInstall} disabled={installed && !needsUpgrade}>安装</button>
          <button className="btn danger" onClick={onUninstall} disabled={!installed}>卸载</button>
        </div>
      </div>
    </div>
  )
}
