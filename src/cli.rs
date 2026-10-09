//! The command line, as clap derives it, and as whoever runs it is told it.
//!
//! Every doc comment below is this binary's `--help` text as clap derives it, which
//! is why TOML table syntax and `<prefix>` placeholders sit in them unquoted:
//! backticks would be printed literally on somebody's terminal. rustdoc reads
//! `[server]` as a link and `<prefix>` as an HTML tag and complains about both, so
//! its two lints are off here rather than the help text being bent to suit a
//! renderer nobody reads it in.
//!
//! What a terminal shows is [`command`]'s: the same commands and arguments, each
//! with the terminal dictionary's text for it in the terminal's language
//! (docs/design/terminal-words.json, the keys under `cli.`), and a command line
//! clap refuses told by the catalogue ([`parse`]).
#![allow(rustdoc::broken_intra_doc_links, rustdoc::invalid_html_tags)]

use std::path::PathBuf;

use clap::error::{ContextKind, ContextValue, ErrorKind};
use clap::{CommandFactory as _, FromArgMatches as _, Parser, Subcommand};

use crate::cause::Cause;
use crate::words::{self, Language};

/// The optional cargo features this binary was built with, for `--help` and the log
/// of a starting gateway: `embedded-gateway` decides whether it accepts `tui`, and
/// `apple-hp-media-static` whether it links the Mac's HEVC decoder statically
/// instead of loading it, and nothing else about the binary says so. Not in
/// `--version`, which packaging compares to the release's.
pub const FEATURES: &[&str] = &[
    #[cfg(feature = "embedded-gateway")]
    "embedded-gateway",
    #[cfg(feature = "apple-hp-media-static")]
    "apple-hp-media-static",
];

/// [`FEATURES`] as a terminal and the log spell them.
pub fn features_line() -> String {
    if FEATURES.is_empty() { "none".to_owned() } else { FEATURES.join(", ") }
}

#[derive(Parser)]
#[command(
    name = "alumia",
    version,
    about = "Browser-based RDP client",
    after_help = format!("Features: {}", features_line())
)]
pub struct Cli {
    #[command(subcommand)]
    pub command: Commands,
}

#[derive(Subcommand)]
pub enum Commands {
    /// Start the web server. Every [[targets]] profile is served; the browser
    /// picks one after login (there is no --target selector).
    Serve {
        /// TOML config file (default: the installed global config; required
        /// when running from a checkout)
        #[arg(short, long)]
        config: Option<PathBuf>,

        /// Address to listen on — overrides [server].listen (default:
        /// 127.0.0.1:52380). Either host:port, bracketing an IPv6 literal
        /// ([::1]:52380), or unix:<path> for a socket a local reverse proxy
        /// connects to. A browser needs the host:port form
        #[arg(short, long, env = "ALUMIA_LISTEN")]
        listen: Option<String>,

        /// Serve as the gateway a Mac app hosts: the settings and everything else
        /// of it in the app's own folder, started over in this same process when
        /// the app changes them. Not for interactive use — the app's service runs it
        #[cfg(all(target_os = "macos", feature = "embedded-gateway"))]
        #[arg(long, hide = true, conflicts_with_all = ["config", "listen"])]
        app: bool,
    },

