import { ChangeEvent, FormEvent, useCallback, useEffect, useMemo, useRef, useState } from 'react'
import {
  CheckCircle2,
  Check,
  Chrome,
  Copy,
  ExternalLink,
  FolderOpen,
  Loader2,
  RefreshCw,
  RotateCw,
  Settings,
  Shield,
  TriangleAlert
} from 'lucide-react'

type Status =
  | { type: 'idle' }
  | { type: 'opening' }
  | { type: 'ready' }
  | { type: 'capturing' }
  | { type: 'capturingLanding'; searchResult: CaptureResult }
  | { type: 'success'; result: CaptureResult }
  | { type: 'landingSuccess'; searchResult: CaptureResult; landingResult: CaptureResult }
  | { type: 'error'; message: string }

const initialForm: CapturePayload = {
  url: '',
  savePath: localStorage.getItem('reportingAutomation.savePath') || '',
  resultPosition: 1
}

const DEFAULT_CONTENT_PROMPT = 'Create a professional phishing abuse email with a clear urgent subject and a 280–320-word body. Describe the reported URL, deceptive or copied content, user risks, available evidence, and relevant general anti-fraud, cybercrime, consumer-protection, impersonation, copyright, and trademark concerns. Do not invent facts or specific legal violations. Ask the recipient to investigate and take appropriate action.'

const caseTabs = ['Phishing', 'Cloaking', 'Stray Domain', 'Death fishing'] as const
type CaseTab = (typeof caseTabs)[number]
type ScreenshotState = { search: boolean | null; landing: boolean | null; amp: boolean | null }
type ActivityLevel = 'info' | 'success' | 'warning' | 'error'
type ActivityFilter = 'all' | 'warning' | 'error'
type ActivityEntry = { id: number; time: string; level: ActivityLevel; stage: string; message: string }
type WorkflowStage = 'setup' | 'capture' | 'content' | 'report'

const progressLabels: Record<ProgressStage, string> = {
  openingBrave: 'Opening browser',
  searchEvidence: 'Capturing search evidence',
  landingPage: 'Capturing landing page',
  checkingAmp: 'Checking AMP',
  analyzingUrl: 'Analyzing URL with Phish.Report',
  extractingContacts: 'Extracting reporting contacts',
  generatingReport: 'Generating report content',
  preparingGmail: 'Preparing Gmail draft',
  preparingDmca: 'Preparing Google DMCA report'
}
const timingFields: Array<{ key: Exclude<keyof AutomationTiming, 'captureMode'>; label: string; help: string }> = [
  { key: 'browserStartupMs', label: 'Browser startup', help: 'Wait after launching the controlled browser' },
  { key: 'searchSettleMs', label: 'Search settle', help: 'Pause before reading Google results' },
  { key: 'visualEvidenceMs', label: 'Page visual loading', help: 'Allow text and images to finish rendering' },
  { key: 'ampSettleMs', label: 'AMP result settle', help: 'Wait for AMP result panels and screenshots' },
  { key: 'gmailLoadMs', label: 'Gmail initial load', help: 'Pause after opening Gmail inbox' },
  { key: 'attachmentSettleMs', label: 'Attachment settle', help: 'Pause after Gmail finishes uploads' },
  { key: 'composeMaximizeMs', label: 'Compose maximize', help: 'Pause after maximizing the draft' },
  { key: 'sentBeforeRefreshMs', label: 'Sent page initial load', help: 'Pause before refreshing Sent' },
  { key: 'sentAfterRefreshMs', label: 'Sent page refresh', help: 'Wait for the newest sent row after refresh' },
  { key: 'sentMessageOpenMs', label: 'Sent message open', help: 'Pause before capturing 5.png' }
]

