# Global Installation

The installer is intentionally user-local. It places the runtime under `${HOME}/.theloop`, creates a small `theloop` launcher in `${HOME}/.local/bin`, and never writes to `/usr/local`, `/opt`, or a system package manager location.

## Install

From a checked-out repository:

```bash
bash ./install.sh
```

The same script can be used from a remote source after the source URL is configured by the release process. It is idempotent: an existing runtime is upgraded in place, while `.theloop/config`, `.theloop/credentials`, and `.theloop/projects` are preserved.

Useful options include `--dry-run` for a no-change preview, `--update` for an explicit upgrade, and `--doctor` for post-install diagnostics. The launcher supports `theloop`, `theloop /path/to/project`, `theloop --version`, and `theloop --help`.

## Uninstall

```bash
theloop --uninstall
```

or, from the runtime directory:

```bash
bash ~/.theloop/runtime/uninstall.sh
```

Uninstallation removes only the installer-owned runtime, launcher, PATH block, and manifest. Project `.theloop/` directories, credentials, configuration, and project memory are preserved by default. `--purge` is intentionally explicit and removes installer-owned configuration and credentials only after confirmation.

## Safety model

Both scripts use shell plus Node.js only, create directories with restrictive permissions where supported, maintain a manifest of installed paths, and avoid destructive recursive deletion outside the installer root. The uninstall command is confirmation-gated unless `--yes` is supplied for automation.