    /// Run the local multi-instance control plane. The TUI supervises one gateway
    /// process per instance and serves every instance through one loopback port at
    /// <instance>.alumia.localhost.
    #[cfg(feature = "embedded-gateway")]
    Tui {
        /// Loopback port shared by alumia.localhost and every instance
        /// subdomain (default: 52380, the same port `serve` listens on — they
        /// are two ways to serve, never two servers)
        #[arg(
            long,
            env = "ALUMIA_TUI_PORT",
            default_value_t = crate::config::DEFAULT_PORT,
            value_parser = clap::value_parser!(u16).range(1..),
        )]
        port: u16,

        /// Directory whose immediate subdirectories are alumia instances
        #[arg(long)]
        instances_dir: Option<PathBuf>,
    },

    /// Start one managed worker on its private endpoint — <instance-dir>/gateway.sock,
    /// or a named pipe on Windows — printing the endpoint and launch token on stdout
    /// for the TUI that started it.
    ///
    /// Not for interactive use. It serves the one client it was started by, reads
    /// only <instance-dir>/alumia.toml, and stops when its stdin closes — which
    /// is how it dies with its manager.
    #[cfg(feature = "embedded-gateway")]
    #[command(hide = true)]
    ServeEmbedded {
        /// The managed instance directory. Nothing outside it is read.
        #[arg(long)]
        instance_dir: PathBuf,
    },

    /// Check a config file and say what is wrong with it, without starting
    /// anything. Reads stdin unless --config names a file.
    ///
    /// An instance manager can use this before saving so its editor accepts
    /// exactly what the gateway accepts.
    CheckConfig {
        /// The file to check (default: read the config from stdin)
        #[arg(short, long)]
        config: Option<PathBuf>,
        /// Apply managed-instance rules instead of a served gateway's: no
        /// [server] block, and no targets configured yet is not an error
        #[cfg(feature = "embedded-gateway")]
        #[arg(long)]
        embedded: bool,
    },

    /// Generate a [server].site_passwd credential for the web login: prompts
    /// for a password and prints username:bcrypt_hash
    GenPasswd {
        /// Username for the web login (must not contain ':')
        username: String,
    },

    /// What the Mac app asks of the gateway it hosts. Each prints one line of
    /// JSON: its answer, or {"refused": …} with the cause.
    ///
    /// Not for interactive use: the app runs these, and reads what they print.
    #[cfg(all(target_os = "macos", feature = "embedded-gateway"))]
    #[command(hide = true)]
    App {
        /// The language a refusal is said in, pt-BR or en-US (default: the
        /// terminal's)
        #[arg(long)]
        language: Option<String>,

        #[command(subcommand)]
        asked: AppCommands,
    },
}

/// The Mac app's requests ([`crate::app::command`]).
#[cfg(all(target_os = "macos", feature = "embedded-gateway"))]
#[derive(Subcommand)]
pub enum AppCommands {
    /// Print the settings as the app shows them, with no password among them
    ConfigShow,
    /// Change the settings by the JSON on stdin, checked as the gateway checks
    /// them; a change it refuses leaves them as they were
    ConfigApply,
    /// Print what the hosted gateway is doing
    Status,
    /// End the open session from this Mac
    EndSession,
    /// Start the hosted gateway over with the settings as they are now
    Reload,
    /// Stop the hosted gateway: it serves nothing, and stands, until it is started
    Stop,
    /// Start the hosted gateway its owner stopped
    Start,
}

/// The command line as whoever runs it reads it, in the terminal's language.
pub fn command() -> clap::Command {
    spoken(Cli::command(), words::language())
}

/// `command` with the dictionary's texts in `language` over clap's own.
fn spoken(mut command: clap::Command, language: Language) -> clap::Command {
    // Built first: clap adds its help and version flags, and the `help` command, as
    // it builds, and the dictionary says those too.
    command.build();
    let features = if FEATURES.is_empty() {
        words::say_in(language, "cli.features.none", &[])
    } else {
        FEATURES.join(", ")
    };
    let features = words::say_in(language, "cli.features", &[("features", &features)]);
    under(dressed(command, "cli", language).after_help(features), language)
}

/// Each command under `command` dressed by its own name: the commands themselves,
/// and the copies of them clap keeps under `help`.
fn under(command: clap::Command, language: Language) -> clap::Command {
    command.mut_subcommands(|sub| {
        let key = format!("cli.{}", sub.get_name());
        under(dressed(sub, &key, language), language)
    })
}

