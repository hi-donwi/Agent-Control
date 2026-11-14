use std::fs::{self, File, OpenOptions};
use std::io::{self, Write};
use std::path::{Path, PathBuf};

pub(crate) struct RotatingLog {
    path: PathBuf,
    file: Option<File>,
    current_size: u64,
    max_bytes: u64,
    backups: usize,
}

impl RotatingLog {
    pub(crate) fn open(path: impl AsRef<Path>, max_bytes: u64, backups: usize) -> io::Result<Self> {
        if max_bytes == 0 {
            return Err(io::Error::new(
                io::ErrorKind::InvalidInput,
                "rotation size must be greater than zero",
            ));
        }
        let path = path.as_ref().to_path_buf();
        if let Some(parent) = path.parent() {
            fs::create_dir_all(parent)?;
        }
        let current_size = fs::metadata(&path)
            .map(|metadata| metadata.len())
            .unwrap_or(0);
        let file = open_append(&path)?;
        Ok(Self {
            path,
            file: Some(file),
            current_size,
            max_bytes,
            backups,
        })
    }

    fn rotate(&mut self) -> io::Result<()> {
        self.file.take();
        if self.backups > 0 {
            for index in (1..=self.backups).rev() {
                let destination = backup_path(&self.path, index);
                let source = if index == 1 {
                    self.path.clone()
                } else {
                    backup_path(&self.path, index - 1)
                };
                if destination.exists() {
                    fs::remove_file(&destination)?;
                }
                if source.exists() {
                    fs::rename(source, destination)?;
                }
            }
        } else if self.path.exists() {
            fs::remove_file(&self.path)?;
        }
        self.file = Some(open_append(&self.path)?);
        self.current_size = 0;
        Ok(())
    }
}

impl Write for RotatingLog {
    fn write(&mut self, mut bytes: &[u8]) -> io::Result<usize> {
        let original_len = bytes.len();
        while !bytes.is_empty() {
            if self.current_size >= self.max_bytes {
                self.rotate()?;
            }
            let capacity = (self.max_bytes - self.current_size) as usize;
            let count = bytes.len().min(capacity);
            self.file
                .as_mut()
                .expect("log file is open")
                .write_all(&bytes[..count])?;
            self.current_size += count as u64;
            bytes = &bytes[count..];
        }
        Ok(original_len)
    }

    fn flush(&mut self) -> io::Result<()> {
        self.file.as_mut().expect("log file is open").flush()
    }
}

fn backup_path(path: &Path, index: usize) -> PathBuf {
    let mut name = path.as_os_str().to_os_string();
    name.push(format!(".{index}"));
    PathBuf::from(name)
}

fn open_append(path: &Path) -> io::Result<File> {
    match fs::symlink_metadata(path) {
        Ok(metadata) if !metadata.is_file() || metadata.file_type().is_symlink() => {
            return Err(io::Error::new(
                io::ErrorKind::InvalidInput,
                "log path must be a regular file",
            ));
        }
        Ok(_) => {}
        Err(error) if error.kind() == io::ErrorKind::NotFound => {}
        Err(error) => return Err(error),
    }
    let mut options = OpenOptions::new();
    options.create(true).append(true);
    #[cfg(unix)]
    {
        use std::os::unix::fs::OpenOptionsExt;
        options.mode(0o600);
    }
    let file = options.open(path)?;
    #[cfg(unix)]
    {
        use std::os::unix::fs::PermissionsExt;
        file.set_permissions(fs::Permissions::from_mode(0o600))?;
    }
    Ok(file)
}

#[cfg(test)]
mod tests {
    use super::{backup_path, RotatingLog};
    use std::fs;
    use std::io::Write;
    use std::path::PathBuf;
    use std::sync::atomic::{AtomicU64, Ordering};

    static NEXT_DIR: AtomicU64 = AtomicU64::new(0);

    fn temp_log() -> (PathBuf, PathBuf) {
        let id = NEXT_DIR.fetch_add(1, Ordering::Relaxed);
        let directory =
            std::env::temp_dir().join(format!("agent-control-log-{}-{id}", std::process::id()));
        fs::create_dir_all(&directory).expect("temporary directory");
        (directory.clone(), directory.join("desktop-host.stderr.log"))
    }

    #[test]
    fn keeps_current_and_backups_under_the_configured_size_limit() {
        let (directory, path) = temp_log();
        let mut log = RotatingLog::open(&path, 10, 2).expect("rotating log");
        log.write_all(b"1234567890abcdefghijABCDEFGHIJklmnopqrst")
            .expect("write log");
        log.flush().expect("flush log");

        for candidate in [&path, &backup_path(&path, 1), &backup_path(&path, 2)] {
            if candidate.exists() {
                assert!(fs::metadata(candidate).expect("log metadata").len() <= 10);
            }
        }
        assert_eq!(fs::read(&path).expect("current log"), b"klmnopqrst");
        assert_eq!(
            fs::read(backup_path(&path, 1)).expect("newest backup"),
            b"ABCDEFGHIJ"
        );
        assert_eq!(
            fs::read(backup_path(&path, 2)).expect("older backup"),
            b"abcdefghij"
        );
        fs::remove_dir_all(directory).expect("cleanup");
    }

    #[test]
    fn rejects_zero_sized_logs() {
        let (directory, path) = temp_log();
        assert!(RotatingLog::open(path, 0, 1).is_err());
        fs::remove_dir_all(directory).expect("cleanup");
    }

    #[cfg(unix)]
    #[test]
    fn refuses_a_symlink_as_the_log_file() {
        use std::os::unix::fs::symlink;
        let (directory, path) = temp_log();
        let target = directory.join("other.log");
        fs::write(&target, b"do not follow").expect("target file");
        symlink(&target, &path).expect("symlink");
        assert!(RotatingLog::open(&path, 10, 1).is_err());
        assert_eq!(fs::read(target).expect("target remains"), b"do not follow");
        fs::remove_dir_all(directory).expect("cleanup");
    }

    #[cfg(unix)]
    #[test]
    fn creates_log_files_with_owner_only_permissions() {
        use std::os::unix::fs::PermissionsExt;
        let (directory, path) = temp_log();
        let log = RotatingLog::open(&path, 10, 1).expect("rotating log");
        drop(log);
        assert_eq!(
            fs::metadata(path)
                .expect("log metadata")
                .permissions()
                .mode()
                & 0o777,
            0o600
        );
        fs::remove_dir_all(directory).expect("cleanup");
    }
}
