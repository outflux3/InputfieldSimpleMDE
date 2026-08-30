#!/usr/bin/env python3
"""
Run the InputfieldSimpleMDE suite in headless Chrome and report the result.

Chrome is driven over the DevTools Protocol rather than with --dump-dom,
because --dump-dom cannot see an asynchronous suite:

  * --dump-dom writes the page at the load event, long before the tests finish.
  * --virtual-time-budget defers that dump, but only advances timers when
    combined with --disable-gpu, and --disable-gpu stops requestAnimationFrame
    from ever firing. The module coalesces its DOM scans into a rAF callback, so
    under those flags nothing the suite is testing actually runs.

Driving the browser directly sidesteps both problems: real frames, real timers,
and the results read back as data when the suite says it has finished.

Stdlib only — no pip install, no node. It speaks just enough WebSocket to carry
CDP messages.

Usage:
    python3 cdp.py <url> [--timeout SECONDS] [--verbose] [--chrome PATH]
"""

import argparse
import base64
import json
import os
import re
import shutil
import socket
import struct
import subprocess
import sys
import tempfile
import time
import urllib.request

CHROME_CANDIDATES = [
    "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
    "/Applications/Chromium.app/Contents/MacOS/Chromium",
    "/Applications/Microsoft Edge.app/Contents/MacOS/Microsoft Edge",
    "/usr/bin/google-chrome",
    "/usr/bin/chromium",
    "/usr/bin/chromium-browser",
]


# --------------------------------------------------------------- websocket

class WebSocket:
    """The client half of RFC 6455, cut down to what CDP needs."""

    def __init__(self, url, timeout=30):
        m = re.match(r"ws://([^:/]+):(\d+)(/.*)$", url)
        if not m:
            raise ValueError("unsupported websocket url: %s" % url)
        host, port, path = m.group(1), int(m.group(2)), m.group(3)

        self.sock = socket.create_connection((host, port), timeout=timeout)
        self.sock.settimeout(timeout)
        self.buf = b""

        key = base64.b64encode(os.urandom(16)).decode()
        handshake = (
            "GET %s HTTP/1.1\r\n"
            "Host: %s:%d\r\n"
            "Upgrade: websocket\r\n"
            "Connection: Upgrade\r\n"
            "Sec-WebSocket-Key: %s\r\n"
            "Sec-WebSocket-Version: 13\r\n\r\n" % (path, host, port, key)
        )
        self.sock.sendall(handshake.encode())

        while b"\r\n\r\n" not in self.buf:
            chunk = self.sock.recv(4096)
            if not chunk:
                raise IOError("connection closed during websocket handshake")
            self.buf += chunk
        head, self.buf = self.buf.split(b"\r\n\r\n", 1)
        if b"101" not in head.split(b"\r\n")[0]:
            raise IOError("websocket upgrade refused: %s" % head.split(b"\r\n")[0])

    def send(self, text):
        payload = text.encode("utf-8")
        header = bytearray([0x81])  # FIN + text frame
        mask = os.urandom(4)
        n = len(payload)
        if n < 126:
            header.append(0x80 | n)
        elif n < 65536:
            header.append(0x80 | 126)
            header += struct.pack(">H", n)
        else:
            header.append(0x80 | 127)
            header += struct.pack(">Q", n)
        header += mask
        masked = bytes(b ^ mask[i % 4] for i, b in enumerate(payload))
        self.sock.sendall(bytes(header) + masked)

    def _read(self, n):
        while len(self.buf) < n:
            chunk = self.sock.recv(65536)
            if not chunk:
                raise IOError("connection closed")
            self.buf += chunk
        out, self.buf = self.buf[:n], self.buf[n:]
        return out

    def recv(self):
        """Return the next text message, reassembling continuation frames."""
        message = b""
        while True:
            b0, b1 = self._read(2)
            fin = b0 & 0x80
            opcode = b0 & 0x0F
            length = b1 & 0x7F
            if length == 126:
                length = struct.unpack(">H", self._read(2))[0]
            elif length == 127:
                length = struct.unpack(">Q", self._read(8))[0]
            payload = self._read(length) if length else b""

            if opcode == 0x8:            # close
                raise IOError("websocket closed by browser")
            if opcode == 0x9:            # ping -> pong
                self.sock.sendall(b"\x8a\x80" + os.urandom(4))
                continue
            if opcode == 0xA:            # pong
                continue

            message += payload
            if fin:
                return message.decode("utf-8", "replace")

    def close(self):
        try:
            self.sock.close()
        except Exception:
            pass


