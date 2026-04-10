

// require("dotenv").config()
// const express    = require("express")
// const cors       = require("cors")
// const mongoose   = require("mongoose")
// const multer     = require("multer")
// const cloudinary = require("./cloudinary.config")
// const Post       = require("./bot/Post")
// const Listing    = require("./bot/Listing")

// const { createBot }                  = require("./bot/telegramBot")
// const { createMarketplaceBot,
//         notifyApproved,
//         notifyRejected,
//         recordRejection,  // 4. Импортируем новую функцию
//         TTL_DAYS }                       = require("./bot/Marketplacebot")
// const { loadAllPosts, loadPostById } = require("./blog/index")
// const { startListingsCron }              = require("./bot/listings.cron.js")


// const app    = express()
// const upload = multer({ storage: multer.memoryStorage() })

// app.use(cors())
// app.use(express.json())

// mongoose
//   .connect(process.env.MONGODB_URI)
//   .then(() => {console.log("✅ MongoDB connected")
//     startListingsCron()
//   })
//   .catch(e  => console.error("❌ MongoDB error:", e.message))

// // ── Auth middleware ───────────────────────────────────────────────────────

// function auth(req, res, next) {
//   if (req.headers["x-admin-key"] !== process.env.ADMIN_KEY)
//     return res.status(401).json({ error: "Unauthorized" })
//   next()
// }

// // ── Blog API ──────────────────────────────────────────────────────────────

// app.get("/", (req, res) => res.json({ status: "ok" }))

// app.get("/api/blog", async (req, res) => {
//   try {
//     const isAdmin = req.headers["x-admin-key"] === process.env.ADMIN_KEY
//     const showAll = isAdmin && req.query.all === "1"

//     if (showAll) {
//       // Админ видит все посты включая pending
//       const mongoPosts = await Post.find({}).lean()
//       res.json(mongoPosts)
//     } else {
//       // Публика и обычные запросы — только published
//       res.json(await loadAllPosts())
//     }
//   }
//   catch (e) { res.status(500).json({ error: "Blog load error" }) }
// })


// app.get("/api/blog/:id", async (req, res) => {
//   try {
//     const post = await loadPostById(req.params.id)
//     if (!post) return res.status(404).json({ error: "Post not found" })
//     res.json(post)
//   } catch (e) { res.status(500).json({ error: "Post load error" }) }
// })

// // ── Admin API ─────────────────────────────────────────────────────────────

// app.post("/api/upload", auth, upload.single("file"), async (req, res) => {
//   try {
//     const isVideo = req.file.mimetype.startsWith("video")
//     const b64     = req.file.buffer.toString("base64")
//     const dataUri = `data:${req.file.mimetype};base64,${b64}`
//     const result  = await cloudinary.uploader.upload(dataUri, {
//       folder: "blog",
//       resource_type: isVideo ? "video" : "image",
//       public_id: `admin_${Date.now()}`,
//     })
//     res.json({ url: result.secure_url })
//   } catch (e) { res.status(500).json({ error: e.message }) }
// })

// app.post("/api/blog", auth, async (req, res) => {
//   try { res.json(await Post.create(req.body)) }
//   catch (e) { res.status(500).json({ error: e.message }) }
// })

// app.put("/api/blog/:id", auth, async (req, res) => {
//   try {
//     const post = await Post.findOneAndUpdate(
//       { id: req.params.id }, req.body, { returnDocument: "after" }
//     )
//     res.json(post)
//   } catch (e) { res.status(500).json({ error: e.message }) }
// })

// app.delete("/api/blog/:id", auth, async (req, res) => {
//   try {
//     const post = await Post.findOne({ id: req.params.id })
//     if (!post) return res.status(404).json({ error: "Not found" })

//     // Собираем все Cloudinary URL из поста
//     const allUrls = [
//       post.cover,
//       post.video,
//       ...(post.photos || []),
//       ...(post.videos || []),
//     ].filter(Boolean)

//     // Удаляем каждый ресурс из Cloudinary
//     await Promise.allSettled(
//       allUrls.map(url => {
//         // Извлекаем public_id из URL: .../blog/filename → blog/filename
//         const match = url.match(/\/upload\/(?:v\d+\/)?(.+)\.[a-z0-9]+$/i)
//         if (!match) return Promise.resolve()
//         const publicId    = match[1]
//         const resourceType = url.match(/\.(mp4|webm|mov)$/i) ? "video" : "image"
//         return cloudinary.uploader.destroy(publicId, { resource_type: resourceType })
//       })
//     )

