from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from urllib.parse import urlparse

ROOT = Path(__file__).resolve().parent


class Handler(SimpleHTTPRequestHandler):
    def translate_path(self, path):
        rel = urlparse(path).path.lstrip("/")
        return str(ROOT / rel)

    def do_GET(self):
        rel = urlparse(self.path).path
        if rel in ("/", "/index.html"):
            html = (ROOT / "index.html").read_text(encoding="utf-8")
            html = html.replace(
                '<script src="supabase-config.js"></script>',
                '<script>window.SUPABASE_CONFIG = null;</script>',
            )
            self.send_response(200)
            self.send_header("Content-Type", "text/html; charset=utf-8")
            self.end_headers()
            self.wfile.write(html.encode("utf-8"))
            return
        super().do_GET()

    def log_message(self, fmt, *args):
        pass


ThreadingHTTPServer(("127.0.0.1", 4174), Handler).serve_forever()