# --------------------------------------------------------------------- cdp

class Browser:
    def __init__(self, chrome, timeout=60, keep_open=False):
        self.timeout = timeout
        self.profile = tempfile.mkdtemp(prefix="mde-tests-")
        self.keep_open = keep_open
        self.next_id = 0
        self.console = []
        self.errors = []

        # NOTE: no --disable-gpu. It stops requestAnimationFrame firing, which
        # the module relies on to coalesce its scans.
        self.proc = subprocess.Popen(
            [
                chrome,
                "--headless",
                "--no-first-run",
                "--no-default-browser-check",
                "--disable-extensions",
                "--disable-background-networking",
                "--disable-component-update",
                "--no-sandbox",
                "--allow-file-access-from-files",
                "--hide-scrollbars",
                "--window-size=1280,2400",
                "--remote-debugging-port=0",
                "--user-data-dir=%s" % self.profile,
                "about:blank",
            ],
            stdout=subprocess.DEVNULL,
            stderr=subprocess.DEVNULL,
        )

        port = self._await_port()
        target = self._await_target(port)
        self.ws = WebSocket(target, timeout=timeout)
        self.call("Runtime.enable")
        self.call("Log.enable")
        self.call("Page.enable")

    def _await_port(self):
        path = os.path.join(self.profile, "DevToolsActivePort")
        deadline = time.time() + 30
        while time.time() < deadline:
            if self.proc.poll() is not None:
                raise IOError("Chrome exited before it opened a debugging port")
            if os.path.exists(path):
                content = open(path).read().split("\n")
                if content and content[0].strip().isdigit():
                    return int(content[0].strip())
            time.sleep(0.05)
        raise IOError("Chrome never opened a debugging port")

    def _await_target(self, port):
        deadline = time.time() + 30
        while time.time() < deadline:
            try:
                raw = urllib.request.urlopen(
                    "http://127.0.0.1:%d/json/list" % port, timeout=5
                ).read()
                for t in json.loads(raw):
                    if t.get("type") == "page" and t.get("webSocketDebuggerUrl"):
                        return t["webSocketDebuggerUrl"]
            except Exception:
                pass
            time.sleep(0.1)
        raise IOError("no debuggable page target appeared")

    def call(self, method, params=None):
        self.next_id += 1
        mid = self.next_id
        self.ws.send(json.dumps({"id": mid, "method": method, "params": params or {}}))
        deadline = time.time() + self.timeout
        while time.time() < deadline:
            msg = json.loads(self.ws.recv())
            if msg.get("id") == mid:
                if "error" in msg:
                    raise IOError("%s failed: %s" % (method, msg["error"]))
                return msg.get("result", {})
            self._note(msg)
        raise IOError("timed out waiting for %s" % method)

    def _note(self, msg):
        method = msg.get("method")
        if method == "Runtime.consoleAPICalled":
            p = msg["params"]
            text = " ".join(
                str(a.get("value", a.get("description", "")))
                for a in p.get("args", [])
            )
            self.console.append((p.get("type", "log"), text))
            if p.get("type") == "error":
                self.errors.append(text)
        elif method == "Runtime.exceptionThrown":
            d = msg["params"]["exceptionDetails"]
            self.errors.append(
                d.get("exception", {}).get("description") or d.get("text", "exception")
            )
        elif method == "Log.entryAdded":
            e = msg["params"]["entry"]
            if e.get("level") in ("error",):
                self.errors.append("%s %s" % (e.get("source", ""), e.get("text", "")))

    def evaluate(self, expression):
        result = self.call(
            "Runtime.evaluate",
            {"expression": expression, "returnByValue": True, "awaitPromise": True},
        )
        if result.get("exceptionDetails"):
            d = result["exceptionDetails"]
            raise IOError(
                d.get("exception", {}).get("description") or d.get("text", "eval failed")
            )
        return result.get("result", {}).get("value")

    def navigate(self, url):
        self.call("Page.navigate", {"url": url})

    def close(self):
        if self.keep_open:
            return
        try:
            self.ws.close()
        except Exception:
            pass
        try:
            self.proc.terminate()
            self.proc.wait(timeout=10)
        except Exception:
            try:
                self.proc.kill()
            except Exception:
                pass
        shutil.rmtree(self.profile, ignore_errors=True)


