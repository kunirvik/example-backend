const Listing           = require("./Listing")
const { notifyExpired } = require("./Marketplacebot")

async function expireListings() {
  console.log("⏰ [cron] checking expired listings...")
  try {
    const expired = await Listing.find({
      status:    "published",
      expiresAt: { $lt: new Date(), $ne: null },
    })
    if (!expired.length) return console.log("⏰ [cron] nothing to expire")

    await Listing.updateMany(
      { id: { $in: expired.map(l => l.id) } },
      { $set: { status: "expired" } }
    )
    await Promise.allSettled(expired.map(l => notifyExpired(l)))
    console.log(`✅ [cron] expired ${expired.length} listings`)
  } catch (e) {
    console.error("❌ [cron] error:", e.message)
  }
}

function startListingsCron() {
  console.log("⏰ Listings cron started (every 24h)")
  setTimeout(expireListings, 5_000)            // первый запуск через 5 сек
  setInterval(expireListings, 24 * 60 * 60 * 1000) // потом каждые 24 часа
}

module.exports = { startListingsCron }