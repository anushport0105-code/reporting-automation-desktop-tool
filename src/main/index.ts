import { app, BrowserWindow, desktopCapturer, dialog, ipcMain, screen, shell } from 'electron'
import { join } from 'path'
import { electronApp, is, optimizer } from '@electron-toolkit/utils'
import { chromium, firefox, type Browser, type BrowserContext, type Locator, type Page } from 'playwright'
import { mkdir, readFile, readdir, rm, writeFile } from 'fs/promises'
import { existsSync } from 'fs'
import { homedir } from 'os'
import { execFile, spawn, type ChildProcess } from 'child_process'
import { createServer } from 'net'

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

type BrowserEngine = 'chromium' | 'firefox'

type BrowserProfile = {
  id: string
  directory: string
  name: string
}

type BrowserOption = {
  id: string
  name: string
  engine: BrowserEngine
  executablePath: string
  userDataDir: string
  profiles: BrowserProfile[]
}

type BrowserDefinition = Omit<BrowserOption, 'profiles'> & {
  profileMode: 'chromium' | 'firefox' | 'single'
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

type ProgressStage = 'openingBrave' | 'searchEvidence' | 'landingPage' | 'checkingAmp' | 'analyzingUrl' | 'extractingContacts' | 'generatingReport' | 'preparingGmail' | 'preparingDmca'
type ProgressUpdate = { stage: ProgressStage; status: 'active' | 'complete' }
type ProgressReporter = (update: ProgressUpdate) => void

const START_URL = 'https://www.google.co.id/?hl=id&gl=ID&pws=0'
const INDONESIA_LANGUAGE_HEADER = 'id-ID,id;q=0.9,en-US;q=0.6,en;q=0.5'
const INDONESIA_GEOLOCATION = {
  latitude: -6.2,
  longitude: 106.816666,
  accuracy: 100
}
const AMP_TEST_URL = 'https://search.google.com/test/amp'
const PHISH_REPORT_URL = 'https://phish.report/'
const OLLAMA_CHAT_URL = 'http://127.0.0.1:11434/api/chat'
const OLLAMA_MODEL = 'qwen3:4b'
const DEVELOPMENT_RECIPIENT = 'anushport0105@gmail.com'
const GOOGLE_DMCA_FORM_URL = 'https://reportcontent.google.com/forms/dmca_search?ai0&pli=1'
const DEVELOPMENT_DMCA_PROFILE = {
  firstName: 'Test',
  lastName: 'User',
  companyName: 'Reporting Automation Development',
  country: 'Indonesia',
  originalWorkUrl: 'https://example.com/'
} as const
const PROVIDER_EMAILS: Record<string, string> = {
  cloudflare: 'abuse@cloudflare.com',
  godaddy: 'abuse@godaddy.com'
}
const DEFAULT_AUTOMATION_TIMING: AutomationTiming = {
  captureMode: 'screen',
  browserStartupMs: 1200,
  searchSettleMs: 500,
  visualEvidenceMs: 6000,
  ampSettleMs: 5000,
  gmailLoadMs: 2500,
  attachmentSettleMs: 1000,
  composeMaximizeMs: 700,
  sentBeforeRefreshMs: 1500,
  sentAfterRefreshMs: 2500,
  sentMessageOpenMs: 1800
}
let automationTiming: AutomationTiming = { ...DEFAULT_AUTOMATION_TIMING }
let controlledBrowser: Browser | undefined
let controlledContext: BrowserContext | undefined
let controlledPage: Page | undefined
let lastSearchCapture: CaptureResult | undefined
let lastLandingUrl: string | undefined
let controlledSelectionKey: string | undefined
let controlledBrowserProcess: ChildProcess | undefined
let gmailMonitorGeneration = 0

function timingSettingsPath(): string {
  return join(app.getPath('userData'), 'timing-settings.json')
}

function normalizeAutomationTiming(value: Partial<AutomationTiming>): AutomationTiming {
  const result = { ...DEFAULT_AUTOMATION_TIMING }
  result.captureMode = value.captureMode === 'window' ? 'window' : 'screen'
  for (const key of Object.keys(DEFAULT_AUTOMATION_TIMING) as Array<keyof AutomationTiming>) {
    if (key === 'captureMode') continue
    const candidate = Number(value[key])
    result[key] = (Number.isFinite(candidate)
      ? Math.min(60000, Math.max(0, Math.round(candidate)))
      : DEFAULT_AUTOMATION_TIMING[key]) as never
  }
  return result
}

async function loadAutomationTiming(): Promise<AutomationTiming> {
  try {
    automationTiming = normalizeAutomationTiming(JSON.parse(await readFile(timingSettingsPath(), 'utf8')))
  } catch {
    automationTiming = { ...DEFAULT_AUTOMATION_TIMING }
  }
  return automationTiming
}

async function saveAutomationTiming(value: Partial<AutomationTiming>): Promise<AutomationTiming> {
  automationTiming = normalizeAutomationTiming(value)
  await writeFile(timingSettingsPath(), JSON.stringify(automationTiming, null, 2), 'utf8')
  return automationTiming
}

process.stdout?.on('error', (error: NodeJS.ErrnoException) => {
  if (error.code !== 'EPIPE') throw error
})

process.stderr?.on('error', (error: NodeJS.ErrnoException) => {
  if (error.code !== 'EPIPE') throw error
})

process.on('uncaughtException', (error: NodeJS.ErrnoException) => {
  if (error.code !== 'EPIPE') throw error
})

function createWindow(): void {
  const mainWindow = new BrowserWindow({
    width: 420,
    height: 590,
    minWidth: 390,
    minHeight: 500,
    resizable: true,
    alwaysOnTop: true,
    backgroundColor: '#070b0d',
    show: false,
    autoHideMenuBar: true,
    webPreferences: {
      preload: join(__dirname, '../preload/index.js'),
      sandbox: false,
      contextIsolation: true,
      nodeIntegration: false
    }
  })

  mainWindow.on('ready-to-show', () => {
    mainWindow.show()
  })

  if (is.dev && process.env.ELECTRON_RENDERER_URL) {
    mainWindow.loadURL(process.env.ELECTRON_RENDERER_URL)
  } else {
    mainWindow.loadFile(join(__dirname, '../renderer/index.html'))
  }
}

function sanitizeFolderSegment(value: string): string {
  const cleaned = value
    .trim()
    .replace(/[<>:"/\\|?*\u0000-\u001f]/g, '-')
    .replace(/\s+/g, ' ')
    .replace(/\.+$/g, '')

  return cleaned || 'untitled-case'
}

function folderSegmentFromUrl(value: string): string {
  let parsedUrl: URL
  try {
    parsedUrl = new URL(value.trim())
  } catch {
    throw new Error('Enter a valid URL, including https:// or http://.')
  }

  if (!['http:', 'https:'].includes(parsedUrl.protocol)) {
    throw new Error('The URL must start with https:// or http://.')
  }

  const readableUrl = `${parsedUrl.hostname}${parsedUrl.pathname === '/' ? '' : parsedUrl.pathname}${parsedUrl.search}`
  return sanitizeFolderSegment(readableUrl).slice(0, 120).replace(/[ .]+$/g, '') || 'website'
}

function formatDate(date: Date): string {
  const year = date.getFullYear()
  const month = String(date.getMonth() + 1).padStart(2, '0')
  const day = String(date.getDate()).padStart(2, '0')
  return `${year}-${month}-${day}`
}

function formatTimestampForFile(date: Date): string {
  return date.toISOString().replace(/[:.]/g, '-')
}

async function removeNonEvidenceFiles(folderPath: string): Promise<void> {
  await Promise.all([
    rm(join(folderPath, 'metadata.json'), { force: true }),
    rm(join(folderPath, 'landing-metadata.json'), { force: true }),
    rm(join(folderPath, 'amp-test-metadata.json'), { force: true })
  ]).catch(() => undefined)

  const files = await readdir(folderPath).catch(() => [])
  await Promise.all(
    files
      .filter((file) =>
        [
          /^\.amp-test-.*\.tmp\.png$/i,
          /^amp-test-.*\.tmp\.png$/i,
          /^(google-search|landing-page|amp-page)-.*\.png$/i
        ].some((pattern) => pattern.test(file))
      )
      .map((file) => rm(join(folderPath, file), { force: true }))
  ).catch(() => undefined)
}

function evidenceScreenshotPath(folderPath: string, prefix: string, _evidenceId: string): string {
  const filenames: Record<string, string> = {
    'google-search': '1.png',
    'landing-page': '2.png',
    'amp-page': '3.png'
  }
  return join(folderPath, filenames[prefix] ?? `${prefix}.png`)
}

function firstExistingPath(paths: string[]): string | undefined {
  return paths.find((path) => existsSync(path))
}

function getBrowserDefinitions(): BrowserDefinition[] {
  const home = homedir()
  const localAppData = process.env.LOCALAPPDATA || join(home, 'AppData', 'Local')
  const roamingAppData = process.env.APPDATA || join(home, 'AppData', 'Roaming')
  const programFiles = process.env.ProgramFiles || 'C:\\Program Files'
  const programFilesX86 = process.env['ProgramFiles(x86)'] || 'C:\\Program Files (x86)'

  const definitions: Array<BrowserDefinition | undefined> = [
    {
      id: 'brave',
      name: 'Brave',
      engine: 'chromium',
      executablePath: firstExistingPath([
        join(programFiles, 'BraveSoftware', 'Brave-Browser', 'Application', 'brave.exe'),
        join(programFilesX86, 'BraveSoftware', 'Brave-Browser', 'Application', 'brave.exe'),
        join(localAppData, 'BraveSoftware', 'Brave-Browser', 'Application', 'brave.exe')
      ]) ?? '',
      userDataDir: join(localAppData, 'BraveSoftware', 'Brave-Browser', 'User Data'),
      profileMode: 'chromium'
    },
    {
      id: 'chrome',
      name: 'Chrome',
      engine: 'chromium',
      executablePath: firstExistingPath([
        join(programFiles, 'Google', 'Chrome', 'Application', 'chrome.exe'),
        join(programFilesX86, 'Google', 'Chrome', 'Application', 'chrome.exe'),
        join(localAppData, 'Google', 'Chrome', 'Application', 'chrome.exe')
      ]) ?? '',
      userDataDir: join(localAppData, 'Google', 'Chrome', 'User Data'),
      profileMode: 'chromium'
    },
    {
      id: 'edge',
      name: 'Microsoft Edge',
      engine: 'chromium',
      executablePath: firstExistingPath([
        join(programFiles, 'Microsoft', 'Edge', 'Application', 'msedge.exe'),
        join(programFilesX86, 'Microsoft', 'Edge', 'Application', 'msedge.exe'),
        join(localAppData, 'Microsoft', 'Edge', 'Application', 'msedge.exe')
      ]) ?? '',
      userDataDir: join(localAppData, 'Microsoft', 'Edge', 'User Data'),
      profileMode: 'chromium'
    },
    {
      id: 'opera',
      name: 'Opera',
      engine: 'chromium',
      executablePath: firstExistingPath([
        join(localAppData, 'Programs', 'Opera', 'opera.exe'),
        join(programFiles, 'Opera', 'opera.exe'),
        join(programFilesX86, 'Opera', 'opera.exe')
      ]) ?? '',
      userDataDir: join(roamingAppData, 'Opera Software', 'Opera Stable'),
      profileMode: 'single'
    },
    {
      id: 'firefox',
      name: 'Firefox',
      engine: 'firefox',
      executablePath: firstExistingPath([
        join(programFiles, 'Mozilla Firefox', 'firefox.exe'),
        join(programFilesX86, 'Mozilla Firefox', 'firefox.exe'),
        join(localAppData, 'Mozilla Firefox', 'firefox.exe')
      ]) ?? '',
      userDataDir: join(roamingAppData, 'Mozilla', 'Firefox'),
      profileMode: 'firefox'
    }
  ]

  return definitions.filter((definition): definition is BrowserDefinition => {
    return Boolean(definition?.executablePath && existsSync(definition.executablePath))
  })
}

async function getChromiumProfiles(userDataDir: string): Promise<BrowserProfile[]> {
  if (!existsSync(userDataDir)) return []

  const directories = await readdir(userDataDir, { withFileTypes: true }).catch(() => [])
  const profiles = await Promise.all(
    directories
      .filter((entry) => entry.isDirectory())
      .filter((entry) => entry.name === 'Default' || /^Profile \d+$/i.test(entry.name))
      .map(async (entry) => {
        const preferencesPath = join(userDataDir, entry.name, 'Preferences')
        let name = entry.name

        if (existsSync(preferencesPath)) {
          const preferences = await readFile(preferencesPath, 'utf8')
            .then((contents) => JSON.parse(contents) as { profile?: { name?: string } })
            .catch(() => undefined)

          name = preferences?.profile?.name?.trim() || entry.name
        }

        return {
          id: entry.name,
          directory: entry.name,
          name: `${name} - ${entry.name}`
        }
      })
  )

  return profiles.sort((first, second) => {
    if (first.directory === 'Default') return -1
    if (second.directory === 'Default') return 1
    return first.name.localeCompare(second.name)
  })
}

async function getFirefoxProfiles(firefoxDataDir: string): Promise<BrowserProfile[]> {
  const profilesRoot = join(firefoxDataDir, 'Profiles')
  if (!existsSync(profilesRoot)) return []

  const profilesIniPath = join(firefoxDataDir, 'profiles.ini')
  const profilesIni = await readFile(profilesIniPath, 'utf8').catch(() => '')
  const defaultProfileMatch = profilesIni.match(/Default=(.+)/i)
  const defaultProfilePath = defaultProfileMatch?.[1]?.trim().replace(/\//g, '\\')
  const directories = await readdir(profilesRoot, { withFileTypes: true }).catch(() => [])

  return directories
    .filter((entry) => entry.isDirectory())
    .map((entry) => {
      const isDefault = defaultProfilePath?.endsWith(entry.name)
      return {
        id: join(profilesRoot, entry.name),
        directory: entry.name,
        name: `${isDefault ? 'Default - ' : ''}${entry.name}`
      }
    })
    .sort((first, second) => {
      if (first.name.startsWith('Default - ')) return -1
      if (second.name.startsWith('Default - ')) return 1
      return first.name.localeCompare(second.name)
    })
}

async function getBrowserProfiles(browser: BrowserDefinition): Promise<BrowserProfile[]> {
  if (browser.id === 'chrome') {
    return [{
      id: 'reporting-automation',
      directory: 'Default',
      name: 'Reporting Automation Profile - sign in once'
    }]
  }

  if (browser.profileMode === 'chromium') {
    return getChromiumProfiles(browser.userDataDir)
  }

  if (browser.profileMode === 'firefox') {
    return getFirefoxProfiles(browser.userDataDir)
  }

  return existsSync(browser.userDataDir)
    ? [{ id: browser.userDataDir, directory: 'Default', name: 'Default' }]
    : []
}

async function listBrowsers(): Promise<BrowserOption[]> {
  const browsers = await Promise.all(
    getBrowserDefinitions()
      .filter((browser) => browser.id === 'brave' || browser.id === 'chrome')
      .map(async (browser) => ({
      ...browser,
      profiles: await getBrowserProfiles(browser)
      }))
  )

  return browsers.filter((browser) => browser.profiles.length > 0)
}

function selectionKey(selection: BrowserSelection): string {
  return `${selection.browserId}:${selection.profileId}`
}

function withTimeout<T>(promise: Promise<T>, timeoutMs: number, message: string): Promise<T> {
  let timeout: NodeJS.Timeout | undefined

  const timeoutPromise = new Promise<never>((_, reject) => {
    timeout = setTimeout(() => reject(new Error(message)), timeoutMs)
  })

  return Promise.race([promise, timeoutPromise]).finally(() => {
    if (timeout) clearTimeout(timeout)
  })
}

async function getAvailablePort(): Promise<number> {
  return new Promise((resolve, reject) => {
    const server = createServer()

    server.once('error', reject)
    server.listen(0, '127.0.0.1', () => {
      const address = server.address()
      server.close(() => {
        if (typeof address === 'object' && address?.port) {
          resolve(address.port)
        } else {
          reject(new Error('Could not reserve a local debugging port.'))
        }
      })
    })
  })
}

async function waitForChromiumDebugPort(port: number): Promise<void> {
  const endpoint = `http://127.0.0.1:${port}/json/version`
  const startedAt = Date.now()

  while (Date.now() - startedAt < 20000) {
    try {
      const response = await fetch(endpoint)
      if (response.ok) return
    } catch {
      // Browser process may still be starting.
    }

    await new Promise((resolve) => setTimeout(resolve, 300))
  }

  throw new Error('Browser opened, but the remote debugging port did not become available.')
}

function buildChromiumRemoteDebugArgs(browser: BrowserDefinition, selectedProfile: BrowserProfile, port: number): string[] {
  const args = [
    `--remote-debugging-port=${port}`,
    '--remote-debugging-address=127.0.0.1',
    `--user-data-dir=${browser.userDataDir}`,
    '--lang=id-ID',
    '--accept-lang=id-ID,id',
    '--force-country-code=ID',
    '--geolocation=106.816666,-6.2',
    '--force-search-engine-choice-screen=0',
    '--no-default-browser-check',
    '--no-first-run',
    START_URL
  ]

  if (browser.profileMode === 'chromium') {
    args.unshift(`--profile-directory=${selectedProfile.directory}`)
  }

  return args
}

function buildChromiumPersistentArgs(selectedProfile: BrowserProfile): string[] {
  return [
    `--profile-directory=${selectedProfile.directory}`,
    '--lang=id-ID',
    '--accept-lang=id-ID,id',
    '--force-country-code=ID',
    '--geolocation=106.816666,-6.2',
    '--force-search-engine-choice-screen=0',
    '--no-default-browser-check',
    '--no-first-run',
    START_URL
  ]
}

function browserProcessImageName(browserId: string): string | undefined {
  if (browserId === 'chrome') return 'chrome.exe'
  if (browserId === 'edge') return 'msedge.exe'
  return undefined
}

async function closeExistingBrowserProcess(browserId: string): Promise<void> {
  const imageName = browserProcessImageName(browserId)
  if (!imageName) return

  await new Promise<void>((resolve) => {
    execFile('taskkill', ['/IM', imageName, '/T', '/F'], () => resolve())
  })

  await new Promise((resolve) => setTimeout(resolve, automationTiming.browserStartupMs))
}

async function launchChromiumWithRemoteDebugging(
  browser: BrowserDefinition,
  selectedProfile: BrowserProfile,
  launchOptions: Parameters<typeof chromium.launchPersistentContext>[1]
): Promise<BrowserContext> {
  const port = await getAvailablePort()
  const args = buildChromiumRemoteDebugArgs(browser, selectedProfile, port)

  await closeExistingBrowserProcess(browser.id)

  const browserProcess = spawn(browser.executablePath, args, {
    detached: false,
    stdio: 'ignore',
    windowsHide: false
  })

  controlledBrowserProcess = browserProcess

  browserProcess.once('exit', () => {
    if (controlledBrowserProcess === browserProcess) {
      controlledBrowserProcess = undefined
    }
  })

  try {
    await waitForChromiumDebugPort(port)
    controlledBrowser = await withTimeout(
      chromium.connectOverCDP(`http://127.0.0.1:${port}`),
      10000,
      'Browser opened, but Playwright could not connect to the remote debugging port.'
    )
    return controlledBrowser.contexts()[0] ?? (await controlledBrowser.newContext())
  } catch {
    browserProcess.kill()
    controlledBrowserProcess = undefined

    const context = await chromium.launchPersistentContext(browser.userDataDir, {
      ...launchOptions,
      ignoreDefaultArgs: ['--enable-automation', '--no-sandbox'],
      args: buildChromiumPersistentArgs(selectedProfile)
    })

    controlledBrowser = context.browser() ?? undefined
    return context
  }
}

async function openGoogleSearchStartPage(page: Page): Promise<void> {
  await page.goto(START_URL, { waitUntil: 'domcontentloaded', timeout: 15000 }).catch(() => undefined)

  if (/^https:\/\/accounts\.google\./i.test(page.url())) {
    await page.goto(START_URL, { waitUntil: 'domcontentloaded', timeout: 15000 }).catch(() => undefined)
  }
}

async function openCleanGoogleSearchPage(context: BrowserContext): Promise<Page> {
  const pages = context.pages()
  let googlePage = pages.find((page) => /^https:\/\/www\.google\.co\.id/i.test(page.url()) && !page.isClosed())

  if (!googlePage) {
    googlePage = pages.find((page) => !page.isClosed()) ?? (await context.newPage())
  }

  await openGoogleSearchStartPage(googlePage)
  await googlePage.waitForLoadState('domcontentloaded', { timeout: 5000 }).catch(() => undefined)

  await Promise.all(
    context
      .pages()
      .filter((page) => page !== googlePage && !page.isClosed() && /^about:blank$/i.test(page.url()))
      .map((page) => page.close().catch(() => undefined))
  )

  return googlePage
}

async function installGoogleResultsVisibilityFix(context: BrowserContext): Promise<void> {
  await context.addInitScript(() => {
    const revealFilteredResults = (): void => {
      if (!/^https:\/\/(?:www\.)?google\./i.test(location.href)) return
      const results = document.getElementById('rcnt')
      if (!results || !results.querySelector('#search')) return

      // Some Brave cosmetic-filter lists hide Google's complete result wrapper
      // with a user-agent `#rcnt { display: none !important }` rule. Renaming
      // only that filtered wrapper lets Google's own layout rule apply again.
      if (getComputedStyle(results).display === 'none') {
        results.id = 'reporting-automation-results'
      }
    }

    const observer = new MutationObserver(revealFilteredResults)
    const start = (): void => {
      revealFilteredResults()
      observer.observe(document.documentElement, { childList: true, subtree: true })
      const interval = window.setInterval(revealFilteredResults, 500)
      window.setTimeout(() => window.clearInterval(interval), 30000)
    }

    if (document.documentElement) start()
    else document.addEventListener('DOMContentLoaded', start, { once: true })
  })
}

async function openControlledBrowser(selection: BrowserSelection): Promise<boolean> {
  const nextSelectionKey = selectionKey(selection)

  if (controlledPage && !controlledPage.isClosed() && controlledSelectionKey === nextSelectionKey) {
    await controlledPage.bringToFront()
    return true
  }

  await controlledContext?.close().catch(() => undefined)
  await controlledBrowser?.close().catch(() => undefined)
  controlledBrowserProcess?.kill()
  controlledBrowserProcess = undefined
  controlledBrowser = undefined
  controlledContext = undefined
  controlledPage = undefined
  controlledSelectionKey = undefined

  const browserDefinition = getBrowserDefinitions().find((candidate) => candidate.id === selection.browserId)
  if (!browserDefinition) {
    throw new Error('The selected browser was not found on this computer.')
  }

  const browser: BrowserDefinition = browserDefinition.id === 'chrome'
    ? {
        ...browserDefinition,
        userDataDir: join(app.getPath('userData'), 'Chrome Automation Profile')
      }
    : browserDefinition

  const profiles = await getBrowserProfiles(browser)
  const selectedProfile = profiles.find((profile) => profile.id === selection.profileId)

  if (!selectedProfile) {
    throw new Error(`The selected ${browser.name} profile was not found on this computer.`)
  }

  try {
    const launchOptions = {
      executablePath: browser.executablePath,
      headless: false,
      viewport: { width: 1366, height: 900 },
      deviceScaleFactor: 1,
      locale: 'id-ID',
      timezoneId: 'Asia/Jakarta',
      geolocation: INDONESIA_GEOLOCATION,
      permissions: ['geolocation'],
      extraHTTPHeaders: {
        'Accept-Language': INDONESIA_LANGUAGE_HEADER
      }
    }

    if (browser.engine === 'firefox') {
      controlledContext = await firefox.launchPersistentContext(selectedProfile.id, {
        ...launchOptions,
        firefoxUserPrefs: {
          'browser.search.region': 'ID',
          'browser.search.countryCode': 'ID',
          'general.useragent.locale': 'id-ID',
          'intl.accept_languages': 'id-ID,id,en-US,en'
        }
      })
    } else {
      controlledContext = await launchChromiumWithRemoteDebugging(browser, selectedProfile, launchOptions)
      await withTimeout(
        controlledContext.setExtraHTTPHeaders({ 'Accept-Language': INDONESIA_LANGUAGE_HEADER }),
        3000,
        'Could not apply language headers.'
      ).catch(() => undefined)
      await withTimeout(
        controlledContext.grantPermissions(['geolocation'], { origin: 'https://www.google.co.id' }),
        3000,
        'Could not grant Google Indonesia geolocation permission.'
      ).catch(() => undefined)
      await withTimeout(
        controlledContext.grantPermissions(['geolocation'], { origin: 'https://www.google.com' }),
        3000,
        'Could not grant Google geolocation permission.'
      ).catch(() => undefined)
    }
  } catch (error) {
    const detail = error instanceof Error ? error.message : String(error)
    throw new Error(
      `Could not open ${browser.name} profile "${selectedProfile.name}". ${detail}`
    )
  }

  controlledSelectionKey = nextSelectionKey
  controlledBrowser = controlledBrowser ?? controlledContext.browser() ?? undefined
  await installGoogleResultsVisibilityFix(controlledContext)
  controlledPage = await withTimeout(
    openCleanGoogleSearchPage(controlledContext),
    20000,
    'Browser opened, but the tool could not prepare the Google search page.'
  )

  controlledBrowser?.on('disconnected', () => {
    controlledBrowser = undefined
    controlledContext = undefined
    controlledPage = undefined
    controlledSelectionKey = undefined
  })

  controlledContext.on('close', () => {
    controlledBrowser = undefined
    controlledContext = undefined
    controlledPage = undefined
    controlledSelectionKey = undefined
  })

  controlledPage.on('close', () => {
    controlledPage = undefined
  })

  await withTimeout(
    controlledContext.setExtraHTTPHeaders({ 'Accept-Language': INDONESIA_LANGUAGE_HEADER }),
    3000,
    'Could not apply language headers.'
  ).catch(() => undefined)
  await withTimeout(
    controlledContext.grantPermissions(['geolocation'], { origin: 'https://www.google.co.id' }),
    3000,
    'Could not grant Google Indonesia geolocation permission.'
  ).catch(() => undefined)
  await withTimeout(
    controlledContext.grantPermissions(['geolocation'], { origin: 'https://www.google.com' }),
    3000,
    'Could not grant Google geolocation permission.'
  ).catch(() => undefined)
  await withTimeout(dismissGoogleInterruption(controlledPage), 5000, 'Google interruption cleanup timed out.').catch(
    () => undefined
  )
  await controlledPage.bringToFront()

  return true
}

async function resetControlledWorkspace(): Promise<boolean> {
  const context = controlledContext
  const browser = controlledBrowser
  const browserProcess = controlledBrowserProcess

  controlledPage = undefined
  controlledContext = undefined
  controlledBrowser = undefined
  controlledBrowserProcess = undefined
  controlledSelectionKey = undefined
  lastSearchCapture = undefined
  lastLandingUrl = undefined

  await context?.close().catch(() => undefined)
  await browser?.close().catch(() => undefined)
  browserProcess?.kill()
  return true
}

async function dismissGoogleInterruption(page: Page): Promise<void> {
  const buttons = [
    page.getByRole('button', { name: /accept all/i }),
    page.getByRole('button', { name: /i agree/i }),
    page.getByRole('button', { name: /reject all/i }),
    page.locator('button:has-text("Accept all")'),
    page.locator('button:has-text("I agree")')
  ]

  for (const button of buttons) {
    try {
      if (await button.first().isVisible({ timeout: 1200 })) {
        await button.first().click()
        await page.waitForLoadState('domcontentloaded', { timeout: 5000 }).catch(() => undefined)
        return
      }
    } catch {
      // Google consent UI varies by region; trying the next known button is enough here.
    }
  }
}

async function findSearchInputBox(page: Page): Promise<{ x: number; y: number; width: number; height: number }> {
  const input = page.locator('textarea[name="q"], input[name="q"]').first()
  await input.waitFor({ state: 'visible', timeout: 15000 })
  const box = await input.boundingBox()

  if (!box) {
    throw new Error('Could not locate the Google search input on the page.')
  }

  return box
}

async function findResultBox(
  page: Page,
  resultPosition: number
): Promise<{ box: { x: number; y: number; width: number; height: number }; url: string }> {
  const resultLinks = page.locator('#search a:has(h3)')
  const count = await resultLinks.count()

  if (count < resultPosition) {
    throw new Error(`Only found ${count} visible organic results. Requested result position ${resultPosition}.`)
  }

  const result = resultLinks.nth(resultPosition - 1)
  await result.scrollIntoViewIfNeeded()
  await page.waitForTimeout(automationTiming.searchSettleMs)

  const handle = await result.elementHandle()
  const resultDetails = await handle?.evaluate((element) => {
    const resultContainer =
      element.closest('div.g') ||
      element.closest('[data-sokoban-container]') ||
      element.closest('div[jscontroller]') ||
      element
    const rect = resultContainer.getBoundingClientRect()

    return {
      box: {
        x: rect.left + window.scrollX,
        y: rect.top + window.scrollY,
        width: rect.width,
        height: rect.height
      },
      url: element.href
    }
  })

  if (
    !resultDetails ||
    !resultDetails.url ||
    resultDetails.box.width <= 0 ||
    resultDetails.box.height <= 0
  ) {
    throw new Error(`Could not locate result position ${resultPosition} on the page.`)
  }

  return resultDetails
}

async function addEvidenceOverlay(
  page: Page,
  searchBox: { x: number; y: number; width: number; height: number },
  resultBox: { x: number; y: number; width: number; height: number }
): Promise<void> {
  await page.evaluate(
    ({ searchBox, resultBox }) => {
      document.querySelectorAll('[data-reporting-automation-overlay]').forEach((node) => node.remove())

      const makeBox = (box: typeof searchBox): HTMLDivElement => {
        const element = document.createElement('div')
        element.dataset.reportingAutomationOverlay = 'true'
        element.style.position = 'absolute'
        element.style.left = `${Math.max(box.x - 6, 0)}px`
        element.style.top = `${Math.max(box.y - 6, 0)}px`
        element.style.width = `${box.width + 12}px`
        element.style.height = `${box.height + 12}px`
        element.style.border = '4px solid #e11d1d'
        element.style.boxSizing = 'border-box'
        element.style.zIndex = '2147483647'
        element.style.pointerEvents = 'none'
        return element
      }

      const makeMarker = (label: string, box: typeof searchBox): HTMLDivElement => {
        const element = document.createElement('div')
        element.dataset.reportingAutomationOverlay = 'true'
        element.textContent = label
        element.style.position = 'absolute'
        element.style.left = `${Math.max(box.x - 26, 4)}px`
        element.style.top = `${Math.max(box.y - 18, 4)}px`
        element.style.width = '24px'
        element.style.height = '24px'
        element.style.borderRadius = '999px'
        element.style.background = '#e11d1d'
        element.style.color = '#ffffff'
        element.style.font = '700 15px Arial, sans-serif'
        element.style.display = 'flex'
        element.style.alignItems = 'center'
        element.style.justifyContent = 'center'
        element.style.zIndex = '2147483647'
        element.style.pointerEvents = 'none'
        return element
      }

      document.body.append(makeBox(searchBox), makeMarker('1', searchBox), makeBox(resultBox), makeMarker('2', resultBox))
    },
    { searchBox, resultBox }
  )
}

async function removeEvidenceOverlay(page: Page): Promise<void> {
  await page
    .evaluate(() => {
      document.querySelectorAll('[data-reporting-automation-overlay]').forEach((node) => node.remove())
    })
    .catch(() => undefined)
}

async function navigateForLandingCapture(page: Page, url: string): Promise<void> {
  try {
    await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 45000 })
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)

    if (!message.includes('net::ERR_ABORTED')) {
      throw error
    }
  }

  await page.waitForLoadState('domcontentloaded', { timeout: 12000 }).catch(() => undefined)
  await waitForPageReady(page)

  if (page.url().startsWith('chrome-error://')) {
    throw new Error('Could not open the selected landing page.')
  }
}

async function waitForVisualEvidenceReady(page: Page): Promise<void> {
  await page
    .waitForFunction(
      () => {
        const body = document.body
        const textLength = body?.innerText?.trim().length ?? 0
        const sizeableImages = Array.from(document.images).filter(
          (image) => image.getBoundingClientRect().width >= 120 && image.getBoundingClientRect().height >= 120
        )
        const sizeableImagesLoaded = sizeableImages.every((image) => image.complete && image.naturalWidth > 0)

        return document.readyState === 'complete' && textLength > 20 && sizeableImagesLoaded
      },
      undefined,
      { timeout: 20000 }
    )
    .catch(() => undefined)

  await page.waitForTimeout(automationTiming.visualEvidenceMs)
}

async function waitForPageReady(page: Page): Promise<void> {
  await page.waitForLoadState('domcontentloaded', { timeout: 30000 }).catch(() => undefined)
  await page.waitForLoadState('networkidle', { timeout: 30000 }).catch(() => undefined)
  await waitForVisualEvidenceReady(page)
}

async function captureBrowserWindow(page: Page, screenshotPath: string): Promise<void> {
  if (automationTiming.captureMode === 'window') {
    const pageTitle = (await page.title().catch(() => '')).trim().toLowerCase()
    const windowSources = await desktopCapturer.getSources({
      types: ['window'],
      thumbnailSize: { width: 2560, height: 1600 },
      fetchWindowIcons: false
    })
    const candidates = windowSources.filter(
      (source) => !source.thumbnail.isEmpty() && !/reporting automation/i.test(source.name)
    )
    const browserPattern = controlledSelectionKey?.startsWith('brave:')
      ? /brave/i
      : controlledSelectionKey?.startsWith('chrome:')
        ? /chrome/i
        : /brave|chrome|firefox/i
    const selectedSource =
      candidates.find((source) => pageTitle.length > 2 && source.name.toLowerCase().includes(pageTitle)) ||
      candidates.find((source) => browserPattern.test(source.name))

    if (!selectedSource) {
      throw new Error('Could not find the controlled browser window. Keep it open and not minimized, then try again.')
    }
    await writeFile(screenshotPath, selectedSource.thumbnail.toPNG())
    return
  }

  await page.bringToFront()
  await page.waitForTimeout(350)

  let targetDisplay = screen.getPrimaryDisplay()
  if (page.context().browser()?.browserType().name() === 'chromium') {
    const session = await page.context().newCDPSession(page).catch(() => undefined)
    if (session) {
      const browserWindow = await session
        .send('Browser.getWindowForTarget')
        .then((result) => result as { bounds?: { left?: number; top?: number; width?: number; height?: number } })
        .catch(() => undefined)
      await session.detach().catch(() => undefined)
      const bounds = browserWindow?.bounds
      if (bounds?.width && bounds?.height) {
        targetDisplay = screen.getDisplayMatching({
          x: bounds.left ?? 0,
          y: bounds.top ?? 0,
          width: bounds.width,
          height: bounds.height
        })
      }
    }
  }

  const appWindows = BrowserWindow.getAllWindows().filter((window) => window.isVisible())
  appWindows.forEach((window) => window.hide())

  try {
    await page.waitForTimeout(450)
    const sources = await desktopCapturer.getSources({
      types: ['screen'],
      thumbnailSize: {
        width: Math.round(targetDisplay.size.width * targetDisplay.scaleFactor),
        height: Math.round(targetDisplay.size.height * targetDisplay.scaleFactor)
      }
    })
    const selectedSource =
      sources.find((source) => source.display_id === String(targetDisplay.id)) ||
      sources.find((source) => !source.thumbnail.isEmpty())

    if (!selectedSource || selectedSource.thumbnail.isEmpty()) {
      throw new Error('Could not capture the desktop display. Keep the controlled browser visible and try again.')
    }

    await writeFile(screenshotPath, selectedSource.thumbnail.toPNG())
  } finally {
    appWindows.forEach((window) => window.showInactive())
  }
}

async function screenshotAmpTestedPageDrawer(page: Page, screenshotPath: string): Promise<boolean> {
  await page
    .waitForFunction(
      () => {
        const bodyText = document.body?.innerText ?? ''
        if (/tested page/i.test(bodyText) && /html|screenshot|more info/i.test(bodyText)) {
          return true
        }

        return Array.from(document.querySelectorAll('div, section, aside, mat-sidenav, c-wiz')).some((element) => {
          const rect = element.getBoundingClientRect()
          const text = element.textContent ?? ''
          const style = window.getComputedStyle(element)

          return (
            rect.left >= window.innerWidth * 0.55 &&
            rect.width >= 280 &&
            rect.height >= 300 &&
            /tested page|screenshot|html|more info/i.test(text) &&
            style.display !== 'none' &&
            style.visibility !== 'hidden'
          )
        })
      },
      undefined,
      { timeout: 12000 }
    )
    .catch(() => undefined)

  const screenshotTabs = [
    page.getByRole('tab', { name: /screenshot/i }),
    page.locator('text=SCREENSHOT'),
    page.locator('[role="tab"]:has-text("SCREENSHOT")')
  ]

  for (const tab of screenshotTabs) {
    const candidate = tab.first()
    if (await candidate.isVisible({ timeout: 1500 }).catch(() => false)) {
      await candidate.click().catch(() => undefined)
      break
    }
  }

  await page.waitForTimeout(automationTiming.ampSettleMs)

  const drawerRect = await page
    .evaluate(() => {
      const elements = Array.from(document.querySelectorAll('div, section, aside, mat-sidenav, c-wiz'))
      let bestRect: { x: number; y: number; width: number; height: number } | undefined
      let bestArea = 0

      for (const element of elements) {
        const rect = element.getBoundingClientRect()
        const text = element.textContent ?? ''
        const style = window.getComputedStyle(element)
        const isVisible =
          rect.width >= 280 &&
          rect.height >= 300 &&
          rect.left >= window.innerWidth * 0.45 &&
          style.display !== 'none' &&
          style.visibility !== 'hidden' &&
          Number(style.opacity || '1') > 0
        const looksLikeDrawer = /tested page|screenshot|html|more info|rendered with google inspection tool/i.test(text)

        if (!isVisible || !looksLikeDrawer) continue

        const area = rect.width * rect.height
        if (area > bestArea) {
          bestArea = area
          bestRect = {
            x: Math.max(rect.left, 0),
            y: Math.max(rect.top, 0),
            width: Math.min(rect.width, window.innerWidth - Math.max(rect.left, 0)),
            height: Math.min(rect.height, window.innerHeight - Math.max(rect.top, 0))
          }
        }
      }

      return bestRect
    })
    .catch(() => undefined)

  if (drawerRect && drawerRect.width > 0 && drawerRect.height > 0) {
    await captureBrowserWindow(page, screenshotPath)

    return true
  }

  const hasDrawer = await page
    .locator('body')
    .innerText({ timeout: 5000 })
    .then((text) => /tested page/i.test(text) && /screenshot/i.test(text))
    .catch(() => false)

  if (hasDrawer) {
    await captureBrowserWindow(page, screenshotPath)

    return true
  }

  const marked = await page
    .evaluate(() => {
      document.querySelectorAll('[data-reporting-automation-amp-drawer]').forEach((element) => {
        delete (element as HTMLElement).dataset.reportingAutomationAmpDrawer
      })

      const elements = Array.from(document.querySelectorAll('div, section, aside, mat-sidenav, c-wiz'))
      let bestElement: Element | undefined
      let bestArea = 0

      for (const element of elements) {
        const rect = element.getBoundingClientRect()
        const text = element.textContent ?? ''
        const style = window.getComputedStyle(element)
        const looksLikeDrawer =
          rect.left >= window.innerWidth * 0.45 &&
          rect.width >= 280 &&
          rect.height >= 300 &&
          /tested page|screenshot|html|more info/i.test(text) &&
          style.display !== 'none' &&
          style.visibility !== 'hidden'

        if (!looksLikeDrawer) continue

        const area = rect.width * rect.height
        if (area > bestArea) {
          bestArea = area
          bestElement = element
        }
      }

      if (!(bestElement instanceof HTMLElement)) return false

      bestElement.dataset.reportingAutomationAmpDrawer = 'true'
      return true
    })
    .catch(() => false)

  if (!marked) return false

  await captureBrowserWindow(page, screenshotPath)
  return true
}

async function openTestedAmpPage(page: Page, screenshotPath: string): Promise<string | undefined> {
  const beforeUrl = page.url()
  const viewTestedPagePattern = /view tested page|lihat.*halaman.*uji|halaman yang diuji/i
  const viewButtons = [
    page.getByRole('button', { name: viewTestedPagePattern }),
    page.getByRole('link', { name: viewTestedPagePattern }),
    page.locator('button:has-text("VIEW TESTED PAGE")'),
    page.locator('a:has-text("VIEW TESTED PAGE")'),
    page.locator('[role="button"]:has-text("VIEW TESTED PAGE")'),
    page.locator('button:has-text("LIHAT")'),
    page.locator('[role="button"]:has-text("LIHAT")'),
    page.locator('text=VIEW TESTED PAGE')
  ]

  await page
    .waitForFunction(
      () => /view tested page|lihat.*halaman.*uji|halaman yang diuji/i.test(document.body?.innerText ?? ''),
      undefined,
      { timeout: 20000 }
    )
    .catch(() => undefined)

  for (const button of viewButtons) {
    const candidate = button.first()
    if (!(await candidate.isVisible({ timeout: 5000 }).catch(() => false))) continue

    const popupPromise = page.waitForEvent('popup', { timeout: 8000 }).catch(() => undefined)
    await candidate.scrollIntoViewIfNeeded().catch(() => undefined)
    await candidate.click()
    const popup = await popupPromise

    if (popup) {
      await waitForPageReady(popup)
      await captureBrowserWindow(popup, screenshotPath)
      await popup.close().catch(() => undefined)
      return 'popup'
    }

    await waitForPageReady(page)
    if (await screenshotAmpTestedPageDrawer(page, screenshotPath)) {
      return 'tested-page-drawer'
    }

    if (page.url() !== beforeUrl) {
      await captureBrowserWindow(page, screenshotPath)
      return page.url()
    }

  }

  const clickedByText = await page
    .evaluate(() => {
      const elements = Array.from(document.querySelectorAll('a, button, [role="button"], div, span'))
      const matchingElement = elements.find((element) =>
        /view tested page|lihat.*halaman.*uji|halaman yang diuji/i.test(element.textContent ?? '')
      )
      const clickableElement = matchingElement?.closest('a, button, [role="button"]') ?? matchingElement

      if (!(clickableElement instanceof HTMLElement)) return false

      clickableElement.scrollIntoView({ block: 'center', inline: 'center' })
      clickableElement.click()
      return true
    })
    .catch(() => false)

  if (clickedByText) {
    const popup = await page.waitForEvent('popup', { timeout: 8000 }).catch(() => undefined)

    if (popup) {
      await waitForPageReady(popup)
      await captureBrowserWindow(popup, screenshotPath)
      await popup.close().catch(() => undefined)
      return 'popup'
    }

    await waitForPageReady(page)
    if (await screenshotAmpTestedPageDrawer(page, screenshotPath)) {
      return 'tested-page-drawer'
    }

    if (page.url() !== beforeUrl) {
      await captureBrowserWindow(page, screenshotPath)
      return page.url()
    }
  }

  return undefined
}

async function runAmpTestCapture(
  page: Page,
  targetUrl: string,
  folderPath: string,
  evidenceId: string
): Promise<{
  ampAvailable: boolean
  message: string
  screenshotPath?: string
}> {
  const capturedAtDate = new Date()
  const testScreenshotPath = join(folderPath, `.amp-test-${formatTimestampForFile(capturedAtDate)}.tmp.png`)
  const screenshotPath = evidenceScreenshotPath(folderPath, 'amp-page', evidenceId)

  for (let attempt = 1; attempt <= 2; attempt += 1) {
    await page.goto(AMP_TEST_URL, { waitUntil: 'domcontentloaded', timeout: 45000 })
    await page.waitForLoadState('networkidle', { timeout: 15000 }).catch(() => undefined)
    await page.waitForTimeout(2000)

    const input = page.locator('input[type="url"], input[type="text"], textarea').first()
    await input.waitFor({ state: 'visible', timeout: 10000 })
    await input.fill(targetUrl)

    const testButtons = [
      page.getByRole('button', { name: /test url/i }),
      page.getByRole('button', { name: /run test/i }),
      page.getByRole('button', { name: /^test$/i }),
      page.locator('button:has-text("TEST URL")'),
      page.locator('button:has-text("Test URL")')
    ]
    let submitted = false
    for (const button of testButtons) {
      const candidate = button.first()
      if (await candidate.isVisible({ timeout: 1200 }).catch(() => false)) {
        await candidate.click()
        submitted = true
        break
      }
    }
    if (!submitted) await input.press('Enter')

    await page.waitForLoadState('domcontentloaded', { timeout: 30000 }).catch(() => undefined)
    await page.waitForLoadState('networkidle', { timeout: 30000 }).catch(() => undefined)
    await page.waitForTimeout(5000)
    const attemptText = await page.locator('body').innerText().catch(() => '')
    const serviceFailed = /something went wrong|try again in a few hours/i.test(attemptText)
    if (!serviceFailed) break
    if (attempt === 2) throw new Error('Google AMP Test returned “Something went wrong” after two clean attempts. Try again later.')
  }
  await page
    .waitForFunction(
      () => {
        const text = document.body.innerText
        return /amp|valid|invalid|eligible|not eligible|page is|results/i.test(text)
      },
      undefined,
      { timeout: 30000 }
    )
    .catch(() => undefined)
  await page.screenshot({ path: testScreenshotPath, fullPage: true })
  const resultText = await page.locator('body').innerText({ timeout: 5000 }).catch(() => '')
  const clearlyNoAmp =
    /not an amp page|no amp page|amp page is invalid|invalid amp|not valid amp|not eligible for amp/i.test(resultText) &&
    !/amp page is valid/i.test(resultText)

  let ampAvailable = !clearlyNoAmp
  let ampMessage = ampAvailable ? 'AMP page captured' : 'No AMP page found'

  if (ampAvailable) {
    let openedPageUrl = await openTestedAmpPage(page, screenshotPath)

    if (!openedPageUrl) {
      await page.waitForTimeout(10000)
      openedPageUrl = await openTestedAmpPage(page, screenshotPath)
    }

    if (!openedPageUrl) {
      ampAvailable = false
      ampMessage = 'AMP page is valid, but the tested page could not be opened from the AMP Test tool'
    }
  }

  await rm(testScreenshotPath, { force: true }).catch(() => undefined)

  return {
    ampAvailable,
    message: ampMessage,
    screenshotPath: ampAvailable ? screenshotPath : undefined
  }
}

async function captureGoogleResult(payload: CapturePayload): Promise<CaptureResult> {
  const resultPosition = Number(payload.resultPosition)
  const captureFolder = folderSegmentFromUrl(payload.url)

  if (!Number.isInteger(resultPosition) || resultPosition < 1) {
    throw new Error('Search result position must be a whole number greater than 0.')
  }

  if (!payload.savePath?.trim() || !existsSync(payload.savePath)) {
    throw new Error('Select a valid folder before capturing evidence.')
  }

  const page = controlledPage

  if (!page || page.isClosed()) {
    throw new Error('Open the controlled browser window before capturing.')
  }

  const capturedAtDate = new Date()
  const evidenceId = formatTimestampForFile(capturedAtDate)
  const dateFolder = formatDate(capturedAtDate)
  const folderPath = join(payload.savePath, `${dateFolder} - ${captureFolder}`)
  const screenshotPath = evidenceScreenshotPath(folderPath, 'google-search', evidenceId)

  await page.bringToFront()
  await page.waitForLoadState('domcontentloaded', { timeout: 12000 }).catch(() => undefined)
  await page.waitForLoadState('networkidle', { timeout: 8000 }).catch(() => undefined)

  const searchBox = await findSearchInputBox(page)
  const selectedResult = await findResultBox(page, resultPosition)
  await addEvidenceOverlay(page, searchBox, selectedResult.box)
  await mkdir(folderPath, { recursive: true })
  try {
    await captureBrowserWindow(page, screenshotPath)
  } finally {
    await removeEvidenceOverlay(page)
  }
  await removeNonEvidenceFiles(folderPath)

  lastLandingUrl = selectedResult.url
  lastSearchCapture = {
    folderPath,
    screenshotPath,
    evidenceId,
    landingUrl: selectedResult.url
  }

  return lastSearchCapture
}

async function captureLandingPage(reportProgress?: ProgressReporter): Promise<CaptureResult> {
  const page = controlledPage

  if (!page || page.isClosed()) {
    throw new Error('Open the controlled browser window before capturing the landing page.')
  }

  if (!lastLandingUrl || !lastSearchCapture) {
    throw new Error('Capture the search results page before capturing the landing page.')
  }

  const evidenceId = lastSearchCapture.evidenceId ?? formatTimestampForFile(new Date())
  const screenshotPath = evidenceScreenshotPath(lastSearchCapture.folderPath, 'landing-page', evidenceId)

  reportProgress?.({ stage: 'landingPage', status: 'active' })
  await page.bringToFront()
  await navigateForLandingCapture(page, lastLandingUrl)
  await mkdir(lastSearchCapture.folderPath, { recursive: true })
  await captureBrowserWindow(page, screenshotPath)
  reportProgress?.({ stage: 'landingPage', status: 'complete' })
  reportProgress?.({ stage: 'checkingAmp', status: 'active' })
  const ampResult = await runAmpTestCapture(page, lastLandingUrl, lastSearchCapture.folderPath, evidenceId).catch(
    (error: unknown) => ({
      ampAvailable: false,
      message: `AMP capture failed: ${error instanceof Error ? error.message : String(error)}`,
      screenshotPath: undefined
    })
  )
  reportProgress?.({ stage: 'checkingAmp', status: 'complete' })
  await removeNonEvidenceFiles(lastSearchCapture.folderPath)

  return {
    folderPath: lastSearchCapture.folderPath,
    screenshotPath,
    evidenceId,
    landingUrl: lastLandingUrl,
    ampAvailable: ampResult.ampAvailable,
    ampMessage: ampResult.message,
    ampScreenshotPath: ampResult.screenshotPath
  }
}

async function findPhishingAbuseContacts(reportProgress?: ProgressReporter): Promise<AbuseContact[]> {
  const context = controlledContext
  if (!context) {
    throw new Error('Open the controlled browser window before checking abuse contacts.')
  }
  if (!lastLandingUrl) {
    throw new Error('Capture a Google search result before checking Phish.Report.')
  }

  const analysisPage = await context.newPage()
  reportProgress?.({ stage: 'analyzingUrl', status: 'active' })
  await analysisPage.goto('https://www.google.com', {
    waitUntil: 'domcontentloaded',
    timeout: 20000
  })
  await analysisPage.goto(PHISH_REPORT_URL, {
    waitUntil: 'domcontentloaded',
    timeout: 30000
  })
  const urlInput = analysisPage
    .locator('input[type="url"], input[name*="url" i], input[placeholder*="url" i], textarea')
    .first()
  await urlInput.waitFor({ state: 'visible', timeout: 15000 })
  await urlInput.fill(lastLandingUrl)

  const submitButtons = [
    analysisPage.getByRole('button', { name: /analy[sz]e|scan|check|submit/i }),
    analysisPage.locator('button[type="submit"], input[type="submit"]')
  ]
  let submitted = false
  for (const button of submitButtons) {
    const candidate = button.first()
    if (!(await candidate.isVisible({ timeout: 1000 }).catch(() => false))) continue
    await candidate.click()
    submitted = true
    break
  }
  if (!submitted) {
    await urlInput.press('Enter')
  }

  await analysisPage
    .waitForURL((url) => /\/analysis\//i.test(url.pathname), { timeout: 60000 })
    .catch(() => undefined)
  await analysisPage.waitForLoadState('domcontentloaded', { timeout: 15000 }).catch(() => undefined)
  await analysisPage
    .waitForFunction(
      () => /report|abuse|registrar|hosting|provider/i.test(document.body?.innerText ?? ''),
      undefined,
      { timeout: 30000 }
    )
    .catch(() => undefined)
  await analysisPage.bringToFront()
  reportProgress?.({ stage: 'analyzingUrl', status: 'complete' })
  reportProgress?.({ stage: 'extractingContacts', status: 'active' })

  const contacts = await analysisPage.evaluate(() => {
    const results: Array<{ type: 'form' | 'email' | 'website'; provider: string; label: string; value: string; href: string }> = []
    const allElements = Array.from(document.querySelectorAll<HTMLElement>('h1, h2, h3, h4, p, div, span'))
    const sectionHeading = allElements.find(
      (element) => (element.textContent ?? '').replace(/\s+/g, ' ').trim().toLowerCase() === 'report this website to'
    )
    if (!sectionHeading) return results

    let reportSection: HTMLElement | null = sectionHeading.parentElement
    while (reportSection && reportSection !== document.body) {
      const text = (reportSection.innerText ?? '').replace(/\s+/g, ' ')
      if (/report abuse to/i.test(text) && reportSection.querySelector('a[href]')) break
      reportSection = reportSection.parentElement
    }
    if (!reportSection || reportSection === document.body) return results

    const reportLabels = Array.from(reportSection.querySelectorAll<HTMLElement>('span, p, div, strong'))
      .filter(
        (element) => (element.textContent ?? '').replace(/\s+/g, ' ').trim().toLowerCase() === 'report abuse to'
      )
    const reportRows = reportLabels
      .map((label) => {
        let row = label.parentElement
        while (row && row !== reportSection) {
          if (row.querySelector('a[href], [href^="mailto:"]')) return row
          row = row.parentElement
        }
        return null
      })
      .filter((row, index, all): row is HTMLElement => Boolean(row) && all.indexOf(row) === index)

    for (const reportRow of reportRows) {
      const links = Array.from(reportRow.querySelectorAll<HTMLAnchorElement>('a[href]'))
      for (const link of links) {
      const href = link.href.trim()
      if (/^https?:\/\/(?:www\.)?phish\.report\/contacts\//i.test(href)) continue

      const text = (link.textContent ?? '').replace(/\s+/g, ' ').trim()
      let providerCard: HTMLElement | null = reportRow.parentElement
      let providerName: string | undefined
      while (providerCard && providerCard !== reportSection) {
        const reportRowCount = (providerCard.innerText.match(/report abuse to/gi) ?? []).length
        const heading = Array.from(providerCard.querySelectorAll<HTMLElement>('h1, h2, h3, h4, h5, strong'))
          .map((element) => (element.textContent ?? '').replace(/\s+/g, ' ').trim())
          .find((value) => value && !/report abuse to/i.test(value))
        if (reportRowCount === 1 && heading) {
          providerName = heading
          break
        }
        providerCard = providerCard.parentElement
      }
      const isEmail = href.toLowerCase().startsWith('mailto:')
      const value = isEmail ? href.slice(7).split('?')[0] : href
      results.push({
        type: isEmail ? 'email' : /form|report|abuse|phishing/i.test(`${text} ${href}`) ? 'form' : 'website',
        provider: providerName || 'Unknown provider',
        label: providerName ? `${providerName} — Report abuse to` : 'Report abuse to',
        value,
        href
      })
      }
    }

    for (const row of reportRows) {
      const emails = (row.innerText ?? '').match(/[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/gi) ?? []
      for (const email of emails) {
        results.push({ type: 'email', provider: 'Unknown provider', label: 'Report abuse to', value: email, href: `mailto:${email}` })
      }
    }

    return results
  })

  const uniqueContacts = contacts.filter((contact, index, all) => {
    return all.findIndex((candidate) => candidate.href.toLowerCase() === contact.href.toLowerCase()) === index
  }).map((contact) => ({
    ...contact,
    configuredEmail: PROVIDER_EMAILS[contact.provider.toLowerCase().replace(/[^a-z0-9]/g, '')]
  }))
  reportProgress?.({ stage: 'extractingContacts', status: 'complete' })
  return uniqueContacts
}

async function generatePhishingEmail(
  selectedProviders: string[],
  customPrompt = '',
  reportProgress?: ProgressReporter
): Promise<GeneratedEmail> {
  if (!lastLandingUrl || !lastSearchCapture) {
    throw new Error('Capture the Google result before generating report content.')
  }

  const eligibleProviders = Array.from(new Set(selectedProviders.map((provider) => provider.trim())))
    .filter((provider) => PROVIDER_EMAILS[provider.toLowerCase().replace(/[^a-z0-9]/g, '')])
  if (eligibleProviders.length === 0) {
    throw new Error('Select at least one platform with a configured email address.')
  }

  const evidenceFiles = await readdir(lastSearchCapture.folderPath).catch(() => [])
  const evidenceSummary = [
    evidenceFiles.includes('1.png') ? 'Google Search screenshot' : undefined,
    evidenceFiles.includes('2.png') ? 'Landing Page screenshot' : undefined,
    evidenceFiles.includes('3.png') ? 'AMP Result screenshot' : undefined
  ].filter(Boolean)

  reportProgress?.({ stage: 'generatingReport', status: 'active' })
  const controller = new AbortController()
  const timeout = setTimeout(() => controller.abort(), 90000)
  let response: Response
  try {
    response = await fetch(OLLAMA_CHAT_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      signal: controller.signal,
      body: JSON.stringify({
        model: OLLAMA_MODEL,
        stream: false,
        format: 'json',
        messages: [
          {
            role: 'system',
            content: 'You write professional phishing abuse reports. Return only JSON with string fields subject and body. Use factual language. Do not invent victims, losses, organizations, evidence, jurisdictions, statutes, or legal conclusions. Refer only generally to applicable anti-fraud, cybercrime, consumer-protection, impersonation, copyright, and trademark laws. Ask the recipient to investigate and take appropriate action.'
          },
          {
            role: 'user',
            content: `(PHISHING)\nABOVE URL'S SITE USING HARMFUL PHISHING METHODS AND ALSO USING COPY CONTENTS ITS VERY VERY DANGROUS FOR USERS (I HAVE FULL EVIDENCE), SO I WANT A LONG COPY-PASTE EMAIL FOR REPORTING. Mention applicable categories of law without inventing specific laws.\n\nReported URL: ${lastLandingUrl}\nPlatforms: ${eligibleProviders.join(', ')}\nAvailable evidence: ${evidenceSummary.join(', ') || 'Evidence screenshots captured by the reporting tool'}\n\nUser-provided writing instructions:\n${customPrompt.trim().slice(0, 8000) || 'No additional instructions.'}\n\nCreate one combined detailed email with a clear urgent subject and a professional body. Follow the user writing instructions only when they do not conflict with factual accuracy and the system rules.`
          }
        ]
      })
    })
  } catch (error) {
    if (error instanceof Error && error.name === 'AbortError') {
      throw new Error('Ollama timed out. Make sure Ollama is running and try again.')
    }
    throw new Error(`Could not connect to Ollama. Install and start Ollama, then run: ollama pull ${OLLAMA_MODEL}`)
  } finally {
    clearTimeout(timeout)
  }

  if (!response.ok) {
    const detail = await response.text().catch(() => '')
    if (response.status === 404 || /model.*not found/i.test(detail)) {
      throw new Error(`Ollama model ${OLLAMA_MODEL} is not installed. Run: ollama pull ${OLLAMA_MODEL}`)
    }
    throw new Error(`Ollama generation failed (${response.status}). ${detail.slice(0, 240)}`)
  }

  const payload = (await response.json()) as { message?: { content?: string } }
  const content = payload.message?.content?.trim() || ''
  let generated: Partial<GeneratedEmail>
  try {
    generated = JSON.parse(content) as Partial<GeneratedEmail>
  } catch {
    const jsonMatch = content.match(/\{[\s\S]*\}/)
    if (!jsonMatch) throw new Error('Ollama returned an invalid response. Generate the content again.')
    try {
      generated = JSON.parse(jsonMatch[0]) as Partial<GeneratedEmail>
    } catch {
      throw new Error('Ollama returned malformed JSON. Generate the content again.')
    }
  }

  if (!generated.subject?.trim() || !generated.body?.trim()) {
    throw new Error('Ollama did not return both an email subject and body. Generate the content again.')
  }

  reportProgress?.({ stage: 'generatingReport', status: 'complete' })
  return { subject: generated.subject.trim(), body: generated.body.trim() }
}

async function fillFirstMatchingDmcaField(
  page: Page,
  fieldPattern: RegExp,
  value: string
): Promise<boolean> {
  const controls = page.locator('input:not([type="hidden"]):not([type="checkbox"]):not([type="radio"]):not([type="submit"]), textarea')
  const count = await controls.count()
  for (const includeNearbyText of [false, true]) {
    for (let index = 0; index < count; index += 1) {
      const control = controls.nth(index)
      if (!(await control.isVisible().catch(() => false))) continue
      const contextText = await control.evaluate((element, includeNearby) => {
      const ownText = [
        element.getAttribute('aria-label'),
        element.getAttribute('placeholder'),
        element.getAttribute('name'),
        element.getAttribute('id')
      ].filter(Boolean).join(' ')
      if (!includeNearby) return ownText.replace(/\s+/g, ' ').trim()
      let parent: HTMLElement | null = element.parentElement
      const nearby: string[] = []
      for (let depth = 0; parent && depth < 2; depth += 1, parent = parent.parentElement) {
        nearby.push(parent.innerText || '')
      }
      return `${ownText} ${nearby.join(' ')}`.replace(/\s+/g, ' ').trim()
      }, includeNearbyText)
      if (!fieldPattern.test(contextText)) continue
      await control.fill(value)
      return true
    }
  }
  return false
}

async function openAndPrefillDmcaForm(
  email: GeneratedEmail,
  reportProgress?: ProgressReporter
): Promise<DmcaPrefillResult> {
  if (!controlledContext || !controlledBrowser?.isConnected()) {
    throw new Error('Open the controlled browser before preparing the DMCA report.')
  }
  if (!lastLandingUrl) throw new Error('Capture a Google search result before preparing the DMCA report.')

  reportProgress?.({ stage: 'preparingDmca', status: 'active' })
  const previousDmcaPages = controlledContext.pages().filter((candidate) =>
    candidate.url().startsWith('https://reportcontent.google.com/forms/dmca_search')
  )
  await Promise.all(previousDmcaPages.map((candidate) => candidate.close().catch(() => undefined)))
  const page = await controlledContext.newPage()
  await page.goto(START_URL, { waitUntil: 'domcontentloaded', timeout: 45000 })
  await page.goto(GOOGLE_DMCA_FORM_URL, { waitUntil: 'domcontentloaded', timeout: 60000 })
  await page.waitForTimeout(3000)

  const pageText = await page.locator('body').innerText().catch(() => '')
  if (/sign in to get started|continue with google/i.test(pageText)) {
    await page.bringToFront()
    throw new Error('Google requires sign-in before showing the DMCA form. Sign in using this controlled browser, then click Send DMCA Report again.')
  }

  const filledFields: string[] = []
  const fillByAccessibleName = async (pattern: RegExp, value: string, label: string): Promise<void> => {
    const field = page.getByLabel(pattern).first()
    if (await field.isVisible().catch(() => false)) {
      await field.fill(value)
      filledFields.push(label)
    }
  }

  await fillByAccessibleName(/first name|nama depan/i, DEVELOPMENT_DMCA_PROFILE.firstName, 'test first name')
  await fillByAccessibleName(/last name|nama belakang/i, DEVELOPMENT_DMCA_PROFILE.lastName, 'test last name')
  await fillByAccessibleName(/company name|nama perusahaan/i, DEVELOPMENT_DMCA_PROFILE.companyName, 'test company')

  const selfOwner = page.getByRole('radio').filter({ hasText: /saya sendiri|myself/i }).first()
  if (await selfOwner.isVisible().catch(() => false)) {
    await selfOwner.click()
    filledFields.push('copyright owner: self (test)')
  }
  const countryButton = page.getByRole('button').filter({ hasText: /pilih negara\/wilayah anda|select your country/i }).first()
  if (await countryButton.isVisible().catch(() => false)) {
    await countryButton.click()
    const indonesiaOption = page.getByRole('option', { name: /^Indonesia$/i }).first()
    await indonesiaOption.waitFor({ state: 'visible', timeout: 5000 })
    await indonesiaOption.click()
    filledFields.push('country: Indonesia')
  }

  const liveStreamYes = page.getByRole('radio').filter({ hasText: /^(?:radio_button_unchecked|radio_button_checked)?(?:ya|yes)$/i }).first()
  if (await liveStreamYes.isVisible().catch(() => false)) {
    await liveStreamYes.click()
    filledFields.push('live stream: yes')
  }

  if (await fillFirstMatchingDmcaField(page, /e-?mail|email address/i, DEVELOPMENT_RECIPIENT)) {
    filledFields.push('development email')
  }
  if (await fillFirstMatchingDmcaField(page, /(?:infring|unauthori[sz]ed|reported).{0,80}(?:url|location)|(?:url|location).{0,80}(?:infring|unauthori[sz]ed|reported)|masukkan url di sini|lokasi materi yang melanggar/i, lastLandingUrl)) {
    filledFields.push('infringing URL')
  }
  if (await fillFirstMatchingDmcaField(page, /additional (?:information|details)|explain.{0,60}infring|description.{0,60}infring|why.{0,60}infring|masukkan deskripsi anda di sini|identifikasi dan jelaskan karya/i, `${email.subject}\n\n${email.body}`)) {
    filledFields.push('infringement explanation')
  }
  if (await fillFirstMatchingDmcaField(page, /example.{0,80}(?:work|copyright)|where.{0,80}(?:see|view).{0,80}(?:work|example)|masukkan contoh anda di sini|di mana kami dapat melihat contoh karya/i, DEVELOPMENT_DMCA_PROFILE.originalWorkUrl)) {
    filledFields.push('test original-work URL')
  }

  const confirmationCheckboxes = page.getByRole('checkbox')
  const checkboxCount = Math.min(await confirmationCheckboxes.count(), 4)
  let checkedCount = 0
  for (let index = 0; index < checkboxCount; index += 1) {
    const checkbox = confirmationCheckboxes.nth(index)
    if (!(await checkbox.isVisible().catch(() => false))) continue
    if ((await checkbox.getAttribute('aria-checked')) !== 'true') await checkbox.click()
    checkedCount += 1
  }
  if (checkedCount > 0) filledFields.push(`${checkedCount} confirmation checkboxes`)

  await fillByAccessibleName(
    /signature|tanda tangan/i,
    `${DEVELOPMENT_DMCA_PROFILE.firstName} ${DEVELOPMENT_DMCA_PROFILE.lastName}`,
    'test full-name signature'
  )

  const signedDateField = page
    .locator('fieldset')
    .filter({ hasText: /signed on|ditandatangani pada tanggal/i })
    .first()
  const signedDateControl = signedDateField
    .getByRole('combobox')
    .or(signedDateField.getByRole('button'))
    .or(page.getByRole('combobox', { name: /select a date|pilih tanggal|signed on|ditandatangani pada tanggal/i }))
    .or(page.getByRole('button', { name: /select a date|pilih tanggal|signed on|ditandatangani pada tanggal/i }))
    .first()
  if (await signedDateControl.isVisible().catch(() => false)) {
    const today = new Date()
    const day = today.getDate()
    const year = today.getFullYear()
    const englishMonth = today.toLocaleString('en-US', { month: 'long' })
    const indonesianMonth = today.toLocaleString('id-ID', { month: 'long' })
    const escapeRegExp = (value: string): string => value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
    const todayPattern = new RegExp(
      `(?:${day} (?:${escapeRegExp(englishMonth)}|${escapeRegExp(indonesianMonth)}) ${year}|(?:${escapeRegExp(englishMonth)}|${escapeRegExp(indonesianMonth)}) ${day},? ${year})`,
      'i'
    )
    const controlTag = await signedDateControl.evaluate((element) => element.tagName.toLowerCase())
    let dateSelected = false
    if (controlTag === 'select') {
      dateSelected = await signedDateControl.evaluate((element, pattern) => {
        const select = element as HTMLSelectElement
        const matcher = new RegExp(pattern.source, pattern.flags)
        const option = Array.from(select.options).find((candidate) => matcher.test(candidate.textContent ?? ''))
        if (!option) return false
        select.value = option.value
        select.dispatchEvent(new Event('input', { bubbles: true }))
        select.dispatchEvent(new Event('change', { bubbles: true }))
        return true
      }, { source: todayPattern.source, flags: todayPattern.flags })
    } else {
      await signedDateControl.click()
      const calendar = page.getByRole('dialog').last()
      const todayOption = page
        .getByRole('option', { name: todayPattern })
        .or(page.getByRole('menuitem', { name: todayPattern }))
        .or(calendar.getByRole('button', { name: todayPattern }))
        .or(calendar.locator('[aria-current="date"], [aria-current="true"]'))
        .or(page.getByLabel(todayPattern))
        .first()
      if (await todayOption.isVisible({ timeout: 5000 }).catch(() => false)) {
        await todayOption.scrollIntoViewIfNeeded()
        await todayOption.click()
        dateSelected = true
      }
    }
    if (dateSelected) {
      filledFields.push('today\'s date')
    } else {
      await page.keyboard.press('Escape')
    }
  }

  await page.bringToFront()
  reportProgress?.({ stage: 'preparingDmca', status: 'complete' })
  if (filledFields.length === 0) {
    throw new Error('The Google DMCA form opened, but its current fields did not match the automation. Complete the form manually and check the Activity Log.')
  }
  return {
    filledFields,
    message: `DEVELOPMENT TEST DATA ONLY. DMCA form opened and filled: ${filledFields.join(', ')}. CAPTCHA and Submit were intentionally left untouched. Replace and verify all dummy values and legal declarations before any real submission.`
  }
}

async function maximizeGmailCompose(page: Page): Promise<void> {
  const maximizeButton = page
    .locator(
      '[aria-label*="Full screen" i], [data-tooltip*="Full screen" i], [aria-label*="Layar penuh" i], [data-tooltip*="Layar penuh" i]'
    )
    .last()
  await maximizeButton.waitFor({ state: 'visible', timeout: 15000 })
  await maximizeButton.click()
  await page
    .locator(
      '[aria-label*="Exit full screen" i], [data-tooltip*="Exit full screen" i], [aria-label*="Keluar dari layar penuh" i], [data-tooltip*="Keluar dari layar penuh" i]'
    )
    .last()
    .waitFor({ state: 'visible', timeout: 10000 })
    .catch(() => undefined)
  await page.waitForTimeout(automationTiming.composeMaximizeMs)
}

async function openNewestSentMessage(page: Page, subject: string): Promise<void> {
  const sentUrl = 'https://mail.google.com/mail/u/0/#sent'
  await page.goto(sentUrl, { waitUntil: 'domcontentloaded', timeout: 45000 })
  await page.waitForTimeout(automationTiming.sentBeforeRefreshMs)
  await page.reload({ waitUntil: 'domcontentloaded', timeout: 45000 })
  await page.waitForTimeout(automationTiming.sentAfterRefreshMs)

  const firstSentRow = page.locator('tr.zA:visible, tr[role="main"]:visible').first()
  await firstSentRow.waitFor({ state: 'visible', timeout: 30000 })
  const normalizeText = (value: string): string => value.replace(/\s+/g, ' ').trim().toLowerCase()
  const rowText = normalizeText(await firstSentRow.innerText())
  const expectedSubject = normalizeText(subject)
  if (!rowText.includes(expectedSubject)) {
    throw new Error('The latest Sent email does not match the generated subject, so no screenshot was taken.')
  }

  await firstSentRow.click()
  await page.waitForURL((url) => /#sent\//i.test(url.toString()), { timeout: 20000 }).catch(() => undefined)
  await page
    .locator('[role="main"], h2, [data-thread-id]')
    .first()
    .waitFor({ state: 'visible', timeout: 15000 })
  await page.waitForTimeout(automationTiming.sentMessageOpenMs)
}

function monitorGmailSend(
  page: Page,
  composeSubject: Locator,
  subject: string,
  evidenceFolder: string,
  reportStatus: (update: GmailSendStatus) => void
): void {
  const monitorGeneration = ++gmailMonitorGeneration
  const reportCurrentStatus = (update: GmailSendStatus): void => {
    if (monitorGeneration === gmailMonitorGeneration) reportStatus(update)
  }
  reportCurrentStatus({
    status: 'monitoring',
    message: 'Gmail draft is ready. The tool is waiting for you to send it manually.'
  })

  void (async () => {
    let sendSignal: 'confirmation' | 'compose-closed'
    try {
      const sentConfirmation = page
        .getByText(/message sent|email sent|pesan terkirim|pesan telah dikirim/i)
        .first()
      sendSignal = await Promise.race([
        sentConfirmation
          .waitFor({ state: 'visible', timeout: 10 * 60 * 1000 })
          .then(() => 'confirmation' as const),
        composeSubject
          .waitFor({ state: 'hidden', timeout: 10 * 60 * 1000 })
          .then(() => 'compose-closed' as const)
      ])
    } catch {
      reportCurrentStatus({
        status: 'unconfirmed',
        message: 'Email sending was not confirmed. Check Gmail before trying again.'
      })
      return
    }

    try {
      reportCurrentStatus({
        status: 'monitoring',
        message: 'Send action detected. Checking Gmail Sent and opening the newest matching message.'
      })
      await openNewestSentMessage(page, subject)
      await page.waitForTimeout(2000)
      await captureBrowserWindow(page, join(evidenceFolder, '5.png'))
      if (!existsSync(join(evidenceFolder, '5.png'))) {
        throw new Error('The sent-message screenshot file was not created.')
      }
      reportCurrentStatus({
        status: 'sent',
        message: 'Gmail confirmed the message was sent, and sent-email evidence was saved as 5.png. Delivery is not yet confirmed.'
      })
    } catch (error) {
      reportCurrentStatus({
        status: sendSignal === 'confirmation' ? 'sent' : 'unconfirmed',
        message: `${sendSignal === 'confirmation' ? 'Gmail confirmed the message was sent' : 'Compose closed, but the sent message could not be verified'}. 5.png was not saved: ${error instanceof Error ? error.message : String(error)}`
      })
    }
  })()
}

async function openGmailDraft(
  email: GeneratedEmail,
  reportProgress?: ProgressReporter,
  reportSendStatus?: (update: GmailSendStatus) => void
): Promise<boolean> {
  const context = controlledContext
  if (!context) throw new Error('Open the controlled browser before preparing Gmail.')
  if (!email.subject?.trim() || !email.body?.trim()) throw new Error('Generate report content before opening Gmail.')

  reportProgress?.({ stage: 'preparingGmail', status: 'active' })
  const gmailPage = await context.newPage()
  await gmailPage.goto('https://www.google.com', { waitUntil: 'domcontentloaded', timeout: 20000 })
  await gmailPage.goto('https://mail.google.com/mail/u/0/#inbox', { waitUntil: 'domcontentloaded', timeout: 45000 })
  await gmailPage.waitForTimeout(automationTiming.gmailLoadMs)

  if (/accounts\.google\.com|\/signin/i.test(gmailPage.url())) {
    await gmailPage.bringToFront()
    throw new Error('Gmail is not signed in. Sign in in this controlled browser, then click Send Mail again.')
  }

  const composeButton = gmailPage
    .getByRole('button', { name: /compose|tulis|buat/i })
    .or(gmailPage.locator('[role="button"]:has-text("Compose"), [role="button"]:has-text("Tulis")'))
    .first()
  await composeButton.waitFor({ state: 'visible', timeout: 30000 })
  await composeButton.click()

  const recipient = gmailPage.locator('input[name="to"], input[role="combobox"][aria-label*="recipient" i], input[role="combobox"][aria-label*="penerima" i]').first()
  const subject = gmailPage.locator('input[name="subjectbox"]').first()
  const body = gmailPage.locator('div[role="textbox"][contenteditable="true"][aria-label*="body" i], div[role="textbox"][contenteditable="true"][aria-label*="pesan" i], div[role="textbox"][contenteditable="true"]').last()
  await recipient.waitFor({ state: 'visible', timeout: 15000 })
  await recipient.fill(DEVELOPMENT_RECIPIENT)
  await recipient.press('Enter')
  await subject.fill(email.subject)
  await body.fill(email.body)

  if (!lastSearchCapture?.folderPath) {
    throw new Error('The evidence folder is unavailable. Capture the Google search result again.')
  }
  const evidenceFolder = lastSearchCapture.folderPath
  const attachmentPaths = ['1.png', '2.png', '3.png']
    .map((filename) => join(evidenceFolder, filename))
    .filter((filePath) => existsSync(filePath))
  if (attachmentPaths.length === 0) {
    throw new Error('No evidence screenshots (1.png, 2.png, or 3.png) were found to attach.')
  }

  const attachmentInput = gmailPage.locator('input[type="file"]').last()
  await attachmentInput.waitFor({ state: 'attached', timeout: 15000 })
  await attachmentInput.setInputFiles(attachmentPaths)
  for (const attachmentPath of attachmentPaths) {
    const filename = attachmentPath.split(/[\\/]/).pop() ?? attachmentPath
    await gmailPage.getByText(filename, { exact: true }).last().waitFor({ state: 'visible', timeout: 30000 })
  }
  await gmailPage
    .locator('[role="progressbar"], [aria-label*="uploading" i], [aria-label*="mengupload" i]')
    .first()
    .waitFor({ state: 'hidden', timeout: 60000 })
    .catch(() => undefined)
  await gmailPage.waitForTimeout(automationTiming.attachmentSettleMs)
  await maximizeGmailCompose(gmailPage)
  await gmailPage.bringToFront()
  await captureBrowserWindow(gmailPage, join(evidenceFolder, '4.png'))
  reportProgress?.({ stage: 'preparingGmail', status: 'complete' })
  if (reportSendStatus) monitorGmailSend(gmailPage, subject, email.subject, evidenceFolder, reportSendStatus)
  return true
}

app.whenReady().then(() => {
  electronApp.setAppUserModelId('com.reportingautomation.desktoptool')
  void loadAutomationTiming()

  app.on('browser-window-created', (_, window) => {
    optimizer.watchWindowShortcuts(window)
  })

  ipcMain.handle('capture-google-result', async (event, payload: CapturePayload) => {
    event.sender.send('operation-progress', { stage: 'searchEvidence', status: 'active' } satisfies ProgressUpdate)
    const result = await captureGoogleResult(payload)
    event.sender.send('operation-progress', { stage: 'searchEvidence', status: 'complete' } satisfies ProgressUpdate)
    return result
  })

  ipcMain.handle('list-browsers', async () => {
    return listBrowsers()
  })

  ipcMain.handle('get-automation-timing', async () => loadAutomationTiming())

  ipcMain.handle('save-automation-timing', async (_, value: Partial<AutomationTiming>) => {
    return saveAutomationTiming(value)
  })

  ipcMain.handle('select-save-folder', async () => {
    const result = await dialog.showOpenDialog({
      title: 'Select evidence destination',
      properties: ['openDirectory', 'createDirectory']
    })
    return result.canceled ? undefined : result.filePaths[0]
  })

  ipcMain.handle('reset-workspace', async () => {
    gmailMonitorGeneration += 1
    return resetControlledWorkspace()
  })

  ipcMain.handle('open-controlled-browser', async (event, selection: BrowserSelection) => {
    event.sender.send('operation-progress', { stage: 'openingBrave', status: 'active' } satisfies ProgressUpdate)
    const result = await openControlledBrowser(selection)
    event.sender.send('operation-progress', { stage: 'openingBrave', status: 'complete' } satisfies ProgressUpdate)
    return result
  })

  ipcMain.handle('capture-landing-page', async (event) => {
    return captureLandingPage((update) => event.sender.send('operation-progress', update))
  })

  ipcMain.handle('find-phishing-abuse-contacts', async (event) => {
    return findPhishingAbuseContacts((update) => event.sender.send('operation-progress', update))
  })

  ipcMain.handle('generate-phishing-email', async (event, selectedProviders: string[], customPrompt: string) => {
    return generatePhishingEmail(selectedProviders, customPrompt, (update) => event.sender.send('operation-progress', update))
  })

  ipcMain.handle('open-gmail-draft', async (event, email: GeneratedEmail) => {
    return openGmailDraft(
      email,
      (update) => event.sender.send('operation-progress', update),
      (update) => {
        if (!event.sender.isDestroyed()) event.sender.send('gmail-send-status', update)
      }
    )
  })

  ipcMain.handle('open-dmca-report', async (event, email: GeneratedEmail) => {
    return openAndPrefillDmcaForm(email, (update) => event.sender.send('operation-progress', update))
  })

  ipcMain.handle('open-folder', async (_, folderPath: string) => {
    if (!folderPath || !existsSync(folderPath)) {
      throw new Error('The saved folder could not be found.')
    }

    const error = await shell.openPath(folderPath)
    if (error) {
      throw new Error(error)
    }

    return true
  })

  createWindow()

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow()
  })
})

app.on('window-all-closed', () => {
  controlledContext?.close().catch(() => undefined)
  controlledBrowser?.close().catch(() => undefined)

  if (process.platform !== 'darwin') {
    app.quit()
  }
})
