// What the page says and in which language: the language a browser's own list
// asks for, a choice made here over it, and how a text's holes are filled.
import assert from "node:assert/strict";
import { test } from "node:test";
import errors from "./design/errors.json" with { type: "json" };
import enUS from "./words/en-US.json" with { type: "json" };
import ptBR from "./words/pt-BR.json" with { type: "json" };
import { chooseLanguage, LANGUAGES, say } from "./words.ts";

test("a choice made here is the language, whatever the browser asks for", () => {
  assert.equal(chooseLanguage("pt-BR", ["en-US"]), "pt-BR");
  assert.equal(chooseLanguage("en-US", ["pt-BR"]), "en-US");
});

test("with no choice, the first of the browser's languages this page has", () => {
  assert.equal(chooseLanguage(null, ["pt-BR", "en-US"]), "pt-BR");
  assert.equal(chooseLanguage(null, ["en-GB", "pt-BR"]), "en-US");
  // Portuguese of any country is pt-BR, and English of any is en-US.
  assert.equal(chooseLanguage(null, ["pt-PT"]), "pt-BR");
  assert.equal(chooseLanguage(null, ["PT"]), "pt-BR");
  assert.equal(chooseLanguage(null, ["en"]), "en-US");
  // One this page has not is passed over for the next.
  assert.equal(chooseLanguage(null, ["es-ES", "fr", "pt-BR"]), "pt-BR");
});

test("a browser that asks for neither language is spoken to in English", () => {
  assert.equal(chooseLanguage(null, ["es-ES", "de"]), "en-US");
  assert.equal(chooseLanguage(null, []), "en-US");
  // And something this page never wrote in its storage is no choice.
  assert.equal(chooseLanguage("xx", ["pt-BR"]), "pt-BR");
  assert.equal(chooseLanguage("", ["pt-BR"]), "pt-BR");
});

test("a word is said in the language asked for", () => {
  assert.equal(say("pt-BR", "signin.submit"), "Entrar");
  assert.equal(say("en-US", "signin.submit"), "Sign in");
});

test("a catalogue message is said by its code, with its holes filled", () => {
  assert.equal(
    say("pt-BR", "AL-1202", { status: 503 }),
    "O servidor recusou a entrada (resposta 503). Tente de novo; se continuar, veja o registro do servidor.",
  );
  assert.equal(
    say("en-US", "AL-1201"),
    "Wrong username or password. Check them and try again.",
  );
});

test("a hole nothing fills is left out, with the space it leaves closed", () => {
  // A cause's hole with nothing given for it: the sentence closes over it.
  assert.equal(
    say("en-US", "AL-1202"),
    "The server refused the sign-in (answer ). Try again; if it goes on, look at the server's log.",
  );
  assert.equal(
    say("en-US", "AL-7506"),
    "The server has no computer named . Reload the list.",
  );
});

test("no message has a place for somebody else's words", () => {
  // A general code says its sentence whole. The original text of a cause the
  // catalogue does not know is whoever failed's own, in their language, and is
  // shown apart from the sentence: given as a fill, it goes nowhere.
  assert.equal(say("en-US", "AL-1200"), "Could not sign in.");
  assert.equal(
    say("en-US", "AL-2000"),
    "The session did not open. Open it again when you want.",
  );
  assert.equal(
    say("en-US", "AL-1200", { detail: "boom" }),
    "Could not sign in.",
  );
  assert.equal(
    say("pt-BR", "AL-7700", { detail: "the VNC server closed the connection" }),
    "A sessão com o computador remoto terminou. Abra de novo.",
  );
  for (const code of Object.keys(errors) as (keyof typeof errors)[]) {
    for (const language of LANGUAGES) {
      assert.doesNotMatch(
        errors[code].text[language],
        /\{detail\}/,
        `${code} in ${language}`,
      );
    }
  }
});

test("both languages have every word, and none is empty", () => {
  assert.deepEqual(Object.keys(ptBR), Object.keys(enUS));
  for (const language of LANGUAGES) {
    for (const key of Object.keys(ptBR) as (keyof typeof ptBR)[]) {
      assert.notEqual(say(language, key), "", `${key} in ${language}`);
    }
    for (const code of Object.keys(errors) as (keyof typeof errors)[]) {
      assert.notEqual(say(language, code), "", `${code} in ${language}`);
    }
  }
});
