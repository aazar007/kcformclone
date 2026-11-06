This is KSU Crown 3.0's official registration form for players.

---

# KSU Crown — registration form

A team registration form for the KSU Crown esports championship: 1v1 and 5v5 titles,
per-game rosters, per-game rulebooks, verified university email addresses, self-service
editing, a live-tournament announcement, and an organiser console.

Deployed on **Cloudflare Workers** via OpenNext (`wrangler.toml`, `open-next.config.ts`).
`npm run build:cloud` is that target's build; `npm run dev` is local development.

## The organiser console is not at `/admin`

`/admin` answers with the ordinary 404. The console lives on segments **derived from a
hash of `ADMIN_SECRET`**:

```
ADMIN_SECRET  →  /crown-<12 hex>   the grand admin's door
              →  /crew-<12 hex>    the staff door
ADMIN_PATH    →  /crown-my-ops     optional override
STAFF_PATH    →  /crew-my-team     optional override
```

Changing `ADMIN_SECRET` therefore moves both addresses. `npm run check` prints the current
ones. With no `ADMIN_SECRET` in production there is no console at all.

## The grand admin's password is stored, hashed — `ADMIN_SECRET` is only a bootstrap

**The grand admin signs in with a password stored as a scrypt hash in the
`AdminCredential` table.** It is set from the console, and rotating it is how access is
revoked.

`ADMIN_SECRET` is **not** a permanent second credential. It is accepted in exactly one
situation: **a deployment that has never had a password set**, so somebody can get in and
set the first one. The moment a password exists, the secret stops signing anybody in.

That ordering is the point. While the secret remained a permanent alternative, holding it
meant owning the console for ever, and no password rotation could take that away.

Three consequences:

- **Forgotten password** — recover out of band, not through the sign-in form:

  ```bash
  npm run admin:reset            # set a new password (prompted, hidden)
  npm run admin:reset -- --clear # remove it, returning to bootstrap mode
  ```

  This needs `DATABASE_URL` and a shell on a trusted machine — deliberately a narrower
  thing to hold than a value the console accepts from a browser.
- **Three wrong guesses lock that caller out for 15 minutes**, and the password is refused
  during it. So is the secret, because exempting it would make the lockout pointless.
  Wait, or reset out of band.
- **A configured-but-unreachable database refuses**, rather than falling back to the
  secret; otherwise an outage would promote the secret back to a full credential.

An optional `ADMIN_PEPPER` mixes a value that never reaches the database into the hash, so
a stolen dump cannot be tested against a guess. It must match everywhere, and changing it
invalidates the stored password (then `npm run admin:reset`).

## Email addresses are strict to the member's own university

Each member's address must belong to the university selected **on that row**, and the form
will not accept an address before one is chosen — there is no rule to check it against
until the institution is known.

Where a university issues students a separate subdomain, that subdomain is the *only*
accepted form: `@student.ksu.edu.sa` for King Saud, `@stu.kau.edu.sa` for King Abdulaziz.
To add one, set `studentDomains` on that institution's entry in `src/lib/universities.ts` —
a one-line change, deliberately, because inventing a subdomain that does not exist would
lock out every real student there.

The rule runs in three places so it cannot be bypassed: the roster step, the API's payload
validation, and the organiser's team editor.

**Coaches are exempt.** A coach may have graduated, or may never have studied at one of the
listed institutions, so a university and student number are optional for them, and their
email may be any address. Players still have to name their institution.

## The captain enters only a teammate's university and address

A team leader does not have — and should not need — every teammate's personal details. On
the roster step only the leader's own row asks for a name, game tag, student number,
Discord and phone. Every other row asks for three things:

1. **Role** — starter, substitute or coach, because the squad's shape is the captain's.
2. **University** — chosen per person, because it decides which addresses are acceptable.
3. **Email** — which must be that university's own domain.

Everything else — name, game tag, student ID, Discord, phone, and the organisers'
questions — is completed by the player from their emailed link.

The API applies the same split: `validatePayload` rejects a leader's missing details but
accepts an empty teammate row, while still refusing an invalid value if one is present and
still enforcing the university domain. The organiser's team editor is relaxed the same way,
so an unrelated fix is never blocked by a profile that has not arrived.

