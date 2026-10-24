# Arctos performance audit — October 24, 2026

The largest avoidable cost was the number of requests made by an ordinary client save, rather than database size. This update reduces those requests, overlaps independent reads, and improves browser caching without redesigning the CRM.

## Scope and evidence

- Baseline: production source commit `a8d6cd686cc34b993118d63bf62fe9dd20f4bf9a`, verified against the live build information.
- Source inventory and syntax checks cover 173 JavaScript files, including browser modules, API handlers, server helpers, build tooling and tests. All 55 CSS sources compile successfully.
- Reviewed the client-save wrapper chain, client opening, calendars, startup bundles, search/navigation loading, document handling, polling, event listeners and deployment cache headers.
- Inspected database statistics and indexes across 37 public tables, constraint validation, storage totals, query statistics, performance/security advisors and the available preceding 24 hours of request logs. No customer records or files were changed during the audit.
- Tests use synthetic clients and mocked encrypted endpoints. No production writes, messages, calls or appointments were used for testing.

## Changes implemented

1. **Save only changed supporting records.** Medicare details, health and retirement plans, doctors, medications, hospital indemnity, life policies and pharmacy records reuse their existing loaded baselines. Unchanged records no longer require repeat reads and writes during a client save. Changed values, cleared fields, additions and removals still save.
2. **Remove the full-client re-read after Save.** The confirmed results from the actual writes are retained. Transient repeated-card fields and encrypted input fields are excluded from the returned client-search/event object. This also prevents deleted cards from returning on subsequent saves.
3. **Combine writes to the same row.** Underwriting values and doctors-section notes now use the existing version-checked client update. Medicaid number and plan type use their existing Medicare/health-plan writes. Optimistic client-version checking remains in place.
4. **Avoid the unchanged license read.** An existing client's untouched protected inputs do not trigger another license read/save. Protected edits still use the existing encrypted, authorized endpoints. A failed protected read now stops a license save instead of treating the saved identifiers as blank; this protects other identifiers when a connection fails.
5. **Overlap independent loading.** Pharmacy information begins loading alongside the other client data. Shared-calendar, local-appointment and follow-up reads now start together, then merge and deduplicate as before. Booking availability checks remain unchanged.
6. **Reduce unnecessary UI work.** Date validation binds once per input, dirty-state updates share a queued calculation, and the Call Data footer observes client dialogs rather than every update across the whole application.
7. **Cache static styles safely.** The build gives authentication, workspace and client-color styles content-hashed URLs with immutable browser caching. A new deployment automatically changes a URL when the file changes. HTML and build information continue to refresh normally. The database connection can start establishing earlier using preconnect.

The compiled workspace and authentication CSS are byte-for-byte identical to the baseline. The only client-form markup addition is an invisible plan-type hydration field; the existing visible dropdown, layout, colors and sections remain intact.

## Measured save example

A synthetic existing client had Medicare and health coverage, a life policy, two doctors, one medication, one pharmacy and mocked encrypted information. Only the phone number changed. Each simulated request incurred 100 ms of latency.

| Measure | Before | After |
| --- | ---: | ---: |
| Save-path requests | 28 | 1 |
| Reads | 16 | 0 |
| Writes | 12 | 1 |
| Simulated save duration | 1,753 ms | 152 ms |

This is a 96% reduction in request count for this specific edit. It is a controlled request-latency test, not a promised saving time on a cellular network. Other edits and pending file uploads require additional requests. Background search-summary refreshes are outside this repository-save measurement.

The initial login JavaScript remains approximately 61 KB compressed, and workspace CSS remains approximately 42 KB compressed. The improvement here is caching and fewer waits, rather than a claim that those assets became smaller.

## Database and service findings

- Database size was approximately 18 MB. Document storage contained 272 objects totaling approximately 408 MB. These totals do not indicate a need for a larger server by themselves.
- No unvalidated public-table constraints were found.
- For the most frequently observed REST paths, average origin response times were generally tens to low hundreds of milliseconds. These measurements exclude the user's mobile-network round trip.
- No server errors appeared among the 16 highest-volume request-path/method groups inspected. Vercel's available runtime-error scan also returned no clusters. This does not establish that every possible client-side error is absent.
- Advisors identified four foreign keys without covering indexes, six row-policy authentication initialization notices, and one overlapping permissive-policy notice. Several indexes were reported unused; none were removed, because recent usage statistics alone do not prove an index is unnecessary.
- Security advisors also flagged password-breach protection and executable privileged functions for review. Some privileged functions are intentional parts of the existing encrypted-data design; these were not automatically rewritten or disabled.

