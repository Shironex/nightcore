//! Atomic file writes + corrupt-file quarantine for the store.

/// Write `bytes` to `path` atomically: write to a sibling temp file, then `rename`
/// it over the target. A reader either sees the old file or the new one, never a
/// truncated write (data-integrity #3). The temp file is removed on a write/persist
/// failure so a crash mid-write doesn't litter the dir.
pub(crate) fn write_atomic(path: &std::path::Path, bytes: &[u8]) -> std::io::Result<()> {
    use std::io::Write;
    let dir = path.parent().unwrap_or_else(|| std::path::Path::new("."));
    let file_name = path.file_name().and_then(|n| n.to_str()).unwrap_or("tmp");
    // A unique-ish sibling temp name (pid + nanos) so two concurrent writers to
    // different files in the same dir don't collide.
    let nonce = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map(|d| d.as_nanos())
        .unwrap_or(0);
    let tmp = dir.join(format!(".{file_name}.{}.{nonce}.tmp", std::process::id()));

    let write_then_rename = || -> std::io::Result<()> {
        let mut file = create_owner_only(&tmp)?;
        file.write_all(bytes)?;
        // `sync_data` (fdatasync), not `sync_all` (fsync): durability here only needs
        // the file's *contents* + the metadata required to read them back (size/block
        // map) on disk before the rename. The non-essential inode metadata `sync_all`
        // also flushes (mtime/atime) is pure overhead on this hot per-mutation path —
        // a status bump or `updated_at` tick fsyncs the whole record otherwise. The
        // atomic rename still gives a reader the old-or-new file, never a torn write.
        file.sync_data()?;
        drop(file);
        std::fs::rename(&tmp, path)
    };
    let result = write_then_rename();
    if result.is_err() {
        let _ = std::fs::remove_file(&tmp);
    }
    result
}

/// Create+truncate a fresh file for writing with owner-only (0600) permissions
/// applied AT CREATION on Unix, so a secret-bearing atomic write (e.g. settings.json
/// with plaintext MCP env/headers) never exists at the default umask (0644) — not
/// even for the temp-file window before the caller's late `restrict_to_owner`, and
/// not permanently if a crash lands between the rename and that chmod. On non-Unix
/// there is no mode bit; a plain create is used.
fn create_owner_only(path: &std::path::Path) -> std::io::Result<std::fs::File> {
    #[cfg(unix)]
    {
        use std::os::unix::fs::OpenOptionsExt;
        std::fs::OpenOptions::new()
            .write(true)
            .create(true)
            .truncate(true)
            .mode(0o600)
            .open(path)
    }
    #[cfg(not(unix))]
    {
        std::fs::File::create(path)
    }
}

/// Move an unparsable store file aside to a non-clobbering `<name>.corrupt-<millis>`
/// sibling, returning the backup path. Single-file stores (settings.json,
/// projects.json) load all-or-nothing: on a parse error the caller falls back to
/// defaults, and the NEXT write would persist those defaults over the bad file —
/// permanently erasing recoverable data (incl. plaintext MCP secrets). Quarantining
/// first means the later overwrite lands on a now-absent path instead. Best-effort:
/// the rename can fail (e.g. read-only dir); callers log and continue.
pub(crate) fn quarantine_corrupt(path: &std::path::Path) -> std::io::Result<std::path::PathBuf> {
    let millis = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map(|d| d.as_millis())
        .unwrap_or(0);
    let name = path
        .file_name()
        .map(|n| n.to_string_lossy().into_owned())
        .unwrap_or_else(|| "store.json".to_string());
    let backup = path.with_file_name(format!("{name}.corrupt-{millis}"));
    std::fs::rename(path, &backup)?;
    Ok(backup)
}

#[cfg(test)]
mod tests {
    use super::*;
    use tempfile::TempDir;

    /// The failure-cleanup branch of [`write_atomic`]: when the final `rename` fails,
    /// the sibling temp file it already created + fsynced must be removed, so a failed
    /// (or crash-adjacent) write never litters the store dir with orphan
    /// `.<name>.<pid>.<nonce>.tmp` droppings. The 0600 + atomic-rename invariants are
    /// covered via re-export in `store/mod.rs`; this pins the ELSE arm they can't reach.
    ///
    /// We force the rename to fail deterministically by making the TARGET path a
    /// directory (`rename(regular file, existing dir)` errors on every platform), so
    /// the create+write+sync all succeed and control reaches the `remove_file` cleanup.
    #[test]
    fn write_atomic_removes_the_temp_file_when_rename_fails() {
        let tmp = TempDir::new().expect("create temp dir");
        // A directory sitting on the target path makes `rename(tmp, target)` fail.
        let target = tmp.path().join("settings.json");
        std::fs::create_dir(&target).expect("create the blocking directory");

        let result = write_atomic(&target, b"{\"token\":\"s3cr3t\"}");
        assert!(
            result.is_err(),
            "renaming the temp file onto a directory must fail"
        );

        // The invariant under test: no temp sibling survives the failed rename. The
        // dir must hold ONLY the blocking directory — no `.settings.json.*.tmp` file.
        let leftovers: Vec<_> = std::fs::read_dir(tmp.path())
            .expect("read the store dir")
            .filter_map(|e| e.ok())
            .filter(|e| {
                let name = e.file_name();
                let name = name.to_string_lossy();
                name.starts_with(".settings.json.") && name.ends_with(".tmp")
            })
            .map(|e| e.file_name())
            .collect();
        assert!(
            leftovers.is_empty(),
            "the temp file must be cleaned up after a failed rename, found: {leftovers:?}"
        );
    }

    /// Parity unit for [`quarantine_corrupt`] on a `settings.json` fixture (the loader
    /// path in `store::settings` — projects.json parity lives in `store/project.rs`).
    /// Pins the function's own contract: the original file is MOVED to a
    /// non-clobbering `<name>.corrupt-<millis>` sibling whose bytes are preserved, and
    /// the returned path is that backup.
    #[test]
    fn quarantine_corrupt_moves_settings_to_a_nonclobbering_backup() {
        let tmp = TempDir::new().expect("create temp dir");
        let path = tmp.path().join("settings.json");
        std::fs::write(&path, b"{ not valid json").expect("seed a corrupt file");

        let backup = quarantine_corrupt(&path).expect("quarantine the file");

        // The original is moved aside so the next write can't overwrite it in place.
        assert!(!path.exists(), "the corrupt file is moved off its path");
        // The backup is a distinct, non-clobbering sibling with the corrupt- prefix.
        assert_ne!(backup, path, "the backup must not be the original path");
        assert_eq!(backup.parent(), path.parent());
        assert!(backup
            .file_name()
            .unwrap()
            .to_string_lossy()
            .starts_with("settings.json.corrupt-"));
        // The bytes are preserved verbatim for recovery (incl. plaintext secrets).
        assert_eq!(
            std::fs::read(&backup).expect("read the backup"),
            b"{ not valid json"
        );
    }
}