## One leader, one registration

**Only the team leader registers.** The form no longer asks who leads: the person
submitting *is* the leader, and they are always the first row of the roster
(`leaderIndex` is 0, and `validatePayload` ignores any submitted index). The rule is
stated before the form opens — "Only the team leader may register the team. Duplicate
registrations will result in a ban." — because a second entry is how a squad gets
disqualified.

The starting line-up is fixed by the game's rules (`rosterRulesFor(...).starters`); the
leader chooses only the bench: how many **substitutes** (0 … `maxSubstitutes`) and whether
the team carries **a coach** (when the game allows one). `resizeRoster` rebuilds the rows
from those two choices, so the roster can never be a shape validation would refuse.

Reference codes are `ESC-26-XXXXXXX` — seven characters from an alphabet that omits
`I`, `O`, `0` and `1`, because these get read aloud and copied by hand.

## Teammates complete their details **before** submission

Pressing **Continue** at the end of the roster step creates a **draft** and emails every
teammate their link. Nothing is registered yet — the team name is not reserved, and the
registration only exists once the captain presses Submit.

```
roster step  ──Continue──▶  draft created, one email per teammate
                                  │
   review step (live) ────────────┘   their answers appear as they arrive
        │                                  (/api/registrations/draft/:id polled every 4 s)
        ▼
     Submit ──▶ Team + members, draft deleted, leader's receipt emailed
```

Why a draft and not a `Team` row: an abandoned attempt must not reserve a team name, appear
in the console's registration count, or look like a team that registered. `Draft` and
`DraftMember` exist for exactly that window and are deleted on submission (or after 72
hours untouched, by the sweeper in `pruneDrafts`).

- `POST /api/registrations/draft` creates or refreshes the draft and sends the links. It
  reuses the same draft when the browser sends the `draftId` + `secret` it was given, so
  going back to fix a role does not re-email three players. A row keeps its completed
  profile while its university and address are unchanged; changing either makes it a
  different person as far as the domain rule is concerned, so that row starts empty.
- `GET /api/registrations/draft/:id?secret=…` is what the review step polls.
- The **secret** is the capability: the browser holds it, the database holds only its
  SHA-256 hash. It lives in `sessionStorage` beside the draft, so a reload rejoins the same
  draft instead of invalidating links already sent.
- On submission the server **overwrites** each teammate's personal fields from the draft
  rows (matched by address, never by position) before validating, so the browser cannot
  assert details it never collected. The completion token travels into the `Member` row, so
  a link sent before submission still works afterwards.

The review step shows a live panel: how many players have answered, which ones have not,
and each name as it arrives. Submission is allowed while a player is still pending — the
first press says so, the second registers anyway — because one unread email must not be
able to strand a whole team. Their link stays valid, and the console shows the row as
**Details pending** until they use it.

## Opening a registration, by role

There is one way in, and it asks for **two** things: the reference code **and the email
address** that was entered for you. The pair names a person; a six-digit code mailed to
that address proves it is theirs. Only then does the server decide a role:

| Proved as | Sees | Can change |
| --- | --- | --- |
| **Leader** | every name and position, plus their own card | the order of the roster, their own details |
| **Player / substitute / coach** | their own card only | their own details |
| **Organiser** | the full editor | everything the console allows |

`POST /api/registrations/lookup` does both phases — `{reference, email}` sends the code,
`{reference, email, code}` verifies it. The verified response carries a proof scoped
`teamId:ROLE:memberId`, so:

- `PUT /api/registrations/roster` accepts only a `LEADER` (or `ORGANISER`) proof, and only
  reorders rows. It cannot read or write a teammate's personal fields at all.
- `PUT /api/registrations/profile` addresses the row named in the proof, so a request can
  never reach a sibling. University, address and role are read from the stored row.
- `PUT /api/registrations/[reference]`, which replaces a whole roster, is now
  **organiser-only** — the one thing a leader must never be able to do is rewrite somebody
  else's phone number.

A player's response contains no roster, so there is nothing in the payload (or the DOM) to
peek at. A leader's roster carries names and positions but no addresses, phones or student
numbers.

### The shared team link

