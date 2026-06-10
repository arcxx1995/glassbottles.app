import { NextResponse } from 'next/server'

// DEPRECATED — WhatsApp integration was removed.
// This route returns 410 Gone so clients that cached the endpoint get a clear,
// permanent signal rather than a 404. Stop calling this endpoint.
//
// Notification is now handled by Resend email (notify-receiver edge function).
// The whatsapp_number and whatsapp_verified columns in public.profiles are
// retained (not dropped) to avoid a destructive migration, but are no longer
// written to by any server code.

export async function POST() {
  return NextResponse.json(
    {
      error: 'This endpoint has been removed. WhatsApp integration is no longer supported.',
      info: 'Notifications are now sent by email.',
    },
    { status: 410 }
  )
}
