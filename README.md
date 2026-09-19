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

## Deployment

Vercel hosts the frontend from `public/` using `vercel.json`. Set the Vercel environment variable `API_BASE_URL` to the public URL of the Node backend. Deploy the backend on a Node-capable host such as Render using `render.yaml`, and set its `FRONTEND_ORIGIN` to the final Vercel domain. Vercel's static frontend deployment cannot run the downloader's long-running Node/yt-dlp process by itself.

Verified adapters support direct public audio/video URLs and public posts from YouTube, TikTok, Instagram, Facebook, X, and Vimeo through `yt-dlp`. The UI shows only formats actually returned by each source, including available video qualities, audio, and photos. Private, login-only, DRM-protected, or unavailable posts are rejected. Copy `.env.example` to `.env`; set `YTDLP_PATH` to the local `yt-dlp` executable when it is not on PATH.

# pubg
