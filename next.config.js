/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  images: {
    remotePatterns: [
      { protocol: 'https', hostname: '**' },
    ],
  },
  serverExternalPackages: ['playwright', 'playwright-core', '@sparticuz/chromium', 'fsevents'],
  webpack: (config, { isServer }) => {
    if (isServer) {
      // Anthropic SDK 0.98+ includes node: builtins that webpack doesn't handle.
      // Marking them external lets Node resolve them at runtime.
      config.externals = [
        ...(Array.isArray(config.externals) ? config.externals : [config.externals].filter(Boolean)),
        ({ request }, callback) => {
          if (request && request.startsWith('node:')) {
            return callback(null, `commonjs ${request.slice(5)}`)
          }
          // playwright, sparticuz chromium, and fsevents are server-only (scraper)
          if (
            request &&
            (request === 'playwright' ||
              request === 'playwright-core' ||
              request === '@sparticuz/chromium' ||
              request === 'fsevents')
          ) {
            return callback(null, `commonjs ${request}`)
          }
          callback()
        },
      ]
    } else {
      // Playwright and its native deps must never be bundled for the browser.
      config.externals = [
        ...(Array.isArray(config.externals) ? config.externals : [config.externals].filter(Boolean)),
        'playwright',
        'playwright-core',
        '@sparticuz/chromium',
        'fsevents',
      ]
    }
    return config
  },
}

module.exports = nextConfig