/// `command` with the dictionary's texts under `key`: what it is, what each of its
/// arguments is and takes, and the words its help is laid out with. A command or
/// an argument the dictionary has no text for keeps clap's: a hidden command's is
/// not for a person to read.
fn dressed(command: clap::Command, key: &str, language: Language) -> clap::Command {
    // A text names the default port where it has one to name.
    let say = |key: &str| words::say_in(language, key, &[("port", &crate::config::DEFAULT_PORT)]);
    let text = |key: String| words::has(&key).then(|| say(&key));
    let command = match text(format!("{key}.about")) {
        // The list of commands shows the first paragraph, and `--help` all of it.
        Some(whole) => {
            let first = whole.split("\n\n").next().unwrap_or_default().to_owned();
            command.about(first).long_about(whole)
        }
        None => command,
    };
    let mut command = command
        .subcommand_help_heading(say("cli.heading.commands"))
        .subcommand_value_name(say("cli.value.command"))
        .mut_args(|arg| {
            let id = arg.get_id().as_str().to_owned();
            let heading = if arg.is_positional() { "cli.heading.arguments" } else { "cli.heading.options" };
            let arg = arg.help_heading(say(heading));
            let arg = match text(format!("{key}.{id}.value")) {
                Some(name) => arg.value_name(name),
                None => arg,
            };
            let said = match id.as_str() {
                "help" => Some(say("cli.flag.help")),
                "version" => Some(say("cli.flag.version")),
                _ => text(format!("{key}.{id}")),
            };
            match said {
                // The text says the default and the variable itself, in its
                // language: clap's own notes of them are English.
                Some(said) => arg
                    .help(said.clone())
                    .long_help(said)
                    .hide_default_value(true)
                    .hide_env(true)
                    .hide_possible_values(true),
                None => arg,
            }
        });
    // The usage line is clap's, with the two words it writes in English said by
    // the dictionary: its heading and where the options go.
    let usage = command.render_usage().to_string();
    let usage = usage.trim_start_matches("Usage: ").replace("[OPTIONS]", &say("cli.usage.options"));
    command.override_usage(usage).help_template(format!(
        "{{about-with-newline}}\n{}: {{usage}}\n\n{{all-args}}{{after-help}}",
        say("cli.heading.usage")
    ))
}

/// The command line parsed, as `Cli::parse` parses it, with a refusal told in the
/// terminal's language and by the catalogue.
pub fn parse() -> Cli {
    let matches = command().try_get_matches().unwrap_or_else(|error| refuse(&error));
    Cli::from_arg_matches(&matches).unwrap_or_else(|error| refuse(&error))
}

/// End the process as clap would, saying why as [`words::tell`] says an error.
fn refuse(error: &clap::Error) -> ! {
    let Some(cause) = refusal(error) else {
        // Help and the version are answers, printed as clap prints them.
        error.exit()
    };
    // clap's own sentence goes under the catalogue's, without the usage and the
    // hint clap adds after it: the catalogue's sentence says where to look.
    let rendered = error.render().to_string();
    let own = rendered.split("\n\n").next().unwrap_or_default().trim_start_matches("error: ").trim_end();
    let told = cause.of(anyhow::Error::msg(own.to_owned()));
    eprintln!("{}", words::tell(&told, "AL-9700"));
    std::process::exit(error.exit_code())
}

/// Why clap refused a command line, as the catalogue says it: the kind of refusal,
/// and the argument or the value clap names. `None` for help and the version,
/// which are answers and not refusals.
fn refusal(error: &clap::Error) -> Option<Cause> {
    let named = |kind: ContextKind| match error.get(kind) {
        Some(ContextValue::String(value)) => value.clone(),
        Some(ContextValue::Strings(values)) => values.join(", "),
        Some(other) => other.to_string(),
        None => String::new(),
    };
    let argument = named(ContextKind::InvalidArg);
    let value = named(ContextKind::InvalidValue);
    let other = named(ContextKind::PriorArg);
    Some(match error.kind() {
        ErrorKind::DisplayHelp
        | ErrorKind::DisplayHelpOnMissingArgumentOrSubcommand
        | ErrorKind::DisplayVersion => return None,
        // clap's word for an option given with nothing after it.
        ErrorKind::InvalidValue if value.is_empty() => Cause::new("AL-9712").with("argument", argument),
        ErrorKind::InvalidValue => Cause::new("AL-9701").with("value", value).with("argument", argument),
        ErrorKind::UnknownArgument => Cause::new("AL-9702").with("argument", argument),
        ErrorKind::InvalidSubcommand => {
            Cause::new("AL-9703").with("command", named(ContextKind::InvalidSubcommand))
        }
        ErrorKind::NoEquals => Cause::new("AL-9704").with("argument", argument),
        ErrorKind::ValueValidation => Cause::new("AL-9705").with("value", value).with("argument", argument),
        ErrorKind::TooManyValues => Cause::new("AL-9706").with("argument", argument),
        ErrorKind::TooFewValues => Cause::new("AL-9707").with("argument", argument),
        ErrorKind::WrongNumberOfValues => Cause::new("AL-9708").with("argument", argument),
        // And its word for an argument given twice: it conflicts with itself.
        ErrorKind::ArgumentConflict if other.is_empty() || other == argument => {
            Cause::new("AL-9713").with("argument", argument)
        }
        ErrorKind::ArgumentConflict => Cause::new("AL-9709").with("argument", argument).with("other", other),
        ErrorKind::MissingRequiredArgument => Cause::new("AL-9710").with("argument", argument),
        ErrorKind::MissingSubcommand => Cause::new("AL-9711"),
        // Arguments that are not text, and clap's own failures to write.
        _ => Cause::new("AL-9700"),
    })
}

