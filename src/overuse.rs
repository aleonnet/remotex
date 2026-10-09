//! When the encoder is overused, and what its picture is held to for it.
//!
//! The gateway's one encoder runs on the Mac that hosts it, and a picture it reduces
//! for a phone ([`crate::vnc::DesktopState::reduces`]) is the one picture whose size
//! is the gateway's to choose: the remote cannot be asked for a smaller one, and the
//! phone shows it fitted to its width whatever its pixels. Measured on 2026-10-08
//! (docs/research/2026-10-08-1430-diagnostico-do-0-1-1.md), the sessions of a phone
//! cost this Mac 4.7 to 185 ms a frame while a desk's cost 4 to 13, and the quality
//! walk read the encoder's own delay as the link's congestion.
//!
//! The rule is libwebrtc's, which adapts a sent picture to the CPU that encodes it
//! (`video/adaptation/overuse_frame_detector.cc`, `.h`, and
//! `call/adaptation/video_stream_adapter.cc`): the encoder's usage is its encode
//! time over the interval between frames, checked every five seconds; two checks
//! at or over 85 % adapt down, one under 42 % adapts up, and an adaptation up
//! waits ten seconds after the last adaptation, doubling each time an overuse
//! follows one, to four minutes at most. Down is three fifths of the pixels, up
//! is five thirds, and the floor is 320 by 180 pixels. The two thresholds are
//! apart by more than one step, so a step never crosses both.
//!
//! What is adapted is a budget of pixels, published by the encoder
//! ([`crate::encode::VideoSink::budget`]) and applied by the engine that reduces
//! the picture, after the width the viewer shows and under the ceiling
//! ([`crate::video::fit_pixels`]). Nothing else reads it: a desktop sent at its
//! own pixels is not the gateway's to shrink.

use std::time::Duration;

use tokio::time::Instant;

use crate::video::{MAX_LONG_SIDE, MAX_SHORT_SIDE};

/// Encode time over the frame interval, in percent, at and over which the
/// encoder is overused.
pub const HIGH_USAGE_PERCENT: u64 = 85;
/// Under which it is underused: `(85 - 1) / 2`, as libwebrtc derives it.
pub const LOW_USAGE_PERCENT: u64 = 42;
/// How often the usage is judged.
pub const CHECK_EVERY: Duration = Duration::from_secs(5);
/// How many checks in a row must find the encoder overused before the budget goes down.
pub const HIGH_CHECKS: u32 = 2;
/// How long after an adaptation the budget may go up, at first.
pub const RAMP_UP_AT_FIRST: Duration = Duration::from_secs(10);
/// And at most, after the wait has doubled for overuses that followed a rise.
pub const RAMP_UP_AT_MOST: Duration = Duration::from_secs(240);
/// The least picture a budget holds the encoder to.
pub const BUDGET_FLOOR: u32 = 320 * 180;

/// Past the ceiling's pixels a budget holds nothing, and is none.
const BUDGET_CEILING: u64 = MAX_LONG_SIDE as u64 * MAX_SHORT_SIDE as u64;

/// What a check found: the budget goes down, or it may go up.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum Verdict {
    Down,
    Up,
}

/// The encoder's usage, judged every [`CHECK_EVERY`]. Pure: it takes `now`
/// rather than reading a clock, so every decision is testable without waiting
/// for one.
pub struct Overuse {
    checked_at: Option<Instant>,
    /// What the rounds since the last check cost, and the intervals they were
    /// paced at.
    encode: Duration,
    span: Duration,
    /// Checks in a row that found the encoder overused.
    above: u32,
    /// How long after the last adaptation the budget may go up.
    ramp_up: Duration,
    /// When the budget last moved, either way.
    adapted_at: Option<Instant>,
    /// Whether it went up since it last went down: an overuse that follows a
    /// rise doubles the wait before the next.
    rose: bool,
}

impl Default for Overuse {
    fn default() -> Self {
        Self::new()
    }
}

impl Overuse {
    pub fn new() -> Self {
        Self {
            checked_at: None,
            encode: Duration::ZERO,
            span: Duration::ZERO,
            above: 0,
            ramp_up: RAMP_UP_AT_FIRST,
            adapted_at: None,
            rose: false,
        }
    }

    /// One round encoded: what it cost, and the interval the stream was paced at.
    pub fn round(&mut self, encode: Duration, interval: Duration) {
        self.encode += encode;
        self.span += interval;
    }

    /// The usage since the last check, in percent, where a check is due.
    fn usage(&mut self, now: Instant) -> Option<u64> {
        let Some(at) = self.checked_at else {
            self.checked_at = Some(now);
            return None;
        };
        if now.duration_since(at) < CHECK_EVERY {
            return None;
        }
        self.checked_at = Some(now);
        let (encode, span) = (std::mem::take(&mut self.encode), std::mem::take(&mut self.span));
        if span.is_zero() {
            // Nothing was encoded: a still screen, which overuses nothing.
            self.above = 0;
            return None;
        }
        Some((100 * encode.as_micros() / span.as_micros()) as u64)
    }

    /// Judge the usage, where a check is due.
    pub fn check(&mut self, now: Instant) -> Option<Verdict> {
        let usage = self.usage(now)?;
        if usage >= HIGH_USAGE_PERCENT {
            self.above += 1;
            if self.above < HIGH_CHECKS {
                return None;
            }
            self.above = 0;
            if self.rose {
                self.ramp_up = (self.ramp_up * 2).min(RAMP_UP_AT_MOST);
                self.rose = false;
            }
            self.adapted_at = Some(now);
            return Some(Verdict::Down);
        }
        self.above = 0;
        if usage < LOW_USAGE_PERCENT
            && let Some(at) = self.adapted_at
            && now.duration_since(at) >= self.ramp_up
        {
            self.adapted_at = Some(now);
            self.rose = true;
            return Some(Verdict::Up);
        }
        None
    }
}

