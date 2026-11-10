import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

const script = fileURLToPath(new URL("../scripts/update-default.py", import.meta.url));

test("the action defaults to a documented exact CLI version", () => {
  const action = readFileSync(new URL("../action.yml", import.meta.url), "utf8");
  const version = action.match(/    default: "([0-9]+\.[0-9]+\.[0-9]+)"/);
  assert.ok(version, "The default must be an exact stable CLI version");
  const readme = readFileSync(new URL("../README.md", import.meta.url), "utf8");
  assert.ok(readme.includes(`currently \`${version[1]}\``));
});

for (const [release, expected, success] of [
  ["v0.6.0", "0.6.0", true],
  ["v0.10.0", "0.10.0", true],
  ["v0.5.0", "0.5.0", true],
  ["v0.4.0", "0.5.0", true],
  ["v0.6.0-rc.1", "0.5.0", false],
]) {
  test(`default update handles ${release}`, (t) => {
    const cwd = mkdtempSync(join(tmpdir(), "diplodocus-default-"));
    t.after(() => rmSync(cwd, { recursive: true, force: true }));
    writeFileSync(join(cwd, "action.yml"), '    default: "0.5.0"\n');
    writeFileSync(join(cwd, "README.md"), 'Default: `0.5.0`. Override: `0.4.0`.\n');
    const result = spawnSync("python3", [script], {
      cwd,
      env: { ...process.env, DIPLODOCUS_RELEASE: release },
      encoding: "utf8",
    });
    assert.equal(result.status === 0, success, result.stderr);
    assert.equal(readFileSync(join(cwd, "action.yml"), "utf8"), `    default: "${expected}"\n`);
    assert.equal(readFileSync(join(cwd, "README.md"), "utf8"), `Default: \`${expected}\`. Override: \`0.4.0\`.\n`);
  });
}

const selector = fileURLToPath(new URL("../scripts/select-release.py", import.meta.url));
const archives = [
  "x86_64-unknown-linux-gnu.tar.xz",
  "aarch64-unknown-linux-gnu.tar.xz",
  "x86_64-apple-darwin.tar.xz",
  "aarch64-apple-darwin.tar.xz",
  "x86_64-pc-windows-msvc.zip",
].map((target) => `diplodocus-${target}`);
const names = archives.flatMap((archive) => [archive, `${archive}.sha256`]);
const release = (tag, assets = names, properties = {}) => ({
  tag_name: tag,
  draft: false,
  prerelease: false,
  assets: assets.map((name) => ({ name })),
  ...properties,
});
const select = (releases) => spawnSync("python3", [selector], {
  input: JSON.stringify(releases),
  encoding: "utf8",
});

test("default selection skips unpublished, unstable, and incomplete releases", () => {
  const result = select([
    release("v0.16.0", names, { draft: true }),
    release("v0.15.0", names, { prerelease: true }),
    release("v0.14.0-rc.1"),
    release("v0.13.0", []),
    release("v0.12.1"),
    release("v0.12.0"),
  ]);
  assert.equal(result.status, 0, result.stderr);
  assert.equal(result.stdout.trim(), "v0.12.1");
});

for (const missing of names) {
  test(`default selection requires ${missing}`, () => {
    const result = select([release("v0.13.0", names.filter((name) => name !== missing))]);
    assert.notEqual(result.status, 0);
    assert.equal(result.stdout, "");
    assert.match(result.stderr, /No stable Diplodocus release/);
  });
}
