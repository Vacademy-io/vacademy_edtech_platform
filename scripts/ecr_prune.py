#!/usr/bin/env python3
"""Delete old images from our public ECR registry (billed per GB stored).

Every build pushes a new image and nothing ever removed them: by Oct 2026 the
registry held 2,258 images (~$75/month, mostly ai-service and admin-core).
Run weekly by .github/workflows/ecr-prune.yml.

An image is KEPT if any of these hold:
  - it is one of the newest KEEP_LATEST images of its repository;
  - it was pushed within the last KEEP_DAYS days (rollback window);
  - it is tagged `latest` (stage server and voice-bot box deploy :latest);
  - prod is running it (digest or tag found in the cluster via kubectl).

Fails closed: if the cluster cannot be read, nothing is deleted.

Usage: python3 scripts/ecr_prune.py            # dry run
       python3 scripts/ecr_prune.py --apply    # delete
"""
import datetime as dt
import json
import os
import subprocess
import sys

REGISTRY = os.environ.get("ECR_REGISTRY", "public.ecr.aws/e0x1f4p4")
KEEP_LATEST = int(os.environ.get("KEEP_LATEST", "10"))
KEEP_DAYS = int(os.environ.get("KEEP_DAYS", "14"))
APPLY = "--apply" in sys.argv


def run_json(*cmd):
    return json.loads(subprocess.check_output(cmd))


def ecr(*args):
    return run_json("aws", "ecr-public", "--region", "us-east-1", "--output", "json", *args)


def images_in_cluster():
    """Every image reference of ours in the cluster: pod specs, running image IDs and controllers."""
    refs = set()
    pods = run_json("kubectl", "get", "pods", "-A", "-o", "json")
    for pod in pods["items"]:
        for c in pod["spec"].get("containers", []) + pod["spec"].get("initContainers", []):
            refs.add(c["image"])
        for s in pod.get("status", {}).get("containerStatuses", []) + pod.get("status", {}).get("initContainerStatuses", []):
            refs.add(s.get("imageID", ""))
    owners = run_json("kubectl", "get", "deploy,sts,ds,cronjob", "-A", "-o", "json")
    for o in owners["items"]:
        spec = o["spec"].get("jobTemplate", {}).get("spec", o["spec"])
        for c in spec["template"]["spec"].get("containers", []):
            refs.add(c["image"])
    return {r for r in refs if REGISTRY in r}


def main():
    try:
        refs = images_in_cluster()
    except Exception as e:  # never delete blind
        sys.exit(f"cannot read the cluster ({e}); refusing to prune")
    if not refs:
        sys.exit("found no images of ours in the cluster; refusing to prune")

    in_use_digests = {r.split("@", 1)[1] for r in refs if "@sha256:" in r}
    in_use_tags = set()
    for r in refs:
        if "@" not in r and ":" in r.rsplit("/", 1)[-1]:
            repo_tag = r.split("/", 2)[2]
            repo, tag = repo_tag.rsplit(":", 1)
            in_use_tags.add((repo, tag))

    cutoff = (dt.datetime.now(dt.timezone.utc) - dt.timedelta(days=KEEP_DAYS)).isoformat()
    total_deleted = total_bytes = 0
    for repo in [r["repositoryName"] for r in ecr("describe-repositories")["repositories"]]:
        images, token = [], None
        while True:
            page = ecr("describe-images", "--repository-name", repo, *(["--next-token", token] if token else []))
            images += page["imageDetails"]
            token = page.get("nextToken")
            if not token:
                break
        images.sort(key=lambda i: i["imagePushedAt"], reverse=True)

        doomed = []
        for n, img in enumerate(images):
            tags = set(img.get("imageTags", []))
            keep = (n < KEEP_LATEST
                    or img["imagePushedAt"] >= cutoff
                    or "latest" in tags
                    or img["imageDigest"] in in_use_digests
                    or any((repo, t) in in_use_tags for t in tags))
            if not keep:
                doomed.append(img)

        size = sum(i.get("imageSizeInBytes", 0) for i in doomed)
        total_deleted += len(doomed)
        total_bytes += size
        print(f"{repo:60} images={len(images):5} delete={len(doomed):5} ~{size / 1e9:7.1f} GB")
        if APPLY:
            for k in range(0, len(doomed), 100):
                ids = [{"imageDigest": i["imageDigest"]} for i in doomed[k:k + 100]]
                result = ecr("batch-delete-image", "--repository-name", repo, "--image-ids", json.dumps(ids))
                for f in result.get("failures", []):
                    print(f"   failed {f.get('imageId', {}).get('imageDigest', '')[:19]}: {f.get('failureReason')}")

    mode = "DELETED" if APPLY else "DRY RUN (pass --apply to delete)"
    print(f"\n{mode}: {total_deleted} images, ~{total_bytes / 1e9:.0f} GB by image size "
          f"(shared layers make the billed saving smaller)")


if __name__ == "__main__":
    main()