After submission the leader is shown a **team link** — `/?tab=edit&ref=ESC-26-…` — with a
copy button. It opens the same flow with the reference already filled in, so each player
adds only their own address. The reference in the URL grants nothing by itself: the code
mailed to the address is what opens the card.

## Email confirmation is per person, and it is where details are completed

Only the **team leader** proves their address during registration, with a six-digit code
(`/api/otp/request` and `/api/otp/verify`). Every other member completes the form in their
emailed link, and submitting it marks them both complete and confirmed.

- Each member has their own token, stored as a SHA-256 hash (`DraftMember` before
  submission, `Member` after). Exactly one row is updated when a link is used, so one
  player completing their details can never fill in the rest of the roster.
- Opening a link does **not** save anything. `/confirm-email` renders that member's form —
  prefilled with whatever is already stored — and the save is a POST to
  `/api/confirm-email`. That keeps a mail filter which follows every URL from completing a
  profile nobody submitted.
- The address and university are read from the stored row, never from the request, so a
  player cannot move themselves to another institution or become a coach to skip the
  student number. The student ID stays globally unique.
- `Member.emailConfirmedAt` is the status the console shows as **Confirmed** or **Pending**.

Changing an address invalidates its confirmation; the edit flow keeps a confirmation only
while the address stays the same.

## Resending, and bans

The console's Registrations section carries two per-row controls:

