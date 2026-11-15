#!/usr/bin/env python3
"""Deploy agent-games-wildcard to Vercel via the REST API.

Reuses the registered custom.vercel credential through the same
dynamic_credentials surrogate mechanism as bin/vercel.py.
Uploads source files only (no node_modules — Vercel runs npm install from
package.json). Sets NO env vars / secrets.
Usage: python3 scripts/deploy.py [--name agent-games-wildcard]
"""
import argparse
import base64
import json
import os
import sys
import time

sys.path.insert(0, os.path.expanduser("~/workspace/custom-connectors/custom.vercel/bin"))
import vercel as vhelper  # noqa: E402  (provides call())

ROOT = os.path.expanduser("~/workspace/agent-games/wildcard")

FILES = [
    "package.json",
    "vercel.json",
    "server.js",
    "api/index.js",
    "api/check.js",
    "lib/check.js",
    "lib/bsc.js",
    "lib/data.js",
    "public/index.html",
]


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--name", default="agent-games-wildcard")
    args = parser.parse_args()

    files = []
    for rel in FILES:
        path = os.path.join(ROOT, rel)
        with open(path, "rb") as f:
            content = f.read()
        files.append({
            "file": rel,
            "data": base64.b64encode(content).decode("utf-8"),
            "encoding": "base64",
        })
        print("staged %s (%d bytes)" % (rel, len(content)))

    payload = {
        "name": args.name,
        "target": "production",
        "projectSettings": {"framework": None},
        "files": files,
    }
    result = vhelper.call("POST", "/v13/deployments", payload)
    print(json.dumps(result, indent=2))
    uid = result.get("id") or result.get("uid")
    url = result.get("url")
    if not uid:
        print("DEPLOY FAILED: no deployment id in response")
        return 1
    print("deployment id: %s  url: %s" % (uid, url))
    for _ in range(40):
        time.sleep(5)
        status = vhelper.call("GET", "/v13/deployments/%s" % uid)
        state = status.get("readyState")
        print("state: %s" % state)
        if state == "READY":
            print("READY: https://%s" % status.get("url", url))
            return 0
        if state in ("ERROR", "CANCELED"):
            print(json.dumps(status, indent=2))
            return 1
    print("timed out waiting for READY; check status with:")
    print("  python3 ~/workspace/custom-connectors/custom.vercel/bin/vercel.py status --id %s" % uid)
    return 2


if __name__ == "__main__":
    sys.exit(main())
