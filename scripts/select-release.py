import json
import re
import sys

# The default must install on every platform exercised by the action's CI.
archives = {
    f"diplodocus-{target}.{extension}"
    for target, extension in [
        ("x86_64-unknown-linux-gnu", "tar.xz"),
        ("aarch64-unknown-linux-gnu", "tar.xz"),
        ("x86_64-apple-darwin", "tar.xz"),
        ("aarch64-apple-darwin", "tar.xz"),
        ("x86_64-pc-windows-msvc", "zip"),
    ]
}
required = archives | {f"{archive}.sha256" for archive in archives}
for release in json.load(sys.stdin):
    if release["draft"] or release["prerelease"]:
        continue
    if not re.fullmatch(r"v[0-9]+\.[0-9]+\.[0-9]+", release["tag_name"]):
        continue
    if required <= {asset["name"] for asset in release["assets"]}:
        print(release["tag_name"])
        break
else:
    raise SystemExit("No stable Diplodocus release contains all platform archives and checksums")
