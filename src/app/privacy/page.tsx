import type { Metadata } from "next";
import { LegalPage } from "@/components/LegalPage";

export const metadata: Metadata = {
  title: "Privacy Policy",
  description: "How Rauhan's Toolhub handles your data.",
  robots: { index: true, follow: false },
};

export default function PrivacyPage() {
  return (
    <LegalPage title="Privacy Policy" updated="17 September 2026">
      <p>
        Rauhan&rsquo;s Toolhub is a personal, single-user set of tools operated
        by Rauhan Sheikh. Access is restricted to an allowlist of Google
        accounts; it is not a public service and does not accept general
        sign-ups.
      </p>

      <h2>What this app accesses</h2>
      <p>
        When you sign in with Google, the app requests three scopes and no
        others:
      </p>
      <ul>
        <li>
          <strong>openid</strong> and <strong>email</strong> &mdash; to confirm
          which account you are, and to check it against the allowlist.
        </li>
        <li>
          <strong>youtube.readonly</strong> &mdash; read-only access to your
          YouTube playlists, so the app can total their runtime. This is what
          makes private playlists work; a public API key cannot see them.
        </li>
      </ul>
      <p>
        The access is read-only. The app cannot modify, create or delete
        anything in your YouTube account.
      </p>

      <h2>What is stored</h2>
      <p>
        <strong>There is no database.</strong> After sign-in, your email address
        and Google refresh token are encrypted (AES-256-GCM) and placed in an
        httpOnly cookie in your own browser. The server keeps no copy.
      </p>
      <p>
        Playlist data is fetched from YouTube when you ask for it, used to
        compute the result on screen, and then discarded. It is never written to
        disk.
      </p>
      <p>
        Files you download with the downloader tool are saved to the server&rsquo;s
        own disk, which only the operator can reach.
      </p>

      <h2>What is not done</h2>
      <ul>
        <li>No analytics, tracking pixels, or advertising.</li>
        <li>No sharing, selling or transfer of data to third parties.</li>
        <li>No profiling, and no automated decisions about you.</li>
        <li>No email is sent to you by this app.</li>
      </ul>

      <h2>Logs</h2>
      <p>
        The web server records ordinary access logs &mdash; timestamp, IP
        address, requested path, response status &mdash; as any web server does.
        These are used for debugging and are not linked to your Google account.
      </p>

      <h2>Removing access</h2>
      <p>
        Signing out clears the cookie, which is the only place your token is
        held. To revoke the app&rsquo;s access to your Google account entirely,
        visit{" "}
        <a
          href="https://myaccount.google.com/permissions"
          target="_blank"
          rel="noreferrer"
        >
          myaccount.google.com/permissions
        </a>{" "}
        and remove it. That takes effect immediately and independently of this
        app.
      </p>

      <h2>Contact</h2>
      <p>
        Questions about this policy:{" "}
        <a href="mailto:rauhan1998@gmail.com">rauhan1998@gmail.com</a>.
      </p>
    </LegalPage>
  );
}