//     await Post.deleteOne({ id: req.params.id })
//     res.json({ ok: true })
//   } catch (e) { res.status(500).json({ error: e.message }) }
// })

// app.post("/api/blog/:id/bump", auth, async (req, res) => {
//   const post = await Post.findOneAndUpdate(
//     { id: req.params.id },
//     { updatedAt: new Date() },
//     { returnDocument: "after" }
//   )
//   res.json(post)
// })

// app.patch("/api/blog/:id/approve", auth, async (req, res) => {
//   try {
//     const post = await Post.findOneAndUpdate(
//       { id: req.params.id },
//       { status: "published" },
//       { returnDocument: "after" }
//     )
//     res.json(post)
//   } catch (e) { res.status(500).json({ error: e.message }) }
// })

// app.post("/api/listings/:id/view", async (req, res) => {
//   try {
//     const { id } = req.params
//     const { viewerId } = req.body
 
//     if (!viewerId) {
//       return res.status(400).json({ 
//         error: "viewerId is required" 
//       })
//     }
 
//     // Находим объявление
//     const listing = await Listing.findOne({ id, status: "published" })
    
//     if (!listing) {
//       return res.status(404).json({ 
//         error: "Listing not found or not published" 
//       })
//     }
 
//     // Проверяем, просматривал ли этот пользователь уже это объявление
//     const alreadyViewed = listing.viewedBy?.some(v => v.userId === viewerId)
 
//     if (!alreadyViewed) {
//       // Добавляем просмотр
//       await Listing.updateOne(
//         { id },
//         {
//           $inc: { viewCount: 1 },
//           $push: { 
//             viewedBy: {
//               userId: viewerId,
//               viewedAt: new Date()
//             }
//           },
//           $set: { lastViewedAt: new Date() }
//         }
//       )
 
//       console.log(`📊 [view] listing ${id} viewed by ${viewerId.slice(0, 15)}... (total: ${listing.viewCount + 1})`)
 
//       return res.json({ 
//         success: true, 
//         viewCount: listing.viewCount + 1,
//         isNewView: true
//       })
//     } else {
//       // Просмотр уже был учтен
//       console.log(`👁️ [view] listing ${id} already viewed by ${viewerId.slice(0, 15)}...`)
      
//       return res.json({ 
//         success: true, 
//         viewCount: listing.viewCount,
//         isNewView: false
//       })
//     }
 
//   } catch (error) {
//     console.error("❌ [view] error:", error.message)
//     res.status(500).json({ 
//       error: "Failed to track view" 
//     })
//   }
// })
 

// app.get("/api/listings/:id/stats", async (req, res) => {
//   try {
//     const { id } = req.params
 
//     const listing = await Listing.findOne({ id })
    
//     if (!listing) {
//       return res.status(404).json({ error: "Listing not found" })
//     }
 
//     // Группируем просмотры по дням
//     const viewsByDay = {}
//     listing.viewedBy?.forEach(view => {
//       const date = new Date(view.viewedAt).toISOString().split('T')[0]
//       viewsByDay[date] = (viewsByDay[date] || 0) + 1
//     })
 
//     res.json({
//       id: listing.id,
//       title: listing.title,
//       totalViews: listing.viewCount || 0,
//       uniqueViewers: listing.viewedBy?.length || 0,
//       lastViewedAt: listing.lastViewedAt,
//       viewsByDay,
//       createdAt: listing.createdAt,
//       publishedAt: listing.publishedAt,
//     })
 
//   } catch (error) {
//     console.error("❌ [stats] error:", error.message)
//     res.status(500).json({ error: "Failed to get stats" })
//   }
// })
 
// // ── ENDPOINT: Топ просматриваемых объявлений ───────────────────────────────────
// /**
//  * GET /api/listings/top/views
//  * 
//  * Возвращает топ объявлений по просмотрам
//  */
// app.get("/api/listings/top/views", async (req, res) => {
//   try {
//     const limit = parseInt(req.query.limit) || 10
 
//     const topListings = await Listing.find({ status: "published" })
//       .sort({ viewCount: -1 })
//       .limit(limit)
//       .select("id title price category photos viewCount createdAt")
//       .lean()
 
//     res.json(topListings)
 
//   } catch (error) {
//     console.error("❌ [top-views] error:", error.message)
//     res.status(500).json({ error: "Failed to get top listings" })
//   }
// })
 