#[cfg(test)]
mod tests {
    use std::collections::{BTreeSet, HashSet};

    use clap::error::ErrorKind;
    use clap::{Arg, ArgAction, Command, CommandFactory, Parser};

    use super::{features_line, refusal, spoken, Cli, Commands, FEATURES};
    use crate::words::{self, Language};

    const LANGUAGES: [Language; 2] = [Language::Portuguese, Language::English];

    /// What the real command line answers `argv` with: help, or a refusal.
    fn answered(language: Language, argv: &[&str]) -> clap::Error {
        spoken(Cli::command(), language)
            .try_get_matches_from(argv)
            .expect_err("a command line that is answered and not run")
    }

    /// The dictionary's text as the help carries it: with the default port, and
    /// the features this binary has, where it names them.
    fn say(language: Language, key: &str) -> String {
        let features =
            if FEATURES.is_empty() { words::say_in(language, "cli.features.none", &[]) } else { features_line() };
        words::say_in(language, key, &[("port", &crate::config::DEFAULT_PORT), ("features", &features)])
    }

    /// Every command and argument a person can ask help of is said by the
    /// dictionary, in each language, and the dictionary has no text for one there
    /// is not; and what clap prints has none of the English it writes by itself.
    #[test]
    fn help_is_said_in_both_languages() {
        // What the commands and arguments there are ask the dictionary for.
        let mut derived = Cli::command();
        derived.build();
        let mut asked: BTreeSet<String> = [
            "cli.about",
            "cli.features",
            "cli.features.none",
            "cli.heading.usage",
            "cli.heading.commands",
            "cli.heading.arguments",
            "cli.heading.options",
            "cli.usage.options",
            "cli.value.command",
            "cli.flag.help",
            "cli.flag.version",
        ]
        .map(str::to_owned)
        .into();
        let mut commands = Vec::new();
        for sub in derived.get_subcommands().filter(|sub| !sub.is_hide_set()) {
            let name = sub.get_name();
            commands.push(name.to_owned());
            asked.insert(format!("cli.{name}.about"));
            // A hidden argument, like a hidden command, is not a person's to read.
            for arg in sub.get_arguments().filter(|arg| !arg.is_hide_set()) {
                let id = arg.get_id().as_str();
                if matches!(id, "help" | "version") {
                    continue;
                }
                asked.insert(format!("cli.{name}.{id}"));
                if arg.get_action().takes_values() {
                    asked.insert(format!("cli.{name}.{id}.value"));
                }
            }
        }
        assert!(commands.iter().any(|name| name == "serve") && commands.iter().any(|name| name == "help"));
        let written: BTreeSet<String> =
            words::keys().filter(|key| key.starts_with("cli.")).map(str::to_owned).collect();
        let unsaid: Vec<_> = asked.difference(&written).collect();
        assert!(unsaid.is_empty(), "the dictionary has no text for {unsaid:?}");
        // A build without the panel has fewer commands than the dictionary says.
        if cfg!(feature = "embedded-gateway") {
            let unasked: Vec<_> = written.difference(&asked).collect();
            assert!(unasked.is_empty(), "no command or argument asks for {unasked:?}");
        }
        for key in &written {
            assert_ne!(say(Language::Portuguese, key), say(Language::English, key), "{key}");
            for language in LANGUAGES {
                assert!(!say(language, key).contains('{'), "{key} has a place nothing fills");
            }
        }

        // clap's own English, which no help in Portuguese may carry, and its notes
        // of a default, a variable and the values, which no help carries.
        let notes = ["[default", "[env", "[possible values"];
        let english = ["Usage:", "Commands:", "Arguments:", "Options:", "[OPTIONS]", "<COMMAND>", "Print "];
        let clean = |language: Language, help: &str| {
            for note in notes {
                assert!(!help.contains(note), "{note} in:\n{help}");
            }
            if language == Language::Portuguese {
                for word in english {
                    assert!(!help.contains(word), "{word:?} in:\n{help}");
                }
            }
        };
        for language in LANGUAGES {
            let command = spoken(Cli::command(), language);
            assert_eq!(command.get_about().map(ToString::to_string), Some(say(language, "cli.about")));
            for sub in command.get_subcommands().filter(|sub| !sub.is_hide_set()) {
                let name = sub.get_name();
                assert_eq!(
                    sub.get_long_about().map(ToString::to_string),
                    Some(say(language, &format!("cli.{name}.about"))),
                    "{name}"
                );
                for arg in sub.get_arguments().filter(|arg| !arg.is_hide_set()) {
                    let key = match arg.get_id().as_str() {
                        "help" => "cli.flag.help".to_owned(),
                        "version" => "cli.flag.version".to_owned(),
                        id => format!("cli.{name}.{id}"),
                    };
                    let said = Some(say(language, &key));
                    assert_eq!(arg.get_help().map(ToString::to_string), said, "{key}");
                    assert_eq!(arg.get_long_help().map(ToString::to_string), said, "{key}");
                }
            }

            let whole = answered(language, &["alumia", "--help"]);
            assert_eq!(whole.kind(), ErrorKind::DisplayHelp);
            let whole = whole.render().to_string();
            clean(language, &whole);
            for heading in ["cli.heading.usage", "cli.heading.commands", "cli.heading.options"] {
                assert!(whole.contains(&format!("{}:", say(language, heading))), "{heading} in:\n{whole}");
            }
            assert!(
                whole.contains(&format!("alumia <{}>", say(language, "cli.value.command"))),
                "{whole}"
            );
            assert!(whole.trim_end().ends_with(&say(language, "cli.features")), "{whole}");
            for name in commands.iter().filter(|name| *name != "help") {
                assert!(whole.contains(&format!("  {name} ")), "{name} in:\n{whole}");
                let asked = answered(language, &["alumia", name, "--help"]);
                assert_eq!(asked.kind(), ErrorKind::DisplayHelp);
                let help = asked.render().to_string();
                clean(language, &help);
                assert!(
                    help.contains(&format!("{}: alumia {name}", say(language, "cli.heading.usage"))),
                    "{help}"
                );
                // `alumia help <command>` is the same answer.
                assert_eq!(answered(language, &["alumia", "help", name]).render().to_string(), help);
            }
        }
        let gen_passwd = answered(Language::Portuguese, &["alumia", "gen-passwd", "--help"]).render().to_string();
        assert!(gen_passwd.contains("Uso: alumia gen-passwd <USUÁRIO>"), "{gen_passwd}");
        assert!(gen_passwd.contains("Argumentos:\n  <USUÁRIO>"), "{gen_passwd}");
        let serve = answered(Language::Portuguese, &["alumia", "serve", "--help"]).render().to_string();
        assert!(serve.contains("Uso: alumia serve [OPÇÕES]"), "{serve}");
        assert!(serve.contains("-l, --listen <ENDEREÇO>"), "{serve}");
        assert!(serve.contains("ALUMIA_LISTEN"), "the text names the variable clap's note named:\n{serve}");
    }

