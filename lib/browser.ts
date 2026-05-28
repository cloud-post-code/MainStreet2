import { chromium, type Browser } from 'playwright-core'

// Vercel/Lambda serverless functions don't ship a Chromium binary. We pull a
// Lambda-compatible build from @sparticuz/chromium at runtime. Locally, the
// `playwright` package (kept as a sibling dependency for the CLI scraper)
// already cached a Chromium binary that `playwright-core` resolves via the
// shared ms-playwright cache, so no executablePath override is needed.
export async function launchBrowser(): Promise<Browser> {
  if (process.env.VERCEL || process.env.AWS_LAMBDA_FUNCTION_NAME) {
    const sparticuz = (await import('@sparticuz/chromium')).default
    return chromium.launch({
      args: sparticuz.args,
      executablePath: await sparticuz.executablePath(),
      headless: true,
    })
  }
  return chromium.launch({ headless: true })
}
