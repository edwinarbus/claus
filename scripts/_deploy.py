#!/usr/bin/env python3
import json, os, sys, hashlib, time, urllib.request, urllib.error

ROOT = "REDACTED_PATH"
AUTH = os.path.expanduser("~/Library/Application Support/com.vercel.cli/auth.json")

with open(AUTH) as f:
    token = json.load(f)["token"]
with open(os.path.join(ROOT, ".vercel/project.json")) as f:
    proj = json.load(f)
team = proj["orgId"]
project_name = proj.get("projectName", "scandiplan")

EXCLUDE_DIRS = {".vercel", ".git", ".claude", "scripts"}
EXCLUDE_FILES = {"netlify.toml", "README.md"}

files = []
for dirpath, dirnames, filenames in os.walk(ROOT):
    dirnames[:] = [d for d in dirnames if d not in EXCLUDE_DIRS]
    for name in filenames:
        if name in EXCLUDE_FILES or name == "_deploy.py":
            continue
        full = os.path.join(dirpath, name)
        rel = os.path.relpath(full, ROOT)
        with open(full, "rb") as fh:
            data = fh.read()
        sha = hashlib.sha1(data).hexdigest()
        files.append({"file": rel, "sha": sha, "size": len(data), "data": data})

def req(url, method="GET", headers=None, body=None):
    r = urllib.request.Request(url, data=body, method=method, headers=headers or {})
    try:
        with urllib.request.urlopen(r, timeout=120) as resp:
            return resp.status, resp.read()
    except urllib.error.HTTPError as e:
        return e.code, e.read()

# 1. Upload each file by digest.
print(f"Uploading {len(files)} files...", flush=True)
for i, fobj in enumerate(files, 1):
    status, body = req(
        f"https://api.vercel.com/v2/files?teamId={team}",
        method="POST",
        headers={
            "Authorization": f"Bearer {token}",
            "Content-Type": "application/octet-stream",
            "x-vercel-digest": fobj["sha"],
            "Content-Length": str(fobj["size"]),
        },
        body=fobj["data"],
    )
    if status not in (200, 201):
        print(f"  upload FAILED {fobj['file']}: {status} {body[:200]}", flush=True)
        sys.exit(1)
print("  all files uploaded.", flush=True)

# 2. Create the production deployment.
manifest = [{"file": f["file"], "sha": f["sha"], "size": f["size"]} for f in files]
payload = {
    "name": project_name,
    "project": project_name,
    "target": "production",
    "files": manifest,
    "projectSettings": {
        "framework": None,
        "buildCommand": None,
        "outputDirectory": None,
        "installCommand": None,
        "devCommand": None,
    },
}
status, body = req(
    f"https://api.vercel.com/v13/deployments?teamId={team}&forceNew=1&skipAutoDetectionConfirmation=1",
    method="POST",
    headers={"Authorization": f"Bearer {token}", "Content-Type": "application/json"},
    body=json.dumps(payload).encode(),
)
if status not in (200, 201, 202):
    print(f"Create deployment FAILED: {status} {body[:600]}", flush=True)
    sys.exit(1)
dep = json.loads(body)
dep_id = dep.get("id")
url = dep.get("url")
print(f"Deployment created: https://{url}  (id={dep_id})", flush=True)

# 3. Poll until ready.
for _ in range(90):
    status, body = req(
        f"https://api.vercel.com/v13/deployments/{dep_id}?teamId={team}",
        headers={"Authorization": f"Bearer {token}"},
    )
    d = json.loads(body)
    state = d.get("readyState") or d.get("status")
    print(f"  state: {state}", flush=True)
    if state in ("READY", "ERROR", "CANCELED"):
        aliases = d.get("alias") or []
        print(f"FINAL: {state}", flush=True)
        print(f"URL: https://{url}", flush=True)
        for a in aliases:
            print(f"ALIAS: https://{a}", flush=True)
        sys.exit(0 if state == "READY" else 2)
    time.sleep(3)
print("Timed out waiting for READY (deploy may still finish).", flush=True)
