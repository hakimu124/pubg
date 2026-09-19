import http from 'node:http';
import { config } from './src/config.js';
import { cleanupTokens, downloadHandler, json, metadataHandler, setCors, sourcesHandler, staticHandler } from './src/api.js';

const server = http.createServer(async (req, res) => {
  try {
    if (req.method === 'OPTIONS') { setCors(res); res.writeHead(204); return res.end(); }
    if (req.method === 'POST' && req.url === '/api/metadata') return await metadataHandler(req, res);
    if (req.method === 'POST' && req.url === '/api/download') return await downloadHandler(req, res);
    if (req.method === 'GET' && req.url === '/api/sources') return sourcesHandler(req, res);
    if (req.method === 'GET') return staticHandler(req, res);
    return json(res, 404, { error: 'Not found' });
  } catch {
    return json(res, 500, { success: false, error: 'Server unavailable' });
  }
});

setInterval(cleanupTokens, 60_000).unref();
server.listen(config.port, () => console.log(`Gitaru running at http://localhost:${config.port}`));
