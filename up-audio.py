#!/usr/bin/env python3
"""Scan app/public/audio/ and sync bodies.ts: adds new stems, removes missing ones."""

import re
import os
from pathlib import Path

AUDIO_DIR = Path(__file__).parent / "app" / "public" / "audio"
BODIES_TS = Path(__file__).parent / "app" / "src" / "data" / "bodies.ts"
AUDIO_EXTS = {".m4a", ".mp3", ".ogg", ".wav", ".webm"}


def scan_audio_files():
    """Return dict of folder -> sorted list of relative paths (e.g. 'sun/drone-01.m4a').

    A body's `delay/` subfolder (e.g. 'sun/delay/second-layer.m4a') is bucketed under its
    own key ('sun/delay') rather than folded into the body's regular stems, so it maps to
    the separate `delayedStems` field in bodies.ts instead of `stems`.
    """
    files_by_folder = {}
    for root, _, files in os.walk(AUDIO_DIR):
        rel_root = Path(root).relative_to(AUDIO_DIR).as_posix()
        if rel_root == ".":
            continue
        parts = rel_root.split("/")
        top_folder = parts[0]
        for f in sorted(files):
            if Path(f).suffix.lower() in AUDIO_EXTS:
                rel_path = f"{rel_root}/{f}"
                if top_folder == "pools":
                    key = rel_root  # e.g. "pools/icy-moon"
                elif len(parts) == 2 and parts[1] == "delay":
                    key = f"{top_folder}/delay"  # e.g. "sun/delay"
                else:
                    key = top_folder  # e.g. "sun"
                files_by_folder.setdefault(key, []).append(rel_path)
    return files_by_folder


def parse_string_array(text):
    """Extract list of strings from a TS array literal like ['a', 'b']."""
    return re.findall(r"""['"]([^'"]+)['"]""", text)


def format_string_array(items, indent="    "):
    """Format a list of strings as a TS array literal."""
    if not items:
        return "[]"
    if len(items) == 1:
        return f"['{items[0]}']"
    inner = ", ".join(f"'{item}'" for item in items)
    # Keep on one line if short enough
    if len(inner) + 4 <= 100:
        return f"[{inner}]"
    lines = [f"{indent}  '{item}'," for item in items]
    return "[\n" + "\n".join(lines) + f"\n{indent}]"


def update_bodies_ts(disk_files):
    source = BODIES_TS.read_text(encoding="utf-8")
    original = source
    changes = []

    # Collect body IDs from the file
    body_ids = re.findall(r"id:\s*'([^']+)'", source)

    # Update stems arrays for each body
    for body_id in body_ids:
        disk_stems = sorted(disk_files.get(body_id, []))

        # Find the stems line for this body block
        pattern = re.compile(
            r"(id:\s*'" + re.escape(body_id) + r"'.*?)(stems:\s*)(\[[^\]]*\])",
            re.DOTALL,
        )
        m = pattern.search(source)
        if m:
            current_stems = parse_string_array(m.group(3))
            if sorted(current_stems) != disk_stems:
                new_arr = format_string_array(disk_stems)
                new_frag = m.group(2) + new_arr

                for f in sorted(set(disk_stems) - set(current_stems)):
                    changes.append(f"  + {body_id}: {f}")
                for f in sorted(set(current_stems) - set(disk_stems)):
                    changes.append(f"  - {body_id}: {f}")

                source = source[: m.start(2)] + new_frag + source[m.end(3) :]

        # Delayed stems (this body's delay/ folder) -> the delayedStems field
        disk_delayed = sorted(disk_files.get(f"{body_id}/delay", []))
        delayed_pattern = re.compile(
            r"(id:\s*'" + re.escape(body_id) + r"'.*?)(delayedStems:\s*)(\[[^\]]*\])",
            re.DOTALL,
        )
        dm = delayed_pattern.search(source)
        if dm:
            current_delayed = parse_string_array(dm.group(3))
            if sorted(current_delayed) != disk_delayed:
                new_delayed_arr = format_string_array(disk_delayed)
                new_delayed_frag = dm.group(2) + new_delayed_arr
                for f in sorted(set(disk_delayed) - set(current_delayed)):
                    changes.append(f"  + {body_id} (delay): {f}")
                for f in sorted(set(current_delayed) - set(disk_delayed)):
                    changes.append(f"  - {body_id} (delay): {f}")
                source = source[: dm.start(2)] + new_delayed_frag + source[dm.end(3) :]
        elif disk_delayed:
            # Field doesn't exist yet but there are files on disk — insert it right after
            # this body's stems array.
            insert_pattern = re.compile(
                r"(id:\s*'" + re.escape(body_id) + r"'.*?stems:\s*\[[^\]]*\],?)",
                re.DOTALL,
            )
            im = insert_pattern.search(source)
            if im:
                new_delayed_arr = format_string_array(disk_delayed)
                insertion = f"\n    delayedStems: {new_delayed_arr},"
                source = source[: im.end(1)] + insertion + source[im.end(1) :]
                for f in sorted(disk_delayed):
                    changes.append(f"  + {body_id} (delay): {f}")

    # Update AUDIO_POOLS
    pool_pattern = re.compile(
        r"(export const AUDIO_POOLS[^{]*\{)(.*?)(\};)",
        re.DOTALL,
    )
    pool_match = pool_pattern.search(source)
    if pool_match:
        pool_body = pool_match.group(2)
        pool_entries = re.findall(
            r"'([^']+)':\s*(\[[^\]]*\])", pool_body
        )
        existing_pools = {}
        for pool_name, arr_text in pool_entries:
            existing_pools[pool_name] = parse_string_array(arr_text)

        pool_changed = False
        for key, files in disk_files.items():
            if not key.startswith("pools/"):
                continue
            pool_name = key[len("pools/"):]
            current = set(existing_pools.get(pool_name, []))
            disk_set = set(files)
            if current != disk_set:
                for f in sorted(disk_set - current):
                    changes.append(f"  + pool:{pool_name}: {f}")
                for f in sorted(current - disk_set):
                    changes.append(f"  - pool:{pool_name}: {f}")
                existing_pools[pool_name] = sorted(disk_set)
                pool_changed = True

        # Remove pools that have no files on disk
        for pool_name in list(existing_pools.keys()):
            if f"pools/{pool_name}" not in disk_files:
                for f in existing_pools[pool_name]:
                    changes.append(f"  - pool:{pool_name}: {f}")
                del existing_pools[pool_name]
                pool_changed = True

        if pool_changed:
            lines = []
            for pool_name in sorted(existing_pools.keys()):
                arr = format_string_array(existing_pools[pool_name], "  ")
                lines.append(f"  '{pool_name}': {arr},")
            new_pool_body = "\n" + "\n".join(lines) + "\n"
            source = (
                source[: pool_match.start(2)]
                + new_pool_body
                + source[pool_match.end(2) :]
            )

    if source == original:
        print("No changes — bodies.ts is already up to date.")
        return

    BODIES_TS.write_text(source, encoding="utf-8")
    print(f"Updated {BODIES_TS.name}:")
    for line in changes:
        print(line)


if __name__ == "__main__":
    disk_files = scan_audio_files()
    update_bodies_ts(disk_files)
