export default function SettingsLoading() {
  return (
    <div className="flex h-full flex-col px-5 pt-10 sm:pt-14">
      {/* Header ghost */}
      <div className="mb-8">
        <div className="skeleton h-7 w-24 rounded-xl" />
      </div>

      {/* Card ghosts */}
      <div className="flex flex-col gap-4 max-w-md w-full">
        <div className="skeleton h-28 rounded-card" />
        <div className="skeleton h-16 rounded-card" style={{ opacity: 0.6 }} />
      </div>
    </div>
  )
}
