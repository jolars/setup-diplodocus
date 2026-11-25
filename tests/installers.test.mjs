import assert from "node:assert/strict";
import { execFileSync, spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

const root = fileURLToPath(new URL("../", import.meta.url));

function fixture(t) {
  const directory = mkdtempSync(join(tmpdir(), "setup diplodocus test "));
  t.after(() => rmSync(directory, { recursive: true, force: true }));
  for (const name of ["tools", "releases", "temporary"]) {
    mkdirSync(join(directory, name));
  }
  writeFileSync(join(directory, "tools", "gh"), `#!/usr/bin/env sh
case "$1" in
api)
  printf '%s\\n' api >> "$TEST_API_LOG"
  jq -r "$4" "$TEST_RELEASES"
  ;;
attestation)
  printf '%s\\n' "$TEST_ATTESTATION_MESSAGE" >&2
  exit "$TEST_ATTESTATION_STATUS"
  ;;
*) exit 99 ;;
esac
`, { mode: 0o755 });
  writeFileSync(join(directory, "tools", "curl"), `#!/usr/bin/env sh
for argument do
  case "$argument" in
  https:*) url="$argument" ;;
  esac
  output="$argument"
done
case "$url" in
https://github.com/jolars/diplodocus/releases/download/v0.4.0/*) ;;
*) echo "Unexpected download URL: $url" >&2; exit 99 ;;
esac
name="$(basename "$url")"
if [ "$name" = "$TEST_FAIL_DOWNLOAD" ]; then
  echo 'Download failed' >&2
  exit 22
fi
cp "$TEST_RELEASE_DIR/$name" "$output"
`, { mode: 0o755 });
  return {
    directory,
    env: {
      ...process.env,
      PATH: `${join(directory, "tools")}:${process.env.PATH}`,
      TMPDIR: join(directory, "temporary"),
      RUNNER_OS: "Linux",
      RUNNER_ARCH: "X64",
      RUNNER_TEMP: directory,
      GITHUB_OUTPUT: join(directory, "output"),
      DIPLODOCUS_VERSION: "v0.4.0",
      DIPLODOCUS_INSTALL_DIR: join(directory, "installed binary"),
      TEST_API_LOG: join(directory, "api.log"),
      TEST_RELEASES: join(directory, "releases.json"),
      TEST_RELEASE_DIR: join(directory, "releases"),
      TEST_ATTESTATION_STATUS: "0",
      TEST_ATTESTATION_MESSAGE: "Verified",
      TEST_FAIL_DOWNLOAD: "",
    },
  };
}

function shell(script, env) {
  return spawnSync("sh", [join(root, "scripts", script)], {
    cwd: root,
    env,
    encoding: "utf8",
  });
}

function outputs(env) {
  return Object.fromEntries(readFileSync(env.GITHUB_OUTPUT, "utf8").trim().split("\n").map((line) => {
    const separator = line.indexOf("=");
    return [line.slice(0, separator), line.slice(separator + 1)];
  }));
}

const platforms = [
  ["Linux", "X64", "x86_64-unknown-linux-gnu", "tar.xz"],
  ["Linux", "ARM64", "aarch64-unknown-linux-gnu", "tar.xz"],
  ["macOS", "X64", "x86_64-apple-darwin", "tar.xz"],
  ["macOS", "ARM64", "aarch64-apple-darwin", "tar.xz"],
  ["Windows", "ARM64", "aarch64-pc-windows-msvc", "zip"],
  ["Windows", "X64", "x86_64-pc-windows-msvc", "zip"],
];

for (const [os, arch, target, extension] of platforms) {
  test(`latest selects a complete stable release for ${os}-${arch}`, (t) => {
    const { env } = fixture(t);
    const asset = `diplodocus-${target}.${extension}`;
    const release = (tag, names, properties = {}) => ({
      tag_name: tag,
      draft: false,
      prerelease: false,
      assets: names.map((name) => ({ name })),
      ...properties,
    });
    writeFileSync(env.TEST_RELEASES, JSON.stringify([
      release("v0.8.0-rc.1", [asset, `${asset}.sha256`], { prerelease: true }),
      release("v0.7.0", [asset, `${asset}.sha256`], { draft: true }),
      release("v0.6.0", []),
      release("v0.5.0", [asset]),
      release("v0.4.0", [asset, `${asset}.sha256`]),
      release("v0.3.0", [asset, `${asset}.sha256`]),
    ]));
    const result = shell("resolve-version.sh", {
      ...env,
      RUNNER_OS: os,
      RUNNER_ARCH: arch,
      DIPLODOCUS_VERSION: "latest",
    });
    assert.equal(result.status, 0, result.stderr);
    assert.deepEqual(outputs(env), {
      version: "v0.4.0",
      target,
      asset,
      "install-dir": `${env.RUNNER_TEMP}/setup-diplodocus/v0.4.0/${target}`,
    });
  });
}

test("exact versions accept both prefixes and prereleases without an API lookup", (t) => {
  const { env } = fixture(t);
  for (const requested of ["0.4.0", "v0.4.0", "0.5.0-rc.1"]) {
    writeFileSync(env.GITHUB_OUTPUT, "");
    const result = shell("resolve-version.sh", { ...env, DIPLODOCUS_VERSION: requested });
    assert.equal(result.status, 0, result.stderr);
    assert.equal(outputs(env).version, requested.startsWith("v") ? requested : `v${requested}`);
  }
  assert.equal(existsSync(env.TEST_API_LOG), false);
});

test("invalid versions and unsupported platforms fail before installation", (t) => {
  const { env } = fixture(t);
  for (const requested of ["main", "v0.4", "../v0.4.0", "0.4.0\nextra", "0.4.0$(false)"]) {
    const result = shell("resolve-version.sh", { ...env, DIPLODOCUS_VERSION: requested });
    assert.notEqual(result.status, 0, requested);
    assert.match(result.stderr, /version/);
  }
  const unsupported = shell("resolve-version.sh", { ...env, RUNNER_OS: "Windows", RUNNER_ARCH: "X86" });
  assert.notEqual(unsupported.status, 0);
  assert.match(unsupported.stderr, /Unsupported Diplodocus platform/);
  assert.equal(existsSync(env.GITHUB_OUTPUT), false);
});

test("latest fails when no complete stable release exists", (t) => {
  const { env } = fixture(t);
  writeFileSync(env.TEST_RELEASES, "[]");
  const result = shell("resolve-version.sh", { ...env, DIPLODOCUS_VERSION: "latest" });
  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /No stable Diplodocus release/);
});

