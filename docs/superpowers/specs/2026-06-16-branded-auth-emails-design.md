# Branded Supabase Auth Emails (via existing Resend SMTP)

**Date:** 2026-06-16
**Status:** Approved (design)
**Branch:** test

## Problem

Signup verification and password-reset emails go out using Supabase's default
(unstyled) email templates. They are already *delivered* through Resend —
`supabase/config.toml` wires `[auth.email.smtp]` to `smtp.resend.com`. What's
missing is branded HTML that matches the glassbottles ocean/night-sky identity.

The request: send HTML emails for signup verification and forgot-password (plus
email-change, added in scope). No change to the delivery transport — Resend SMTP
stays.

## Goals

- Branded HTML for three auth emails: confirmation, recovery, email change.
- Match the app's ocean palette and voice.
- Render correctly across major mail clients (Gmail, Apple Mail, Outlook).
- Zero new infrastructure — no edge function, no app code, no new secret.

## Non-Goals (YAGNI)

- Magic-link / OTP template — app is email + password only.
- Password-changed notification email.
- React Email / component rendering.
- A Supabase Send Email Hook edge function (explicitly rejected — the SMTP path
  already exists and is simpler).

## Approach

Use Supabase's native template system: HTML files referenced from
`config.toml`. Supabase renders the file (Go templates) and hands the result to
the existing Resend SMTP transport. This is the lowest-infra option and keeps
the current delivery path intact.

## Files

```
supabase/templates/confirmation.html    # signup verification link
supabase/templates/recovery.html         # password reset link
supabase/templates/email-change.html     # confirm new email address
```

All three share one HTML skeleton. Only the heading, body sentence, CTA label,
and link variable differ. The shared shell is duplicated into each file (email
HTML has no include mechanism; duplication is correct here).

## Email-safe build constraints (non-negotiable for inbox rendering)

- **Table-based layout.** No flexbox/grid. Outer wrapper table, centered
  content table, 600px max width.
- **All CSS inline** via `style="..."` attributes. No reliance on `<style>`
  blocks (Gmail strips/limits them). A `<style>` block may carry only
  progressive-enhancement hints (e.g. media query for mobile padding); the email
  must be fully legible without it.
