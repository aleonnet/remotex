//! What a command says to the person at its terminal, in that person's language.
//!
//! The gateway's sentences are English, written where they happen
//! ([`crate::cause`]): the log is in them, and so is every test that reads one. A
//! person at a terminal is told why in their own language first: the catalogue's
//! sentence for the cause the error knows (docs/design/errors.json), or the
//! general one of the command that failed, with its code, and the gateway's own
//! sentence under it, as the page keeps it under Details. What is not an error,
//! the panel's labels and the commands' help, is a text of the terminal's
//! dictionary (docs/design/terminal-words.json).
//!
//! The language is the terminal's: `LC_ALL`, then `LC_MESSAGES`, then `LANG`, the
//! order POSIX gives them. Windows sets none of the three, so there the user's own
//! language comes after them. Portuguese where the name says so, English anywhere
//! else.

use std::collections::{BTreeMap, HashMap};
use std::sync::LazyLock;

use crate::cause::{self, Cause};

/// A language the catalogue and the dictionary have every text in.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum Language {
    Portuguese,
    English,
}

impl Language {
    /// The language a locale's name asks for: `pt_BR.UTF-8`, `pt-BR` and `pt` are
    /// Portuguese; `C`, `POSIX` and every other language are English.
    pub fn named(name: &str) -> Self {
        let language = name.split(['_', '-', '.', '@']).next().unwrap_or_default();
        if language.eq_ignore_ascii_case("pt") { Self::Portuguese } else { Self::English }
    }

    /// The name the catalogue and the dictionary key their texts by.
    pub fn tag(self) -> &'static str {
        match self {
            Self::Portuguese => "pt-BR",
            Self::English => "en-US",
        }
    }
}

/// The language the three variables ask for, in POSIX's order, where one of them
/// is set. An empty one is not set.
fn of_environment(variable: impl Fn(&str) -> Option<String>) -> Option<Language> {
    ["LC_ALL", "LC_MESSAGES", "LANG"]
        .into_iter()
        .find_map(|name| variable(name).filter(|value| !value.is_empty()))
        .map(|value| Language::named(&value))
}

/// The language the system says its user reads, where the terminal's variables
/// say nothing. Asked only on Windows, which sets none of them.
#[cfg(all(windows, feature = "embedded-gateway"))]
fn of_system() -> Option<Language> {
    use windows_sys::Win32::Globalization::GetUserDefaultLocaleName;
    // `LOCALE_NAME_MAX_LENGTH`, the terminator included.
    let mut name = [0u16; 85];
    // SAFETY: the buffer is `name.len()` wide characters, and the call says how
    // many it wrote, the terminator among them, or zero.
    let written = unsafe { GetUserDefaultLocaleName(name.as_mut_ptr(), name.len() as i32) };
    let written = usize::try_from(written).ok().filter(|&written| written > 0)?;
    Some(Language::named(&String::from_utf16_lossy(&name[..written - 1])))
}

#[cfg(not(all(windows, feature = "embedded-gateway")))]
fn of_system() -> Option<Language> {
    None
}

/// The language of whoever runs a command: what the terminal's variables ask for,
/// then what the system says where they ask for nothing, then English.
fn chosen(variable: impl Fn(&str) -> Option<String>, system: impl FnOnce() -> Option<Language>) -> Language {
    of_environment(variable).or_else(system).unwrap_or(Language::English)
}

thread_local! {
    /// The language asked for by whoever this thread is answering, where that is not
    /// the terminal's: see [`speaking`].
    static ASKED: std::cell::Cell<Option<Language>> = const { std::cell::Cell::new(None) };
}

/// The language of whoever runs this command, decided once; or, inside
/// [`speaking`], the one asked for.
pub fn language() -> Language {
    static LANGUAGE: LazyLock<Language> = LazyLock::new(|| chosen(|name| std::env::var(name).ok(), of_system));
    ASKED.get().unwrap_or(*LANGUAGE)
}

