import { cn } from '@/lib/utils'
import type { ThreadMessage } from '@/types'

interface MessageBubbleProps {
  message: ThreadMessage
}

export default function MessageBubble({ message }: MessageBubbleProps) {
  return (
    <div className={cn('flex', message.is_mine ? 'justify-end' : 'justify-start')}>
      <div
        className={cn(
          'max-w-[78%] px-4 py-3 rounded-2xl font-ui text-sm leading-relaxed',
          message.is_mine
            ? 'bg-seafoam/15 text-sand rounded-br-sm'
            : 'bg-ocean-mid border border-border-subtle text-sand rounded-bl-sm'
        )}
      >
        <p>{message.message}</p>
        <time
          dateTime={message.sent_at}
          className={cn(
            'font-mono text-[10px] mt-1 block',
            message.is_mine ? 'text-seafoam/50 text-right' : 'text-sand/25'
          )}
        >
          {new Date(message.sent_at).toLocaleTimeString('en-US', {
            hour: 'numeric',
            minute: '2-digit',
          })}
        </time>
      </div>
    </div>
  )
}
