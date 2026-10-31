export default function ShelfLoading() {
  return (
    <div className="relative flex h-full flex-col overflow-hidden pt-16">
      <div className="shelf-scene" aria-hidden />
      <div className="relative px-5 mb-6">
        <div className="skeleton h-6 w-14 rounded-xl" />
        <div className="skeleton h-4 w-36 rounded-xl mt-2" style={{ opacity: 0.6 }} />
      </div>
      <div className="shelf-wall grid-cols-3 sm:grid-cols-4 lg:grid-cols-5">
        {[1, 0.8, 0.6, 0.45, 0.3, 0.2].map((opacity, i) => (
          <div key={i} className="flex items-end justify-center pb-6">
            <div className="skeleton h-[84px] w-14 rounded-2xl" style={{ opacity }} />
          </div>
        ))}
      </div>
    </div>
  )
}
