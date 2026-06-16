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
- **Web-safe font stack:** `-apple-system, BlinkMacSystemFont, "Segoe UI",
  Roboto, Helvetica, Arial, sans-serif`. The app's custom display/UI fonts
  cannot load reliably in mail clients; do not attempt webfont loading.
- **Explicit hex backgrounds on every cell.** Dark-theme mail clients mangle
  transparent/implicit backgrounds. Set colors on each table cell.
- **Bottle mark:** hosted PNG served from the app's public origin
  (`https://glassbottles.app/...`). No inline SVG (Gmail drops it). If no hosted
  asset exists yet, fall back to the text wordmark "glassbottles" only — do not
  block on producing an image.

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
1. Brand mark (PNG or wordmark), centered.
2. Heading (sea-flavored sentence).
3. Plain-transactional action line.
4. Seafoam CTA button.
5. Raw fallback URL (full link as text, for clients that strip buttons).
6. "This link expires in 1 hour." (matches `otp_expiry = 3600`).
7. Quiet footer: "If you didn't request this, you can ignore this email."

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
2. **Real end-to-end:** push templates to the hosted Supabase project (Dashboard
   → Authentication → Email Templates, or `supabase config push` if the project
   is linked). Trigger a real signup and a real password reset to a personal
   inbox; confirm Resend delivers the branded mail and the links work through
   `/auth/callback`.

## Risks / edge cases

- **Dark-mode inversion:** some clients auto-invert dark emails. Mitigation:
  explicit per-cell hex backgrounds; accept minor client-specific variance.
- **Outlook (Word engine):** no rounded corners / box-shadow. Button degrades to
  a flat seafoam rectangle — acceptable.
- **Missing hosted bottle PNG:** fall back to text wordmark; do not block.
- **Template var typos** silently render blank. Double-check var names against
  Supabase's documented set (`ConfirmationURL`, `NewEmail`, `Email`, `SiteURL`,
  `Token`, `TokenHash`).
