# Restful-Booker — Postman/Newman API Test Collection

[![API Tests (Newman)](https://github.com/zarindev/restful-booker-postman-tests/actions/workflows/newman.yml/badge.svg)](https://github.com/zarindev/restful-booker-postman-tests/actions/workflows/newman.yml)
![Postman](https://img.shields.io/badge/Postman-FF6C37?style=flat&logo=postman&logoColor=white)
![Newman](https://img.shields.io/badge/Newman-CLI-orange)

> **What this is:** a self-built, demo/practice API test collection against [Restful-Booker](https://restful-booker.herokuapp.com/apidoc/index.html), a public API testing playground built by QA trainer Mark Winteringham specifically for this purpose. **This is not a paid client engagement.** It exists to demonstrate real API testing methodology — authentication chaining, full CRUD coverage, and negative testing — since actual client API test suites are confidential and can't be shared publicly.

## What this collection actually tests

Not just "does each endpoint return 200." Every request in this collection either **chains real data through the API** (create a booking, then read/update/delete that *same* booking by the ID it actually returned) or **deliberately tests the negative case first** to prove a guard exists rather than assuming it does.

- **Authentication** — exchanges the API's documented public test credentials for a token, and separately documents the API's actual (slightly unusual) behavior for bad credentials: it returns `200` with `{ "reason": "Bad credentials" }`, not a `401`. Testing what an API *actually* does, not what REST conventions say it *should* do, is the point.
- **Create** — generates a booking with dynamic data (Postman's built-in `$randomFirstName`/`$randomLastName`/`$randomInt`, plus computed check-in/check-out dates) and verifies the full response matches what was submitted, field by field.
- **Read** — retrieves the exact booking just created and verifies it matches; separately confirms a nonexistent booking ID returns `404`, not a silent empty success.
- **Update** — tests the auth guard (`403` with no token) *before* testing the authenticated success case, so the negative test isn't just "passing by coincidence" because the update happened first. The full `PUT` update asserts every field changed; the partial `PATCH` update explicitly asserts the *other* fields were left untouched — a partial update quietly resetting unrelated fields is a real, easy-to-miss bug class.
- **Delete** — same ordering discipline: unauthenticated delete is tested first (`403`, booking must still exist), then the real authenticated delete (`201`), then a follow-up `GET` on the same ID confirms it's actually `404` afterward. A `201` from the delete call only proves the API *accepted* the request — the follow-up `GET` is what proves the deletion actually happened.

## An honest note on one request in this collection

Multiple independent QA practitioners who've tested this API report that **filtering bookings by checkout date returns inconsistent results** — a known community-reported quirk of this practice API. This collection includes a request for that filter, but it deliberately does **not** assert a specific pass/fail outcome on it. Instead, it logs the actual response for manual inspection.

This has now been personally checked against two real, independent CI runs: in both, the `GET /booking?checkout=<date>` response was within ~40 bytes of that same run's *unfiltered* `GET /booking` response (60.78kB vs 60.82kB in one run; 9.24kB vs 9.24kB in the other, with the total shrinking between runs simply because this is a shared public API other people are constantly writing to). That's strong evidence the `checkout` query parameter is being **silently ignored** by the API rather than actually filtering — it just returns the full booking list either way. That's a real, reproducible characteristic of this endpoint, not run-to-run noise, but it's also not something a single assertion can cleanly express against a dataset whose total size is out of this collection's control. The "logged, not asserted" approach stays as the right call here, now backed by evidence instead of just caution.

## Public test credentials

The `username`/`password` values in the environment file (`admin` / `password123`) are Restful-Booker's own documented, publicly published test credentials for this exact API — not a secret leak. They're committed to this public repo deliberately, which is why they're the only "sensitive-looking" values that are.

## A note on how this build was verified

This repo was assembled by an AI coding agent running in a network-sandboxed environment with no outbound access to `restful-booker.herokuapp.com` (confirmed: the sandbox's own egress policy rejects the connection outright), so the collection couldn't be run against the live API from that sandbox. Verification instead happened through a handful of iterations on GitHub Actions, which runs on a normal GitHub-hosted runner with unrestricted internet access:

1. **`newman@6.2.2` crashed on Node.js 20+** before making a single request (`serialised-error` → `object-hash@1.3.1` throws `Unknown object type "asyncfunction"`). Fixed with an `overrides` pin (`object-hash: ^3.0.0`) in `package.json`.
2. With that fixed, the `test:html` script (which only used the `htmlextra` reporter) exited non-zero with **zero console output**, because `htmlextra` alone doesn't stream per-request results — it looked like a silent crash but was actually just real assertion failures with no visibility into what failed. Added the `cli` reporter alongside it (`-r cli,htmlextra`) so failures are actually visible in CI logs.
3. With real output visible, two genuine assertion failures showed up against the live API — both bugs in this collection, not the API: `totalprice` was submitted as a quoted `{{$randomInt}}` template variable, which Postman resolves to a JSON *string*, while the API correctly returns it as a *number*; and a downstream "booking matches" check compared against an environment variable that never got set, because the `totalprice` assertion above it threw before the script reached the line that set it. Fixed the body template to emit `totalprice` unquoted (so it resolves as a real number) and reordered the script to save chained variables before the assertions that can throw.
4. After that fix, **[a CI run went fully green](../../actions/runs/34796217671): 15/15 requests, 15/15 test-scripts, 23/23 assertions passing** against the live API.

**The [GitHub Actions badge](../../actions/workflows/newman.yml) at the top of this README reflects the real, current pass/fail state of this collection** — it re-runs on every push and daily via the scheduled cron job. A future red badge is real signal worth investigating (either a genuine regression, or the practice API itself being down — it's a free-tier Heroku app with its own independent uptime), not something to assume away.

## Project structure

```
restful-booker-postman-api-tests/
├── .github/workflows/
│   └── newman.yml                              # CI: push/PR + daily schedule
├── collections/
│   └── Restful-Booker-API.postman_collection.json
├── environments/
│   └── Restful-Booker.postman_environment.json
├── generate-collection.js                       # Builds the collection JSON programmatically
├── package.json
└── .gitignore
```

**Why the collection is generated by a script instead of hand-edited JSON:** Postman collection JSON is verbose and easy to subtly corrupt by hand (mismatched brackets, a stray comma). Building it via `generate-collection.js` means the whole thing can be regenerated from readable, reviewable JavaScript, and it's trivial to add a new request or folder without touching raw JSON directly.

## Running it locally

**Option 1 — Postman GUI:** Import both files from `collections/` and `environments/` directly into Postman, select the environment, and run the collection with the Collection Runner.

**Option 2 — Newman (CLI, what CI uses):**

```bash
npm install
npm test          # console output
npm run test:html # generates newman-report.html
```

**Regenerating the collection after editing `generate-collection.js`:**

```bash
npm run generate
```

## Design decisions worth knowing about

- **API chaining, not isolated requests** — the booking ID, auth token, and even the created customer's name are captured into environment variables and reused by every downstream request. This is what makes it a real end-to-end flow instead of 15 requests that happen to sit in the same file.
- **Negative tests run before positive tests where order matters** — see the Update and Delete sections above. Test order isn't an afterthought; it's what makes a negative test actually prove something.
- **Dynamic data over fixed fixtures** — every run creates a fresh, uniquely-named booking rather than assuming a fixed one exists, since this is a shared public demo API.
- **A documented "don't know yet" instead of a fabricated assertion** — the checkout-date filter request. An honest gap beats a confident-looking test that was never actually verified.
- **Generated, not hand-written, collection JSON** — see above. Reviewable JavaScript in version control, not an opaque JSON blob.

## About me

I'm a QA Engineer specializing in manual and automation testing (Selenium, Playwright) and API testing, currently working on Upwork. This repo is one piece of a demo portfolio built specifically to show real, inspectable work where client confidentiality prevents me from sharing actual project deliverables.
