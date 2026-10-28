# Setup Diplodocus

[![CI](https://github.com/jolars/setup-diplodocus/actions/workflows/ci.yml/badge.svg)](https://github.com/jolars/setup-diplodocus/actions/workflows/ci.yml)

A GitHub Action that installs [Diplodocus](https://diplodocus.cc/) and makes
`diplodocus` available to subsequent workflow steps. It downloads prebuilt
releases, verifies their checksums and available build provenance, and caches
the installed binary.

Your workflow prepares the language runtimes, package dependencies, and Jupyter
kernels needed by your documentation, then runs the CLI commands it needs.

## Usage

```yaml
jobs:
  documentation:
    runs-on: ubuntu-latest
    permissions:
      contents: read
    steps:
      - uses: actions/checkout@v7
      - uses: jolars/setup-diplodocus@v1
      - run: diplodocus build --config documentation/diplodocus.yaml
```

### Pin the CLI version

Each action release defaults to an exact Diplodocus version, currently `0.10.0`.
Pin a full action release or its commit SHA and omit `version` to receive CLI
upgrades through Dependabot action updates. The action and CLI versions are
independent. Override the default when needed; both `0.4.0` and `v0.4.0` are
accepted.

Diplodocus 0.6.0 and newer use YAML configuration; older releases use TOML.

```yaml
- uses: jolars/setup-diplodocus@v1
  with:
    version: "0.4.0"
```

With `version: latest`, the action selects the newest stable release containing
both the archive and its checksum for the runner's platform. Drafts,
prereleases, and releases whose platform assets are still uploading are skipped.
An exact version can select a prerelease.

### Use a prepared Python environment

After your workflow has prepared the project's dependencies, run Diplodocus
through that environment when extracting APIs or executing Python examples:

```yaml
- uses: jolars/setup-diplodocus@v1
  with:
    version: "0.4.0"
- run: uv sync --locked --project packages/python
- run: >-
    uv run --no-sync --project packages/python
    diplodocus build --config documentation/diplodocus.toml
```

The workflow must install `uv` before these steps. Prepare R and Julia packages,
native extensions, and Jupyter kernels as required by your documentation. Rust
API extraction still needs Diplodocus's supported documentation toolchain and
the documented package's build dependencies. See the [installation
guide](https://diplodocus.cc/installation.html) for requirements.

## Inputs

  | Input     | Default        | Description                                                                                |
  | --------- | -------------- | ------------------------------------------------------------------------------------------ |
  | `version` | `0.10.0`       | Diplodocus version: `latest` or an exact version, with or without `v`.                     |
  | `cache`   | `true`         | Cache the installed binary between workflow runs. Set to `false` to download it each time. |
  | `token`   | `github.token` | GitHub token for release lookup and build provenance verification.                         |

## Outputs

  | Output      | Description                                                   |
  | ----------- | ------------------------------------------------------------- |
  | `version`   | Installed Diplodocus version, without the `v` prefix.         |
  | `cache-hit` | `true` when the installed binary was restored from the cache. |

## Supported runners

  | Operating system | Architectures |
  | ---------------- | ------------- |
  | Linux            | x64, ARM64    |
  | macOS            | x64, ARM64    |
  | Windows          | x64           |

The action targets GitHub-hosted runners. Diplodocus does not currently publish
a Windows ARM64 binary.

## Download verification and caching

Every downloaded archive must match its release's `.sha256` checksum file.
Missing checksums and mismatches fail installation. When the GitHub CLI is
available, the action also verifies build provenance with
`gh attestation verify`. Missing attestations produce a warning; failed
verification stops installation.

The cache stores the verified binary under a key containing the resolved CLI
version and target platform. Version resolution happens before cache lookup, so
`latest` can advance to a new release. Each version has its own installation
directory, and the action checks the installed CLI version on cache hits too.

## License

MIT.
