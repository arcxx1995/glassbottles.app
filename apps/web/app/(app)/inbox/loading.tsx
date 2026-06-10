export default function InboxLoading() {
  return (
    <div className="flex flex-col min-h-screen pt-14">
      {/* Header ghost */}
      <div className="px-5 mb-6">
        <div className="skeleton h-7 w-16 rounded-xl" />
        <div className="skeleton h-4 w-36 rounded-xl mt-2" style={{ opacity: 0.6 }} />
      </div>

      {/* Card ghosts — fading cascade */}
      <div className="flex flex-col gap-4">
        {([1, 0.65, 0.35] as const).map((opacity, i) => (
          <div
            key={i}
            className="skeleton mx-4 h-40 rounded-card"
            style={{ opacity }}
          />
        ))}
      </div>
    </div>
  )
}
