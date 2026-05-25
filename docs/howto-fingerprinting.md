# How to Configure Session Fingerprinting

Session fingerprinting links a conversation to the browser that started it. Tune or disable it for your deployment environment.

## How fingerprinting works

On each chat request, the server computes:

```ts
SHA-256(user-agent + "|" + ip)
```

The first message stores this fingerprint on the conversation row. Subsequent messages must present the same `sessionId` and produce a matching fingerprint.

## Configuration

Set `FINGERPRINT_ENFORCEMENT` in your environment:

| Value | Behavior | Use when |
|-------|----------|----------|
| `strict` | Exact SHA-256 match required | Production — maximum abuse prevention |
| `relaxed` | First 16 hex chars must match | Users with dynamic IPs (mobile, some ISPs) |
| `off` | No fingerprint check | Local dev, automated tests, CI |

## Steps

### Production deployment

Set `FINGERPRINT_ENFORCEMENT=strict` in your Vercel (or hosting) environment variables. No code changes needed.

### Local development

```bash
# .env.local
FINGERPRINT_ENFORCEMENT=off
```

With `off`, you can share session IDs between browser tabs and test tools without fingerprint errors.

### Vercel Preview deployments

Preview URLs are accessed by different IPs (reviewer laptops, CI) and different user agents. Set `FINGERPRINT_ENFORCEMENT=relaxed` or `off` for preview environments.

### Automated tests

Tests running against a local dev server should set `FINGERPRINT_ENFORCEMENT=off`. The fingerprint is derived from the HTTP request headers — test clients typically have no consistent user-agent.

## Verification

With `strict` enforcement:

1. Start a chat session in one browser
2. Copy the `sessionId` from localStorage (`ms_session`)
3. Try to use it from a different browser or with a modified user-agent header
4. You should get a `session_not_found` error

With `off`:

1. Start a chat session, copy the `sessionId`
2. POST to `/api/chat` with that `sessionId` from any client
3. The request should succeed regardless of headers

## Troubleshooting

**Users on mobile get `session_not_found` errors mid-conversation**

Mobile users frequently switch between wifi and cellular, changing their IP. Use `relaxed` mode to allow IP prefix matching.

**Automated E2E tests fail with fingerprint errors**

Set `FINGERPRINT_ENFORCEMENT=off` in the test environment. Fingerprinting is an anti-abuse measure, not a feature under test.

## Related

- [Architecture](explanation-architecture.md) — the full fingerprint implementation
- [API Reference](reference-api.md) — `ChatErrorCode` values including `fingerprint_mismatch`
