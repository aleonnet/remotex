//! Why something failed, as the page can say it in the language the person reads.
//!
//! An error here is a sentence, in English, written where it happens: the gateway's
//! log is in it, and so is what a person quotes when they ask. A browser cannot say
//! that sentence in another language, and guessing the cause back out of its wording
//! breaks the day the wording changes. So an error whose cause somebody at the
//! browser understands, or can do something about, carries that cause beside its
//! sentence: the catalogue's code for it (docs/design/errors.json) and what fills
//! the catalogue's text. [`find`] reads it back wherever an error is sent to the page
//! ([`crate::protocol::ServerMsg::Error`]), and the page says the catalogue's words.
//!
//! The sentence is untouched. An error that knows its cause prints as it always did,
//! chain and all, so the log, the page's "Details" and every test that reads a
//! sentence see what they saw before.
//!
//! An error with no cause is not a fault of this module's: the page then says the
//! general words of the place it shows the error at, and keeps the sentence for
//! whoever asks.

use std::collections::BTreeMap;
use std::fmt;

use serde::Serialize;

/// A cause the catalogue has words for.
#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
pub struct Cause {
    /// The catalogue's code: `AL-` and four digits.
    pub code: &'static str,
    /// What goes in the holes of the catalogue's text, by name.
    pub fill: BTreeMap<&'static str, String>,
}

impl Cause {
    pub fn new(code: &'static str) -> Self {
        Self { code, fill: BTreeMap::new() }
    }

    /// The same cause with `value` for the catalogue text's `{hole}`.
    #[must_use]
    pub fn with(mut self, hole: &'static str, value: impl fmt::Display) -> Self {
        self.fill.insert(hole, value.to_string());
        self
    }

    /// `error`, knowing this is why. An error that already knows a cause keeps it:
    /// the one named where it happened says more than the one a caller would add.
    pub fn of(self, error: impl Into<anyhow::Error>) -> anyhow::Error {
        let error = error.into();
        if find(&error).is_some() {
            return error;
        }
        anyhow::Error::new(Known { cause: self, error })
    }
}

/// A fallible step whose failure has a cause the catalogue knows.
pub trait Caused<T> {
    /// The same result, its error knowing `cause` unless it already knows one.
    fn cause(self, cause: impl FnOnce() -> Cause) -> anyhow::Result<T>;
}

impl<T, E: Into<anyhow::Error>> Caused<T> for Result<T, E> {
    fn cause(self, cause: impl FnOnce() -> Cause) -> anyhow::Result<T> {
        self.map_err(|error| cause().of(error))
    }
}

/// `anyhow::ensure!`, its error knowing the cause named first: the catalogue's
/// code, then what fills the catalogue's text, each `hole = value`, then a
/// semicolon and what `ensure!` takes. The sentence is written as it always was.
#[macro_export]
macro_rules! ensure_known {
    ($code:literal $(, $hole:ident = $value:expr)* ; $condition:expr, $($sentence:tt)+) => {
        if !$condition {
            $crate::bail_known!($code $(, $hole = $value)* ; $($sentence)+);
        }
    };
}

/// `anyhow::bail!`, its error knowing the cause named first, as [`ensure_known`]
/// names it.
#[macro_export]
macro_rules! bail_known {
    ($code:literal $(, $hole:ident = $value:expr)* ; $($sentence:tt)+) => {
        return ::core::result::Result::Err(
            $crate::cause::Cause::new($code)
                $(.with(stringify!($hole), &$value))*
                .of(::anyhow::anyhow!($($sentence)+)),
        )
    };
}

/// The cause `error` knows, wherever in its chain it was named.
pub fn find(error: &anyhow::Error) -> Option<&Cause> {
    error.chain().find_map(|link| link.downcast_ref::<Known>()).map(|known| &known.cause)
}

/// The cause `error` knows, or `general`: the catalogue's general code of the
/// place the error is sent to the page from, which says what happened there and
/// no more. So a session's end always reaches the page with words it can say in
/// the person's language, and the sentence beside them for whoever asks.
pub fn or_general(error: &anyhow::Error, general: &'static str) -> Cause {
    find(error).cloned().unwrap_or_else(|| Cause::new(general))
}

/// The kind of the read or write that failed under `error`, where one did: a step
/// that failed at the network hands its `io::Error` on with no sentence, and the
/// place that tells the page says the cause by this.
pub fn io_kind(error: &anyhow::Error) -> Option<std::io::ErrorKind> {
    error.chain().find_map(|link| link.downcast_ref::<std::io::Error>()).map(std::io::Error::kind)
}

/// An error and its cause. It prints as the error does and has the error's own
/// source, so nothing that reads the sentence or the chain can tell it is here.
struct Known {
    cause: Cause,
    error: anyhow::Error,
}

impl fmt::Display for Known {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        fmt::Display::fmt(&self.error, f)
    }
}

impl fmt::Debug for Known {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        fmt::Debug::fmt(&self.error, f)
    }
}