/// The budget after `verdict`: three fifths of what is encoded now (`picture`, or
/// the budget where it is under the picture) on the way down, never under the
/// floor; five thirds of the budget on the way up, and none past the ceiling,
/// where it holds nothing.
pub fn budget_after(verdict: Verdict, current: Option<u32>, picture: u32) -> Option<u32> {
    match verdict {
        Verdict::Down => {
            let from = u64::from(current.map_or(picture, |budget| budget.min(picture)));
            Some((from * 3 / 5).max(u64::from(BUDGET_FLOOR)) as u32)
        }
        Verdict::Up => current
            .map(|budget| u64::from(budget) * 5 / 3)
            .filter(|&budget| budget < BUDGET_CEILING)
            .map(|budget| budget as u32),
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    const INTERVAL: Duration = Duration::from_micros(33_333);

    /// `rounds` at `usage` percent of the interval, filling one check's span.
    fn load(overuse: &mut Overuse, usage: u64) {
        for _ in 0..150 {
            overuse.round(INTERVAL * usage as u32 / 100, INTERVAL);
        }
    }

    /// Two checks in a row at or over 85 % go down; one under 42 % goes up, ten
    /// seconds after the last adaptation; between the two nothing moves.
    #[test]
    fn two_overused_checks_go_down_and_an_underused_one_goes_up_after_the_wait() {
        let mut overuse = Overuse::new();
        let t0 = Instant::now();
        assert_eq!(overuse.check(t0), None, "the first check only starts the clock");
        load(&mut overuse, 90);
        assert_eq!(overuse.check(t0 + CHECK_EVERY), None, "one overused check is no verdict");
        load(&mut overuse, 90);
        assert_eq!(overuse.check(t0 + CHECK_EVERY * 2), Some(Verdict::Down));
        // Under the high threshold the count starts over.
        load(&mut overuse, 90);
        assert_eq!(overuse.check(t0 + CHECK_EVERY * 3), None);
        load(&mut overuse, 60);
        assert_eq!(overuse.check(t0 + CHECK_EVERY * 4), None, "in between: nothing");
        load(&mut overuse, 90);
        assert_eq!(overuse.check(t0 + CHECK_EVERY * 5), None, "one again, after the reset");
        // Underused, twenty seconds after the adaptation: past the ten the rise waits.
        load(&mut overuse, 20);
        assert_eq!(overuse.check(t0 + CHECK_EVERY * 6), Some(Verdict::Up), "down at 10 s, checked at 30 s: up");
    }

    /// The wait before a rise doubles for each overuse that follows a rise, to four
    /// minutes at most, and a check before the clock is due is no check at all.
    #[test]
    fn the_wait_doubles_after_an_overuse_that_follows_a_rise() {
        let mut overuse = Overuse::new();
        let t0 = Instant::now();
        let mut at = t0;
        let mut tick = |overuse: &mut Overuse, usage: u64| {
            at += CHECK_EVERY;
            load(overuse, usage);
            overuse.check(at)
        };
        overuse.check(t0);
        tick(&mut overuse, 90);
        assert_eq!(tick(&mut overuse, 90), Some(Verdict::Down));
        // 10 s later it may rise: the next check after the wait.
        assert_eq!(tick(&mut overuse, 20), None, "5 s after: too soon");
        assert_eq!(tick(&mut overuse, 20), Some(Verdict::Up), "10 s after: up");
        // Overused again right after a rise: down, and the wait is 20 s now.
        tick(&mut overuse, 90);
        assert_eq!(tick(&mut overuse, 90), Some(Verdict::Down));
        for _ in 0..3 {
            assert_eq!(tick(&mut overuse, 20), None, "under 20 s: no rise");
        }
        assert_eq!(tick(&mut overuse, 20), Some(Verdict::Up), "at 20 s: up");
        // And so on, to four minutes at most.
        assert!(overuse.ramp_up <= RAMP_UP_AT_MOST);
        let mut overuse = Overuse::new();
        overuse.ramp_up = RAMP_UP_AT_MOST;
        overuse.rose = true;
        overuse.check(t0);
        load(&mut overuse, 90);
        overuse.check(t0 + CHECK_EVERY);
        load(&mut overuse, 90);
        assert_eq!(overuse.check(t0 + CHECK_EVERY * 2), Some(Verdict::Down));
        assert_eq!(overuse.ramp_up, RAMP_UP_AT_MOST);
        // A check inside the five seconds judges nothing.
        load(&mut overuse, 90);
        assert_eq!(overuse.check(t0 + CHECK_EVERY * 2 + Duration::from_secs(1)), None);
    }

    /// A span with nothing encoded is a still screen: no usage, and no verdict.
    #[test]
    fn a_still_screen_overuses_nothing() {
        let mut overuse = Overuse::new();
        let t0 = Instant::now();
        overuse.check(t0);
        load(&mut overuse, 90);
        overuse.check(t0 + CHECK_EVERY);
        assert_eq!(overuse.check(t0 + CHECK_EVERY * 2), None, "nothing encoded: no second overused check");
        load(&mut overuse, 90);
        assert_eq!(overuse.check(t0 + CHECK_EVERY * 3), None, "and the count started over");
    }
}
