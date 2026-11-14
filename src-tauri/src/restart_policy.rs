use std::time::Duration;

/// Exponential restart delay with a hard cap and a reset after the child becomes ready.
pub(crate) struct RestartBackoff {
    initial: Duration,
    maximum: Duration,
    next: Duration,
}

impl RestartBackoff {
    pub(crate) fn new(initial: Duration, maximum: Duration) -> Self {
        let initial = initial.min(maximum);
        Self {
            initial,
            maximum,
            next: initial,
        }
    }

    pub(crate) fn next_delay(&mut self) -> Duration {
        let delay = self.next;
        self.next = self
            .next
            .checked_mul(2)
            .unwrap_or(self.maximum)
            .min(self.maximum);
        delay
    }

    pub(crate) fn reset(&mut self) {
        self.next = self.initial;
    }
}

#[cfg(test)]
mod tests {
    use super::RestartBackoff;
    use std::time::Duration;

    #[test]
    fn restart_delay_grows_exponentially_and_stops_at_the_cap() {
        let mut backoff =
            RestartBackoff::new(Duration::from_millis(100), Duration::from_millis(500));

        assert_eq!(backoff.next_delay(), Duration::from_millis(100));
        assert_eq!(backoff.next_delay(), Duration::from_millis(200));
        assert_eq!(backoff.next_delay(), Duration::from_millis(400));
        assert_eq!(backoff.next_delay(), Duration::from_millis(500));
        assert_eq!(backoff.next_delay(), Duration::from_millis(500));
    }

    #[test]
    fn readiness_resets_restart_delay_to_the_initial_interval() {
        let mut backoff = RestartBackoff::new(Duration::from_millis(100), Duration::from_secs(5));
        assert_eq!(backoff.next_delay(), Duration::from_millis(100));
        assert_eq!(backoff.next_delay(), Duration::from_millis(200));

        backoff.reset();

        assert_eq!(backoff.next_delay(), Duration::from_millis(100));
    }
}