- **Fonts:** body/UI copy uses a web-safe sans stack (`-apple-system,
  BlinkMacSystemFont, "Segoe UI", Roboto, Helvetica, Arial, sans-serif`). The
  serif **headings** declare `'Playfair Display', Georgia, 'Times New Roman',
  serif` — Playfair only renders in clients that allow webfonts (Apple/iOS
  Mail); Gmail/Outlook strip the `<link>` and fall back to Georgia. Headings are
  `font-weight:400` (Georgia's 700 read too heavy).
- **Explicit hex backgrounds on every cell.** Dark-theme mail clients mangle
  transparent/implicit backgrounds. Set colors on each table cell.
- **Wordmark = hosted PNG.** The "glassbottles" wordmark is a pre-rendered
  Playfair-SemiBold PNG (sand `#F7E7CE` text on baked-in ocean-deep `#0A1628`,
  3x retina) at `apps/web/public/email/glassbottles-wordmark.png`, referenced as
  `https://glassbottles.app/email/glassbottles-wordmark.png`. This forces the
  brand font everywhere (Gmail included) since images aren't subject to webfont
  restrictions. Displayed at 116×26. `alt="glassbottles"` covers image-blocking
  clients. No inline SVG (Gmail drops it).

## Visual system (brand tokens)

| Role            | Hex       | Token       |
|-----------------|-----------|-------------|
| Page background | `#0A1628` | ocean-deep  |
| Card surface    | `#0D2137` | ocean-mid   |
| Primary text    | `#F7E7CE` | sand        |
| Secondary text  | `rgba(247,231,206,0.5)` | sand/50 |
| Button fill     | `#4ECDC4` | seafoam     |
| Button text     | `#0A1628` | ocean-deep (on seafoam) |

`coral #FF6B6B` is **reserved** (brand rule: throw CTA / destructive only) and
is NOT used in these emails. All action buttons use seafoam.

Layout per email, top to bottom:
1. Wordmark PNG, centered.
2. Heading (sea-flavored sentence, Playfair/Georgia, weight 400).
3. Plain-transactional action line.
4. Seafoam CTA button.
5. "This link expires in 1 hour." (matches `otp_expiry = 3600`).
6. Quiet footer: "If you didn't request this, you can safely ignore this email."

Note: the raw-fallback-URL line was dropped — the CTA button plus expiry line
are enough, and a bare URL cluttered the layout.

## Copy & template variables

Tone: **plain-transactional action line + one light sea sentence** above it.

| Template     | Heading (sea sentence)                          | Action line                                   | CTA label          | Link var                |
|--------------|-------------------------------------------------|-----------------------------------------------|--------------------|-------------------------|
| confirmation | "A bottle's waiting to be cast for you."        | "Confirm your email to finish signing up."    | Confirm email      | `{{ .ConfirmationURL }}` |
| recovery     | "Lost your way back to shore?"                  | "Reset your password to sign back in."        | Reset password     | `{{ .ConfirmationURL }}` |
| email-change | "Charting a new course."                        | "Confirm your new email address to update it." | Confirm new email  | `{{ .ConfirmationURL }}`; show `{{ .NewEmail }}` in body |

Exact wording may be refined during implementation; structure (one sea sentence
+ one plain action line) is fixed.

Notes on vars:
- `{{ .ConfirmationURL }}` already routes to `/auth/callback`; recovery's
  `?next=/reset-password` is preserved by the existing callback handler.
- `double_confirm_changes = true`, so email-change shows the new address
  (`{{ .NewEmail }}`) for clarity.

## config.toml wiring

Replace the commented template block (`config.toml` ~252–261) with:

```toml
[auth.email.template.confirmation]
subject = "Confirm your glassbottles account"
content_path = "./supabase/templates/confirmation.html"

[auth.email.template.recovery]
subject = "Reset your glassbottles password"
content_path = "./supabase/templates/recovery.html"

[auth.email.template.email_change]
subject = "Confirm your new glassbottles email"
content_path = "./supabase/templates/email-change.html"
```

No other `config.toml` change. SMTP block stays as-is.

## Testing

Local `supabase start` is unavailable (no Docker). Verification path:

1. **Visual preview (no stack):** for each template, produce a sibling
   `*.preview.html` with Go vars substituted for mock values
   (`{{ .ConfirmationURL }}` → `https://example.com/confirm?token=mock`,
   `{{ .NewEmail }}` → `new@example.com`). Open in a browser to check layout,
   colors, dark rendering, and button/link presence. These preview files are
   scratch artifacts — gitignore or delete before commit.
2. **Real-client render (no Supabase):** send a rendered template to a personal
   inbox via the Resend API with the wordmark **inlined as a `cid:` attachment**
   (bypasses the not-yet-deployed PNG URL). Confirms Gmail/Apple rendering,
   Georgia-vs-Playfair fallback, and image display.
3. **Real end-to-end:** push templates to the hosted Supabase project (Dashboard
   → Authentication → Email Templates, or `supabase config push` if the project
   is linked). Trigger a real signup and a real password reset to a personal
   inbox; confirm Resend delivers the branded mail and the links work through
   `/auth/callback`.

**Hard dependency:** the wordmark PNG URL
(`https://glassbottles.app/email/glassbottles-wordmark.png`) only resolves once
`apps/web/public/email/` is deployed. Until then, real inbox sends (path 3) show
the `alt` text instead of the wordmark. Deploy the web app before the production
template push, or the first branded emails ship with a broken image.

## Risks / edge cases

- **Dark-mode inversion:** some clients auto-invert dark emails. Mitigation:
  explicit per-cell hex backgrounds; accept minor client-specific variance.
- **Outlook (Word engine):** no rounded corners / box-shadow. Button degrades to
  a flat seafoam rectangle — acceptable.
- **Wordmark PNG 404 until deploy:** the public asset must ship before the
  production template push (see Testing). `alt="glassbottles"` is the fallback.
- **Image-blocking clients** (some Outlook/corporate): wordmark hidden → `alt`
  text shows. Acceptable; heading + button carry the message.
- **Template var typos** silently render blank. Double-check var names against
  Supabase's documented set (`ConfirmationURL`, `NewEmail`, `Email`, `SiteURL`,
  `Token`, `TokenHash`).