impl std::error::Error for Known {
    fn source(&self) -> Option<&(dyn std::error::Error + 'static)> {
        self.error.source()
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn refused() -> Cause {
        Cause::new("AL-7004").with("seconds", 20)
    }

    /// The cause rides the error and changes nothing a reader of the error sees:
    /// the sentence, the chain under it, and what a context adds on top.
    #[test]
    fn an_error_that_knows_its_cause_reads_as_it_did() {
        let plain = anyhow::anyhow!("the logon attempt was refused").context("CredSSP");
        let known = refused().of(anyhow::anyhow!("the logon attempt was refused").context("CredSSP"));
        assert_eq!(known.to_string(), plain.to_string());
        assert_eq!(format!("{known:#}"), format!("{plain:#}"));
        assert_eq!(format!("{known:#}"), "CredSSP: the logon attempt was refused");
        let under = known.context("RDP negotiation");
        assert_eq!(format!("{under:#}"), "RDP negotiation: CredSSP: the logon attempt was refused");
    }

    /// Found at the top, and under as many contexts as callers add on the way up.
    #[test]
    fn a_cause_is_found_at_any_depth() {
        let known = refused().of(anyhow::anyhow!("no answer"));
        assert_eq!(find(&known), Some(&refused()));
        let deep = known.context("reading the first frame").context("connecting");
        assert_eq!(find(&deep), Some(&refused()));
        assert_eq!(find(&deep).map(|cause| cause.fill["seconds"].as_str()), Some("20"));
    }

    #[test]
    fn an_error_nobody_named_a_cause_for_has_none() {
        let plain = anyhow::anyhow!("a zrle run overruns its tile").context("decoding a rectangle");
        assert_eq!(find(&plain), None);
        // Where it is sent to the page it takes the place's general cause, and one
        // that names its own keeps it.
        assert_eq!(or_general(&plain, "AL-7700"), Cause::new("AL-7700"));
        assert_eq!(or_general(&refused().of(plain), "AL-7700"), refused());
    }

    /// A read that failed with nobody saying why is found by its kind, under any
    /// sentence a caller put over it; an error that is nobody's read has none.
    #[test]
    fn a_failed_read_is_found_by_its_kind() {
        let read: anyhow::Result<()> =
            Err(std::io::Error::new(std::io::ErrorKind::UnexpectedEof, "early eof").into());
        let error = anyhow::Context::context(read, "reading a rectangle").unwrap_err();
        assert_eq!(io_kind(&error), Some(std::io::ErrorKind::UnexpectedEof));
        assert_eq!(io_kind(&anyhow::anyhow!("a zrle run overruns its tile")), None);
    }

    /// The step that failed names a cause only when what failed inside it named none.
    #[test]
    fn the_cause_named_where_it_happened_is_kept() {
        let inner = Cause::new("AL-7301").of(anyhow::anyhow!("the logon attempt was refused"));
        let step: anyhow::Result<()> = Err(inner);
        let error = step.cause(|| Cause::new("AL-7300")).unwrap_err();
        assert_eq!(find(&error).map(|cause| cause.code), Some("AL-7301"));

        let unnamed: anyhow::Result<()> = Err(anyhow::anyhow!("an unexpected PDU"));
        let error = unnamed.cause(|| Cause::new("AL-7300")).unwrap_err();
        assert_eq!(find(&error).map(|cause| cause.code), Some("AL-7300"));
        assert_eq!(error.to_string(), "an unexpected PDU");
    }

    /// What the page is sent: the code, and the holes by name.
    #[test]
    fn a_cause_goes_out_as_its_code_and_what_fills_it() {
        let json = serde_json::to_string(&refused().with("host", "mac.lan:5900")).unwrap();
        assert_eq!(json, r#"{"code":"AL-7004","fill":{"host":"mac.lan:5900","seconds":"20"}}"#);
        assert_eq!(serde_json::to_string(&Cause::new("AL-7100")).unwrap(), r#"{"code":"AL-7100","fill":{}}"#);
    }

    /// `bail!` and `ensure!` hand an error that knows its cause on as it is: a
    /// check written with either says why in the same line that says what.
    #[test]
    fn a_cause_goes_through_bail_and_ensure() {
        fn bailed() -> anyhow::Result<()> {
            anyhow::bail!(refused().of(anyhow::anyhow!("the port is taken")))
        }
        fn ensured(port: u16) -> anyhow::Result<()> {
            anyhow::ensure!(port != 0, refused().of(anyhow::anyhow!("--port must be between 1 and 65535")));
            Ok(())
        }
        let bailed = bailed().unwrap_err();
        assert_eq!(find(&bailed), Some(&refused()));
        assert_eq!(format!("{bailed:#}"), "the port is taken");
        let ensured_error = ensured(0).unwrap_err();
        assert_eq!(find(&ensured_error), Some(&refused()));
        assert_eq!(format!("{ensured_error:#}"), "--port must be between 1 and 65535");
        assert!(ensured(52380).is_ok());
    }

    /// The two macros that name the cause first read as `bail!` and `ensure!`
    /// do, sentence and all, and fill the catalogue's holes by name.
    #[test]
    fn a_check_names_its_cause_first() {
        fn named(name: &str, port: u16) -> anyhow::Result<()> {
            crate::ensure_known!("AL-7004", host = name, seconds = port; port != 0, "target {name:?} has no port");
            if name.is_empty() {
                crate::bail_known!("AL-7001"; "a target has an empty name");
            }
            Ok(())
        }
        let unported = named("mac", 0).unwrap_err();
        assert_eq!(find(&unported), Some(&Cause::new("AL-7004").with("host", "mac").with("seconds", 0)));
        assert_eq!(format!("{unported:#}"), "target \"mac\" has no port");
        let unnamed = named("", 5900).unwrap_err();
        assert_eq!(find(&unnamed), Some(&Cause::new("AL-7001")));
        assert_eq!(format!("{unnamed:#}"), "a target has an empty name");
        assert!(named("mac", 5900).is_ok());
    }
}