/// Run `said` with every text of this thread in `language`, whatever the terminal's
/// is: for an answer to somebody who says which language they read, and for a test
/// of what each language says.
pub fn speaking<T>(language: Language, said: impl FnOnce() -> T) -> T {
    let before = ASKED.replace(Some(language));
    let told = said();
    ASKED.set(before);
    told
}

/// A text in each language, Portuguese first.
type Texts = [String; 2];

fn text_of(texts: &Texts, language: Language) -> &str {
    match language {
        Language::Portuguese => &texts[0],
        Language::English => &texts[1],
    }
}

fn texts_of(entry: &serde_json::Value) -> Option<Texts> {
    let text = |language: Language| entry.get(language.tag())?.as_str().map(str::to_owned);
    Some([text(Language::Portuguese)?, text(Language::English)?])
}

/// The catalogue's sentence for each code: a place's general one and each of its
/// causes.
static CATALOGUE: LazyLock<HashMap<String, Texts>> = LazyLock::new(|| {
    let catalogue: serde_json::Value = serde_json::from_str(include_str!("../docs/design/errors.json"))
        .expect("docs/design/errors.json is checked by tools/check-design.py");
    let mut sentences = HashMap::new();
    for place in catalogue["places"].as_array().into_iter().flatten() {
        let entries = std::iter::once(&place["general"]).chain(place["causes"].as_array().into_iter().flatten());
        for entry in entries {
            if let (Some(code), Some(texts)) = (entry["code"].as_str(), texts_of(&entry["text"])) {
                sentences.insert(code.to_owned(), texts);
            }
        }
    }
    sentences
});

/// The sentences the catalogue has for the Mac app in the place of a terminal's:
/// the same cause, said to somebody at a window, who has a pane and a field where
/// the terminal's sentence names a file's key or a command's option.
static CATALOGUE_APP: LazyLock<HashMap<String, Texts>> = LazyLock::new(|| {
    let catalogue: serde_json::Value = serde_json::from_str(include_str!("../docs/design/errors.json"))
        .expect("docs/design/errors.json is checked by tools/check-design.py");
    let mut sentences = HashMap::new();
    for place in catalogue["places"].as_array().into_iter().flatten() {
        let entries = std::iter::once(&place["general"]).chain(place["causes"].as_array().into_iter().flatten());
        for entry in entries {
            if let (Some(code), Some(texts)) = (entry["code"].as_str(), texts_of(&entry["app"])) {
                sentences.insert(code.to_owned(), texts);
            }
        }
    }
    sentences
});

/// The terminal's own texts, by key.
static DICTIONARY: LazyLock<HashMap<String, Texts>> = LazyLock::new(|| {
    let dictionary: serde_json::Value = serde_json::from_str(include_str!("../docs/design/terminal-words.json"))
        .expect("docs/design/terminal-words.json is checked by tools/check-design.py");
    dictionary["words"]
        .as_object()
        .into_iter()
        .flatten()
        .filter_map(|(key, entry)| Some((key.clone(), texts_of(entry)?)))
        .collect()
});

/// `text` with each `{hole}` it has filled from `fill`. A hole nothing fills stays
/// as it is written, which is how a text that asks for more than it was given
/// shows.
fn filled(text: &str, fill: &BTreeMap<&'static str, String>) -> String {
    let mut said = text.to_owned();
    for (hole, value) in fill {
        said = said.replace(&format!("{{{hole}}}"), value);
    }
    said
}

/// The catalogue's sentence for `cause` in `language`, where it has the code.
pub fn message_in(language: Language, cause: &Cause) -> Option<String> {
    CATALOGUE.get(cause.code).map(|texts| filled(text_of(texts, language), &cause.fill))
}