    /// Each kind of refusal clap has is told by a sentence of its own, in each
    /// language, with what clap names of it; help and the version are answers.
    #[test]
    fn a_refused_argument_has_a_sentence_for_each_kind() {
        let alumia = |argv: &[&str]| answered(Language::English, argv);
        let one = |arg: Arg, argv: &[&str]| {
            Command::new("x").arg(arg.long("o")).try_get_matches_from(argv).unwrap_err()
        };
        let refused = [
            (ErrorKind::InvalidValue, "AL-9701", one(Arg::new("o").value_parser(["a", "b"]), &["x", "--o", "c"])),
            (ErrorKind::InvalidValue, "AL-9712", alumia(&["alumia", "serve", "--config"])),
            (ErrorKind::UnknownArgument, "AL-9702", alumia(&["alumia", "serve", "--target", "win"])),
            (ErrorKind::InvalidSubcommand, "AL-9703", alumia(&["alumia", "sevre"])),
            (ErrorKind::NoEquals, "AL-9704", one(Arg::new("o").require_equals(true), &["x", "--o", "a"])),
            (
                ErrorKind::ValueValidation,
                "AL-9705",
                one(Arg::new("o").value_parser(clap::value_parser!(u16)), &["x", "--o", "a"]),
            ),
            (ErrorKind::TooManyValues, "AL-9706", one(Arg::new("o").action(ArgAction::SetTrue), &["x", "--o=a"])),
            (ErrorKind::TooFewValues, "AL-9707", one(Arg::new("o").num_args(2..), &["x", "--o", "a"])),
            (ErrorKind::WrongNumberOfValues, "AL-9708", one(Arg::new("o").num_args(2), &["x", "--o", "a"])),
            (
                ErrorKind::ArgumentConflict,
                "AL-9709",
                Command::new("x")
                    .arg(Arg::new("a").long("a").action(ArgAction::SetTrue).conflicts_with("b"))
                    .arg(Arg::new("b").long("b").action(ArgAction::SetTrue))
                    .try_get_matches_from(["x", "--a", "--b"])
                    .unwrap_err(),
            ),
            (ErrorKind::ArgumentConflict, "AL-9713", alumia(&["alumia", "serve", "-c", "a", "-c", "b"])),
            (ErrorKind::MissingRequiredArgument, "AL-9710", alumia(&["alumia", "gen-passwd"])),
            (
                ErrorKind::MissingSubcommand,
                "AL-9711",
                Command::new("x")
                    .subcommand_required(true)
                    .subcommand(Command::new("a"))
                    .try_get_matches_from(["x"])
                    .unwrap_err(),
            ),
        ];
        for (kind, code, error) in &refused {
            assert_eq!(error.kind(), *kind, "{code}: {error}");
            let cause = refusal(error).expect("a refusal");
            assert_eq!(cause.code, *code, "{error}");
            assert!(cause.fill.values().all(|value| !value.is_empty()), "{code} names nothing: {:?}", cause.fill);
            let said = LANGUAGES.map(|language| words::message_in(language, &cause).expect("the catalogue has the code"));
            assert_ne!(said[0], said[1], "{code}");
            for sentence in &said {
                assert!(!sentence.contains('{'), "{code} has a place nothing fills: {sentence}");
            }
        }
        let kinds: HashSet<_> = refused.iter().map(|(kind, ..)| *kind).collect();
        assert_eq!(kinds.len(), 11, "the kinds of refusal clap has");
        let codes: HashSet<_> = refused.iter().map(|(_, code, _)| *code).collect();
        assert_eq!(codes.len(), refused.len(), "a sentence for each");

        // What clap names is what the sentence carries.
        let cause = refusal(&answered(Language::Portuguese, &["alumia", "serve", "--target", "win"])).unwrap();
        assert_eq!(
            words::message_in(Language::Portuguese, &cause).unwrap(),
            "--target não é um argumento deste comando. Rode o comando com --help para ver os que ele aceita."
        );

        for answer in [&["alumia", "--help"][..], &["alumia", "--version"], &["alumia", "serve", "-h"], &["alumia"]] {
            assert!(refusal(&alumia(answer)).is_none(), "{answer:?} is asked, not refused");
        }
        // A failure clap says nothing of the command line about has the general
        // sentence, as an error with no cause has.
        assert_eq!(refusal(&clap::Error::new(ErrorKind::Io)).unwrap().code, "AL-9700");
    }

