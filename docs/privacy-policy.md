# Career Atlas privacy policy

Career Atlas is a Chrome extension that builds a graph of your career history
from your own LinkedIn profile. It runs entirely in your browser: your seed
data (your profile, the companies you worked at, the colleagues you trace,
and where they went next) is stored only in `chrome.storage.local`, on your
own machine. It is never sent to us or to any third party.

## Usage analytics

Career Atlas sends a small amount of anonymous usage telemetry to help us
notice when LinkedIn changes its page markup and breaks our parsers, and to
understand whether the core actions (seeding, expanding a company, tracing a
colleague) actually work. This is on by default and can be turned off at any
time from the toggle in the extension's title bar.

What is sent, per event:

- Which action happened (e.g. "seeded my graph", "expanded a company",
  "traced a colleague") and whether it succeeded or failed.
- On failure, a fixed error code (e.g. "logged out", "could not parse the
  page") — never the underlying error text, which can contain page content.
- Counts, bucketed into ranges (e.g. "3-5 people found") rather than exact
  numbers, and durations.
- A random identifier generated on your device the first time you use the
  extension, so we can tell repeat usage from a new install. It is not tied
  to your name, your LinkedIn account, or any other identity.

What is never sent: any person's name, any company's name, any LinkedIn
profile URL or photo, or any other content read from your graph. The code
that records these events is typed so that only the fields above can ever be
attached to an event — passing a name or URL through it is a compile error,
not a code-review judgment call.

## Where it goes

Anonymous events are sent to PostHog, our analytics provider, over HTTPS.
PostHog acts as our data processor and does not use this data for its own
purposes.

## Your choice

Turn the "Share anonymous usage data" toggle off in the extension's title bar
at any time. Turning it off stops new events from being recorded and drops
anything already queued that hasn't been sent yet.

## Contact

Questions about this policy can be raised as an issue on the project's
GitHub repository: https://github.com/AlessandroFC15/career-atlas.
