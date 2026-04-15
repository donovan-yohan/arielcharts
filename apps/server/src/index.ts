import { createServer } from 'node:http';
import { healthResponse } from './lib/health.js';

const port = Number(process.env.PORT ?? 4000);

const server = createServer((_req, res) => {
  res.setHeader('content-type', 'application/json');
  res.end(JSON.stringify(healthResponse()));
});

server.listen(port, () => {
  console.log(`MermaidFlow server listening on http://localhost:${port}`);
});
