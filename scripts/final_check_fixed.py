import json, os, subprocess, sys, uuid, urllib.request, urllib.error

ROOT = r"C:/Users/kohja/retailflow"
BASE = "http://127.0.0.1:8020"
LOGDIR = ROOT + "/logs"
os.makedirs(LOGDIR, exist_ok=True)
LOGF = LOGDIR + "/final_check.log"
open(LOGF, "w").close()

def log(*a):
    s = " ".join(str(x) for x in a)
    print(s, flush=True)
    with open(LOGF, "a", encoding="utf-8") as f:
        f.write(s + "\n")

def call(method, path, data=None, ctype=None, timeout=45):
    url = path if path.startswith("http") else BASE + path
    headers = {}
    if ctype:
        headers["Content-Type"] = ctype
    req = urllib.request.Request(url, data=data, method=method, headers=headers)
    try:
        with urllib.request.urlopen(req, timeout=timeout) as resp:
            return resp.status, resp.read().decode("utf-8", "replace")
    except urllib.error.HTTPError as e:
        return e.code, e.read().decode("utf-8", "replace")
    except Exception as e:
        return 0, "ERR " + str(e)

def flat(o):
    return json.dumps(o)

# 1. health
st, body = call("GET", "/api/v1/health")
log("HEALTH", st, body[:160].replace("\n", " "))

# frontend
st_fe, _ = call("GET", "http://127.0.0.1:3000/")
log("FRONTEND", st_fe)

# 2. openapi
st, body = call("GET", "/api/v1/openapi.json")
if st != 200:
    log("OPENAPI_FAIL", st)
    log("FINAL_CHECK_DONE")
    sys.exit(0)
spec = json.loads(body)
paths = spec.get("paths", {})
gets = [p for p, o in paths.items() if "get" in o]
posts = [(p, o["post"]) for p, o in paths.items() if "post" in o]

# 3. GET sweep
log("== GET SWEEP ==")
bad = []
for p in sorted(gets):
    if "{" in p:
        continue
    st, b = call("GET", p)
    if st != 200:
        bad.append((p, st, b.replace("\n", " ")[:200]))
for p, st, b in bad:
    log("BAD", st, p, b)
n_get = len([p for p in gets if "{" not in p])
log("GET_TOTAL", n_get, "BAD", len(bad))

# 4. POST routes + fields
log("== POST ROUTES ==")
for p, op in posts:
    try:
        cts = list(op.get("requestBody", {}).get("content", {}).keys())
    except Exception:
        cts = []
    fields = []
    try:
        fields = list(op["requestBody"]["content"]["multipart/form-data"]["schema"]["properties"].keys())
    except Exception:
        pass
    log("POST", p, "|", ",".join(cts), "|fields:", ",".join(fields))

# 5. sample csv
sd = ROOT + "/sample-data"
csvs = sorted(f for f in os.listdir(sd) if f.endswith(".csv")) if os.path.isdir(sd) else []
log("SAMPLE_CSVS", len(csvs), csvs[:4])

def multipart(field, filename, content):
    b = "----rf" + uuid.uuid4().hex
    out = b""
    out += ("--%s\r\n" % b).encode()
    out += ('Content-Disposition: form-data; name="%s"; filename="%s"\r\n' % (field, filename)).encode()
    out += b"Content-Type: text/csv\r\n\r\n"
    out += content
    out += ("\r\n--%s--\r\n" % b).encode()
    return out, "multipart/form-data; boundary=%s" % b

# 6. upload
up = None
for p, op in posts:
    if "multipart/form-data" in flat(op) and ("ingest" in p.lower() or "upload" in p.lower()):
        up = (p, op)
        break
if up is None:
    for p, op in posts:
        if "multipart/form-data" in flat(op):
            up = (p, op)
            break
if up and csvs:
    p, op = up
    try:
        fields = list(op["requestBody"]["content"]["multipart/form-data"]["schema"]["properties"].keys())
    except Exception:
        fields = ["file"]
    field = "file" if "file" in fields else (fields[0] if fields else "file")
    data = open(os.path.join(sd, csvs[0]), "rb").read()
    body, ct = multipart(field, csvs[0], data)
    st, resp = call("POST", p, data=body, ctype=ct)
    log("UPLOAD", st, p, resp[:260].replace("\n", " "))
else:
    log("UPLOAD_SKIP", "route=" + str(bool(up)), "csvs=" + str(len(csvs)))

# 7. pipelines + run
st, body = call("GET", "/api/v1/pipelines")
log("PIPELINES", st, body[:300].replace("\n", " "))
pid = None
try:
    arr = json.loads(body)
    items = arr if isinstance(arr, list) else arr.get("items", arr.get("data", []))
    if items:
        pid = items[0].get("id") or items[0].get("pipeline_id")
except Exception:
    pass
log("PIPELINE_ID", pid)
if pid is not None:
    for p, op in posts:
        if "run" in p.lower() and "{" in p:
            rp = p.replace("{pipeline_id}", str(pid)).replace("{id}", str(pid))
            st, resp = call("POST", rp, data=b"", ctype="application/json")
            log("RUN", st, rp, resp[:300].replace("\n", " "))
            break

# 8. warehouse + analytics
for ep in ["/api/v1/warehouse/tables", "/api/v1/analytics/summary", "/api/v1/overview", "/api/v1/monitoring/summary"]:
    st, b = call("GET", ep)
    log("CHECK", st, ep, b[:280].replace("\n", " "))

# 9. pytest
log("== PYTEST ==")
py = ROOT + "/backend/.venv/Scripts/python.exe"
if not os.path.exists(py):
    py = sys.executable
try:
    r = subprocess.run([py, "-m", "pytest", "-q", "--no-header", "-p", "no:cacheprovider"],
                       cwd=ROOT + "/backend", capture_output=True, text=True, timeout=900)
    log("PYTEST_EXIT", r.returncode)
    for line in (r.stdout + r.stderr).strip().splitlines()[-16:]:
        log("  ", line)
except Exception as e:
    log("PYTEST_ERR", e)

log("FINAL_CHECK_DONE")
