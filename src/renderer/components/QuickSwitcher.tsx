import { useState, useEffect, useCallback } from 'react'
import type { ModelConfig, TerminalSession } from '../types'

const IS_WIN = /Win/i.test(navigator.platform)

/** 匹配会话当前对应的配置：baseUrl 优先，opusModel 兜底 */
function matchShortName(configs: ModelConfig[], s: TerminalSession): string {
  if (s.currentBaseUrl) {
    const m = configs.find((c) => c.baseUrl === s.currentBaseUrl)
    if (m) return m.shortName
  }
  if (s.currentModel) {
    const m = configs.find((c) => c.opusModel === s.currentModel)
    if (m) return m.shortName
  }
  return configs[0]?.shortName ?? ''
}

export default function QuickSwitcher() {
  const [sessions, setSessions] = useState<TerminalSession[]>([])
  const [configs, setConfigs] = useState<ModelConfig[]>([])
  const [focused, setFocused] = useState(0)
  const [selected, setSelected] = useState<Record<string, string>>({})
  const [switchingTty, setSwitchingTty] = useState<string | null>(null)

  const refresh = useCallback(async () => {
    try {
      const [s, c] = await Promise.all([
        window.ccSwitch.session.list(),
        window.ccSwitch.config.list()
      ])
      setSessions(s)
      setConfigs(c.length === 0 ? await window.ccSwitch.config.importExisting() : c)
    } catch {
      // 静默
    }
  }, [])

  useEffect(() => {
    refresh()
    // 【修复】持续轮询：捕获快速窗打开期间新开的终端会话
    const timer = setInterval(refresh, 2000)
    // 【修复】窗口每次唤起(focus)时立即刷新，确保显示最新会话
    const onFocus = () => refresh()
    window.addEventListener('focus', onFocus)
    return () => {
      clearInterval(timer)
      window.removeEventListener('focus', onFocus)
    }
  }, [refresh])

  // 初始化/补全每个会话的选中模型
  useEffect(() => {
    setSelected((prev) => {
      let changed = false
      const next = { ...prev }
      for (const s of sessions) {
        if (!next[s.sessionId]) {
          const m = matchShortName(configs, s)
          if (m) { next[s.sessionId] = m; changed = true }
        }
      }
      return changed ? next : prev
    })
  }, [sessions, configs])

  const safeFocused = sessions.length === 0 ? 0 : Math.min(focused, sessions.length - 1)
  const focusedSession = sessions[safeFocused]

  const cycleModel = useCallback(
    (dir: 1 | -1) => {
      if (!focusedSession || configs.length === 0) return
      const cur = selected[focusedSession.sessionId] || configs[0].shortName
      const idx = Math.max(0, configs.findIndex((c) => c.shortName === cur))
      const nextIdx = (idx + dir + configs.length) % configs.length
      setSelected((prev) => ({ ...prev, [focusedSession.sessionId]: configs[nextIdx].shortName }))
    },
    [focusedSession, configs, selected]
  )

  const doSwitch = useCallback(async () => {
    if (!focusedSession) return
    const shortName = selected[focusedSession.sessionId]
    if (!shortName) return
    setSwitchingTty(focusedSession.tty || focusedSession.sessionId)
    try {
      await window.ccSwitch.session.switchModel(
        focusedSession.sessionId,
        shortName,
        focusedSession.tty,
        focusedSession.isBusy && !IS_WIN ? false : focusedSession.isBusy
      )
      await refresh()
      window.close()
    } catch (err) {
      console.error('[quick] switch failed', err)
    } finally {
      setSwitchingTty(null)
    }
  }, [focusedSession, selected, refresh])

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      switch (e.key) {
        case 'ArrowDown':
          e.preventDefault()
          setFocused((i) => Math.min(i + 1, Math.max(sessions.length - 1, 0)))
          break
        case 'ArrowUp':
          e.preventDefault()
          setFocused((i) => Math.max(i - 1, 0))
          break
        case 'ArrowRight':
        case '.':
          e.preventDefault()
          cycleModel(1)
          break
        case 'ArrowLeft':
        case ',':
          e.preventDefault()
          cycleModel(-1)
          break
        case 'Enter':
          e.preventDefault()
          doSwitch()
          break
        case 'Escape':
          e.preventDefault()
          window.close()
          break
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [sessions.length, cycleModel, doSwitch])

  return (
    <div className="quick">
      <div className="quick-header">
        <span>快速切换模型</span>
        <kbd>⌘⇧M</kbd>
      </div>

      {sessions.length === 0 ? (
        <div className="quick-empty">未检测到终端会话</div>
      ) : (
        <div className="quick-list">
          {sessions.map((s, i) => {
            const isFocused = i === safeFocused
            const isSwitching = switchingTty === (s.tty || s.sessionId)
            const shortName = selected[s.sessionId] || ''
            const cfg = configs.find((c) => c.shortName === shortName)
            return (
              <div
                key={s.sessionId}
                className={`quick-row ${isFocused ? 'focused' : ''} ${isSwitching ? 'switching' : ''}`}
              >
                <div className="quick-row-info">
                  <div className="quick-row-top">
                    <span className="quick-app">{s.appName || '终端'}</span>
                    <span className="quick-cwd" title={s.name}>{s.name || s.tty || s.sessionId}</span>
                    {s.isBusy && <span className="quick-busy">● 运行中</span>}
                  </div>
                </div>
                <div className="quick-model">
                  {isFocused && <span className="arrows">◀ ▶</span>}
                  {cfg?.name || shortName || '—'}
                </div>
              </div>
            )
          })}
        </div>
      )}

      <div className="quick-footer">
        <span><kbd>↑↓</kbd> 选会话</span>
        <span><kbd>← →</kbd> 选模型</span>
        <span><kbd>↵</kbd> 切换</span>
        <span><kbd>esc</kbd> 关闭</span>
      </div>
    </div>
  )
}
