export interface SocialProfile {
  user_id: string
  handle: string
  avatar_url: string | null
  bio: string | null
}

type AuthorRef = Pick<SocialProfile, 'handle' | 'avatar_url'>

export interface Post {
  id: string
  author_id: string
  community_id: string | null
  body: string
  image_url: string | null
  score: number
  comment_count: number
  /** Safety screen verdict; 'held' rows only ever reach their author (RLS). */
  screen: 'ok' | 'crisis' | 'held' | null
  created_at: string
  author: AuthorRef
  community: { slug: string; name: string } | null
  /** Only your own vote is visible (RLS), so this is 0 | 1 | -1 for you. */
  my_vote: { value: 1 | -1 }[]
}

export interface Comment {
  id: string
  post_id: string
  parent_id: string | null
  author_id: string
  body: string
  created_at: string
  author: AuthorRef
}

export interface Community {
  id: string
  slug: string
  name: string
  description: string | null
  created_by: string
  members: { count: number }[]
}

export interface Friendship {
  requester_id: string
  addressee_id: string
  status: 'pending' | 'accepted'
}

export interface Scrap {
  id: string
  wall_id: string
  author_id: string
  kind: 'scrap' | 'testimonial'
  body: string
  approved: boolean
  screen: 'ok' | 'crisis' | 'held' | null
  created_at: string
  author: AuthorRef
}

export type FeedSort = 'hot' | 'new' | 'friends'