    #[test]
    fn help_names_the_features_and_version_does_not() {
        let mut command = spoken(Cli::command(), Language::English);
        let help = command.render_help().to_string();
        assert!(help.trim_end().ends_with(&format!("Features: {}", features_line())), "{help}");
        assert_eq!(FEATURES.contains(&"embedded-gateway"), cfg!(feature = "embedded-gateway"));
        assert_eq!(FEATURES.contains(&"apple-hp-media-static"), cfg!(feature = "apple-hp-media-static"));
        assert_eq!(
            command.render_version(),
            format!("alumia {}\n", env!("CARGO_PKG_VERSION"))
        );
    }

    #[test]
    fn serve_parses_config() {
        let cli = Cli::try_parse_from(["alumia", "serve", "-c", "/etc/x.toml"]).unwrap();
        let Commands::Serve { config, .. } = cli.command else {
            panic!("expected the serve subcommand");
        };
        assert_eq!(config.as_deref(), Some(std::path::Path::new("/etc/x.toml")));
    }

    #[test]
    fn serve_config_is_optional() {
        let cli = Cli::try_parse_from(["alumia", "serve"]).unwrap();
        let Commands::Serve { config, listen, .. } = cli.command else {
            panic!("expected the serve subcommand");
        };
        assert!(config.is_none());
        assert!(listen.is_none(), "unset means the config file decides");
    }

