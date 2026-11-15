use std::sync::atomic::{AtomicBool, Ordering};

#[derive(Default)]
pub(crate) struct AppLifecycle {
    quitting: AtomicBool,
}

impl AppLifecycle {
    pub(crate) fn should_hide_on_close(&self) -> bool {
        !self.quitting.load(Ordering::Acquire)
    }

    pub(crate) fn request_quit(&self) -> bool {
        !self.quitting.swap(true, Ordering::AcqRel)
    }
}

#[cfg(test)]
mod tests {
    use super::AppLifecycle;

    #[test]
    fn a_window_close_hides_the_app_until_explicit_quit() {
        let lifecycle = AppLifecycle::default();

        assert!(lifecycle.should_hide_on_close());
        assert!(lifecycle.request_quit());
        assert!(!lifecycle.should_hide_on_close());
    }

    #[test]
    fn repeated_quit_requests_are_idempotent() {
        let lifecycle = AppLifecycle::default();

        assert!(lifecycle.request_quit());
        assert!(!lifecycle.request_quit());
    }
}
