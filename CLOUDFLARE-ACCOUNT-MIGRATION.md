# Gallery account routing

The gallery application, D1 data, and R2 media run in Cloudflare account
`7c5ecc8cc6dc99838cfbf1b3a1086b74`. Its Worker is
`simchas-gallery-api.smwlyqswkwt232.workers.dev`.

The existing API URL, `simchas-gallery-api.0534169095.workers.dev`, remains a
streaming gateway in account `3298021f3289a8f22f48693678cc6e73`. This preserves
Google Drive's registered OAuth callback, existing media URLs, and the GitHub
background-job audience. It does not process gallery jobs or access D1/R2.

The gateway retains the existing provider secrets. It passes them to the new
application only over HTTPS with a private `GALLERY_PROXY_SECRET`, stored as a
Cloudflare secret on both Workers. Incoming proxy headers are replaced by the
gateway; the application rejects forwarded credentials without the secret or
with an unexpected origin/path. Only the two Drive credentials and OpenAI API
key may be forwarded. Database and session-signing settings cannot be overridden.

Do not remove the old gateway until Google OAuth callbacks and all persisted
media URLs have been migrated. Keep the old D1/R2 resources as a rollback copy.

## Deployments

- Production uses `CLOUDFLARE_PRODUCTION_API_TOKEN` for the paid account.
- Staging keeps `CLOUDFLARE_API_TOKEN` and its existing account.
- Missing production credentials must not fall back to the old account.
- The production workflow deploys `cloudflare-worker.js`, preserving every
  active binding, then verifies the paid Worker's health.
- `cloudflare-proxy.js` is the legacy gateway's entry point. Its active provider
  secrets and shared proxy secret must be preserved when updating it.
- Background jobs continue to use the existing API URL and schedule.

The existing OpenAI key is preserved. Moving Cloudflare accounts does not add
OpenAI credit; `credit_balance_exhausted` must be resolved independently.
