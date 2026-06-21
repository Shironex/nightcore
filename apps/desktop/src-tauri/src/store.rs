//! The on-disk task registry.
//!
//! One pretty-printed JSON file per task at
//! `<workspace_root>/.nightcore/tasks/<id>.json`. The store keeps an in-memory
//! map (behind a `Mutex`) as the source of truth for reads, and writes through to
//! disk on every mutation so a restart reloads the exact same board. `.nightcore/`
//! is already gitignored.
//!
//! Held in managed Tauri state; commands take it as `State<'_, TaskStore>`.

use std::collections::HashMap;
use std::path::PathBuf;
use std::sync::Mutex;

use crate::task::Task;

/// Workspace root (`apps/desktop/src-tauri` → up three), the same cwd resolution
/// M0 used for the sidecar. M1 keeps tasks under this project's `.nightcore/`.
pub fn workspace_root() -> PathBuf {
    PathBuf::from(env!("CARGO_MANIFEST_DIR")).join("../../..")
}

/// In-memory task map plus the directory it persists to.
pub struct TaskStore {
    tasks: Mutex<HashMap<String, Task>>,
    dir: PathBuf,
}

impl TaskStore {
    /// Load every task file under `<workspace_root>/.nightcore/tasks/` into memory.
    /// Creates the directory if missing. Unparsable files are skipped with a log
    /// rather than aborting startup.
    pub fn load() -> Self {
        let dir = workspace_root().join(".nightcore/tasks");
        if let Err(e) = std::fs::create_dir_all(&dir) {
            eprintln!("task store: failed to create {}: {e}", dir.display());
        }

        let mut tasks = HashMap::new();
        match std::fs::read_dir(&dir) {
            Ok(entries) => {
                for entry in entries.flatten() {
                    let path = entry.path();
                    if path.extension().and_then(|e| e.to_str()) != Some("json") {
                        continue;
                    }
                    match std::fs::read_to_string(&path) {
                        Ok(raw) => match serde_json::from_str::<Task>(&raw) {
                            Ok(task) => {
                                tasks.insert(task.id.clone(), task);
                            }
                            Err(e) => eprintln!("task store: skipping {}: {e}", path.display()),
                        },
                        Err(e) => eprintln!("task store: cannot read {}: {e}", path.display()),
                    }
                }
            }
            Err(e) => eprintln!("task store: cannot list {}: {e}", dir.display()),
        }

        Self {
            tasks: Mutex::new(tasks),
            dir,
        }
    }

    /// Path to a task's JSON file.
    fn path_for(&self, id: &str) -> PathBuf {
        self.dir.join(format!("{id}.json"))
    }

    /// Snapshot of all tasks (unordered).
    pub fn list(&self) -> Vec<Task> {
        self.tasks
            .lock()
            .expect("task store poisoned")
            .values()
            .cloned()
            .collect()
    }

    /// A single task by id, if present.
    pub fn get(&self, id: &str) -> Option<Task> {
        self.tasks
            .lock()
            .expect("task store poisoned")
            .get(id)
            .cloned()
    }

    /// Insert or replace a task and write its file. Bumping `updated_at` is the
    /// caller's responsibility (see [`mutate`](Self::mutate)).
    pub fn upsert(&self, task: &Task) -> Result<(), String> {
        self.write_file(task)?;
        self.tasks
            .lock()
            .expect("task store poisoned")
            .insert(task.id.clone(), task.clone());
        Ok(())
    }

    /// Apply `f` to a copy of the task, bump `updated_at`, then persist and store
    /// it. Returns the updated task. Errors if the id is unknown.
    pub fn mutate<F>(&self, id: &str, f: F) -> Result<Task, String>
    where
        F: FnOnce(&mut Task),
    {
        let mut task = self
            .get(id)
            .ok_or_else(|| format!("no task with id {id}"))?;
        f(&mut task);
        task.updated_at = crate::task::now_ms();
        self.upsert(&task)?;
        Ok(task)
    }

    /// Remove a task from memory and delete its file. Idempotent on a missing file.
    pub fn remove(&self, id: &str) -> Result<(), String> {
        self.tasks
            .lock()
            .expect("task store poisoned")
            .remove(id);
        let path = self.path_for(id);
        match std::fs::remove_file(&path) {
            Ok(()) => Ok(()),
            Err(e) if e.kind() == std::io::ErrorKind::NotFound => Ok(()),
            Err(e) => Err(format!("failed to delete {}: {e}", path.display())),
        }
    }

    /// Write one task as pretty JSON to its file.
    fn write_file(&self, task: &Task) -> Result<(), String> {
        let json = serde_json::to_string_pretty(task).map_err(|e| e.to_string())?;
        std::fs::write(self.path_for(&task.id), json)
            .map_err(|e| format!("failed to persist task {}: {e}", task.id))
    }
}