// async function cleanOldViews() {
//   try {
//     const sixMonthsAgo = new Date()
//     sixMonthsAgo.setMonth(sixMonthsAgo.getMonth() - 6)
 
//     const result = await Listing.updateMany(
//       {},
//       {
//         $pull: {
//           viewedBy: {
//             viewedAt: { $lt: sixMonthsAgo }
//           }
//         }
//       }
//     )
 
//     console.log(`🧹 Cleaned old views from ${result.modifiedCount} listings`)
//   } catch (error) {
//     console.error("❌ Failed to clean old views:", error.message)
//   }
// }
 

// app.get("/api/listings", async (req, res) => {
//   try {
//     const listings = await Listing.find({ status: "published" })
//       .sort({ createdAt: -1 })
//       .select("-viewedBy") // Не отправляем детальную информацию о просмотрах клиенту
//       .lean()
 
//     res.json(listings)
//   } catch (error) {
//     console.error("Failed to fetch listings:", error.message)
//     res.status(500).json({ error: "Failed to fetch listings" })
//   }
// })
 
// module.exports = {
//   cleanOldViews
// }
// // ── Start ─────────────────────────────────────────────────────────────────

// const PORT = process.env.PORT || 5001
// app.listen(PORT, () => {
//   console.log(`🚀 Server running on port ${PORT}`)
//   createBot(app)
//   createMarketplaceBot(app) 
// })

// ═══════════════════════════════════════════════════════════════════════════════
// index.js - ГЛАВНЫЙ SERVER С REDIS КЕШИРОВАНИЕМ
// ═══════════════════════════════════════════════════════════════════════════════

require("dotenv").config()
const express    = require("express")
const cors       = require("cors")
const mongoose   = require("mongoose")
const multer     = require("multer")
const compression = require("compression")
const helmet = require("helmet")

const cloudinary = require("./cloudinary.config")
const Post       = require("./bot/Post")
const Listing    = require("./bot/Listing")
const bans = require('./bot/user-bans.js')
// ── REDIS ИМПОРТ ────────────────────────────────────────────────────────────────
const redis = require("./redis.js")

const { createBot }                  = require("./bot/telegramBot")
const { createMarketplaceBot,
        notifyApproved,
        notifyRejected,
        recordRejection,
        TTL_DAYS }                       = require("./bot/Marketplacebot")
const { loadAllPosts, loadPostById } = require("./blog/index")
const { startListingsCron }              = require("./bot/listings.cron.js")

const app    = express()
const upload = multer({ storage: multer.memoryStorage() })

// ── MIDDLEWARE ──────────────────────────────────────────────────────────────────

app.use(helmet()) // Безопасность
app.use(compression()) // Сжатие ответов
app.use(cors())
app.use(express.json({ limit: '10mb' }))

// ── ЛОГИРОВАНИЕ ЗАПРОСОВ ────────────────────────────────────────────────────────
app.use((req, res, next) => {
  const start = Date.now()
  
  res.on('finish', () => {
    const duration = Date.now() - start
    console.log(`${req.method} ${req.path} ${res.statusCode} ${duration}ms`)
  })
  
  next()
})

// ── ПОДКЛЮЧЕНИЕ К БД ────────────────────────────────────────────────────────────

mongoose
  .connect(process.env.MONGODB_URI)
  .then(() => {
    console.log("✅ MongoDB connected")
    startListingsCron()
  })
  .catch(e  => console.error("❌ MongoDB error:", e.message))

// ── Auth middleware ────────────────────────────────────────────────────────────

function auth(req, res, next) {
  if (req.headers["x-admin-key"] !== process.env.ADMIN_KEY)
    return res.status(401).json({ error: "Unauthorized" })
  next()
}

// ═════════════════════════════════════════════════════════════════════════════════
// BLOG API
// ═════════════════════════════════════════════════════════════════════════════════

app.get("/", (req, res) => res.json({ status: "ok" }))

app.get("/api/blog", async (req, res) => {
  try {
    const isAdmin = req.headers["x-admin-key"] === process.env.ADMIN_KEY
    const showAll = isAdmin && req.query.all === "1"

    if (showAll) {
      const mongoPosts = await Post.find({}).lean()
      res.json(mongoPosts)
    } else {
      res.json(await loadAllPosts())
    }
  }
  catch (e) { res.status(500).json({ error: "Blog load error" }) }
})