    /// The listen address is one value on the command line as it is one key in
    /// the file: there is no `--host`/`--port` pair to disagree with each other.
    #[test]
    fn serve_takes_one_listen_address() {
        for argv in [
            vec!["alumia", "serve", "--listen", "0.0.0.0:8080"],
            vec!["alumia", "serve", "-l", "0.0.0.0:8080"],
        ] {
            let cli = Cli::try_parse_from(&argv).unwrap();
            let Commands::Serve { listen, .. } = cli.command else {
                panic!("expected the serve subcommand");
            };
            assert_eq!(listen.as_deref(), Some("0.0.0.0:8080"));
        }
        for gone in ["--host", "--port"] {
            assert!(
                Cli::try_parse_from(["alumia", "serve", gone, "x"]).is_err(),
                "{gone} is half an address: the listen address is one option"
            );
        }
    }

    #[test]
    fn serve_rejects_the_removed_target_selector() {
        // Target selection is browser-side now: --target is gone.
        assert!(Cli::try_parse_from(["alumia", "serve", "--target", "win"]).is_err());
    }

    /// The managed worker takes the one path only its supervisor knows — the
    /// instance it owns — and nothing else: the endpoint and secret are the
    /// gateway's to decide, and the SPA is in the binary.
    #[cfg(feature = "embedded-gateway")]
    #[test]
    fn serve_embedded_takes_the_one_path_the_launcher_knows() {
        let cli = Cli::try_parse_from(["alumia", "serve-embedded", "--instance-dir", "/i"])
            .unwrap();
        let Commands::ServeEmbedded { instance_dir } = cli.command else {
            panic!("expected the serve-embedded subcommand");
        };
        assert_eq!(instance_dir, std::path::Path::new("/i"));

        assert!(
            Cli::try_parse_from(["alumia", "serve-embedded"]).is_err(),
            "the instance directory has no default: the launcher names it"
        );
        for rejected in ["--port", "--gateway", "--token", "--web-root"] {
            assert!(
                Cli::try_parse_from([
                    "alumia",
                    "serve-embedded",
                    "--instance-dir",
                    "/i",
                    rejected,
                    "x"
                ])
                .is_err(),
                "{rejected} is not the launcher's to pass"
            );
        }
    }

    /// The shared port is `serve`'s: a default in the binary, an override on the
    /// command line or in the environment, and never a port the kernel picked —
    /// a browser is told this number.
    #[cfg(feature = "embedded-gateway")]
    #[test]
    fn the_tui_port_defaults_and_refuses_an_ephemeral_one() {
        let cli = Cli::try_parse_from(["alumia", "tui"]).expect("the port has a default");
        let Commands::Tui { port, .. } = cli.command else {
            panic!("expected the tui subcommand");
        };
        assert_eq!(port, crate::config::DEFAULT_PORT);
        assert!(
            Cli::try_parse_from(["alumia", "tui", "--port", "0"]).is_err(),
            "0 is the kernel's choice, and nobody can be told it"
        );
    }

