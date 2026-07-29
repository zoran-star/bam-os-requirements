#!/usr/bin/env python3
"""Mission board static server.

Identical to `python3 -m http.server` except it forbids caching. The board's
index.html and data.json change constantly, and a cached copy is worse than a
dead server: the page still loads, so it looks fine, while showing a layout and
a set of cards that no longer exist. That cost a round trip on 2026-07-28.
"""
import sys
from functools import partial
from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer


class NoCacheHandler(SimpleHTTPRequestHandler):
    def send_head(self):
        # Stripping Last-Modified on the way out is not enough: the base handler
        # reads these request headers first and answers 304 from them, so a
        # browser holding an old copy is told to keep it.
        for h in ("If-Modified-Since", "If-None-Match"):
            while h in self.headers:
                del self.headers[h]
        return super().send_head()

    def end_headers(self):
        self.send_header("Cache-Control", "no-store, no-cache, must-revalidate, max-age=0")
        self.send_header("Pragma", "no-cache")
        self.send_header("Expires", "0")
        super().end_headers()

    def send_header(self, keyword, value):
        # Drop the validators that let a browser serve a 304 from its own cache.
        if keyword.lower() in ("last-modified", "etag"):
            return
        super().send_header(keyword, value)

    def log_message(self, fmt, *args):
        pass


if __name__ == "__main__":
    port = int(sys.argv[1])
    directory = sys.argv[2]
    ThreadingHTTPServer(("", port), partial(NoCacheHandler, directory=directory)).serve_forever()
