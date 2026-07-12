export {}

declare global {
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
  type GmailSendStatus = { status: 'monitoring' | 'sent' | 'unconfirmed'; message: string }

  type ProgressStage = 'openingBrave' | 'searchEvidence' | 'landingPage' | 'checkingAmp' | 'analyzingUrl' | 'extractingContacts' | 'generatingReport' | 'preparingGmail'
  type ProgressUpdate = { stage: ProgressStage; status: 'active' | 'complete' }

  interface Window {
    reportingAutomation: {
      listBrowsers: () => Promise<BrowserOption[]>
      selectSaveFolder: () => Promise<string | undefined>
      resetWorkspace: () => Promise<boolean>
      openControlledBrowser: (selection: BrowserSelection) => Promise<boolean>
      captureGoogleResult: (payload: CapturePayload) => Promise<CaptureResult>
      captureLandingPage: () => Promise<CaptureResult>
      findPhishingAbuseContacts: () => Promise<AbuseContact[]>
      generatePhishingEmail: (selectedProviders: string[]) => Promise<GeneratedEmail>
      openGmailDraft: (email: GeneratedEmail) => Promise<boolean>
      onProgress: (callback: (update: ProgressUpdate) => void) => () => void
      onGmailSendStatus: (callback: (update: GmailSendStatus) => void) => () => void
      openFolder: (folderPath: string) => Promise<boolean>
    }
  }
}