/// The dictionary's text for `key` in `language`, with `fill` in its holes. A key
/// the dictionary does not have is said as the key: tools/check-design.py fails on
/// one before anybody reads it.
pub fn say_in(language: Language, key: &str, fill: &[(&'static str, &dyn std::fmt::Display)]) -> String {
    let fill = fill.iter().map(|(hole, value)| (*hole, value.to_string())).collect();
    DICTIONARY.get(key).map_or_else(|| key.to_owned(), |texts| filled(text_of(texts, language), &fill))
}

/// Whether the dictionary has a text for `key`.
pub fn has(key: &str) -> bool {
    DICTIONARY.contains_key(key)
}

/// Every key the dictionary has, for a test that holds them to what asks for them.
#[cfg(test)]
pub(crate) fn keys() -> impl Iterator<Item = &'static str> {
    DICTIONARY.keys().map(String::as_str)
}

/// The dictionary's text for `key`, in the language of whoever runs this command.
pub fn say(key: &str, fill: &[(&'static str, &dyn std::fmt::Display)]) -> String {
    say_in(language(), key, fill)
}

/// What a person is told of `error` in `language`: the catalogue's sentence for
/// the cause the error knows, or for `general`, the code of the command that
/// failed, with the code to quote; and under it the error's own sentence, chain
/// and all, which is the line the log has.
pub fn tell_in(language: Language, error: &anyhow::Error, general: &'static str) -> String {
    let cause = cause::or_general(error, general);
    match message_in(language, &cause) {
        Some(sentence) => format!("{sentence} ({})\n  {error:#}", cause.code),
        None => format!("{error:#}"),
    }
}

/// The catalogue's sentence for `cause` in `language` as the Mac app is told it:
/// the one written for the app where the cause has one, and the terminal's own
/// where it has not.
fn message_to_app(language: Language, cause: &Cause) -> Option<String> {
    match CATALOGUE_APP.get(cause.code) {
        Some(texts) => Some(filled(text_of(texts, language), &cause.fill)),
        None => message_in(language, cause),
    }
}

/// What [`tell_in`] says, apart: for an answer that carries the code, the sentence
/// and the error's own words each in a field of its own.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct Told {
    /// The catalogue's code for the cause, or the general one.
    pub code: &'static str,
    /// The catalogue's sentence for it, in the language asked for.
    pub sentence: String,
    /// The error's own sentence, chain and all.
    pub own: String,
}

/// What the Mac app is told of `error` in `language`, apart: the gateway it hosts
/// answers it, and whoever reads the answer is at a window of the app and not at
/// a terminal ([`message_to_app`]). A code the catalogue lacks leaves the error's
/// own sentence as the one that is said.
pub fn told_to_app(language: Language, error: &anyhow::Error, general: &'static str) -> Told {
    let cause = cause::or_general(error, general);
    let own = format!("{error:#}");
    let sentence = message_to_app(language, &cause).unwrap_or_else(|| own.clone());
    Told { code: cause.code, sentence, own }
}

/// What a person is told of `error`, in the language of whoever runs this command.
pub fn tell(error: &anyhow::Error, general: &'static str) -> String {
    tell_in(language(), error, general)
}

/// The same on one line, for a place that has one: the panel's status line.
pub fn tell_line(error: &anyhow::Error, general: &'static str) -> String {
    let cause = cause::or_general(error, general);
    match message_in(language(), &cause) {
        Some(sentence) => format!("{sentence} ({}) {error:#}", cause.code),
        None => format!("{error:#}"),
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn environment<'a>(set: &'a [(&'a str, &'a str)]) -> impl Fn(&str) -> Option<String> + 'a {
        move |name| set.iter().find(|(variable, _)| *variable == name).map(|(_, value)| (*value).to_owned())
    }

    /// POSIX's order: `LC_ALL` over `LC_MESSAGES` over `LANG`, an empty one not
    /// counting, and none of them set leaving the question to the system.
    #[test]
    fn the_terminals_variables_are_read_in_posix_order() {
        let of = |set: &[(&str, &str)]| of_environment(environment(set));
        assert_eq!(of(&[("LANG", "pt_BR.UTF-8")]), Some(Language::Portuguese));
        assert_eq!(of(&[("LANG", "pt_BR.UTF-8"), ("LC_MESSAGES", "en_US.UTF-8")]), Some(Language::English));
        assert_eq!(
            of(&[("LANG", "en_US.UTF-8"), ("LC_MESSAGES", "en_US.UTF-8"), ("LC_ALL", "pt_PT")]),
            Some(Language::Portuguese),
            "LC_ALL wins"
        );
        assert_eq!(of(&[("LC_ALL", ""), ("LANG", "pt_BR")]), Some(Language::Portuguese), "an empty one is not set");
        assert_eq!(of(&[("LANG", "C")]), Some(Language::English));
        assert_eq!(of(&[("LANG", "POSIX")]), Some(Language::English));
        assert_eq!(of(&[("LANG", "fr_FR.UTF-8")]), Some(Language::English), "a language there are no texts in");
        assert_eq!(of(&[]), None);
    }

    /// The name a system gives its user's language, as Windows spells it.
    #[test]
    fn a_system_language_name_is_read_as_a_language() {
        assert_eq!(Language::named("pt-BR"), Language::Portuguese);
        assert_eq!(Language::named("pt-PT"), Language::Portuguese);
        assert_eq!(Language::named("pt"), Language::Portuguese);
        assert_eq!(Language::named("en-US"), Language::English);
        assert_eq!(Language::named(""), Language::English);
        assert_eq!(Language::named("ptx-BR"), Language::English, "not Portuguese by its first letters");
        // And it comes after the terminal's three: where one of them is set, the
        // system is not asked.
        let portuguese = || Some(Language::named("pt-BR"));
        assert_eq!(chosen(environment(&[("LANG", "en_US.UTF-8")]), portuguese), Language::English);
        assert_eq!(
            chosen(environment(&[("LANG", "C")]), || -> Option<Language> { panic!("the system is asked though LANG is set") }),
            Language::English
        );
        // With none of them set the system's word is the language, and with no
        // word from it either, English.
        assert_eq!(chosen(environment(&[]), portuguese), Language::Portuguese);
        assert_eq!(chosen(environment(&[("LC_ALL", "")]), portuguese), Language::Portuguese);
        assert_eq!(chosen(environment(&[]), || None), Language::English);
    }

    /// An error is told by its cause's sentence in the person's language, with the
    /// code, and its own sentence is kept whole under it.
    #[test]
    fn an_error_is_told_by_its_cause_with_its_own_sentence_under_it() {
        let error = Cause::new("AL-7004")
            .with("host", "mac-mini.lan")
            .with("seconds", 20)
            .of(anyhow::anyhow!("timed out"))
            .context("VNC connect failed");
        assert_eq!(
            tell_in(Language::Portuguese, &error, "AL-7000"),
            "mac-mini.lan não respondeu em 20 s. Confira se o computador está ligado e na rede. (AL-7004)\n  \
             VNC connect failed: timed out"
        );
        assert_eq!(
            tell_in(Language::English, &error, "AL-7000"),
            "mac-mini.lan did not answer within 20 s. Check that the computer is on and on the network. (AL-7004)\n  \
             VNC connect failed: timed out"
        );
    }

    /// An error that knows no cause is told by the general sentence of where it
    /// is shown; one whose code the catalogue lacks is told by its own sentence
    /// alone.
    #[test]
    fn an_error_with_no_cause_is_told_by_the_general_sentence() {
        let error = anyhow::anyhow!("no route to host");
        assert_eq!(
            tell_in(Language::Portuguese, &error, "AL-7700"),
            "A sessão com o computador remoto terminou. Abra de novo. (AL-7700)\n  no route to host"
        );
        assert_eq!(tell_in(Language::Portuguese, &error, "AL-0000"), "no route to host");
    }

    /// Every sentence of the catalogue is read: a code the file has and this does
    /// not would be told in English alone.
    #[test]
    fn the_whole_catalogue_is_carried() {
        let catalogue: serde_json::Value = serde_json::from_str(include_str!("../docs/design/errors.json")).unwrap();
        let codes: usize = catalogue["places"]
            .as_array()
            .unwrap()
            .iter()
            .map(|place| 1 + place["causes"].as_array().unwrap().len())
            .sum();
        assert_eq!(CATALOGUE.len(), codes);
        assert!(codes > 100, "{codes}");
    }
}