export function App(): JSX.Element {
  const [form, setForm] = useState<CapturePayload>(initialForm)
  const [browsers, setBrowsers] = useState<BrowserOption[]>([])
  const [selectedBrowser, setSelectedBrowser] = useState('brave')
  const [selectedProfile, setSelectedProfile] = useState('')
  const [status, setStatus] = useState<Status>({ type: 'idle' })
  const [selectedCaseTab, setSelectedCaseTab] = useState<CaseTab>('Phishing')
  const [abuseContacts, setAbuseContacts] = useState<AbuseContact[]>([])
  const [contactError, setContactError] = useState('')
  const [checkingContacts, setCheckingContacts] = useState(false)
  const [activeProgress, setActiveProgress] = useState<ProgressStage | null>(null)
  const [browserConnected, setBrowserConnected] = useState(false)
  const [screenshotState, setScreenshotState] = useState<ScreenshotState>({ search: null, landing: null, amp: null })
  const [selectedProviders, setSelectedProviders] = useState<string[]>([])
  const [generatedEmail, setGeneratedEmail] = useState<GeneratedEmail | null>(null)
  const [customPrompt, setCustomPrompt] = useState(DEFAULT_CONTENT_PROMPT)
  const [contentCopied, setContentCopied] = useState(false)
  const [generatingEmail, setGeneratingEmail] = useState(false)
  const [preparingGmail, setPreparingGmail] = useState(false)
  const [preparingDmca, setPreparingDmca] = useState(false)
  const [emailError, setEmailError] = useState('')
  const [gmailSendStatus, setGmailSendStatus] = useState<GmailSendStatus | null>(null)
  const [activityLog, setActivityLog] = useState<ActivityEntry[]>([])
  const [activityFilter, setActivityFilter] = useState<ActivityFilter>('all')
  const [activityExpanded, setActivityExpanded] = useState(true)
  const [timingSettings, setTimingSettings] = useState<AutomationTiming | null>(null)
  const [showTimingSettings, setShowTimingSettings] = useState(false)
  const [savingTiming, setSavingTiming] = useState(false)
  const [activeWorkflowStage, setActiveWorkflowStage] = useState<WorkflowStage>('setup')
  const activityId = useRef(0)
  const activityEnd = useRef<HTMLDivElement | null>(null)
  const addActivity = useCallback((level: ActivityLevel, stage: string, message: string): void => {
    setActivityLog((current) => [...current.slice(-299), {
      id: ++activityId.current,
      time: new Date().toLocaleTimeString([], { hour12: false }),
      level,
      stage,
      message
    }])
  }, [])
  const activeBrowser = useMemo(() => {
    return browsers.find((browser) => browser.id === selectedBrowser)
  }, [browsers, selectedBrowser])

  const activeProfiles = activeBrowser?.profiles ?? []

  const canCapture = useMemo(() => {
    return (
      form.url.trim().length > 0 &&
      form.savePath.trim().length > 0 &&
      form.resultPosition > 0 &&
      browserConnected &&
      status.type !== 'capturing' &&
      status.type !== 'capturingLanding' &&
      status.type !== 'opening'
    )
  }, [browserConnected, form, status.type])

  const visibleActivityLog = useMemo(() => {
    if (activityFilter === 'all') return activityLog
    return activityLog.filter((entry) => entry.level === activityFilter)
  }, [activityFilter, activityLog])

  function scrollToWorkspaceSection(id: string): void {
    const stages: Record<string, WorkflowStage> = {
      'setup-section': 'setup',
      'capture-section': 'capture',
      'analysis-section': 'content',
      'report-section': 'report'
    }
    setActiveWorkflowStage(stages[id] ?? 'setup')
  }

  useEffect(() => {
    let mounted = true

    async function loadProfiles(): Promise<void> {
      try {
        const availableBrowsers = await window.reportingAutomation.listBrowsers()
        if (!mounted) return

        const savedBrowser = localStorage.getItem('reportingAutomation.browser') || 'brave'
        const savedProfile = localStorage.getItem('reportingAutomation.profile') || ''
        const nextBrowser = availableBrowsers.find((browser) => browser.id === savedBrowser) || availableBrowsers[0]
        const nextProfile =
          nextBrowser?.profiles.find((profile) => profile.id === savedProfile)?.id ||
          nextBrowser?.profiles[0]?.id ||
          ''

        setBrowsers(availableBrowsers)
        setSelectedBrowser(nextBrowser?.id ?? '')
        setSelectedProfile(nextProfile)

        if (availableBrowsers.length === 0) {
          setStatus({ type: 'error', message: 'No local Brave or Google Chrome profiles were found.' })
        }
      } catch (error) {
        const message = error instanceof Error ? error.message : 'Could not load browser profiles.'
        setStatus({ type: 'error', message })
      }
    }

    loadProfiles()

    return () => {
      mounted = false
    }
  }, [])

  useEffect(() => {
    return window.reportingAutomation.onGmailSendStatus((update) => {
      setGmailSendStatus(update)
      addActivity(update.status === 'sent' ? 'success' : update.status === 'unconfirmed' ? 'warning' : 'info', 'Gmail', update.message)
    })
  }, [addActivity])

  useEffect(() => {
    window.reportingAutomation.getAutomationTiming().then(setTimingSettings).catch((error) => {
      addActivity('error', 'Timing settings', error instanceof Error ? error.message : 'Could not load timing settings')
    })
  }, [addActivity])

  useEffect(() => {
    return window.reportingAutomation.onProgress((update) => {
      if (update.status === 'active') {
        setActiveProgress(update.stage)
        addActivity('info', progressLabels[update.stage], 'Started')
      } else {
        setActiveProgress((current) => (current === update.stage ? null : current))
        addActivity('success', progressLabels[update.stage], 'Completed')
      }
    })
  }, [addActivity])

  useEffect(() => {
    activityEnd.current?.scrollIntoView({ block: 'nearest' })
  }, [activityLog])

  useEffect(() => {
    if (status.type === 'error') addActivity('error', 'Workflow', status.message)
  }, [addActivity, status])

  useEffect(() => {
    if (contactError) addActivity('error', 'Phish.Report', contactError)
  }, [addActivity, contactError])

  useEffect(() => {
    if (emailError) addActivity('error', 'Email', emailError)
  }, [addActivity, emailError])

  async function copyActivityLog(): Promise<void> {
    const text = activityLog.map((entry) => `${entry.time}  ${entry.level.toUpperCase()}  ${entry.stage} — ${entry.message}`).join('\n')
    await navigator.clipboard.writeText(text)
  }

  async function saveTimingSettings(): Promise<void> {
    if (!timingSettings) return
    setSavingTiming(true)
    try {
      const saved = await window.reportingAutomation.saveAutomationTiming(timingSettings)
      setTimingSettings(saved)
      setShowTimingSettings(false)
      addActivity('success', 'Settings', `Saved. Capture mode: ${saved.captureMode === 'window' ? 'browser application window' : 'full screen'}`)
    } catch (error) {
      addActivity('error', 'Timing settings', error instanceof Error ? error.message : 'Could not save timing settings')
    } finally {
      setSavingTiming(false)
    }
  }

  useEffect(() => {
    if (status.type === 'error') setActiveProgress(null)
  }, [status.type])

  useEffect(() => {
    if (!browserConnected || !form.savePath.trim() || !form.url.trim()) return
    let validUrl = false
    try {
      const parsed = new URL(form.url)
      validUrl = parsed.protocol === 'http:' || parsed.protocol === 'https:'
    } catch {
      validUrl = false
    }
    if (!validUrl) return
    const advance = window.setTimeout(() => setActiveWorkflowStage('capture'), 500)
    return () => window.clearTimeout(advance)
  }, [browserConnected, form.savePath, form.url])

  function updatePosition(event: ChangeEvent<HTMLInputElement>): void {
    setForm((current) => ({
      ...current,
      resultPosition: Math.max(1, Number(event.target.value))
    }))
  }

  function updateUrl(event: ChangeEvent<HTMLInputElement>): void {
    setForm((current) => ({
      ...current,
      url: event.target.value
    }))
  }

  async function selectSaveFolder(): Promise<void> {
    try {
      const savePath = await window.reportingAutomation.selectSaveFolder()
      if (!savePath) return
      localStorage.setItem('reportingAutomation.savePath', savePath)
      setForm((current) => ({ ...current, savePath }))
      addActivity('info', 'Case setup', `Evidence destination selected: ${savePath}`)
    } catch (error) {
      setStatus({
        type: 'error',
        message: error instanceof Error ? error.message : 'Could not select the evidence folder.'
      })
    }
  }

  function updateSelectedProfile(event: ChangeEvent<HTMLSelectElement>): void {
    const profileId = event.target.value
    setSelectedProfile(profileId)
    localStorage.setItem('reportingAutomation.profile', profileId)
  }

  function selectBrowser(browserId: string): void {
    const browser = browsers.find((candidate) => candidate.id === browserId)
    const profileId = browser?.profiles[0]?.id ?? ''
    setSelectedBrowser(browserId)
    setSelectedProfile(profileId)
    setBrowserConnected(false)
    localStorage.setItem('reportingAutomation.browser', browserId)
    localStorage.setItem('reportingAutomation.profile', profileId)
  }

  async function openBrowserWindow(): Promise<void> {
    setStatus({ type: 'opening' })

    try {
      await window.reportingAutomation.openControlledBrowser({
        browserId: selectedBrowser,
        profileId: selectedProfile
      })
      setBrowserConnected(true)
      setStatus({ type: 'ready' })
      addActivity('success', 'Browser', `${activeBrowser?.name ?? 'Browser'} connected with the selected profile`)
    } catch (error) {
      setBrowserConnected(false)
      const message = error instanceof Error ? error.message : 'Could not open the controlled browser window.'
      setStatus({ type: 'error', message })
    }
  }

  async function handleSubmit(event: FormEvent): Promise<void> {
    event.preventDefault()
    setSelectedCaseTab('Phishing')
    setAbuseContacts([])
    setContactError('')
    setSelectedProviders([])
    setGeneratedEmail(null)
    setCustomPrompt(DEFAULT_CONTENT_PROMPT)
    setContentCopied(false)
    setEmailError('')
    setScreenshotState({ search: null, landing: null, amp: null })
    setStatus({ type: 'capturing' })

    try {
      const result = await window.reportingAutomation.captureGoogleResult(form)
      setScreenshotState({ search: true, landing: null, amp: null })
      setStatus({ type: 'success', result })
      addActivity('success', 'Evidence', `Saved Google Search evidence: ${result.screenshotPath}`)
    } catch (error) {
      setScreenshotState({ search: false, landing: null, amp: null })
      const message = error instanceof Error ? error.message : 'Capture failed. Please try again.'
      setStatus({ type: 'error', message })
    }
  }

  async function openFolder(): Promise<void> {
    if (status.type !== 'success' && status.type !== 'landingSuccess') return

    try {
      const folderPath = status.type === 'success' ? status.result.folderPath : status.landingResult.folderPath
      await window.reportingAutomation.openFolder(folderPath)
      addActivity('info', 'Evidence', `Opened evidence folder: ${folderPath}`)
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Could not open the saved folder.'
      setStatus({ type: 'error', message })
    }
  }

  async function captureLandingPage(searchResult: CaptureResult): Promise<void> {
    setStatus({ type: 'capturingLanding', searchResult })

    try {
      const landingResult = await window.reportingAutomation.captureLandingPage()
      setScreenshotState({
        search: true,
        landing: true,
        amp: Boolean(landingResult.ampScreenshotPath)
      })
      setStatus({ type: 'landingSuccess', searchResult, landingResult })
      setActiveWorkflowStage('content')
      addActivity('success', 'Evidence', `Saved Landing evidence: ${landingResult.screenshotPath}`)
      addActivity(
        landingResult.ampScreenshotPath ? 'success' : 'warning',
        'Evidence',
        landingResult.ampScreenshotPath ? `Saved AMP evidence: ${landingResult.ampScreenshotPath}` : (landingResult.ampMessage || 'AMP evidence was not available')
      )
    } catch (error) {
      setScreenshotState({ search: true, landing: false, amp: false })
      const message = error instanceof Error ? error.message : 'Landing page and AMP test capture failed. Please try again.'
      setStatus({ type: 'error', message })
    }
  }

  async function findAbuseContacts(): Promise<void> {
    setCheckingContacts(true)
    setContactError('')
    setAbuseContacts([])
    setSelectedProviders([])
    setGeneratedEmail(null)
    setEmailError('')

    try {
      const contacts = await window.reportingAutomation.findPhishingAbuseContacts()
      setAbuseContacts(contacts)
      addActivity('success', 'Phish.Report', `Extracted ${contacts.length} reporting contact${contacts.length === 1 ? '' : 's'}`)
      if (contacts.length === 0) setContactError('Phish.Report did not show any reporting websites or abuse email addresses.')
    } catch (error) {
      setContactError(error instanceof Error ? error.message : 'Could not check Phish.Report.')
    } finally {
      setCheckingContacts(false)
      setActiveProgress(null)
    }
  }

  async function resetWorkspace(): Promise<void> {
    try {
      await window.reportingAutomation.resetWorkspace()
    } finally {
      setBrowserConnected(false)
      setStatus({ type: 'idle' })
      setActiveWorkflowStage('setup')
      setActiveProgress(null)
      setScreenshotState({ search: null, landing: null, amp: null })
      setSelectedCaseTab('Phishing')
      setAbuseContacts([])
      setContactError('')
      setCheckingContacts(false)
      setSelectedProviders([])
      setGeneratedEmail(null)
      setCustomPrompt(DEFAULT_CONTENT_PROMPT)
      setContentCopied(false)
      setGmailSendStatus(null)
      setGeneratingEmail(false)
      setPreparingGmail(false)
      setPreparingDmca(false)
      setEmailError('')
      setForm((current) => ({ ...current, url: '', resultPosition: 1 }))
      setActivityLog([])
      activityId.current = 0
    }
  }

  function toggleProvider(provider: string): void {
    setSelectedProviders((current) =>
      current.includes(provider) ? current.filter((item) => item !== provider) : [...current, provider]
    )
    setGeneratedEmail(null)
    setEmailError('')
    setGmailSendStatus(null)
  }

  async function generateEmailContent(): Promise<void> {
    const eligibleProviders = abuseContacts
      .filter((contact) => selectedProviders.includes(contact.provider) && contact.configuredEmail)
      .map((contact) => contact.provider)
    setGeneratingEmail(true)
    setEmailError('')
    try {
      const generated = await window.reportingAutomation.generatePhishingEmail(eligibleProviders, customPrompt)
      setGeneratedEmail(generated)
      setActiveWorkflowStage('report')
      setContentCopied(false)
      addActivity('success', 'Ollama', `Generated report content for: ${eligibleProviders.join(', ')}`)
    } catch (error) {
      setEmailError(error instanceof Error ? error.message : 'Could not generate report content.')
    } finally {
      setGeneratingEmail(false)
      setActiveProgress(null)
    }
  }

  async function sendMail(): Promise<void> {
    if (!generatedEmail) return
    setPreparingGmail(true)
    setEmailError('')
    setGmailSendStatus(null)
    try {
      await window.reportingAutomation.openGmailDraft(generatedEmail)
      addActivity('success', 'Gmail', 'Draft prepared, evidence attached, and draft screenshot saved as 4.png')
    } catch (error) {
      setEmailError(error instanceof Error ? error.message : 'Could not prepare the Gmail draft.')
    } finally {
      setPreparingGmail(false)
      setActiveProgress(null)
    }
  }

  async function prepareDmcaReport(): Promise<void> {
    if (!generatedEmail) return
    setPreparingDmca(true)
    setEmailError('')
    try {
      const result = await window.reportingAutomation.openDmcaReport(generatedEmail)
      addActivity('success', 'Google DMCA', result.message)
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Could not prepare the Google DMCA report.'
      setEmailError(message)
      addActivity('error', 'Google DMCA', message)
    } finally {
      setPreparingDmca(false)
      setActiveProgress(null)
    }
  }

  async function copyGeneratedEmail(): Promise<void> {
    if (!generatedEmail) return
    await navigator.clipboard.writeText(`Subject: ${generatedEmail.subject}\n\n${generatedEmail.body}`)
    setContentCopied(true)
    window.setTimeout(() => setContentCopied(false), 1800)
    addActivity('info', 'Email', 'Copied generated subject and body')
  }

  const searchComplete = status.type === 'success' || status.type === 'capturingLanding' || status.type === 'landingSuccess'

  return (
    <main className="app-shell">
      <header className="compact-header">
        <h1>Reporting Automation</h1>
        <div className="header-actions">
          <button type="button" onClick={() => setShowTimingSettings(true)} title="Timing settings" aria-label="Timing settings">
            <Settings size={14} />
          </button>
          <button type="button" onClick={resetWorkspace} title="Reset workspace" aria-label="Reset workspace">
            <RefreshCw size={14} />
          </button>
          <b>v0.6</b>
        </div>
      </header>

      {showTimingSettings && timingSettings && (
        <div className="settings-backdrop" role="presentation" onMouseDown={(event) => {
          if (event.currentTarget === event.target) setShowTimingSettings(false)
        }}>
          <section className="timing-settings" role="dialog" aria-modal="true" aria-labelledby="timing-title">
            <div className="settings-heading">
              <div><span>AUTOMATION PACING</span><h2 id="timing-title">Timing settings</h2></div>
              <button type="button" onClick={() => setShowTimingSettings(false)} aria-label="Close settings">×</button>
            </div>
            <p className="settings-note">Values are milliseconds. Changes are saved on this computer and applied without rebuilding. Safety timeouts remain protected.</p>
            <label className="capture-mode-setting">
              <span><strong>Screenshot capture mode</strong><small>Window mode excludes other applications and desktop content.</small></span>
              <select value={timingSettings.captureMode} onChange={(event) => setTimingSettings((current) => current ? {
                ...current,
                captureMode: event.target.value === 'window' ? 'window' : 'screen'
              } : current)}>
                <option value="screen">Full screen</option>
                <option value="window">Browser application window</option>
              </select>
            </label>
            {timingSettings.captureMode === 'window' && (
              <p className="capture-mode-hint">Keep the controlled browser open and not minimized. Other applications may be used and will not appear in the screenshot.</p>
            )}
            <div className="timing-grid">
              {timingFields.map((field) => (
                <label key={field.key}>
                  <span><strong>{field.label}</strong><small>{field.help}</small></span>
                  <input type="number" min="0" max="60000" step="100" value={timingSettings[field.key]}
                    onChange={(event) => setTimingSettings((current) => current ? {
                      ...current,
                      [field.key]: Math.min(60000, Math.max(0, Number(event.target.value) || 0))
                    } : current)} />
                </label>
              ))}
            </div>
            <div className="settings-footer">
              <button className="button secondary" type="button" onClick={() => setShowTimingSettings(false)}>Cancel</button>
              <button className="button primary" type="button" onClick={saveTimingSettings} disabled={savingTiming}>
                {savingTiming && <Loader2 className="spin" size={14} />}Save values
              </button>
            </div>
          </section>
        </div>
      )}

      <div className="workspace">
        <nav className="workflow-canvas" aria-label="Workflow steps">
          <div className="canvas-grid" aria-hidden="true" />
          <button className={`workflow-node ${activeWorkflowStage === 'setup' ? 'active' : ''} ${browserConnected ? 'complete' : ''}`} type="button" onClick={() => setActiveWorkflowStage('setup')}>
            <span className="node-port input" /><b>1</b><span><small>CONFIGURE</small>Setup</span><i>{browserConnected ? 'Ready' : 'Start'}</i><span className="node-port output" />
          </button>
          <span className={`node-connection ${browserConnected ? 'complete' : ''}`} aria-hidden="true" />
          <button className={`workflow-node ${activeWorkflowStage === 'capture' ? 'active' : ''} ${searchComplete ? 'complete' : ''}`} type="button" onClick={() => setActiveWorkflowStage('capture')}>
            <span className="node-port input" /><b>2</b><span><small>EVIDENCE</small>Capture</span><i>{searchComplete ? 'Saved' : 'Pending'}</i><span className="node-port output" />
          </button>
          <span className={`node-connection ${searchComplete ? 'complete' : ''}`} aria-hidden="true" />
          <button className={`workflow-node ${activeWorkflowStage === 'content' ? 'active' : ''} ${generatedEmail ? 'complete' : ''}`} type="button" onClick={() => setActiveWorkflowStage('content')}>
            <span className="node-port input" /><b>3</b><span><small>OLLAMA</small>Content Generation</span><i>{generatedEmail ? 'Generated' : 'Pending'}</i><span className="node-port output" />
          </button>
          <span className={`node-connection ${generatedEmail ? 'complete' : ''}`} aria-hidden="true" />
          <button className={`workflow-node ${activeWorkflowStage === 'report' ? 'active' : ''}`} type="button" onClick={() => setActiveWorkflowStage('report')}>
            <span className="node-port input" /><b>4</b><span><small>DELIVER</small>Report</span><i>{gmailSendStatus?.status === 'sent' ? 'Sent' : 'Pending'}</i><span className="node-port output" />
          </button>
        </nav>
        <div className={`workspace-main stage-${activeWorkflowStage}`}>
        <div className="workflow" id="setup-section">
          <section className="ops-console" aria-label="Security automation setup console">
            <div className="case-config-panel">
              <header><div><span>CASE CONFIGURATION</span><h2>Mission parameters</h2></div><i>{browserConnected ? 'ARMED' : 'STANDBY'}</i></header>
              <p>Configure the evidence run. The execution graph mirrors these values automatically.</p>
              <label><b>01</b><span>Browser</span><select value={selectedBrowser} onChange={(event) => selectBrowser(event.target.value)} disabled={browserConnected}>
                {browsers.map((browser) => <option key={browser.id} value={browser.id}>{browser.name}</option>)}
              </select></label>
              <label><b>02</b><span>Profile</span><select value={selectedProfile} onChange={updateSelectedProfile} disabled={!activeBrowser || browserConnected}>
                {activeProfiles.length === 0 && <option value="">No profiles found</option>}
                {activeProfiles.map((profile) => <option key={profile.id} value={profile.id}>{profile.name}</option>)}
              </select></label>
              <label><b>03</b><span>Evidence folder</span><div className="ops-input-action"><input value={form.savePath} placeholder="Select destination" readOnly title={form.savePath} /><button type="button" onClick={selectSaveFolder} aria-label="Select save folder"><FolderOpen size={15} /></button></div></label>
              <label><b>04</b><span>Target URL</span><input type="url" value={form.url} onChange={updateUrl} placeholder="https://target.example" /></label>
              <label><b>05</b><span>Result position</span><input min={1} step={1} type="number" value={form.resultPosition} onChange={updatePosition} /></label>
              <button className="initiate-ops" type="button" disabled={!selectedBrowser || !selectedProfile || status.type === 'opening' || status.type === 'capturing' || status.type === 'capturingLanding'} onClick={openBrowserWindow}>
                {status.type === 'opening' ? <Loader2 className="spin" size={16} /> : <Shield size={16} />}
                {status.type === 'opening' ? 'INITIALIZING…' : browserConnected ? 'FOCUS CONTROLLED BROWSER' : 'INITIATE WORKFLOW'}
              </button>
            </div>
            <div className={`execution-graph ${status.type === 'opening' ? 'running' : ''}`}>
              <div className="execution-grid" aria-hidden="true" />
              <header><div><span>EXECUTION GRAPH</span><h2>Automated evidence route</h2></div><i>VIEW ONLY</i></header>
              <div className="graph-status"><span className={browserConnected ? 'online' : ''} />{browserConnected ? 'CONTROL CHANNEL ONLINE' : 'AWAITING INITIALIZATION'}</div>
              <div className="graph-route">
                {[
                  ['Browser', activeBrowser?.name || 'Not selected', Boolean(selectedBrowser)],
                  ['Profile', activeProfiles.find((profile) => profile.id === selectedProfile)?.name || 'Not selected', Boolean(selectedProfile)],
                  ['File Location', form.savePath ? 'Destination set' : 'Awaiting path', Boolean(form.savePath)],
                  ['Target URL', form.url || 'Awaiting URL', Boolean(form.url)],
                  ['Position', `Result ${form.resultPosition}`, form.resultPosition > 0]
                ].map(([title, detail, ready], index) => <div className="graph-fragment" key={String(title)}>
                  <article className={`${ready ? 'ready' : ''} ${index === 0 && status.type === 'opening' ? 'processing' : ''}`}><span className="graph-port input" /><small>0{index + 1} / NODE</small><strong>{title}</strong><em>{detail}</em><i>{ready ? 'READY' : 'PENDING'}</i><span className="graph-port output" /></article>
                  {index < 4 && <span className={`graph-link ${ready ? 'ready' : ''}`}><b /></span>}
                </div>)}
              </div>
              <footer><span>Graph mirrors configuration and animates during execution.</span><b>LOCAL EXECUTION · NO CLOUD STORAGE</b></footer>
            </div>
          </section>
          <section className="browser-setup-canvas" aria-label="Browser setup workflow">
            <div className="browser-canvas-grid" aria-hidden="true" />
            <article className={`browser-config-node ${selectedBrowser ? 'configured' : ''}`}>
              <span className="config-port input" />
              <header><span>1</span><div><small>SELECT</small><strong>Choose Browser</strong></div><i>{selectedBrowser ? 'Configured' : 'Waiting'}</i></header>
              <div className="browser-logo-options">
                {browsers.map((browser) => (
                  <button className={selectedBrowser === browser.id ? 'selected' : ''} type="button" key={browser.id}
                    disabled={browserConnected} onClick={() => selectBrowser(browser.id)}>
                    <span className={`browser-logo ${browser.id}`}>
                      {browser.id === 'brave' ? <Shield size={27} /> : <Chrome size={29} />}
                    </span>
                    <strong>{browser.name}</strong>
                    {selectedBrowser === browser.id && <Check size={13} />}
                  </button>
                ))}
              </div>
              <span className="config-port output" />
            </article>

            <span className={`browser-flow-link ${selectedBrowser ? 'ready' : ''}`} aria-hidden="true"><i>›</i></span>

            <article className={`browser-config-node profile-node ${selectedProfile ? 'configured' : ''} ${status.type === 'opening' ? 'running' : ''}`}>
              <span className="config-port input" />
              <header><span>2</span><div><small>CONNECT</small><strong>Choose Profile</strong></div><i>{status.type === 'opening' ? 'Running' : selectedProfile ? 'Ready' : 'Waiting'}</i></header>
              <div className="profile-symbol"><span /></div>
              <select id="profile" value={selectedProfile} onChange={updateSelectedProfile} disabled={!activeBrowser || browserConnected}>
                {activeProfiles.length === 0 && <option value="">No profiles found</option>}
                {activeProfiles.map((profile) => <option key={profile.id} value={profile.id}>{profile.name}</option>)}
              </select>
              <span className="config-port output" />
            </article>

            <span className={`browser-flow-link ${browserConnected ? 'ready' : ''}`} aria-hidden="true"><i>›</i></span>
            <article className={`case-placeholder-node ${browserConnected ? 'ready' : ''}`}>
              <span className="config-port input" /><b>›</b><span>{browserConnected ? 'Case Details Ready' : 'Next: Case Details'}</span>
            </article>

            <div className="initiate-browser-setup">
              <button type="button" disabled={!selectedBrowser || !selectedProfile || status.type === 'opening' || status.type === 'capturing' || status.type === 'capturingLanding'} onClick={openBrowserWindow}>
                {status.type === 'opening' ? <Loader2 className="spin" size={17} /> : <span>▶</span>}
                {status.type === 'opening' ? 'Running setup…' : browserConnected ? 'Focus Browser' : 'Initiate'}
              </button>
              <small>{browserConnected ? 'Browser setup completed' : 'Run browser setup'}</small>
            </div>
            <div className={`setup-execution-status ${status.type === 'opening' ? 'running' : browserConnected ? 'complete' : ''}`}>
              <span>{status.type === 'opening' ? <Loader2 className="spin" size={12} /> : browserConnected ? <Check size={12} /> : '○'} Setup</span>
              <b>•</b><span>{selectedBrowser ? 'Browser selected' : 'Choose browser'}</span>
              <b>•</b><span>{browserConnected ? 'Profile connected' : selectedProfile ? 'Profile ready' : 'Choose profile'}</span>
            </div>
          </section>

          <form onSubmit={handleSubmit} className="workflow-form">
            {browserConnected ? <section className={`workflow-step case-details-node ${form.savePath && form.url ? 'done' : ''}`}>
              <span className="step-number">3</span>
              <div className="step-body">
                <span className="step-label">Case details</span>
                <div className="path-control">
                  <input value={form.savePath} placeholder="Select evidence destination" readOnly title={form.savePath} />
                  <button type="button" onClick={selectSaveFolder} aria-label="Select save folder"><FolderOpen size={16} /></button>
                </div>
                <input type="url" value={form.url} onChange={updateUrl} placeholder="https://example.com" required />
                <label className="position-control"><span>Position</span><input min={1} step={1} type="number" value={form.resultPosition} onChange={updatePosition} /></label>
              </div>
            </section> : null}

            <section className={`workflow-step capture-step ${searchComplete ? 'done' : ''}`} id="capture-section">
              <span className="step-number">4</span>
              <div className="step-body">
                <span className="step-label">Capture</span>
                <button className="step-button capture" type="submit" disabled={!canCapture}>
                  {status.type === 'capturing' ? <Loader2 className="spin" size={16} /> : <ExternalLink size={16} />}
                  {status.type === 'capturing'
                    ? 'Capturing…'
                    : !browserConnected
                      ? 'Connect browser first'
                      : !form.savePath.trim()
                        ? 'Select save path'
                        : !form.url.trim()
                          ? 'Enter URL to continue'
                          : 'Capture Search'}
                </button>
              </div>
            </section>
          </form>
        </div>

        {activeProgress && (
          <section className="progress-card" role="status" aria-live="polite">
            <Loader2 className="spin" size={18} /><div><span>WORKING</span><strong>{progressLabels[activeProgress]}</strong></div>
            <div className="progress-track"><span /></div>
          </section>
        )}

        {(screenshotState.search !== null || screenshotState.landing !== null || screenshotState.amp !== null) && (
          <section className="screenshot-checklist" aria-label="Screenshot results">
            {screenshotState.search !== null && (
              <div className={screenshotState.search ? 'saved' : 'failed'}>
                <b>{screenshotState.search ? '✓' : '×'}</b><span>Google Search</span>
              </div>
            )}
            {screenshotState.landing !== null && (
              <div className={screenshotState.landing ? 'saved' : 'failed'}>
                <b>{screenshotState.landing ? '✓' : '×'}</b><span>Landing Page</span>
              </div>
            )}
            {screenshotState.amp !== null && (
              <div className={screenshotState.amp ? 'saved' : 'failed'}>
                <b>{screenshotState.amp ? '✓' : '×'}</b><span>AMP Page</span>
              </div>
            )}
          </section>
        )}

        {(status.type === 'idle' || status.type === 'ready' || status.type === 'opening' || status.type === 'capturing' || status.type === 'capturingLanding') && (
          <section className="info-banner">
            <Chrome size={18} />
            <p>{status.type === 'ready' ? `${activeBrowser?.name ?? 'Browser'} is ready. Perform the Google search manually, then capture the selected result.` :
              status.type === 'idle' ? 'Choose a browser and profile, then connect it for evidence collection.' :
              `Keep the controlled ${activeBrowser?.name ?? 'browser'} window open while the current operation completes.`}</p>
          </section>
        )}

        {status.type === 'error' && (
          <section className="alert-card"><TriangleAlert size={20} /><div><strong>Action could not be completed</strong><p>{status.message}</p></div></section>
        )}

        {status.type === 'success' && (
          <section className="workspace-card result-card">
            <div className="result-title"><CheckCircle2 size={20} /><div><h2>Search evidence saved</h2><p>Continue to capture the landing page and AMP evidence.</p></div></div>
            <div className="result-actions">
              <button className="button primary" type="button" onClick={() => captureLandingPage(status.result)}><ExternalLink size={16} />Capture landing + AMP</button>
              <button className="button secondary" type="button" onClick={openFolder}><FolderOpen size={16} />Open folder</button>
            </div>
            <p className="file-path">{status.result.screenshotPath}</p>
          </section>
        )}

        {status.type === 'landingSuccess' && (
          <section className="workspace-card reporting-card" id="analysis-section">
            <div className="card-heading"><div><span>STEP 3</span><h2>Reporting workflow</h2></div><span className="success-pill"><CheckCircle2 size={13} /> Evidence ready</span></div>
            <div className="evidence-summary">
              <span><CheckCircle2 size={14} /> Search</span><span><CheckCircle2 size={14} /> Landing</span>
              <span className={status.landingResult.ampScreenshotPath ? '' : 'muted'}><CheckCircle2 size={14} /> AMP</span>
            </div>
            {status.landingResult.ampScreenshotPath && (
              <>
                <div className="case-tabs" role="tablist" aria-label="Evidence case type">
                  {caseTabs.map((tab) => <button className={`case-tab ${selectedCaseTab === tab ? 'active' : ''}`} type="button" role="tab" aria-selected={selectedCaseTab === tab} key={tab} onClick={() => setSelectedCaseTab(tab)}>{tab}</button>)}
                </div>
                {selectedCaseTab === 'Phishing' && (
                  <div className="contact-checker">
                    <button className="button primary" type="button" disabled={checkingContacts} onClick={findAbuseContacts}>
                      {checkingContacts ? <Loader2 className="spin" size={16} /> : <ExternalLink size={16} />}{checkingContacts ? 'Analyzing Phish.Report…' : 'Find reporting contacts'}
                    </button>
                    {abuseContacts.map((contact) => {
                      const checked = selectedProviders.includes(contact.provider)
                      return (
                        <label className={`abuse-contact selectable ${checked ? 'selected' : ''}`} key={contact.href}>
                          <input type="checkbox" checked={checked} onChange={() => toggleProvider(contact.provider)} />
                          <span className="contact-details">
                            <strong>{contact.label}</strong>
                            <span>{contact.value}</span>
                            {checked && !contact.configuredEmail && (
                              <small>There is no valid email ID for this platform to send mail.</small>
                            )}
                          </span>
                        </label>
                      )
                    })}
                    {contactError && <p className="contact-error">{contactError}</p>}
                    {abuseContacts.length > 0 && (
                      <section className="content-generation-section" id="report-section">
                        <div className="content-generation-heading">CONTENT GENERATION</div>
                        <div className="prompt-composer">
                          <input value={customPrompt} onChange={(event) => setCustomPrompt(event.target.value)}
                            placeholder="Type or paste your email-generation prompt…" aria-label="Content generation prompt" />
                          <button className="button primary" type="button" disabled={
                            generatingEmail || preparingGmail || !customPrompt.trim() || !abuseContacts.some((contact) => selectedProviders.includes(contact.provider) && contact.configuredEmail)
                          } onClick={generateEmailContent}>
                            {generatingEmail && <Loader2 className="spin" size={16} />}{generatingEmail ? 'Generating…' : 'Generate'}
                          </button>
                        </div>
                        {generatedEmail && (
                          <div className="email-preview">
                        <div className="email-preview-header">
                          <div><span>DEVELOPMENT RECIPIENT</span><strong>anushport0105@gmail.com</strong></div>
                          <button className={`copy-content-button ${contentCopied ? 'copied' : ''}`} type="button"
                            onClick={copyGeneratedEmail} title="Copy subject and body" aria-label="Copy subject and body">
                            {contentCopied ? <Check size={14} /> : <Copy size={14} />}
                            <span>{contentCopied ? 'Copied' : 'Copy'}</span>
                          </button>
                        </div>
                        <label>Subject<input value={generatedEmail.subject}
                          onChange={(event) => setGeneratedEmail((current) => current ? { ...current, subject: event.target.value } : current)} /></label>
                        <label>Content<textarea value={generatedEmail.body} rows={12}
                          onChange={(event) => setGeneratedEmail((current) => current ? { ...current, body: event.target.value } : current)} /></label>
                        <div className="generated-actions">
                          <button className="button secondary" type="button" disabled={generatingEmail || preparingGmail || !customPrompt.trim()} onClick={generateEmailContent}>
                            {generatingEmail ? <Loader2 className="spin" size={15} /> : <RotateCw size={15} />}{generatingEmail ? 'Regenerating…' : 'Regenerate'}
                          </button>
                          <button className="button primary" type="button" disabled={generatingEmail || preparingGmail || !generatedEmail.subject.trim() || !generatedEmail.body.trim()} onClick={sendMail}>
                            {preparingGmail && <Loader2 className="spin" size={15} />}{preparingGmail ? 'Preparing Gmail…' : 'Send Mail'}
                          </button>
                        </div>
                        <button className="button secondary dmca-button" type="button"
                          disabled={generatingEmail || preparingGmail || preparingDmca || !generatedEmail.subject.trim() || !generatedEmail.body.trim()}
                          onClick={prepareDmcaReport}>
                          {preparingDmca && <Loader2 className="spin" size={15} />}{preparingDmca ? 'Preparing DMCA Report…' : 'Send DMCA Report'}
                        </button>
                          </div>
                        )}
                      </section>
                    )}
                    {emailError && <p className="contact-error">{emailError}</p>}
                    {gmailSendStatus && (
                      <p className={`gmail-send-status ${gmailSendStatus.status}`}>
                        {gmailSendStatus.status === 'sent' ? '✓ ' : ''}{gmailSendStatus.message}
                      </p>
                    )}
                  </div>
                )}
              </>
            )}
            <div className="result-actions"><button className="button secondary" type="button" onClick={openFolder}><FolderOpen size={16} />Open evidence folder</button></div>
            {status.landingResult.ampMessage && <p className="status-message">{status.landingResult.ampMessage}</p>}
          </section>
        )}
        </div>

        <aside className={`activity-panel ${activityExpanded ? 'expanded' : 'collapsed'}`} aria-label="Backend activity log">
          <div className="activity-header">
            <div><span>LIVE DIAGNOSTICS</span><h2>Activity log</h2></div>
            <div className="activity-actions">
              <button type="button" onClick={copyActivityLog} disabled={activityLog.length === 0}>Copy</button>
              <button type="button" onClick={() => setActivityLog([])} disabled={activityLog.length === 0}>Clear</button>
              <button className="activity-toggle" type="button" onClick={() => setActivityExpanded((current) => !current)} aria-expanded={activityExpanded}>{activityExpanded ? 'Hide' : 'Show'}</button>
            </div>
          </div>
          <div className="activity-filters" role="group" aria-label="Filter activity log">
            <button className={activityFilter === 'all' ? 'active' : ''} type="button" onClick={() => setActivityFilter('all')}>All</button>
            <button className={activityFilter === 'warning' ? 'active warning' : 'warning'} type="button" onClick={() => setActivityFilter('warning')}>Warnings</button>
            <button className={activityFilter === 'error' ? 'active error' : 'error'} type="button" onClick={() => setActivityFilter('error')}>Errors</button>
          </div>
          <div className="activity-feed" role="log" aria-live="polite">
            {visibleActivityLog.length === 0 ? (
              <p className="activity-empty">Backend operations, retries and errors will appear here in real time.</p>
            ) : visibleActivityLog.map((entry) => (
              <div className={`activity-entry ${entry.level}`} key={entry.id}>
                <time>{entry.time}</time><b>{entry.level}</b>
                <div><strong>{entry.stage}</strong><p>{entry.message}</p></div>
              </div>
            ))}
            <div ref={activityEnd} />
          </div>
        </aside>
      </div>
      <footer className="app-footer">
        <span>Local evidence workspace · Images remain on this computer</span>
        <button type="button" onClick={openFolder} disabled={status.type !== 'success' && status.type !== 'landingSuccess'}><FolderOpen size={14} />Open Evidence Folder</button>
      </footer>
    </main>
  )
}