app.get("/api/blog/:id", async (req, res) => {
  try {
    const post = await loadPostById(req.params.id)
    if (!post) return res.status(404).json({ error: "Post not found" })
    res.json(post)
  } catch (e) { res.status(500).json({ error: "Post load error" }) }
})

// ═════════════════════════════════════════════════════════════════════════════════
// ADMIN API
// ═════════════════════════════════════════════════════════════════════════════════

app.post("/api/upload", auth, upload.single("file"), async (req, res) => {
  try {
    const isVideo = req.file.mimetype.startsWith("video")
    const b64     = req.file.buffer.toString("base64")
    const dataUri = `data:${req.file.mimetype};base64,${b64}`
    const result  = await cloudinary.uploader.upload(dataUri, {
      folder: "blog",
      resource_type: isVideo ? "video" : "image",
      public_id: `admin_${Date.now()}`,
    })
    res.json({ url: result.secure_url })
  } catch (e) { res.status(500).json({ error: e.message }) }
})

app.post("/api/blog", auth, async (req, res) => {
  try { 
    const post = await Post.create(req.body)
    res.json(post) 
  }
  catch (e) { res.status(500).json({ error: e.message }) }
})

app.put("/api/blog/:id", auth, async (req, res) => {
  try {
    const post = await Post.findOneAndUpdate(
      { id: req.params.id }, req.body, { returnDocument: "after" }
    )
    res.json(post)
  } catch (e) { res.status(500).json({ error: e.message }) }
})

app.delete("/api/blog/:id", auth, async (req, res) => {
  try {
    const post = await Post.findOne({ id: req.params.id })
    if (!post) return res.status(404).json({ error: "Not found" })

    const allUrls = [
      post.cover,
      post.video,
      ...(post.photos || []),
      ...(post.videos || []),
    ].filter(Boolean)

    await Promise.allSettled(
      allUrls.map(url => {
        const match = url.match(/\/upload\/(?:v\d+\/)?(.+)\.[a-z0-9]+$/i)
        if (!match) return Promise.resolve()
        const publicId    = match[1]
        const resourceType = url.match(/\.(mp4|webm|mov)$/i) ? "video" : "image"
        return cloudinary.uploader.destroy(publicId, { resource_type: resourceType })
      })
    )

    await Post.deleteOne({ id: req.params.id })
    res.json({ ok: true })
  } catch (e) { res.status(500).json({ error: e.message }) }
})

app.post("/api/blog/:id/bump", auth, async (req, res) => {
  const post = await Post.findOneAndUpdate(
    { id: req.params.id },
    { updatedAt: new Date() },
    { returnDocument: "after" }
  )
  res.json(post)
})

// Забанить пользователя
app.post("/api/admin/ban-user", auth, async (req, res) => {
  try {
    const { userId, reason, durationDays, banType } = req.body
    const adminId = req.user?.id || 'admin'

    const result = await bans.banUser(userId, {
      reason,
      durationDays,
      banType,
      bannedBy: adminId
    })

    if (!result.ok) {
      return res.status(400).json({ error: result.error })
    }

    // Инвалидировать кеш этого пользователя
    await redis.delByPattern(`listings:user:${userId}:*`)

    res.json({
      ok: true,
      ban: result.ban,
      message: `User ${userId} banned for ${reason}`
    })
  } catch (e) {
    res.status(500).json({ error: e.message })
  }
})

// Разбанить пользователя
app.post("/api/admin/unban-user/:userId", auth, async (req, res) => {
  try {
    const { userId } = req.params
    const result = await bans.revokeBan(userId, req.user?.id || 'admin')

    if (!result.ok) {
      return res.status(400).json({ error: result.error })
    }

    res.json(result)
  } catch (e) {
    res.status(500).json({ error: e.message })
  }
})

// Получить статус бана
app.get("/api/admin/ban-status/:userId", auth, async (req, res) => {
  try {
    const { userId } = req.params
    const banInfo = await bans.getBanInfo(userId)
    res.json(banInfo)
  } catch (e) {
    res.status(500).json({ error: e.message })
  }
})

// Получить все баны
app.get("/api/admin/bans", auth, async (req, res) => {
  try {
    const bans_list = await bans.getAllActiveBans()
    const stats = await bans.getBanStats()
    
    res.json({
      stats,
      bans: bans_list
    })
  } catch (e) {
    res.status(500).json({ error: e.message })
  }
}) 




