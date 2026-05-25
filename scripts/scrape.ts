/**
 * One-off scraper runner. Point at a business and list of shop URLs.
 * Usage: npm run scrape -- --business-id <uuid> --name "Shop Name" --urls "url1,url2"
 */
import { scrapeAndUpsert } from '../lib/scraper'

async function main() {
  const args = process.argv.slice(2)
  const get = (flag: string) => {
    const i = args.indexOf(flag)
    return i !== -1 ? args[i + 1] : undefined
  }

  const businessId = get('--business-id')
  const businessName = get('--name')
  const urlsArg = get('--urls')

  if (!businessId || !businessName || !urlsArg) {
    console.error('Usage: npm run scrape -- --business-id <uuid> --name "Shop Name" --urls "url1,url2"')
    process.exit(1)
  }

  const urls = urlsArg.split(',').map(u => u.trim()).filter(Boolean)
  console.log(`Scraping ${urls.length} URLs for "${businessName}"...`)

  const { upserted, errors } = await scrapeAndUpsert({ businessId, businessName, urls })
  console.log(`Done. Upserted: ${upserted}, Errors: ${errors}`)
}

main().catch(err => {
  console.error(err)
  process.exit(1)
})
