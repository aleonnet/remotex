import { type FormEvent, useState } from "react";
import { AppVersion } from "./AppVersion.tsx";
import { Frame } from "./Frame.tsx";
import { Glyph } from "./Glyph.tsx";
import { gatewayFetch } from "./gateway.ts";
import { Message } from "./Message.tsx";
import { usePreferences } from "./preferences.tsx";
import { refusal, type SigninFailure, unanswered } from "./signin.ts";

// The web-login gate: one user, POST /api/auth/login sets the session cookie.
// Shown while the mount-time auth check runs and whenever the server answers 401.
//
// The form is an ordinary one, with its fields named and `autocomplete` on each,
// which is what lets a browser's password manager fill it. For the manager to
// offer to save what was typed, the page hands it over once the gateway has taken
// it (`offerToSave`): a form sent by `fetch` that only leaves the page is not a
// submission a browser recognises. The page itself keeps neither field.
//
// "Keep me signed in" is the login's lifetime and nothing about the password: a
// kept login lasts thirty days from now and outlives the browser and a restart of
// the gateway, where any other ends with either (src/auth.rs).

declare global {
  interface Window {
    /** The Credential Management API's password half: Chrome and Edge alone have it. */
    PasswordCredential?: new (data: {
      id: string;
      password: string;
    }) => Credential;
  }
}

/**
 * Hand what was typed to the browser's password manager, where the browser has
 * the means to be handed it. The browser then asks the person whether to save
 * it, and fills the form with it the next time; the page keeps nothing. Called
 * only for a sign-in the gateway took: a wrong password saved is a wrong password
 * offered back.
 *
 * https://web.dev/articles/security-credential-management-save-forms
 */
function offerToSave(username: string, password: string): void {
  const Password = window.PasswordCredential;
  if (!Password) {
    return;
  }
  try {
    // Not waited for: the answer is the person's, to the browser, and the
    // sign-in went through whatever it is.
    navigator.credentials
      .store(new Password({ id: username, password }))
      .catch(() => {});
  } catch {
    // A browser that will not take the credential saves nothing, and that is all.
  }
}

export default function Login({
  checking,
  branding,
  onLogin,
}: {
  /** True while the mount-time /api/auth/status probe is still in flight. */
  checking: boolean;
  /** Deployment display name shown as the form heading. */
  branding: string;
  onLogin: () => void;
}) {
  const { t, message } = usePreferences();
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [keep, setKeep] = useState(false);
  const [failure, setFailure] = useState<SigninFailure | null>(null);
  const [sending, setSending] = useState(false);
  // Whether the password is shown as typed. `said` is what a screen reader is
  // told about it, and only once the eye has been used: the field's own type
  // says nothing when it changes.
  const [shown, setShown] = useState(false);
  const [said, setSaid] = useState("");

  const show = (next: boolean) => {
    setShown(next);
    setSaid(t(next ? "signin.shown" : "signin.hidden"));
  };

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    // A password left showing is hidden again as it is sent.
    if (shown) {
      show(false);
    }
    setSending(true);
    setFailure(null);
    try {
      const res = await gatewayFetch("/api/auth/login", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ username, password, keep }),
      });
      if (res.ok) {
        offerToSave(username, password);
        onLogin();
        return;
      }
      setFailure(refusal(res.status));
    } catch (thrown) {
      setFailure(unanswered(thrown));
    } finally {
      setSending(false);
    }
  };

  return (
    <Frame
      foot={
        <>
          <span>{t("signin.manager")}</span>
          <AppVersion className="al-push" />
        </>
      }
    >
      <div className="al-hero">
        {checking ? (
          <output className="al-dim">{message("AL-1100")}</output>
        ) : (
          <>
            <h1 className="al-name">{branding}</h1>
            <p>{t("signin.lead")}</p>
            <form
              className="al-form"
              onSubmit={(e) => void submit(e)}
              noValidate
            >
              {failure && (
                <Message
                  place="AL-1200"
                  cause={failure.cause}
                  fill={failure.fill}
                  detail={failure.detail}
                />
              )}
              <div className="al-field">
                <label htmlFor="al-user">{t("signin.user")}</label>
                <input
                  className="al-input"
                  id="al-user"
                  name="username"
                  type="text"
                  value={username}
                  onChange={(e) => setUsername(e.target.value)}
                  autoComplete="username"
                  autoCapitalize="none"
                  autoCorrect="off"
                  spellCheck={false}
                  readOnly={sending}
                />
              </div>
              <div className="al-field">
                <label htmlFor="al-pass">{t("signin.password")}</label>
                <div className="al-pass">
                  <input
                    className="al-input"
                    id="al-pass"
                    name="password"
                    type={shown ? "text" : "password"}
                    value={password}
                    onChange={(e) => setPassword(e.target.value)}
                    autoComplete="current-password"
                    autoCapitalize="none"
                    autoCorrect="off"
                    spellCheck={false}
                    readOnly={sending}
                  />
                  <button
                    type="button"
                    className="al-eye"
                    aria-controls="al-pass"
                    aria-pressed={shown}
                    aria-label={t(shown ? "signin.hide" : "signin.show")}
                    title={t(shown ? "signin.hide" : "signin.show")}
                    onClick={() => show(!shown)}
                  >
                    <Glyph name={shown ? "eye-off" : "eye"} />
                  </button>
                </div>
                <output className="al-sr">{said}</output>
              </div>
              <label className="al-check">
                <input
                  type="checkbox"
                  name="keep"
                  checked={keep}
                  onChange={(e) => setKeep(e.target.checked)}
                  disabled={sending}
                />
                <span>{t("signin.keep")}</span>
              </label>
              <div className="al-acts">
                <button
                  className="al-btn al-btn--primary"
                  type="submit"
                  disabled={sending}
                >
                  {t(sending ? "signin.sending" : "signin.submit")}
                </button>
              </div>
            </form>
          </>
        )}
      </div>
    </Frame>
  );
}