# -------------------------------------------------------------------- main

GREEN, RED, GREY, DIM, RESET = "\033[32m", "\033[31m", "\033[90m", "\033[2m", "\033[0m"


def paint(s, colour):
    return s if not sys.stdout.isatty() else colour + s + RESET


def find_chrome(explicit):
    if explicit:
        if os.path.exists(explicit):
            return explicit
        sys.exit("No browser at %s" % explicit)
    for c in CHROME_CANDIDATES:
        if os.path.exists(c):
            return c
    for name in ("google-chrome", "chromium", "chromium-browser"):
        found = shutil.which(name)
        if found:
            return found
    sys.exit(
        "No Chrome, Chromium or Edge found.\n"
        "Pass --chrome /path/to/browser, or run ./run.sh --open to use your own."
    )


def main():
    ap = argparse.ArgumentParser(description=__doc__)
    ap.add_argument("url")
    ap.add_argument("--timeout", type=int, default=90, help="seconds to wait for the suite")
    ap.add_argument("--verbose", action="store_true", help="list passing tests too")
    ap.add_argument("--chrome", help="path to a Chrome/Chromium binary")
    args = ap.parse_args()

    browser = Browser(find_chrome(args.chrome), timeout=30)
    try:
        browser.navigate(args.url)

        deadline = time.time() + args.timeout
        payload = None
        while time.time() < deadline:
            try:
                if browser.evaluate("!!(window.__SUITE__ && window.__SUITE__.done)"):
                    payload = browser.evaluate("JSON.stringify(window.__SUITE__)")
                    break
            except IOError:
                pass  # page still navigating
            time.sleep(0.25)

        if payload is None:
            print(paint("The suite did not finish within %ds." % args.timeout, RED))
            reachable = browser.evaluate("!!window.__SUITE__")
            if not reachable:
                print("  window.__SUITE__ was never created — suite.js did not run.")
                print("  Check that the page can load its scripts from file://.")
            for e in browser.errors[:15]:
                print("  " + paint(e.split("\n")[0], RED))
            return 2

        suite = json.loads(payload)
        for r in suite["results"]:
            if r.get("pass"):
                if args.verbose:
                    print("%s %s" % (paint("PASS", GREEN), r["name"]))
            else:
                print("%s %s" % (paint("FAIL", RED), r["name"]))
                for line in str(r.get("why", "")).split("\n"):
                    print("     " + paint(line, DIM))

        if browser.errors and (suite["failed"] or args.verbose):
            print()
            print(paint("Console errors during the run:", GREY))
            for e in browser.errors[:15]:
                print("  " + paint(e.split("\n")[0], DIM))

        print()
        print(paint(suite["summary"], GREEN if not suite["failed"] else RED))
        return 0 if not suite["failed"] else 1
    finally:
        browser.close()


if __name__ == "__main__":
    sys.exit(main())
