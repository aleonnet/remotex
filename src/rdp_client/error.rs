//! What a session failure is.

use std::fmt;

use crate::cause::{self, Cause};

/// Why a session did not start, or did not continue.
///
/// A sentence, because that is what a caller shows and logs: it is built from the
/// whole cause chain — the step that failed, then what it was doing, down to the
/// field or the status the host actually objected to — so the part a person can
/// act on is not lost behind "RDP negotiation failed". And beside it the cause a
/// page says in the person's own language, where the chain named one
/// ([`crate::cause`]): the sentence is English, and a chain flattened into it has
/// nothing left to find a cause in.
#[derive(Clone, PartialEq, Eq, thiserror::Error)]
#[error("{message}")]
pub struct Error {
    message: String,
    cause: Option<Cause>,
    kind: Kind,
}

/// What failed, where the chain named no cause: read here, since the sentence it
/// is flattened into has nothing left to tell by.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
enum Kind {
    /// A read or a write, with nobody saying why.
    Network,
    /// Something the host sent that this client does not accept.
    Malformed,
    /// Anything else.
    Other,
}

impl Error {
    /// A failure of this client's own, with nothing of the host's in it: a thread
    /// or a runtime that did not start, a panic.
    pub(super) fn internal(message: impl Into<String>) -> Self {
        Self { message: message.into(), cause: Some(Cause::new("AL-7105")), kind: Kind::Other }
    }

    /// The cause the chain this was built from named, if it named one.
    pub fn cause(&self) -> Option<&Cause> {
        self.cause.as_ref()
    }

    /// The cause this is told by where it is sent to the page: its own, or, where
    /// the chain named none, `network` for a read or a write that failed and
    /// `malformed` for what the host sent that this client does not accept. Each
    /// place names its own two: a connection that broke while it was being made is
    /// not said as one that broke with a desktop on screen.
    pub fn told(&self, network: &'static str, malformed: &'static str) -> Option<Cause> {
        self.cause.clone().or(match self.kind {
            Kind::Network => Some(Cause::new(network)),
            Kind::Malformed => Some(Cause::new(malformed)),
            Kind::Other => None,
        })
    }
}

// Debug prints the same sentence rather than a struct dump: this ends up inside a
// `Result<(), Error>` in an `Event`, and `{:?}` on that is what most callers log.
impl fmt::Debug for Error {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        f.write_str(&self.message)
    }
}

impl From<anyhow::Error> for Error {
    fn from(err: anyhow::Error) -> Self {
        // A desktop or a surface past what this client holds says so by its kind,
        // which is the graphics crate's and names no cause of this one.
        let too_large = err.chain().any(|link| link.is::<alumia_rdp_graphics::framebuffer::TooLarge>());
        // A message of this client's own that does not fit what carries it is this
        // client's failure, with nothing of the host's in it.
        let own = err.chain().any(|link| {
            link.is::<super::proto::x224::TooLong>()
                || link.is::<super::proto::channel::TooLong>()
                || link.is::<super::proto::dvc::TooLong>()
        });
        // Before the cause the chain named: a step that sends is named for the
        // network it writes to, and this is no failure of the network's.
        let cause = own
            .then(|| Cause::new("AL-7105"))
            .or_else(|| cause::find(&err).cloned())
            .or_else(|| too_large.then(|| Cause::new("AL-7107")));
        let kind = match cause::io_kind(&err) {
            // What TLS says of a record it refuses is no failure of the network's:
            // it is told by the place's general words.
            Some(std::io::ErrorKind::InvalidData) => Kind::Other,
            Some(_) => Kind::Network,
            None if err.chain().any(|link| link.is::<super::proto::wire::Malformed>()) => Kind::Malformed,
            None => Kind::Other,
        };
        // `{:#}` is anyhow's own chain, `outer: inner: innermost`.
        Self { message: format!("{err:#}"), cause, kind }
    }
}

#[cfg(test)]
mod tests {
    use anyhow::Context as _;

