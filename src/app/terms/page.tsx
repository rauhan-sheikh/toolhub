import type { Metadata } from "next";
import { LegalPage } from "@/components/LegalPage";

export const metadata: Metadata = {
  title: "Terms of Service",
  description: "Terms for using Rauhan's Toolhub.",
  robots: { index: true, follow: false },
};

export default function TermsPage() {
  return (
    <LegalPage title="Terms of Service" updated="17 September 2026">
      <h2>What this is</h2>
      <p>
        Rauhan&rsquo;s Toolhub is a personal project operated by Rauhan Sheikh
        for his own use. It is provided free of charge to the small set of
        accounts on its allowlist. It is not a commercial service.
      </p>

      <h2>Access</h2>
      <p>
        Sign-in is limited to explicitly allowlisted Google accounts. Access may
        be changed or withdrawn at any time, without notice. Do not attempt to
        access the service with an account that has not been granted access.
      </p>

      <h2>No warranty</h2>
      <p>
        The service is provided <strong>&ldquo;as is&rdquo;</strong>, without
        warranty of any kind. There is no uptime guarantee, no backup guarantee,
        and no commitment to preserve any data or downloaded file. It runs on a
        single small server and may be offline, reset, or discontinued at any
        time.
      </p>

      <h2>Acceptable use</h2>
      <p>
        You are responsible for what you do with the tools, including respecting
        the terms of service and copyright of any site you download from. The
        downloader is a front end for{" "}
        <a href="https://github.com/yt-dlp/yt-dlp" target="_blank" rel="noreferrer">
          yt-dlp
        </a>
        ; it grants no rights over the content it retrieves. Do not use it to
        infringe copyright.
      </p>

      <h2>Liability</h2>
      <p>
        To the extent permitted by law, the operator accepts no liability for
        any loss or damage arising from use of this service, including lost
        data or unavailability.
      </p>

      <h2>Changes</h2>
      <p>
        These terms may change at any time. Continued use after a change
        constitutes acceptance of it.
      </p>

      <h2>Contact</h2>
      <p>
        <a href="mailto:rauhan1998@gmail.com">rauhan1998@gmail.com</a>
      </p>
    </LegalPage>
  );
}