- **Resend** sends the completion link again (or the team receipt, for the leader's row).
  A resend **rotates** the member's token, so the previous link stops working — which is
  what makes it useful when the first message never arrived or was forwarded.
  `POST /api/admin/teams/<id>/resend` with no `memberId` emails every teammate.
- **Ban** is a checkbox on the team and on each player. It writes `bannedAt` + `banReason`
  rather than deleting anything, so the entry stays readable and the decision is reversible.
  Banning a **team** writes the same stamp to every member row, so it covers the leader,
  the starters, the substitutes and the coach — including anybody who joins the roster
  later, and anybody who tries to enter again under a different team.

A ban is enforced in three places:

- A banned team's captain cannot open or save the edit flow, and neither the shared link
  nor an emailed completion link will save a profile.
- A banned player's address or student number is refused on a **new** registration, which
  is the point of a ban.
- `findMemberClashes` reports banned rows, so a banned player's address or student number
  is refused on a **new** registration — which is the point of a ban.
- The console keeps showing the entry, with a **Suspended** badge, so an organiser can lift
  it (`POST /api/admin/teams/<id>/ban` with `banned: false`).


## Registration window, and the live announcement

Two independent switches, both edited in the console:

- **Registration** — off shows `closedMessage` instead of the wizard.
- **Live** — shows "Tournament is live — watch us on our official channels" on the landing
  page, with one button per channel (`label` + URL) the organisers add.

The live notice appears **only on the landing page**, never inside the registration form,
and it is independent of the registration switch: a tournament is usually live while
registration is closed, but the stream can be announced earlier. The message falls back to
a translated default when left empty, and watch links are limited to http(s) or a path on
this site — a `javascript:` URL is dropped rather than rendered.

## One-time codes

`OTP_SECRET` signs the proofs that say an address was verified. Generate it with any of
these and paste the **output**, never the command:

```bash
node -e "console.log(require('node:crypto').randomBytes(32).toString('base64'))"
openssl rand -base64 32
head -c 32 /dev/urandom | base64
```

The first needs nothing but Node, which makes it the one that works on Windows, in a
build container, and over SSH. Any 32 random bytes are fine; what matters is length and
unpredictability, not the encoding.

Ceilings: a code allows three wrong guesses; three wrong admin guesses lock the caller out
for fifteen minutes; a site-wide cap (`OTP_GLOBAL_MAX`, default 300) bounds abuse from an
attacker who changes the address every time.

## Mail: two channels, pooled, sent after the response

`SMTP_OTP_*` sends verification codes and `SMTP_CONFIRMATION_*` sends confirmations; each
falls back to the shared `SMTP_*` values, so one account works for both.

- **The transport is pooled**, so a batch of messages (a receipt plus one link per member)
  reuses connections instead of opening a new TLS session per recipient.
- **The sends are concurrent** and are started together.
- **The HTTP response does not wait for them.** They run through Next's `after()`, which
  keeps the request alive on serverless runtimes while the captain gets their reference
  code immediately. If a runtime cannot defer, the sends are awaited inline instead.

A failure to send is logged and reported, never turned into a failed registration: the team
is already stored.

## Two Prisma versions, on purpose

Prisma 8 is installed alongside Prisma 7. Prisma 7 still owns `prisma/schema.prisma` and
the migrations; Prisma 8 reads that schema through `prisma7Schema()` as its *contract*
source. Each CLI has its own config because they want incompatible shapes:

```
prisma.config.ts    → Prisma 8   (contract source, contract emit)
prisma7.config.ts   → Prisma 7   (schema, migrations, client generation)
```

`prisma generate` **does not exist in v8**, which is why `build` and `postinstall` call
`npm run prisma7 -- generate`. After a schema change: `npm run db:migrate`, which also
re-emits the contract.

### Why there are two generated clients

**The Prisma client is not portable between Node and Cloudflare Workers.** With
`runtime = "workerd"` the client imports its query compiler as
`query_compiler_fast_bg.wasm?module` — and `?module` is a Wrangler convention that Node
cannot resolve. Loaded under Node it throws, from the constructor:

```
The loaded wasm module was unexpectedly `undefined` or `null` once loaded
```

Every database call then fails. The symptom is *"the database cannot be reached"*, which
is why changing `DATABASE_URL` — locally or on Vercel — appeared to do nothing: the URL
was fine the whole time.

So `prisma/schema.prisma` declares **two** generators and the build copies the right one
into `generated/prisma-client`, the single path `src/lib/db.ts` imports:

| Command | Client | Used by |
| --- | --- | --- |
| `npm run prisma:node` | `runtime/client` | `dev`, `build`, Vercel, every `scripts/*.ts` |
| `npm run prisma:workers` | `wasm-compiler-edge` | `build:cloud`, Cloudflare Workers |

`build` and `dev` select the Node client; `build:cloud` selects the Workers one. Both
generate from the same schema, so they cannot drift, and `npm test` asserts that each build
selects its own. If a script fails with that wasm message, the selected client is the wrong
flavour — re-run the matching selector.

## Database TLS

A hosted `DATABASE_URL` should end in **`&sslmode=verify-full`**. Providers generate
`sslmode=require` instead, which is not wrong today — `pg` treats it as `verify-full` — but
**`pg` v9, the next major version, will treat `require` as encryption without certificate
verification.** That change would arrive with a dependency bump nobody connects to a
security property, so `npm run check` names it. `verify-ca` is also refused: it checks
that a certificate was signed by a trusted authority but does not check the hostname, so a
certificate for another host passes.

## Cross-origin isolation on the console

The logo tool removes backgrounds with ONNX Runtime's threaded WebAssembly build, which
needs `SharedArrayBuffer` — available only to a cross-origin isolated document. The console
sends `COOP: same-origin` (from `next.config.mjs`) and `COEP: require-corp` (from
`src/middleware.ts`). Without the second header the tool fails with a misleading
`no available backend found … TypeError: Load failed`, which reads like a CDN problem.

```bash
curl -s -D - -o /dev/null "https://YOUR-HOST/crown-…" | grep -i cross-origin
# want: cross-origin-opener-policy: same-origin
#       cross-origin-embedder-policy: require-corp
```

## Rate limits

Rate limits and the admin lockout are keyed by the caller's address. On Cloudflare and
Vercel the platform supplies it. **On anything else, set `TRUSTED_IP_HEADER`** to the
header your proxy *overwrites* — never one it merely forwards. Left unset, every caller
shares one bucket: safe, but site-wide.

## Commands

```bash
npm run dev            # local, port 3001
npm test               # rule checks, no database needed
npm run check          # whole-stack diagnostic: database, mail, sheet, console paths
npm run build:cloud    # the Cloudflare build
npm run db:migrate     # apply/write migrations, then re-emit the contract
npm run admin:reset    # set or clear the grand admin's password
npm run admin:hash     # hash a value for ADMIN_SECRET
```

See `.env.example` for every setting, including which ones are secrets.

