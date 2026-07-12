import { ChangeEvent, FormEvent, useEffect, useMemo, useState } from 'react'
import {
  CheckCircle2,
  Chrome,
  ExternalLink,
  FolderOpen,
  Loader2,
  RefreshCw,
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

const caseTabs = ['Phishing', 'Cloaking', 'Stray Domain', 'Death fishing'] as const
type CaseTab = (typeof caseTabs)[number]
type ScreenshotState = { search: boolean | null; landing: boolean | null; amp: boolean | null }

const progressLabels: Record<ProgressStage, string> = {
  openingBrave: 'Opening browser',
  searchEvidence: 'Capturing search evidence',
  landingPage: 'Capturing landing page',
  checkingAmp: 'Checking AMP',
  analyzingUrl: 'Analyzing URL with Phish.Report',
  extractingContacts: 'Extracting reporting contacts',
  generatingReport: 'Generating report content',
  preparingGmail: 'Preparing Gmail draft'
}

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
  const [generatingEmail, setGeneratingEmail] = useState(false)
  const [preparingGmail, setPreparingGmail] = useState(false)
  const [emailError, setEmailError] = useState('')
  const [gmailSendStatus, setGmailSendStatus] = useState<GmailSendStatus | null>(null)
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
    })
  }, [])

  useEffect(() => {
    return window.reportingAutomation.onProgress((update) => {
      if (update.status === 'active') {
        setActiveProgress(update.stage)
      } else {
        setActiveProgress((current) => (current === update.stage ? null : current))
      }
    })
  }, [])

  useEffect(() => {
    if (status.type === 'error') setActiveProgress(null)
  }, [status.type])

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

  function updateSelectedBrowser(event: ChangeEvent<HTMLSelectElement>): void {
    const browserId = event.target.value
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
    setEmailError('')
    setScreenshotState({ search: null, landing: null, amp: null })
    setStatus({ type: 'capturing' })

    try {
      const result = await window.reportingAutomation.captureGoogleResult(form)
      setScreenshotState({ search: true, landing: null, amp: null })
      setStatus({ type: 'success', result })
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
      if (contacts.length === 0) {
        setContactError('Phish.Report did not show any reporting websites or abuse email addresses.')
      }
    } catch (error) {
      setContactError(error instanceof Error ? error.message : 'Could not check the Phish.Report analysis page.')
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
      setActiveProgress(null)
      setScreenshotState({ search: null, landing: null, amp: null })
      setSelectedCaseTab('Phishing')
      setAbuseContacts([])
      setContactError('')
      setCheckingContacts(false)
      setSelectedProviders([])
      setGeneratedEmail(null)
      setGmailSendStatus(null)
      setGeneratingEmail(false)
      setPreparingGmail(false)
      setEmailError('')
      setForm((current) => ({ ...current, url: '', resultPosition: 1 }))
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
      setGeneratedEmail(await window.reportingAutomation.generatePhishingEmail(eligibleProviders))
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
    } catch (error) {
      setEmailError(error instanceof Error ? error.message : 'Could not prepare the Gmail draft.')
    } finally {
      setPreparingGmail(false)
      setActiveProgress(null)
    }
  }

  const searchComplete = status.type === 'success' || status.type === 'capturingLanding' || status.type === 'landingSuccess'

  return (
    <main className="app-shell">
      <header className="compact-header">
        <h1>Reporting Automation</h1>
        <div className="header-actions">
          <button type="button" onClick={resetWorkspace} title="Reset workspace" aria-label="Reset workspace">
            <RefreshCw size={14} />
          </button>
          <b>v0.5</b>
        </div>
      </header>

      <div className="workspace">
        <div className="workflow">
          <section className={`workflow-step ${selectedProfile ? 'done' : ''}`}>
            <span className="step-number">1</span>
            <div className="step-body">
              <span className="step-label">Choose browser &amp; profile</span>
              <select value={selectedBrowser} onChange={updateSelectedBrowser} disabled={browserConnected} aria-label="Browser">
                {browsers.map((browser) => <option key={browser.id} value={browser.id}>{browser.name}</option>)}
              </select>
              <select id="profile" value={selectedProfile} onChange={updateSelectedProfile} disabled={!activeBrowser || browserConnected}>
                {activeProfiles.length === 0 && <option value="">No profiles found</option>}
                {activeProfiles.map((profile) => <option key={profile.id} value={profile.id}>{profile.name}</option>)}
              </select>
            </div>
          </section>

          <section className={`workflow-step ${browserConnected ? 'done' : ''}`}>
            <span className="step-number">2</span>
            <div className="step-body">
              <span className="step-label">Launch window</span>
              <button className="step-button outline" type="button"
                disabled={!selectedBrowser || !selectedProfile || status.type === 'opening' || status.type === 'capturing' || status.type === 'capturingLanding'}
                onClick={openBrowserWindow}>
                {status.type === 'opening' ? <Loader2 className="spin" size={16} /> : <Chrome size={16} />}
                {browserConnected ? `Focus ${activeBrowser?.name ?? 'Browser'} Window` : `Open ${activeBrowser?.name ?? 'Browser'} Window`}
              </button>
            </div>
          </section>

          <form onSubmit={handleSubmit} className="workflow-form">
            <section className={`workflow-step ${form.savePath && form.url ? 'done' : ''}`}>
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
            </section>

            <section className={`workflow-step capture-step ${searchComplete ? 'done' : ''}`}>
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
          <section className="workspace-card reporting-card">
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
                      {checkingContacts ? <Loader2 className="spin" size={16} /> : <ExternalLink size={16} />}{checkingContacts ? 'Analyzing…' : 'Find reporting contacts'}
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
                      <button
                        className="button primary"
                        type="button"
                        disabled={
                          generatingEmail || preparingGmail ||
                          (!generatedEmail && !abuseContacts.some((contact) => selectedProviders.includes(contact.provider) && contact.configuredEmail))
                        }
                        onClick={generatedEmail ? sendMail : generateEmailContent}
                      >
                        {(generatingEmail || preparingGmail) && <Loader2 className="spin" size={16} />}
                        {generatingEmail ? 'Generating…' : preparingGmail ? 'Preparing Gmail…' : generatedEmail ? 'Send Mail' : 'Generate Content'}
                      </button>
                    )}
                    {generatedEmail && (
                      <div className="email-preview">
                        <span>DEVELOPMENT RECIPIENT</span>
                        <strong>anushport0105@gmail.com</strong>
                        <label>Subject<input value={generatedEmail.subject} readOnly /></label>
                        <label>Content<textarea value={generatedEmail.body} readOnly rows={8} /></label>
                      </div>
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
      <footer className="app-footer"><span>Local evidence workspace</span><span>Images remain on this computer</span></footer>
    </main>
  )
}
