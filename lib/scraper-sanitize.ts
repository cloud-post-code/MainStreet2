// Strip prompt injection patterns from scraped product data before DB upsert.
// Prevents merchants from injecting instructions via product names/descriptions.
const INJECTION_PATTERNS = [
  /\n\nHuman:/gi,
  /\n\nAssistant:/gi,
  /<AnthropicArtifact/gi,
  /\[INST\]/gi,
  /<<SYS>>/gi,
]

export function sanitizeProductText(text: string): string {
  let result = text
  for (const pattern of INJECTION_PATTERNS) {
    result = result.replace(pattern, ' ')
  }
  return result.trim()
}