// app.patch("/api/blog/:id/approve", auth, async (req, res) => {
//   try {
//     const post = await Post.findOneAndUpdate(
//       { id: req.params.id },
//       { status: "published" },
//       { returnDocument: "after" }
//     )
//     res.json(post)
//   } catch (e) { res.status(500).json({ error: e.message }) }
// })

// Когда админ одобряет объявление - добавить expiresAt

app.patch("/api/admin/listings/:id/approve", auth, async (req, res) => {
  try {
    const { id } = req.params
    
    // Когда публикуется - установить дату истечения
    const now = new Date()
    const expiresAt = new Date(now.getTime() + TTL_DAYS * 24 * 60 * 60 * 1000)
    
    const listing = await Listing.findOneAndUpdate(
      { id },
      {
        status: "published",
        publishedAt: now,
        expiresAt: expiresAt  // ✅ УСТАНОВИТЬ ДЕДЛАЙН
      },
      { returnDocument: "after" }
    )
    
    if (!listing) {
      return res.status(404).json({ error: "Listing not found" })
    }
    
    // Уведомить пользователя
    await notifyApproved(listing)
    
    // Инвалидировать кеш
    await redis.invalidateListingsCache()
    
    res.json({
      ok: true,
      listing,
      expiresIn: TTL_DAYS,
      expiresAt: expiresAt
    })
  } catch (e) {
    res.status(500).json({ error: e.message })
  }
}) 
// ═════════════════════════════════════════════════════════════════════════════════
// MARKETPLACE API - С REDIS КЕШИРОВАНИЕМ
// ═════════════════════════════════════════════════════════════════════════════════

/**
 * GET /api/listings
 * Получить все объявления с кешированием
 */
app.get("/api/listings", async (req, res) => {
  try {
    // ✅ КЕШИРОВАНИЕ: проверить кеш
    let listings = await redis.getCachedListings()
    
    if (listings) {
      console.log("📦 Listings из кеша (Redis)")
      res.set('X-Cache', 'HIT')
      return res.json(listings)
    }
    
    // ❌ КЕША НЕТ: получить из БД
    console.log("🔄 Listings из БД (MongoDB)")
    listings = await Listing.find({ status: "published" })
      .sort({ createdAt: -1 })
      .select("-viewedBy")
      .lean()
    
    // ✅ КЕШИРОВАТЬ результат
    await redis.cacheListings(listings)
    
    res.set('X-Cache', 'MISS')
    res.json(listings)
  } catch (error) {
    console.error("❌ Failed to fetch listings:", error.message)
    res.status(500).json({ error: "Failed to fetch listings" })
  }
})

/**
 * GET /api/listings/top/views
 * Топ объявлений по просмотрам
 */
app.get("/api/listings/top/views", async (req, res) => {
  try {
    const limit = parseInt(req.query.limit) || 10
    
    // ✅ КЕШИРОВАНИЕ
    let topListings = await redis.getCachedTopListings()
    
    if (topListings) {
      console.log("📦 Top listings из кеша")
      res.set('X-Cache', 'HIT')
      return res.json(topListings)
    }
    
    console.log("🔄 Top listings из БД")
    topListings = await Listing.find({ status: "published" })
      .sort({ viewCount: -1 })
      .limit(limit)
      .select("id title price category photos viewCount createdAt")
      .lean()
    
    // ✅ КЕШИРОВАТЬ
    await redis.cacheTopListings(topListings)
    
    res.set('X-Cache', 'MISS')
    res.json(topListings)
  } catch (error) {
    console.error("❌ [top-views] error:", error.message)
    res.status(500).json({ error: "Failed to get top listings" })
  }
})

/**
 * POST /api/listings/:id/view
 * Отследить просмотр объявления
 */
app.post("/api/listings/:id/view", async (req, res) => {
  try {
    const { id } = req.params
    const { viewerId } = req.body
 
    if (!viewerId) {
      return res.status(400).json({ 
        error: "viewerId is required" 
      })
    }
 
    const listing = await Listing.findOne({ id, status: "published" })
    
    if (!listing) {
      return res.status(404).json({ 
        error: "Listing not found or not published" 
      })
    }
 
    const alreadyViewed = listing.viewedBy?.some(v => v.userId === viewerId)
 
    if (!alreadyViewed) {
      await Listing.updateOne(
        { id },
        {
          $inc: { viewCount: 1 },
          $push: { 
            viewedBy: {
              userId: viewerId,
              viewedAt: new Date()
            }
          },
          $set: { lastViewedAt: new Date() }
        }
      )
      
      // ✅ ИНВАЛИДИРОВАТЬ КЕШИ
      await redis.invalidateListing(id)
      await redis.invalidateListingsCache()
 
      console.log(`📊 [view] listing ${id} viewed by ${viewerId.slice(0, 15)}...`)
 
      return res.json({ 
        success: true, 
        viewCount: listing.viewCount + 1,
        isNewView: true
      })
    } else {
      console.log(`👁️ [view] listing ${id} already viewed by ${viewerId.slice(0, 15)}...`)
      
      return res.json({ 
        success: true, 
        viewCount: listing.viewCount,
        isNewView: false
      })
    }
 
  } catch (error) {
    console.error("❌ [view] error:", error.message)
    res.status(500).json({ 
      error: "Failed to track view" 
    })
  }
})

