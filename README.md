# Gitaru

Local-first media utility. Every project file lives in this folder; the repository is intentionally independent of GitHub deployment.

## Structure

```text
uganda/
	public/                 Browser UI, styles, PWA shell
	src/
		api.js                API handlers and static file serving
		config.js             Environment-backed configuration
		security/             SSRF validation and rate limiting
		services/             HTTP client and direct-media adapter
	tests/                  Node test runner checks
	server.js               Small HTTP composition root
```

## Run

Requires Node.js 20 or newer.

```powershell
npm start
```

Run the security tests with:

```powershell
node --test tests
```

Open http://localhost:8787.

The current verified adapter supports direct public audio/video URLs only. Platform pages are shown as coming soon until a compliant, reliable adapter is implemented. Copy `.env.example` to `.env` when configuring limits or a different port.
