import { useState, useEffect, useCallback } from 'react'
import type { ModelConfig, TerminalSession } from './types'
import ModelPicker from './components/ModelPicker'

type Tab = 'sessions' | 'config' | 'hook'

export default function App() {
  const [activeTab, setActiveTab] = useState<Tab>('sessions')
  const [sessions, setSessions] = useState<TerminalSession[]>([])
  const [configs, setConfigs] = useState<ModelConfig[]>([])
  const [hookInstalled, setHookInstalled] = useState(false)
  const [switchingId, setSwitchingId] = useState<string | null>(null)
  const [pendingModel, setPendingModel] = useState<Record<string, string>>({})
  const [detecting, setDetecting] = useState(false)

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
    setHookInstalled(await window.ccSwitch.hook.check())
  }, [])

  useEffect(() => {
    loadConfigs()
    loadHookStatus()
    loadSessions()
  }, [loadConfigs, loadHookStatus, loadSessions])

  useEffect(() => {
    const timer = setInterval(loadSessions, 3000)
    return () => clearInterval(timer)
  }, [loadSessions])

  const handleSwitchModel = async (sessionId: string, shortName: string, tty: string) => {
    if (!shortName) return
    setPendingModel((prev) => ({ ...prev, [sessionId]: shortName }))
    setSwitchingId(sessionId)
    try {
      await window.ccSwitch.session.switchModel(sessionId, shortName, tty)
      loadSessions()
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
          <span className="logo">⬡</span>
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
            hookInstalled={hookInstalled}
            detecting={detecting}
            onSwitch={handleSwitchModel}
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
            onInstall={async () => {
              await window.ccSwitch.hook.install()
              setHookInstalled(true)
            }}
            onUninstall={async () => {
              await window.ccSwitch.hook.uninstall()
              setHookInstalled(false)
            }}
          />
        )}
      </main>
    </div>
  )
}

/* ========== Sessions Tab ========== */
interface SessionsTabProps {
  sessions: TerminalSession[]
  configs: ModelConfig[]
  switchingId: string | null
  pendingModel: Record<string, string>
  hookInstalled: boolean
  detecting: boolean
  onSwitch: (sessionId: string, shortName: string, tty: string) => void
  onRefresh: () => void
  onDetect: () => void
}

function SessionsTab({
  sessions, configs, switchingId, pendingModel, hookInstalled, detecting, onSwitch, onRefresh, onDetect
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

            return (
              <div key={session.sessionId} className={`session-card ${isSwitching ? 'switching' : ''}`}>
                <div className="session-info">
                  <div className="session-top">
                    <span className="app-tag">{session.appName || '终端'}</span>
                    <span className={`status ${session.isBusy ? 'busy' : 'idle'}`}>
                      {session.isBusy ? '● claude 运行中' : '● 空闲'}
                    </span>
                  </div>
                  <div className="session-path" title={session.name}>
                    {session.name || session.tty}
                  </div>
                  <div className="session-tty">{session.tty.replace('/dev/', '')}</div>
                </div>
                <div className="session-action">
                  <ModelPicker
                    configs={configs}
                    value={selected}
                    placeholder={session.currentModel && !selected ? `${session.currentModel} · 未匹配` : '选择模型...'}
                    disabled={isSwitching}
                    onChange={(shortName) => onSwitch(session.sessionId, shortName, session.tty)}
                  />
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

  const handleSave = async (config: ModelConfig) => {
    await window.ccSwitch.config.save(config)
    setShowForm(false)
    setEditing(null)
    onRefresh()
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
        <ConfigForm config={editing} onSave={handleSave} onCancel={() => { setShowForm(false); setEditing(null) }} />
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
function ConfigForm({ config, onSave, onCancel }: { config: ModelConfig | null; onSave: (c: ModelConfig) => void; onCancel: () => void }) {
  const isEdit = !!config
  const [form, setForm] = useState<ModelConfig>(
    config ?? {
      id: crypto.randomUUID(), name: '', shortName: '', authToken: '', baseUrl: '',
      apiTimeout: 300000, haikuModel: '', sonnetModel: '', opusModel: '',
      createdAt: Date.now(), updatedAt: Date.now()
    }
  )

  const handleChange = (field: keyof ModelConfig, value: string | number) => {
    setForm((prev) => ({ ...prev, [field]: value }))
  }

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault()
    if (!form.name || !form.shortName || !form.authToken || !form.baseUrl) {
      alert('请填写必填字段')
      return
    }
    if (!/^[a-zA-Z0-9_-]+$/.test(form.shortName)) {
      alert('标识只能包含字母、数字、下划线和连字符')
      return
    }
    onSave(form)
  }

  return (
    <div className="overlay">
      <div className="modal">
        <h3>{isEdit ? '编辑配置' : '新增配置'}</h3>
        <form onSubmit={handleSubmit}>
          <div className="fields">
            <label>名称 *
              <input value={form.name} onChange={(e) => handleChange('name', e.target.value)} placeholder="GLM-5.1 (智谱)" />
            </label>
            <label>标识 * <span className="sub">→ ~/.bashrc_标识</span>
              <input value={form.shortName} onChange={(e) => handleChange('shortName', e.target.value)} placeholder="glm" disabled={isEdit} />
            </label>
            <label className="w2">Auth Token *
              <input value={form.authToken} onChange={(e) => handleChange('authToken', e.target.value)} placeholder="ANTHROPIC_AUTH_TOKEN" />
            </label>
            <label className="w2">Base URL *
              <input value={form.baseUrl} onChange={(e) => handleChange('baseUrl', e.target.value)} placeholder="https://open.bigmodel.cn/api/anthropic" />
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
          <div className="form-btns">
            <button type="button" className="btn ghost" onClick={onCancel}>取消</button>
            <button type="submit" className="btn primary">保存</button>
          </div>
        </form>
      </div>
    </div>
  )
}

/* ========== Hook Tab ========== */
function HookTab({ installed, onInstall, onUninstall }: { installed: boolean; onInstall: () => Promise<void>; onUninstall: () => Promise<void> }) {
  return (
    <div className="panel">
      <div className="hook-card">
        <div className="hook-status">
          <span className={`dot ${installed ? 'on' : 'off'}`} />
          <div>
            <div className="hook-label">Shell Hook {installed ? '已安装' : '未安装'}</div>
            <div className="hook-desc">
              {installed
                ? '每个新终端会自动上报当前模型状态。'
                : '安装后终端会自动上报模型状态，无需手动检测。'}
            </div>
          </div>
        </div>
        <div className="hook-btns">
          <button className="btn primary" onClick={onInstall} disabled={installed}>安装</button>
          <button className="btn danger" onClick={onUninstall} disabled={!installed}>卸载</button>
        </div>
      </div>
    </div>
  )
}