    use super::*;

    /// The reason is at the bottom of the chain, and it is the part worth reading.
    #[test]
    fn the_whole_chain_is_kept() {
        let inner: anyhow::Result<()> = Err(anyhow::anyhow!("the logon attempt failed"));
        let err = inner.context("CredSSP").context("RDP negotiation").unwrap_err();
        assert_eq!(
            Error::from(err).to_string(),
            "RDP negotiation: CredSSP: the logon attempt failed"
        );
    }

    /// The chain is flattened into the sentence here, so this is where its cause is
    /// taken out of it: after this there is only a sentence to look in.
    #[test]
    fn the_cause_the_chain_named_crosses_with_the_sentence() {
        let refused = Cause::new("AL-7204").of(anyhow::anyhow!("the logon attempt was refused"));
        let err = Error::from(refused.context("RDP negotiation"));
        assert_eq!(err.to_string(), "RDP negotiation: the logon attempt was refused");
        assert_eq!(err.cause(), Some(&Cause::new("AL-7204")));

        let unnamed = Error::from(anyhow::anyhow!("an unexpected PDU"));
        assert_eq!(unnamed.cause(), None);
        assert_eq!(unnamed.told("AL-7108", "AL-7106"), None);
        assert_eq!(Error::internal("the RDP session thread panicked").cause(), Some(&Cause::new("AL-7105")));
    }

    /// Where the chain named no cause, the kind of what failed is kept, and each
    /// place says it by its own cause: a read that failed, what the host sent that
    /// this client does not accept, a desktop too large to hold, and what this
    /// client could not fit to send. A cause the chain did name is the one told.
    #[test]
    fn what_failed_is_told_by_its_kind_where_nobody_named_a_cause() {
        let read: anyhow::Result<()> =
            Err(std::io::Error::new(std::io::ErrorKind::ConnectionReset, "reset by peer").into());
        let broke = Error::from(read.context("reading from the host").unwrap_err());
        assert_eq!(broke.told("AL-7210", "AL-7211"), Some(Cause::new("AL-7210")));
        assert_eq!(broke.told("AL-7108", "AL-7106"), Some(Cause::new("AL-7108")));

        let refused: anyhow::Result<()> =
            Err(std::io::Error::new(std::io::ErrorKind::InvalidData, "a record failed its check").into());
        let refused = Error::from(refused.context("reading from the host").unwrap_err());
        assert_eq!(refused.told("AL-7108", "AL-7106"), None, "not the network's, so the place's general words");

        let odd = Error::from(anyhow::Error::new(crate::rdp_client::proto::wire::Malformed::Missing {
            what: "a Demand Active PDU",
            field: "its share id",
        }));
        assert_eq!(odd.told("AL-7210", "AL-7211"), Some(Cause::new("AL-7211")));

        let large = Error::from(anyhow::Error::new(alumia_rdp_graphics::framebuffer::TooLarge(
            "the server asked for a 99999x99999 desktop".to_owned(),
        )));
        assert_eq!(large.told("AL-7108", "AL-7106"), Some(Cause::new("AL-7107")));

        // What this client would send and cannot fit is its own failure.
        let own = Error::from(
            anyhow::Error::new(crate::rdp_client::proto::x224::TooLong(70_000)).context("sending the logon"),
        );
        assert_eq!(own.told("AL-7210", "AL-7211"), Some(Cause::new("AL-7105")));
        // And under a step named for the network it writes to.
        let sending = Cause::new("AL-7210")
            .of(anyhow::Error::new(crate::rdp_client::proto::x224::TooLong(70_000)).context("sending the logon"));
        assert_eq!(Error::from(sending).told("AL-7210", "AL-7211"), Some(Cause::new("AL-7105")));

        let named = Error::from(Cause::new("AL-7204").of(anyhow::anyhow!("the logon attempt was refused")));
        assert_eq!(named.told("AL-7210", "AL-7211"), Some(Cause::new("AL-7204")));
    }
}
