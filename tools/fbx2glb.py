"""Convert FBX files to GLB, locally and for free.

Mixamo exports FBX; the app loads glTF reliably and FBX unreliably (see
web/public/models/mixamo/README.md). Every free converter for this is either a website you
upload to or a Blender install, so this does it on your own machine instead.

The trick is that the conversion already runs fine in a browser: three.js parses FBX and
writes GLB, and both of those have been verified against real Mixamo files. This script
just serves a page that does it and writes the results back to disk, so no file leaves
your computer and nothing needs installing.

    python tools/fbx2glb.py web/public/models/mixamo

Converts every .fbx in that folder to a .glb beside it, then exits.
Add --keep to leave the originals in place (they are kept by default anyway).
"""

from __future__ import annotations

import http.server
import json
import socketserver
import sys
import threading
import time
import webbrowser
from pathlib import Path
from urllib.parse import unquote

PORT = 8770

PAGE = """<!doctype html>
<meta charset="utf-8">
<title>FBX to GLB</title>
<body style="background:#12100d;color:#e8e2d8;font:14px/1.7 system-ui;padding:32px">
<h2 style="font-weight:500">Converting FBX to GLB</h2>
<pre id="out" style="white-space:pre-wrap"></pre>
<script type="importmap">
{"imports":{
  "three":"https://cdn.jsdelivr.net/npm/three@0.171.0/build/three.module.js",
  "three/examples/jsm/libs/fflate.module.js":"https://cdn.jsdelivr.net/npm/three@0.171.0/examples/jsm/libs/fflate.module.js",
  "three/examples/jsm/curves/NURBSCurve.js":"https://cdn.jsdelivr.net/npm/three@0.171.0/examples/jsm/curves/NURBSCurve.js",
  "three/examples/jsm/curves/NURBSUtils.js":"https://cdn.jsdelivr.net/npm/three@0.171.0/examples/jsm/curves/NURBSUtils.js",
  "three/examples/jsm/utils/BufferGeometryUtils.js":"https://cdn.jsdelivr.net/npm/three@0.171.0/examples/jsm/utils/BufferGeometryUtils.js"
}}
</script>
<script type="module">
const out = document.getElementById("out");
const log = (m) => { out.textContent += m + "\\n"; };

const { FBXLoader } = await import("https://cdn.jsdelivr.net/npm/three@0.171.0/examples/jsm/loaders/FBXLoader.js");
const { GLTFExporter } = await import("https://cdn.jsdelivr.net/npm/three@0.171.0/examples/jsm/exporters/GLTFExporter.js");

const files = await (await fetch("/files")).json();
if (!files.length) log("No .fbx files found.");

let done = 0, failed = 0;
for (const name of files) {
  try {
    log("reading  " + name);
    const buf = await (await fetch("/fbx/" + encodeURIComponent(name))).arrayBuffer();

    // One loader per file: three's FBXLoader keeps parse state in module scope.
    const group = new FBXLoader().parse(buf, "");

    const glb = await new Promise((resolve, reject) => {
      new GLTFExporter().parse(
        group,
        (result) => resolve(result),
        (err) => reject(err),
        // binary gives a single .glb; animations are carried across explicitly.
        { binary: true, animations: group.animations || [] },
      );
    });

    const bytes = glb instanceof ArrayBuffer ? glb : new TextEncoder().encode(JSON.stringify(glb));
    await fetch("/save/" + encodeURIComponent(name.replace(/\\.fbx$/i, ".glb")), {
      method: "POST", body: bytes,
    });
    const clips = (group.animations || []).map((a) => a.name).join(", ") || "none";
    log(`  -> ${name.replace(/\\.fbx$/i, ".glb")}  ${(bytes.byteLength / 1e6).toFixed(2)} MB  clips: ${clips}`);
    done++;
  } catch (e) {
    log("  FAILED " + name + ": " + (e?.message ?? e));
    failed++;
  }
}

log(`\\nconverted ${done}, failed ${failed}`);
await fetch("/done", { method: "POST", body: JSON.stringify({ done, failed }) });
</script>
"""


def main() -> int:
    if len(sys.argv) < 2:
        print(__doc__)
        return 1

    folder = Path(sys.argv[1]).resolve()
    if not folder.is_dir():
        print(f"Not a folder: {folder}")
        return 1

    sources = sorted(p for p in folder.glob("*.fbx"))
    if not sources:
        print(f"No .fbx files in {folder}")
        return 1

    print(f"Converting {len(sources)} file(s) in {folder}")
    finished = threading.Event()
    summary: dict = {}

    class Handler(http.server.BaseHTTPRequestHandler):
        def log_message(self, *args):  # keep the console to our own output
            pass

        def _send(self, code, body=b"", content_type="application/octet-stream"):
            self.send_response(code)
            self.send_header("Content-Type", content_type)
            self.send_header("Content-Length", str(len(body)))
            self.end_headers()
            if body:
                self.wfile.write(body)

        def do_GET(self):
            if self.path == "/":
                self._send(200, PAGE.encode("utf-8"), "text/html; charset=utf-8")
            elif self.path == "/files":
                names = json.dumps([p.name for p in sources]).encode()
                self._send(200, names, "application/json")
            elif self.path.startswith("/fbx/"):
                name = unquote(self.path[len("/fbx/"):])
                target = folder / name
                # Never serve outside the folder the user named.
                if target.parent != folder or not target.is_file():
                    return self._send(404)
                self._send(200, target.read_bytes())
            else:
                self._send(404)

        def do_POST(self):
            length = int(self.headers.get("Content-Length", 0))
            payload = self.rfile.read(length)
            if self.path.startswith("/save/"):
                name = unquote(self.path[len("/save/"):])
                target = folder / name
                if target.parent != folder:
                    return self._send(403)
                target.write_bytes(payload)
                print(f"  wrote {target.name}  ({len(payload) / 1e6:.2f} MB)")
                self._send(200)
            elif self.path == "/done":
                try:
                    summary.update(json.loads(payload or b"{}"))
                except json.JSONDecodeError:
                    pass
                self._send(200)
                finished.set()
            else:
                self._send(404)

    with socketserver.TCPServer(("127.0.0.1", PORT), Handler) as server:
        thread = threading.Thread(target=server.serve_forever, daemon=True)
        thread.start()
        url = f"http://127.0.0.1:{PORT}/"
        print(f"Opening {url} -- the conversion runs in your browser, offline apart from the three.js CDN.")
        try:
            webbrowser.open(url)
        except Exception:
            print("Could not open a browser automatically; open the URL above yourself.")

        if not finished.wait(timeout=600):
            print("Timed out waiting for the browser to finish.")
            return 1
        time.sleep(0.3)
        server.shutdown()

    print(f"\nDone: {summary.get('done', 0)} converted, {summary.get('failed', 0)} failed.")
    return 0 if summary.get("failed", 0) == 0 else 1


if __name__ == "__main__":
    sys.exit(main())