    #[cfg(feature = "embedded-gateway")]
    #[test]
    fn tui_takes_its_port_and_instances_dir() {
        let cli = Cli::try_parse_from([
            "alumia",
            "tui",
            "--port",
            "52380",
            "--instances-dir",
            "/instances",
        ])
        .unwrap();
        let Commands::Tui {
            port,
            instances_dir,
        } = cli.command
        else {
            panic!("expected the tui subcommand");
        };
        assert_eq!(port, 52380);
        assert_eq!(instances_dir.as_deref(), Some(std::path::Path::new("/instances")));
        assert!(
            Cli::try_parse_from(["alumia", "tui", "--web-root", "/web"]).is_err(),
            "the SPA is in the binary; there is no web root to name"
        );
    }

    #[cfg(feature = "embedded-gateway")]
    #[test]
    fn check_config_reads_stdin_by_default_and_takes_an_audience() {
        let cli = Cli::try_parse_from(["alumia", "check-config"]).unwrap();
        let Commands::CheckConfig { config, embedded } = cli.command else {
            panic!("expected the check-config subcommand");
        };
        assert!(config.is_none(), "stdin, which is what an unsaved editor has");
        assert!(!embedded, "a served gateway's rules unless asked otherwise");

        let cli =
            Cli::try_parse_from(["alumia", "check-config", "--embedded", "-c", "/i/alumia.toml"])
                .unwrap();
        let Commands::CheckConfig { config, embedded } = cli.command else {
            panic!("expected the check-config subcommand");
        };
        assert_eq!(config.as_deref(), Some(std::path::Path::new("/i/alumia.toml")));
        assert!(embedded);
    }

    #[cfg(not(feature = "embedded-gateway"))]
    #[test]
    fn embedded_cli_is_absent_without_the_feature() {
        assert!(Cli::try_parse_from(["alumia", "serve-embedded"]).is_err());
        assert!(Cli::try_parse_from(["alumia", "tui", "--port", "52380"]).is_err());
        assert!(
            Cli::try_parse_from(["alumia", "check-config", "--embedded"]).is_err()
        );

        let cli = Cli::try_parse_from(["alumia", "check-config"]).unwrap();
        let Commands::CheckConfig { config } = cli.command else {
            panic!("expected the check-config subcommand");
        };
        assert!(config.is_none());
    }

    /// The Mac app's side of the command line is there for the app's service and
    /// the app to use, and in nobody's help.
    #[cfg(all(target_os = "macos", feature = "embedded-gateway"))]
    #[test]
    fn the_apps_commands_parse_and_are_in_no_help() {
        use super::AppCommands;

        let cli = Cli::try_parse_from(["alumia", "serve", "--app"]).unwrap();
        assert!(matches!(cli.command, Commands::Serve { app: true, config: None, .. }));
        let cli = Cli::try_parse_from(["alumia", "serve"]).unwrap();
        assert!(matches!(cli.command, Commands::Serve { app: false, .. }));
        assert!(
            Cli::try_parse_from(["alumia", "serve", "--app", "--config", "/etc/x.toml"]).is_err(),
            "the hosted gateway's settings are the app's folder's, and nobody names another"
        );

        let cli = Cli::try_parse_from(["alumia", "app", "--language", "pt-BR", "status"]).unwrap();
        let Commands::App { language, asked } = cli.command else {
            panic!("expected the app subcommand");
        };
        assert_eq!(language.as_deref(), Some("pt-BR"));
        assert!(matches!(asked, AppCommands::Status));
        for asked in ["config-show", "config-apply", "end-session", "reload", "stop", "start"] {
            assert!(Cli::try_parse_from(["alumia", "app", asked]).is_ok(), "{asked}");
        }
        assert!(Cli::try_parse_from(["alumia", "app"]).is_err(), "it asks something or nothing");

        for language in LANGUAGES {
            let whole = answered(language, &["alumia", "--help"]).render().to_string();
            assert!(!whole.contains("  app "), "{whole}");
            let serve = answered(language, &["alumia", "serve", "--help"]).render().to_string();
            assert!(!serve.contains("--app"), "{serve}");
        }
    }

    #[test]
    fn gen_passwd_takes_a_username() {
        let cli = Cli::try_parse_from(["alumia", "gen-passwd", "andrew"]).unwrap();
        let Commands::GenPasswd { username } = cli.command else {
            panic!("expected the gen-passwd subcommand");
        };
        assert_eq!(username, "andrew");

        // The username is required.
        assert!(Cli::try_parse_from(["alumia", "gen-passwd"]).is_err());
    }

}
