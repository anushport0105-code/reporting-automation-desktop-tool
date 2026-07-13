import { contextBridge, ipcRenderer } from 'electron'

type CapturePayload = {
  url: string
  savePath: string
  resultPosition: number
}

type CaptureResult = {
  folderPath: string
  screenshotPath: string
  evidenceId?: string
  landingUrl?: string
  ampAvailable?: boolean
  ampMessage?: string
  ampScreenshotPath?: string
}

type BrowserProfile = {
  id: string
  directory: string
  name: string
}

type BrowserOption = {
  id: string
  name: string
  engine: 'chromium' | 'firefox'
  executablePath: string
  userDataDir: string
  profiles: BrowserProfile[]
}

type BrowserSelection = {
  browserId: string
  profileId: string
}

type AbuseContact = {
  type: 'form' | 'email' | 'website'
  provider: string
  configuredEmail?: string
  label: string
  value: string
  href: string
}

type GeneratedEmail = { subject: string; body: string }
type DmcaPrefillResult = { filledFields: string[]; message: string }
type AcidDomainResult = { domainNames: string[]; abuseEmails: string[] }
type GmailSendStatus = { status: 'monitoring' | 'sent' | 'unconfirmed'; message: string }
type AutomationTiming = {
  captureMode: 'screen' | 'window'
  browserStartupMs: number
  searchSettleMs: number
  visualEvidenceMs: number
  ampSettleMs: number
  gmailLoadMs: number
  attachmentSettleMs: number
  composeMaximizeMs: number
  sentBeforeRefreshMs: number
  sentAfterRefreshMs: number
  sentMessageOpenMs: number
}

type ProgressUpdate = {
  stage: 'openingBrave' | 'searchEvidence' | 'landingPage' | 'checkingAmp' | 'analyzingUrl' | 'extractingContacts' | 'analyzingDomain' | 'generatingReport' | 'preparingGmail' | 'preparingDmca'
  status: 'active' | 'complete'
}

const api = {
  listBrowsers: (): Promise<BrowserOption[]> => ipcRenderer.invoke('list-browsers'),
  getAutomationTiming: (): Promise<AutomationTiming> => ipcRenderer.invoke('get-automation-timing'),
  saveAutomationTiming: (value: AutomationTiming): Promise<AutomationTiming> => ipcRenderer.invoke('save-automation-timing', value),
  selectSaveFolder: (): Promise<string | undefined> => ipcRenderer.invoke('select-save-folder'),
  resetWorkspace: (): Promise<boolean> => ipcRenderer.invoke('reset-workspace'),
  openControlledBrowser: (selection: BrowserSelection): Promise<boolean> =>
    ipcRenderer.invoke('open-controlled-browser', selection),
  captureGoogleResult: (payload: CapturePayload): Promise<CaptureResult> =>
    ipcRenderer.invoke('capture-google-result', payload),
  captureLandingPage: (): Promise<CaptureResult> => ipcRenderer.invoke('capture-landing-page'),
  findPhishingAbuseContacts: (): Promise<AbuseContact[]> =>
    ipcRenderer.invoke('find-phishing-abuse-contacts'),
  findAcidDomainNames: (): Promise<AcidDomainResult> => ipcRenderer.invoke('find-acid-domain-names'),
  generatePhishingEmail: (selectedProviders: string[], customPrompt: string): Promise<GeneratedEmail> =>
    ipcRenderer.invoke('generate-phishing-email', selectedProviders, customPrompt),
  openGmailDraft: (email: GeneratedEmail): Promise<boolean> =>
    ipcRenderer.invoke('open-gmail-draft', email),
  openDmcaReport: (email: GeneratedEmail): Promise<DmcaPrefillResult> =>
    ipcRenderer.invoke('open-dmca-report', email),
  onProgress: (callback: (update: ProgressUpdate) => void): (() => void) => {
    const listener = (_event: Electron.IpcRendererEvent, update: ProgressUpdate): void => callback(update)
    ipcRenderer.on('operation-progress', listener)
    return () => ipcRenderer.removeListener('operation-progress', listener)
  },
  onGmailSendStatus: (callback: (update: GmailSendStatus) => void): (() => void) => {
    const listener = (_event: Electron.IpcRendererEvent, update: GmailSendStatus): void => callback(update)
    ipcRenderer.on('gmail-send-status', listener)
    return () => ipcRenderer.removeListener('gmail-send-status', listener)
  },
  openFolder: (folderPath: string): Promise<boolean> => ipcRenderer.invoke('open-folder', folderPath)
}

contextBridge.exposeInMainWorld('reportingAutomation', api)
