import json
import sys
from pathlib import Path
from urllib.request import urlopen

import jsonschema
import yaml

root = Path(__file__).resolve().parent.parent
blueprint = yaml.safe_load((root / "render.yaml").read_text())
with urlopen("https://render.com/schema/render.yaml.json", timeout=30) as response:
    jsonschema.Draft202012Validator(json.load(response)).validate(blueprint)

services = {service["name"]: service for service in blueprint["services"]}
databases = {database["name"]: database for database in blueprint["databases"]}
groups = {group["name"]: group for group in blueprint["envVarGroups"]}
regions = {service["region"] for service in services.values()} | {
    database["region"] for database in databases.values()
}
assert len(regions) == 1, "All private services must share one region"
assert all(database["ipAllowList"] == [] for database in databases.values())
assert all(service["maxShutdownDelaySeconds"] >= 45 for service in services.values())
for service in services.values():
    assert (root / service["dockerfilePath"]).is_file()
    for variable in service["envVars"]:
        if "fromService" in variable:
            reference = variable["fromService"]
            target = services[reference["name"]]
            assert reference["type"] == target["type"]
            if "envVarKey" in reference:
                target_keys = {v.get("key") for v in target["envVars"]}
                assert reference["envVarKey"] in target_keys or reference["envVarKey"] == "RENDER_EXTERNAL_URL"
        if "fromDatabase" in variable:
            assert variable["fromDatabase"]["name"] in databases
            assert variable["fromDatabase"]["property"] == "connectionString"
        if "fromGroup" in variable:
            assert variable["fromGroup"] in groups

web = next(service for service in services.values() if service["type"] == "web")
worker = next(service for service in services.values() if service["type"] == "worker")
assert web["healthCheckPath"] == "/health/ready"
assert worker["dockerCommand"].endswith(" worker")
worker_env = {v.get("key"): v for v in worker["envVars"]}
web_env = {v.get("key"): v for v in web["envVars"]}
assert worker_env["DATABASE_URL"]["fromDatabase"] == web_env["DATABASE_URL"]["fromDatabase"]
assert worker_env["ENCRYPTION_KEY"]["fromService"]["envVarKey"] == "ENCRYPTION_KEY"
assert worker_env["ENCRYPTION_KEY"]["fromService"]["name"] == web["name"]
assert web_env["ENCRYPTION_KEY"].get("sync") is False

for manifest_path in sys.argv[1:]:
    manifests = list(yaml.safe_load_all(Path(manifest_path).read_text()))
    deployments = [item for item in manifests if item and item["kind"] == "Deployment"]
    web_pods = [item for item in deployments if item["spec"]["template"]["metadata"]["labels"].get("app.kubernetes.io/component") == "web"]
    worker_pods = [item for item in deployments if item["spec"]["template"]["metadata"]["labels"].get("app.kubernetes.io/component") == "worker"]
    assert len(web_pods) == len(worker_pods) == 1
    web_labels = web_pods[0]["spec"]["template"]["metadata"]["labels"]
    worker_labels = worker_pods[0]["spec"]["template"]["metadata"]["labels"]
    for service in [item for item in manifests if item and item["kind"] == "Service"]:
        selector = service["spec"]["selector"]
        matches = lambda labels: all(labels.get(key) == value for key, value in selector.items())
        if matches(web_labels):
            assert not matches(worker_labels), "HTTP routing must exclude consumers"
            assert service["spec"]["ports"][0]["port"] == 4310
    for deployment in deployments:
        pod = deployment["spec"]["template"]["spec"]
        assert pod["automountServiceAccountToken"] is False
        assert pod["securityContext"]["runAsNonRoot"] is True
        for container in pod["containers"]:
            assert container["securityContext"]["readOnlyRootFilesystem"] is True
    for ingress in [item for item in manifests if item and item["kind"] == "Ingress"]:
        if ingress["spec"]["ingressClassName"] == "alb":
            assert not ingress["spec"].get("tls")
            assert ingress["metadata"]["annotations"]["alb.ingress.kubernetes.io/ssl-redirect"] == "443"
        else:
            assert ingress["spec"]["tls"][0]["secretName"]

print("Render schema, private wiring, and Kubernetes manifests verified")
