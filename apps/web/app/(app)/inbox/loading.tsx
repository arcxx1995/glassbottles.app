export default function InboxLoading() {
  return (
    <div className="flex flex-col min-h-screen pt-14">
      {/* Header ghost */}
      <div className="px-5 mb-6">
        <div className="h-7 w-16 bg-ocean-mid rounded-xl animate-pulse" />
        <div className="h-4 w-36 bg-ocean-mid/60 rounded-xl animate-pulse mt-2" />
      </div>

      {/* Card ghosts — fading cascade */}
      <div className="flex flex-col gap-4">
        {([1, 0.65, 0.35] as const).map((opacity, i) => (
          <div
            key={i}
            className="mx-4 h-40 rounded-3xl bg-ocean-mid animate-pulse"
            style={{ opacity }}
          />
        ))}
      </div>
    </div>
  )
}
