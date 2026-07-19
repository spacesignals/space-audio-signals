#!/usr/bin/env python3
r"""
Upload GalaxyMusic to spacesignals.net/galaxy/ over SFTP.

Mirrors deploy/ -> /home/suspect/spacesignals.net/galaxy on the server:
  * uploads files that are new or whose size differs
  * skips unchanged files (audio/textures are large — this matters)
  * deletes remote files that no longer exist locally (stale hashed bundles)
  * uploads index.html LAST so a half-finished sync never serves a broken page

Credentials are read at runtime from FileZilla's saved site "spacesignals.net"
(%APPDATA%\FileZilla\sitemanager.xml) — nothing is stored in this repo.

Usage:  python upload.py [--dry-run]
"""

import base64
import os
import posixpath
import stat as statmod
import sys
import xml.etree.ElementTree as ET
from pathlib import Path

import paramiko

LOCAL_DIR = Path(__file__).parent / "deploy"
REMOTE_DIR = "spacesignals.net/galaxy"  # relative to the SFTP home dir
SITE_NAME = "spacesignals.net"
DRY_RUN = "--dry-run" in sys.argv


def filezilla_site(name: str) -> dict:
    p = Path(os.path.expandvars(r"%APPDATA%\FileZilla\sitemanager.xml"))
    for s in ET.parse(p).iter("Server"):
        if s.findtext("Name") == name:
            return {
                "host": s.findtext("Host"),
                "port": int(s.findtext("Port") or 22),
                "user": s.findtext("User"),
                "password": base64.b64decode(s.findtext("Pass") or "").decode(),
            }
    raise SystemExit(f"FileZilla site '{name}' not found in sitemanager.xml")


def verify_build() -> None:
    if not (LOCAL_DIR / "index.html").is_file():
        raise SystemExit("deploy/index.html missing — run deploy.bat first. NOT uploading.")
    assets = LOCAL_DIR / "assets"
    if not assets.is_dir() or not any(f.suffix == ".js" for f in assets.iterdir()):
        raise SystemExit("deploy/assets has no JS bundle — build incomplete. NOT uploading.")


def local_files() -> dict[str, Path]:
    files = {}
    for f in LOCAL_DIR.rglob("*"):
        if f.is_file():
            files[f.relative_to(LOCAL_DIR).as_posix()] = f
    return files


def remote_files(sftp, root: str) -> dict[str, int]:
    """rel-posix-path -> size for every file under root."""
    out = {}

    def walk(rdir: str, rel: str):
        try:
            entries = sftp.listdir_attr(rdir)
        except FileNotFoundError:
            return
        for e in entries:
            rp = posixpath.join(rel, e.filename) if rel else e.filename
            full = posixpath.join(rdir, e.filename)
            if statmod.S_ISDIR(e.st_mode):
                walk(full, rp)
            else:
                out[rp] = e.st_size

    walk(root, "")
    return out


def ensure_dirs(sftp, root: str, rel: str, made: set) -> None:
    parts = posixpath.dirname(rel).split("/") if "/" in rel else []
    cur = root
    for part in parts:
        if not part:
            continue
        cur = posixpath.join(cur, part)
        if cur in made:
            continue
        try:
            sftp.stat(cur)
        except FileNotFoundError:
            sftp.mkdir(cur)
            print(f"  mkdir {cur}")
        made.add(cur)


def main() -> None:
    verify_build()
    site = filezilla_site(SITE_NAME)
    print(f"Connecting to {site['host']} as {site['user']} ...")
    client = paramiko.SSHClient()
    client.set_missing_host_key_policy(paramiko.AutoAddPolicy())
    client.connect(site["host"], site["port"], site["user"], site["password"], timeout=20)
    sftp = client.open_sftp()

    try:
        sftp.stat(REMOTE_DIR)
    except FileNotFoundError:
        raise SystemExit(f"Remote dir {REMOTE_DIR} not found — refusing to create web root")

    local = local_files()
    print(f"Local:  {len(local)} files in {LOCAL_DIR}")
    remote = remote_files(sftp, REMOTE_DIR)
    print(f"Remote: {len(remote)} files in {REMOTE_DIR}")

    to_upload = [rel for rel, f in local.items()
                 if rel not in remote or remote[rel] != f.stat().st_size]
    to_delete = [rel for rel in remote if rel not in local]
    # index.html last: everything it references must already be in place
    to_upload.sort(key=lambda r: (r == "index.html", r))

    if not to_upload and not to_delete:
        print("Nothing to do — remote is already in sync.")
        return

    made_dirs: set = set()
    up_bytes = 0
    for rel in to_upload:
        f = local[rel]
        size = f.stat().st_size
        tag = "NEW " if rel not in remote else "CHG "
        print(f"  {tag}{rel}  ({size/1024:.0f} KB)")
        if not DRY_RUN:
            ensure_dirs(sftp, REMOTE_DIR, rel, made_dirs)
            sftp.put(str(f), posixpath.join(REMOTE_DIR, rel))
        up_bytes += size

    for rel in to_delete:
        print(f"  DEL {rel}")
        if not DRY_RUN:
            sftp.remove(posixpath.join(REMOTE_DIR, rel))

    verb = "Would upload" if DRY_RUN else "Uploaded"
    print(f"\n{verb} {len(to_upload)} files ({up_bytes/1e6:.1f} MB), "
          f"deleted {len(to_delete)} stale files.")
    if not DRY_RUN:
        print("Live at https://www.spacesignals.net/galaxy/")
    sftp.close()
    client.close()


if __name__ == "__main__":
    main()