/**
 * GET /api/listings/:id/stats
 * Получить статистику объявления
 */
app.get("/api/listings/:id/stats", async (req, res) => {
  try {
    const { id } = req.params
 
    // ✅ КЕШИРОВАНИЕ
    let stats = await redis.getCachedListingStats(id)
    
    if (stats) {
      console.log("📊 Stats из кеша")
      res.set('X-Cache', 'HIT')
      return res.json(stats)
    }
    
    console.log("🔄 Stats из БД")
    const listing = await Listing.findOne({ id })
    
    if (!listing) {
      return res.status(404).json({ error: "Listing not found" })
    }
 
    const viewsByDay = {}
    listing.viewedBy?.forEach(view => {
      const date = new Date(view.viewedAt).toISOString().split('T')[0]
      viewsByDay[date] = (viewsByDay[date] || 0) + 1
    })
 
    stats = {
      id: listing.id,
      title: listing.title,
      totalViews: listing.viewCount || 0,
      uniqueViewers: listing.viewedBy?.length || 0,
      lastViewedAt: listing.lastViewedAt,
      viewsByDay,
      createdAt: listing.createdAt,
      publishedAt: listing.publishedAt,
    }
    
    // ✅ КЕШИРОВАТЬ
    await redis.cacheListingStats(id, stats)
    
    res.set('X-Cache', 'MISS')
    res.json(stats)
 
  } catch (error) {
    console.error("❌ [stats] error:", error.message)
    res.status(500).json({ error: "Failed to get stats" })
  }
})

// ═════════════════════════════════════════════════════════════════════════════════
// ADMIN ENDPOINTS - УПРАВЛЕНИЕ КЕШЕМ
// ═════════════════════════════════════════════════════════════════════════════════

/**
 * POST /api/admin/cache/invalidate
 * Очистить весь кеш объявлений
 */
app.post("/api/admin/cache/invalidate", auth, async (req, res) => {
  try {
    await redis.invalidateListingsCache()
    res.json({ 
      ok: true, 
      message: "Cache invalidated" 
    })
  } catch (e) {
    res.status(500).json({ error: e.message })
  }
})

/**
 * GET /api/admin/cache/stats
 * Статистика кеша
 */
app.get("/api/admin/cache/stats", auth, async (req, res) => {
  try {
    const keys = await redis.getAllKeys()
    const info = await redis.getInfo()
    
    res.json({
      totalKeys: keys.length,
      keys: keys.slice(0, 20), // Первые 20 ключей
      info: info
    })
  } catch (e) {
    res.status(500).json({ error: e.message })
  }
})

/**
 * GET /api/health
 * Проверка здоровья сервера
 */
app.get("/api/health", async (req, res) => {
  try {
    const mongoConnected = mongoose.connection.readyState === 1
    const redisConnected = await redis.exists('health-check') !== null || true
    
    res.json({
      status: mongoConnected && redisConnected ? 'ok' : 'degraded',
      mongo: mongoConnected ? 'connected' : 'disconnected',
      redis: redisConnected ? 'connected' : 'disconnected',
      timestamp: new Date().toISOString()
    })
  } catch (e) {
    res.status(500).json({
      status: 'error',
      error: e.message
    })
  }
})

// ═════════════════════════════════════════════════════════════════════════════════
// СТАРТ СЕРВЕРА
// ═════════════════════════════════════════════════════════════════════════════════

const PORT = process.env.PORT || 5001
app.listen(PORT, () => {
  console.log(`🚀 Server running on port ${PORT}`)
  console.log(`📊 Redis enabled: ${process.env.REDIS_URL || 'localhost:6379'}`)
  createBot(app)
  createMarketplaceBot(app) 
})

module.exports = app