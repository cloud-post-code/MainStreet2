/**
 * One-off scraper runner. Two modes:
 *
 *   Scrape a whole shop (discover all products, scrape + enrich):
 *     npm run scrape -- --business-id <uuid> --name "Shop Name" --urls "https://shop.com"
 *
 *   Scrape specific product URLs:
 *     npm run scrape -- --business-id <uuid> --name "Shop Name" --mode products \
 *       --urls "https://shop.com/products/a,https://shop.com/products/b"
 *
 *   Skip the GPT-4o-mini vision enrichment pass (faster, free):
 *     ... --no-enrich
 */
import { scrapeAndUpsert, type ScrapeMode } from '../lib/scraper'

async function main() {
  const args = process.argv.slice(2)
  const get = (flag: string) => {
    const i = args.indexOf(flag)
    return i !== -1 ? args[i + 1] : undefined
  }
  const has = (flag: string) => args.includes(flag)

  const businessId = get('--business-id')
  const businessName = get('--name')
  const urlsArg = get('--urls')
  const modeArg = (get('--mode') ?? 'company') as ScrapeMode
  const enrich = !has('--no-enrich')

  if (!businessId || !businessName || !urlsArg) {
    console.error(
      'Usage: npm run scrape -- --business-id <uuid> --name "Shop Name" --urls "url1,url2"\n' +
      '       [--mode company|products] [--no-enrich]',
    )
    process.exit(1)
  }
  if (modeArg !== 'company' && modeArg !== 'products') {
    console.error(`Invalid --mode "${modeArg}". Must be "company" or "products".`)
    process.exit(1)
  }

  const urls = urlsArg.split(',').map(u => u.trim()).filter(Boolean)
  console.log(`Mode: ${modeArg} | Enrich: ${enrich} | URLs: ${urls.length} | Business: ${businessName}`)

  const { upserted, errors, enriched } = await scrapeAndUpsert(
    { businessId, businessName, urls, mode: modeArg },
    { log: msg => console.log(msg), enrich },
  )
  console.log(`Done. Upserted: ${upserted}, Enriched: ${enriched}, Errors: ${errors}`)
}

main().catch(err => {
  console.error(err)
  process.exit(1)
})
