// Serveert de testnummers over HTTP, zodat ook de Cloudflare-variant van de
// server ze kan ophalen zoals ze dat in het echt bij de site doet.
import http from 'node:http';
import { readFile } from 'node:fs/promises';

const port = Number(process.argv[2] || 4174);
const file = new URL('./tracks.json', import.meta.url);

http
  .createServer(async (req, res) => {
    res.writeHead(200, { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' });
    res.end(await readFile(file));
  })
  .listen(port, '127.0.0.1');