References: [foreign-key indexes](https://supabase.com/docs/guides/database/database-linter?lint=0001_unindexed_foreign_keys), [policy initialization](https://supabase.com/docs/guides/database/database-linter?lint=0003_auth_rls_initplan), [overlapping policies](https://supabase.com/docs/guides/database/database-linter?lint=0006_multiple_permissive_policies), [password protection](https://supabase.com/docs/guides/auth/password-security#password-strength-and-leaked-password-protection).

## Validation and limits

- Production build: passed.
- Syntax: all 173 JavaScript files passed.
- New performance/workflow tests: 11 passed. They cover changed/unchanged records, protected data, field clearing, successive saves, row identity/removal, interrupted writes and protected reads, date-listener duplication, observer scope and parallel calendar loading.
- Full pre-existing suite: baseline 222 tests, 201 passed, 21 failed. Updated suite: 233 tests, 212 passed, the same 21 failed. No new failing tests were introduced.
- Existing failures include outdated query mocks without `.neq`, changed navigation/stylesheet expectations, and a bulk-text test expecting a different rejected-request status. They need a separate test-maintenance review; this audit does not label the entire suite green.
- An authenticated real-device browser trace on a weak cellular connection was not available. The end-to-end save tests run the real repository and affected form modules in a simulated browser with controlled data and latency.
- Saves still require a connection and the existing multi-part save process can partially succeed. These changes do not introduce offline synchronization or transactional saves.

Recheck the focused workflows with `npm run test:performance`; build with `npm run build`; check every JavaScript file with `node scripts/check-syntax.mjs`.

## Recommendations approved by Justin

1. **Offline drafts and synchronization.** Retain an encrypted device draft when signal drops, show a clear Pending/Saved/Error state, and synchronize when service returns. Define device protection, conflict handling and how protected information is stored before implementing this workflow.
2. **Atomic, retry-safe saving.** Consolidate the multi-part client save into an authorized server operation with transaction and idempotency handling. This addresses partial saves and interrupted-response retries, rather than merely reducing normal save latency. It is a larger backend change.
3. **Adaptive calendar refresh.** Reduce the current 15-second background polling frequency on weak connections, while preserving an immediate server-side availability check before scheduling. This trades some background freshness for lower bandwidth and needs approval.
4. **Separate maintenance review.** Repair the 21 existing test failures and review the database policy/index/security advisories with before/after query plans. Preserve role access and the intentional encrypted-data functions. These changes were not bundled into this performance release.

No offline storage, changed refresh interval, database migration, authorization-policy change, index removal, record deletion or paid infrastructure upgrade is included in this release.

## Approved follow-up progress

The preceding release description is historical. Justin subsequently authorized all four recommendations.

- Adaptive polling is live: calendar refresh is 60 seconds on detected slow/data-saving connections, 15 seconds otherwise, and paused offline. Scheduling availability checks remain unchanged.
- Four missing foreign-key indexes and equivalent policy optimizations are live. The duplicate permissive policy was removed only after verifying matching access predicates. No records or indexes were deleted and no role access was expanded.
- Test maintenance is complete: all 235 tests pass, including a new behavioral check for active-search versus deceased-archive isolation. Query mocks now implement the existing status exclusion; navigation, escaped labels, startup CSS and consent fixtures reflect the current production behavior. The foreign-client API test still requires rejection before any external send.
- The workspace imports the canonical repository module, avoiding a second singleton URL in unbundled development. No markup or CSS changes were made in this follow-up.
- Production build, JavaScript syntax checks and whitespace checks pass.
- Offline recovery/synchronization and atomic retry-safe saves remain outstanding. Inspection confirms the current save chain spans separate database writes, encrypted-data functions and file uploads; it must not be described as transactional or automatically retried yet.

## Encrypted recovery follow-up

- Open client records now retain encrypted device drafts after edits, with a 500 ms debounce. IndexedDB stores AES-GCM ciphertext and a non-exportable per-agent key. Concurrent tabs cannot replace an existing encryption key; each dialog has its own draft identity. CVV and file contents are excluded. Drafts expire after seven days and are cleared on successful save or explicit Discard Changes.
- An offline Save makes no server request, retains a draft when storage is available, and explicitly reports that the record has not been saved to the CRM. Storage failure never produces a false success message.
- Reopening the same client online offers a Recover draft action in the existing message area. Recovery requires the same signed-in agent and client version, restores medical/policy additions and removals, and never saves automatically. Protected fields are recovered only when explicitly edited; untouched identifiers are not replaced by unloaded blanks.
- Conflicting versions and new-client drafts with an uncertain prior server response are retained but blocked from restoration, preventing an automatic overwrite or duplicate creation. Uploaded/queued files are not restored and must be attached again. This is recovery for records already open during a lost connection, not a fully offline app shell or offline client search.
- All 244 tests pass; all 178 JavaScript files pass syntax checks; the production build passes. Tests use synthetic data and simulated storage/network state, not live client records or physical iPhone testing. Unavailable device storage does not block online saving or discarding changes.
- Automatic synchronization, atomic saves, and safe retries after ambiguous server responses remain outstanding. Current saves still span separate database writes and file uploads.
