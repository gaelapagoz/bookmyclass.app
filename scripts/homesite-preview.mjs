import { createReadStream, existsSync, statSync } from "node:fs";
import { createServer } from "node:http";
import { extname, join, normalize, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";

const repoRoot = resolve(fileURLToPath(new URL("..", import.meta.url)));
const homesiteDir = join(repoRoot, "homesite");
const imageDir = join(repoRoot, "public", "images", "homesite");
const host = process.env.HOMESITE_PREVIEW_HOST || "127.0.0.1";
const port = Number(process.env.HOMESITE_PREVIEW_PORT || "4173");

const contentTypes = new Map([
  [".html", "text/html; charset=utf-8"],
  [".jpg", "image/jpeg"],
  [".jpeg", "image/jpeg"],
  [".png", "image/png"],
  [".webp", "image/webp"],
  [".gif", "image/gif"],
  [".svg", "image/svg+xml; charset=utf-8"],
]);

function isInside(child, parent) {
  const relative = normalize(child).slice(normalize(parent).length);
  return child === parent || relative.startsWith(sep);
}

function safeJoin(root, requestPath) {
  const decodedPath = decodeURIComponent(requestPath);
  const target = resolve(root, `.${decodedPath}`);
  if (!isInside(target, root)) {
    return null;
  }
  return target;
}

function routeToFile(url) {
  const pathname = new URL(url, `http://${host}:${port}`).pathname;

  if (pathname === "/" || pathname === "/index.html") {
    return join(homesiteDir, "index.html");
  }

  if (pathname.startsWith("/images/homesite/")) {
    return safeJoin(imageDir, pathname.replace("/images/homesite", ""));
  }

  if (/^\/[a-z0-9-]+\.html$/i.test(pathname)) {
    return safeJoin(homesiteDir, pathname);
  }

  return null;
}

function send404(response) {
  response.writeHead(404, { "content-type": "text/plain; charset=utf-8" });
  response.end("Not found");
}

const server = createServer((request, response) => {
  const filePath = routeToFile(request.url || "/");
  if (!filePath || !existsSync(filePath) || !statSync(filePath).isFile()) {
    send404(response);
    return;
  }

  const type = contentTypes.get(extname(filePath).toLowerCase()) || "application/octet-stream";
  response.writeHead(200, { "content-type": type });
  createReadStream(filePath).pipe(response);
});

server.listen(port, host, () => {
  console.log(`Homesite preview running at http://${host}:${port}`);
});

function shutdown() {
  server.close(() => process.exit(0));
}

process.on("SIGINT", shutdown);
process.on("SIGTERM", shutdown);