function archive(t, windows) {
  const context = fixture(t);
  const { directory, env } = context;
  const stem = windows ? "diplodocus-x86_64-pc-windows-msvc" : "diplodocus-x86_64-unknown-linux-gnu";
  const asset = `${stem}.${windows ? "zip" : "tar.xz"}`;
  const archivePath = join(env.TEST_RELEASE_DIR, asset);
  const source = join(directory, "source");
  mkdirSync(source);
  if (windows) {
    writeFileSync(join(source, "diplodocus.exe"), "fixture executable\n");
    execFileSync("pwsh", ["-NoLogo", "-NoProfile", "-Command", "Compress-Archive -Path (Join-Path $env:TEST_SOURCE 'diplodocus.exe') -DestinationPath $env:TEST_ARCHIVE"], {
      env: { ...env, TEST_SOURCE: source, TEST_ARCHIVE: archivePath },
    });
  } else {
    mkdirSync(join(source, stem));
    writeFileSync(join(source, stem, "diplodocus"), "#!/bin/sh\nprintf 'diplodocus 0.4.0\\n'\n", { mode: 0o755 });
    execFileSync("tar", ["-cJf", archivePath, "-C", source, stem]);
  }
  const checksumPath = `${archivePath}.sha256`;
  writeFileSync(checksumPath, `${createHash("sha256").update(readFileSync(archivePath)).digest("hex")} *${asset}\n`);
  return { ...context, asset, checksumPath, env: { ...env, DIPLODOCUS_ASSET: asset } };
}

function powershell(env) {
  return spawnSync("pwsh", ["-NoLogo", "-NoProfile", "-Command", `
    function Invoke-WebRequest {
      param($Uri, $OutFile)
      if (-not $Uri.StartsWith('https://github.com/jolars/diplodocus/releases/download/v0.4.0/')) {
        throw "Unexpected download URL: $Uri"
      }
      $name = ($Uri -split '/')[-1]
      if ($name -eq $env:TEST_FAIL_DOWNLOAD) { throw 'Download failed' }
      Copy-Item -LiteralPath (Join-Path $env:TEST_RELEASE_DIR $name) -Destination $OutFile
    }
    & $env:TEST_INSTALL_SCRIPT
  `], {
    cwd: root,
    env: { ...env, TEST_INSTALL_SCRIPT: join(root, "scripts", "install-diplodocus.ps1") },
    encoding: "utf8",
  });
}

for (const windows of [false, true]) {
  const label = windows ? "PowerShell" : "Unix";
  const run = windows ? powershell : (env) => shell("install-diplodocus.sh", env);
  const binary = windows ? "diplodocus.exe" : "diplodocus";

  test(`${label} installs the published archive layout and cleans temporary files`, (t) => {
    const { env } = archive(t, windows);
    const result = run(env);
    assert.equal(result.status, 0, result.stderr);
    const installed = join(env.DIPLODOCUS_INSTALL_DIR, binary);
    assert.equal(existsSync(installed), true);
    if (!windows) {
      assert.equal(execFileSync(installed, ["--version"], { encoding: "utf8" }), "diplodocus 0.4.0\n");
    }
    assert.deepEqual(readdirSync(env.TMPDIR), []);
  });

  for (const failure of ["archive download", "checksum download", "checksum mismatch", "missing checksum entry", "provenance"]) {
    test(`${label} stops before installation on ${failure} failure`, (t) => {
      const { env, asset, checksumPath } = archive(t, windows);
      if (failure === "archive download") env.TEST_FAIL_DOWNLOAD = asset;
      if (failure === "checksum download") env.TEST_FAIL_DOWNLOAD = `${asset}.sha256`;
      if (failure === "checksum mismatch") writeFileSync(checksumPath, `${"0".repeat(64)} *${asset}\n`);
      if (failure === "missing checksum entry") writeFileSync(checksumPath, `${"0".repeat(64)} *different-archive\n`);
      if (failure === "provenance") {
        env.TEST_ATTESTATION_STATUS = "1";
        env.TEST_ATTESTATION_MESSAGE = "Signature verification failed";
      }
      const result = run(env);
      assert.notEqual(result.status, 0, result.stdout);
      assert.equal(existsSync(join(env.DIPLODOCUS_INSTALL_DIR, binary)), false);
      assert.deepEqual(readdirSync(env.TMPDIR), []);
    });
  }

  test(`${label} supports older releases without provenance attestations`, (t) => {
    const { env } = archive(t, windows);
    env.TEST_ATTESTATION_STATUS = "1";
    env.TEST_ATTESTATION_MESSAGE = "No attestations found";
    const result = run(env);
    assert.equal(result.status, 0, result.stderr);
    assert.match(result.stdout + result.stderr, /No provenance attestation|no provenance attestation/);
    assert.equal(existsSync(join(env.DIPLODOCUS_INSTALL_DIR, binary)), true);
  });
}
