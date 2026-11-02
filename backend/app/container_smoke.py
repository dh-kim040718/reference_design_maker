"""Temporary loopback-only containers, isolated restored DB, no provider keys."""
import json
import re
import subprocess
import time
import urllib.error
import urllib.request
from uuid import uuid4

from sqlalchemy.engine import make_url

from app.backup import ROOT
from app.core.settings import get_settings


def run(*args):
    return subprocess.run(["docker", *args], check=True, capture_output=True, text=True).stdout


def main():
    reports = sorted(ROOT.glob("*/report.json"), reverse=True)
    source = next((json.loads(path.read_text("utf-8")) for path in reports
                   if json.loads(path.read_text("utf-8")).get("restore", {}).get("verified")), None)
    if source is None or not re.fullmatch(r"rdm_restore_[a-z0-9_]+", source["target_database"]):
        raise SystemExit("A successful isolated restore drill is required")
    url = make_url(get_settings().database_url)
    if url.host not in {"localhost", "127.0.0.1", "::1"}:
        raise SystemExit("Local DB only")
    identifier = uuid4().hex[:10]
    network = "rdm-smoke-" + identifier
    folder = ROOT / ("container_smoke_" + identifier)
    folder.mkdir(parents=True, exist_ok=False)
    envfile = folder / "temporary.env"
    created = []
    network_created = False
    try:
        database_url = url.set(host="host.docker.internal", database=source["target_database"])
        envfile.write_text(
            "DATABASE_URL=" + database_url.render_as_string(hide_password=False)
            + "\nIMAGE_GENERATION_ENABLED=false\nIMAGE_EDITING_ENABLED=false\n"
            "GENERATION_BUDGET_USD=0\n", encoding="utf-8")
        run("network", "create", network)
        network_created = True
        for service, port, extras in (("api", "18000:8000", ["--network-alias", "api",
                                     "--env-file", str(envfile)]),
                                     ("web", "18080:80", [])):
            name = network + "-" + service
            run("run", "--detach", "--name", name, "--network", network,
                "--publish", "127.0.0.1:" + port, *extras, "reference-design-maker-" + service)
            created.append(name)
        ready = False
        for _ in range(40):
            try:
                endpoint = "http://127.0.0.1:18080/health/ready"
                with urllib.request.urlopen(endpoint, timeout=2) as reply:
                    ready = json.load(reply).get("status") == "ready"
                    if ready:
                        break
            except (urllib.error.URLError, TimeoutError, ValueError):
                pass
            time.sleep(.5)
        if not ready:
            raise RuntimeError("Container readiness failed")
        with urllib.request.urlopen("http://127.0.0.1:18080/", timeout=5) as reply:
            if b'<div id="root">' not in reply.read():
                raise RuntimeError("SPA response failed")
        report = {"spa": "passed", "api_proxy_db_readiness": "passed",
                  "database": source["target_database"], "provider_keys_injected": False,
                  "provider_calls": 0, "temporary_resources_cleanup": "requested"}
        (folder / "report.json").write_text(json.dumps(report, indent=2), "utf-8")
        print(json.dumps({"verified": True, "report": str(folder / "report.json")}))
    except (subprocess.CalledProcessError, RuntimeError, OSError):
        raise SystemExit(
            "Container smoke failed; raw logs suppressed. No provider key injected.") from None
    finally:
        for name in reversed(created):
            subprocess.run(["docker", "rm", "-f", name], capture_output=True, check=False)
        if network_created:
            subprocess.run(["docker", "network", "rm", network], capture_output=True, check=False)
        envfile.unlink(missing_ok=True)


if __name__ == "__main__":
    main()
