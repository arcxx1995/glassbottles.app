export default function SettingsLoading() {
  return (
    <div className="flex flex-col min-h-screen pt-14 px-5">
      {/* Header ghost */}
      <div className="mb-8">
        <div className="h-7 w-24 bg-ocean-mid rounded-xl animate-pulse" />
      </div>

      {/* Card ghosts */}
      <div className="flex flex-col gap-4 max-w-md w-full">
        <div className="h-28 rounded-3xl bg-ocean-mid animate-pulse" />
        <div className="h-16 rounded-3xl bg-ocean-mid/60 animate-pulse" />
      </div>
    </div>
  )
}
