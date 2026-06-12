#!/usr/bin/env python3
"""
Local server for the Peekaboo live (API-driven) dashboard.

Responsibilities:
  1. Serve the static SPA files from this directory.
  2. Proxy any request under /api/...  ->  https://www.aipeekaboo.com/api/v1/...
     injecting the X-API-Key header (the key never reaches the browser).
  3. Cache successful GET responses in memory for cache_ttl_seconds so we
     stay well under the API rate limits (Pro tier: 40/min, 2000/day).

Run:  python3 proxy_server.py
Then: http://localhost:7898

Single-file, stdlib only (no pip installs). Boring and obvious on purpose.
"""

import json
import os
import sys
import time
import threading
import urllib.request
import urllib.error
import urllib.parse
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer

HERE = os.path.dirname(os.path.abspath(__file__))

# ---- config -----------------------------------------------------------------
with open(os.path.join(HERE, "config.json")) as f:
    CONFIG = json.load(f)

API_KEY = CONFIG["api_key"]
API_BASE = CONFIG["api_base"].rstrip("/")
PORT = int(CONFIG.get("port", 7898))
CACHE_TTL = int(CONFIG.get("cache_ttl_seconds", 300))

# ---- tiny in-memory cache ---------------------------------------------------
_cache = {}            # key -> (expires_epoch, status, body_bytes, content_type)
_cache_lock = threading.Lock()


def cache_get(key):
    with _cache_lock:
        item = _cache.get(key)
        if not item:
            return None
        if item[0] < time.time():
            _cache.pop(key, None)
            return None
        return item[1:]


def cache_put(key, status, body, content_type):
    with _cache_lock:
        _cache[key] = (time.time() + CACHE_TTL, status, body, content_type)


# ---- static file serving ----------------------------------------------------
CONTENT_TYPES = {
    ".html": "text/html; charset=utf-8",
    ".js": "application/javascript; charset=utf-8",
    ".css": "text/css; charset=utf-8",
    ".json": "application/json; charset=utf-8",
    ".png": "image/png",
    ".jpg": "image/jpeg",
    ".jpeg": "image/jpeg",
    ".svg": "image/svg+xml",
    ".ico": "image/x-icon",
    ".woff": "font/woff",
    ".woff2": "font/woff2",
}


def guess_type(path):
    ext = os.path.splitext(path)[1].lower()
    return CONTENT_TYPES.get(ext, "application/octet-stream")


class Handler(BaseHTTPRequestHandler):
    server_version = "PeekabooLiveProxy/1.0"

    def log_message(self, fmt, *args):
        # keep the console quiet but show API + errors
        msg = fmt % args
        if "/api/" in msg or " 4" in msg or " 5" in msg:
            sys.stderr.write("%s - %s\n" % (self.address_string(), msg))

    # --- helpers -------------------------------------------------------------
    def _send(self, status, body, content_type, extra_headers=None):
        if isinstance(body, str):
            body = body.encode("utf-8")
        self.send_response(status)
        self.send_header("Content-Type", content_type)
        self.send_header("Content-Length", str(len(body)))
        if extra_headers:
            for k, v in extra_headers.items():
                self.send_header(k, v)
        self.end_headers()
        if self.command != "HEAD":
            self.wfile.write(body)

    def _proxy(self):
        # /api/brands... -> {API_BASE}/brands...
        sub = self.path[len("/api"):]            # keep leading slash + query
        url = API_BASE + sub
        method = self.command
        cache_key = None

        if method == "GET":
            cache_key = url
            cached = cache_get(cache_key)
            if cached:
                status, body, ctype = cached
                self._send(status, body, ctype, {"X-Proxy-Cache": "HIT"})
                return

        # read request body for POST/PUT/DELETE
        length = int(self.headers.get("Content-Length", 0) or 0)
        req_body = self.rfile.read(length) if length else None

        req = urllib.request.Request(url, data=req_body, method=method)
        req.add_header("X-API-Key", API_KEY)
        if self.headers.get("Content-Type"):
            req.add_header("Content-Type", self.headers.get("Content-Type"))

        try:
            with urllib.request.urlopen(req, timeout=60) as resp:
                body = resp.read()
                status = resp.status
                ctype = resp.headers.get("Content-Type", "application/json")
        except urllib.error.HTTPError as e:
            body = e.read()
            status = e.code
            ctype = e.headers.get("Content-Type", "application/json") if e.headers else "application/json"
        except Exception as e:
            payload = json.dumps({"success": False, "error": {"code": "PROXY_ERROR", "message": str(e)}})
            self._send(502, payload, "application/json", {"X-Proxy-Cache": "ERROR"})
            return

        if method == "GET" and status == 200:
            cache_put(cache_key, status, body, ctype)

        self._send(status, body, ctype, {"X-Proxy-Cache": "MISS"})

    def _serve_static(self):
        path = urllib.parse.urlparse(self.path).path
        if path == "/" or path == "":
            path = "/index.html"
        # prevent directory traversal
        safe = os.path.normpath(path).lstrip("/\\")
        full = os.path.join(HERE, safe)
        if not full.startswith(HERE):
            self._send(403, "Forbidden", "text/plain")
            return
        if os.path.isdir(full):
            full = os.path.join(full, "index.html")
        if not os.path.isfile(full):
            # SPA fallback: unknown non-asset path -> index.html
            if "." not in os.path.basename(path):
                full = os.path.join(HERE, "index.html")
            else:
                self._send(404, "Not found", "text/plain")
                return
        with open(full, "rb") as fh:
            body = fh.read()
        self._send(200, body, guess_type(full))

    # --- verbs ---------------------------------------------------------------
    def do_GET(self):
        if self.path.startswith("/api/"):
            self._proxy()
        else:
            self._serve_static()

    def do_HEAD(self):
        self.do_GET()

    def do_POST(self):
        if self.path.startswith("/api/"):
            self._proxy()
        else:
            self._send(405, "Method Not Allowed", "text/plain")

    def do_PUT(self):
        if self.path.startswith("/api/"):
            self._proxy()
        else:
            self._send(405, "Method Not Allowed", "text/plain")

    def do_DELETE(self):
        if self.path.startswith("/api/"):
            self._proxy()
        else:
            self._send(405, "Method Not Allowed", "text/plain")


def main():
    httpd = ThreadingHTTPServer(("127.0.0.1", PORT), Handler)
    print("Peekaboo live dashboard:  http://localhost:%d" % PORT)
    print("Proxying /api/*  ->  %s   (cache %ds)" % (API_BASE, CACHE_TTL))
    try:
        httpd.serve_forever()
    except KeyboardInterrupt:
        print("\nshutting down")
        httpd.shutdown()


if __name__ == "__main__":
    main()
