// require('dotenv').config();
// const express = require('express');

// const { createBot } = require("./bot/telegramBot")

// const cors = require('cors');
// const cloudinary = require('./cloudinary.config');

// const { loadAllPosts, loadPostById } = require("./blog/index")

// const app = express();


// app.use(cors());

// app.use(express.json());


















// app.get("/api/blog", async (req, res) => {
//   try {
//     const posts = await loadAllPosts()
//     res.json(posts)
//   } catch (e) {
//     res.status(500).json({ error: "Blog load error" })
//   }
// })




// app.get("/api/blog/:id", async (req, res) => {
//   try {
//     const post = await loadPostById(req.params.id)

//     if (!post) {
//       return res.status(404).json({ error: "Post not found" })
//     }

//     res.json(post)
//   } catch (e) {
//     res.status(500).json({ error: "Post load error" })
//   }
// })



// const PORT = process.env.PORT || 5001;
// app.listen(PORT, () => {
//   console.log(`Сервер запущен на порту ${PORT}`);
// });

// // После app.listen:
// createBot()








// require("dotenv").config()
// const express   = require("express")
// const cors      = require("cors")
// const mongoose  = require("mongoose")

// const { createBot }              = require("./bot/telegramBot")
// const { loadAllPosts, loadPostById } = require("./blog/index")

// const app = express()

// app.use(cors())
// app.use(express.json()) // needed to parse Telegram webhook JSON body

// // ── MongoDB connection ────────────────────────────────────────────────────

// mongoose
//   .connect(process.env.MONGODB_URI)
//   .then(() => console.log("✅ MongoDB connected"))
//   .catch(e  => console.error("❌ MongoDB error:", e.message))

// // ── Blog API ──────────────────────────────────────────────────────────────

// app.get("/api/blog", async (req, res) => {
//   try {
//     const posts = await loadAllPosts()
//     res.json(posts)
//   } catch (e) {
//     console.error(e)
//     res.status(500).json({ error: "Blog load error" })
//   }
// })

// app.get("/api/blog/:id", async (req, res) => {
//   try {
//     const post = await loadPostById(req.params.id)
//     if (!post) return res.status(404).json({ error: "Post not found" })
//     res.json(post)
//   } catch (e) {
//     console.error(e)
//     res.status(500).json({ error: "Post load error" })
//   }
// })

// // ── Start server, then register Telegram webhook ──────────────────────────

// const PORT = process.env.PORT || 5001
// app.listen(PORT, () => {
//   console.log(`🚀 Server running on port ${PORT}`)
//   createBot(app) // passes `app` so the bot can register its /bot<token> route
// })

require("dotenv").config()
const express    = require("express")
const cors       = require("cors")
const mongoose   = require("mongoose")
const multer     = require("multer")
const cloudinary = require("./cloudinary.config.js")
const Post       = require("./bot/Post.js")
const Listing    = require("./bot/Listing")

const { createBot }                  = require("./bot/telegramBot")
const { createMarketplaceBot,
        notifyApproved,
        notifyRejected,
        recordRejection,  // 4. Импортируем новую функцию
        TTL_DAYS }                       = require("./bot/Marketplacebot")
const { loadAllPosts, loadPostById } = require("./blog/index")
const { startListingsCron }              = require("./bot/listings.cron.js")


const app    = express()
const upload = multer({ storage: multer.memoryStorage() })

app.use(cors())
app.use(express.json())

mongoose
  .connect(process.env.MONGODB_URI)
  .then(() => {console.log("✅ MongoDB connected")
    startListingsCron()
  })
  .catch(e  => console.error("❌ MongoDB error:", e.message))

// ── Auth middleware ───────────────────────────────────────────────────────

function auth(req, res, next) {
  if (req.headers["x-admin-key"] !== process.env.ADMIN_KEY)
    return res.status(401).json({ error: "Unauthorized" })
  next()
}

// ── Blog API ──────────────────────────────────────────────────────────────

app.get("/", (req, res) => res.json({ status: "ok" }))

app.get("/api/blog", async (req, res) => {
  try {
    const isAdmin = req.headers["x-admin-key"] === process.env.ADMIN_KEY
    const showAll = isAdmin && req.query.all === "1"

    if (showAll) {
      // Админ видит все посты включая pending
      const mongoPosts = await Post.find({}).lean()
      res.json(mongoPosts)
    } else {
      // Публика и обычные запросы — только published
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

// ── Admin API ─────────────────────────────────────────────────────────────

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
  try { res.json(await Post.create(req.body)) }
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

    // Собираем все Cloudinary URL из поста
    const allUrls = [
      post.cover,
      post.video,
      ...(post.photos || []),
      ...(post.videos || []),
    ].filter(Boolean)

    // Удаляем каждый ресурс из Cloudinary
    await Promise.allSettled(
      allUrls.map(url => {
        // Извлекаем public_id из URL: .../blog/filename → blog/filename
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

app.patch("/api/blog/:id/approve", auth, async (req, res) => {
  try {
    const post = await Post.findOneAndUpdate(
      { id: req.params.id },
      { status: "published" },
      { returnDocument: "after" }
    )
    res.json(post)
  } catch (e) { res.status(500).json({ error: e.message }) }
})

// ── MARKETPLACE API ───────────────────────────────────────────────────────
 
// Список объявлений
// Публично: только published
// Админ + ?all=1: все статусы
app.get("/api/listings", async (req, res) => {
  try {
    const isAdmin = req.headers["x-admin-key"] === process.env.ADMIN_KEY
    const filter  = (isAdmin && req.query.all === "1") ? {} : { status: "published" }
    res.json(await Listing.find(filter).sort({ createdAt: -1 }).lean())
  } catch (e) { res.status(500).json({ error: "Listings load error" }) }
})

// 6. НОВЫЙ ENDPOINT: Просмотр конкретного объявления с увеличением счетчика
app.get("/api/listings/:id", async (req, res) => {
  try {
    const listing = await Listing.findOne({ id: req.params.id }).lean()
    
    if (!listing) {
      return res.status(404).json({ error: "Listing not found" })
    }
    
    // Увеличиваем счетчик просмотров (только для опубликованных)
    if (listing.status === "published") {
      await Listing.updateOne(
        { id: req.params.id },
        { 
          $inc: { viewCount: 1 },
          $set: { lastViewedAt: new Date() }
        }
      )
      
      // Обновляем объект для ответа
      listing.viewCount = (listing.viewCount || 0) + 1
      listing.lastViewedAt = new Date()
    }
    
    res.json(listing)
  } catch (e) { 
    res.status(500).json({ error: "Listing load error" }) 
  }
})
 
// Одобрить → published + expiresAt + уведомление продавцу
app.patch("/api/listings/:id/approve", auth, async (req, res) => {
  try {
    const now       = new Date()
    const expiresAt = new Date(now)
    expiresAt.setDate(expiresAt.getDate() + TTL_DAYS)
 
    const listing = await Listing.findOneAndUpdate(
      { id: req.params.id },
      { status: "published", publishedAt: now, expiresAt },
      { returnDocument: "after", new: true }
    )
    if (!listing) return res.status(404).json({ error: "Not found" })
    notifyApproved(listing).catch(() => {})
    res.json(listing)
  } catch (e) { res.status(500).json({ error: e.message }) }
})
 
// 4. ОБНОВЛЕНО: Отклонить → rejected + причина + уведомление + recordRejection
app.patch("/api/listings/:id/reject", auth, async (req, res) => {
  try {
    const reason  = req.body.reason || ""
    const listing = await Listing.findOneAndUpdate(
      { id: req.params.id },
      { status: "rejected", rejectReason: reason },
      { returnDocument: "after", new: true }
    )
    if (!listing) return res.status(404).json({ error: "Not found" })
    
    // ВАЖНО: Вызываем recordRejection для учета в дневном лимите
    // Эта функция автоматически вызывается внутри notifyRejected
    notifyRejected(listing, reason).catch(() => {})
    
    res.json(listing)
  } catch (e) { res.status(500).json({ error: e.message }) }
})
 
// Удалить + фото из Cloudinary
app.delete("/api/listings/:id", auth, async (req, res) => {
  try {
    const listing = await Listing.findOne({ id: req.params.id })
    if (!listing) return res.status(404).json({ error: "Not found" })
    await Promise.allSettled(
      (listing.photos || []).map(url => {
        const m = url.match(/\/upload\/(?:v\d+\/)?(.+)\.[a-z0-9]+$/i)
        if (!m) return Promise.resolve()
        return cloudinary.uploader.destroy(m[1], { resource_type: "image" })
      })
    )
    await Listing.deleteOne({ id: req.params.id })
    res.json({ ok: true })
  } catch (e) { res.status(500).json({ error: e.message }) }
})

// 6. НОВЫЙ ENDPOINT: Статистика по категориям
app.get("/api/listings/stats/categories", async (req, res) => {
  try {
    const stats = await Listing.aggregate([
      { $match: { status: "published" } },
      { 
        $group: {
          _id: "$category",
          count: { $sum: 1 },
          totalViews: { $sum: "$viewCount" },
          avgViews: { $avg: "$viewCount" }
        }
      },
      { $sort: { count: -1 } }
    ])
    res.json(stats)
  } catch (e) {
    res.status(500).json({ error: "Stats load error" })
  }
})

// 6. НОВЫЙ ENDPOINT: Топ объявлений по просмотрам
app.get("/api/listings/stats/top-viewed", async (req, res) => {
  try {
    const limit = parseInt(req.query.limit) || 10
    const topListings = await Listing.find({ status: "published" })
      .sort({ viewCount: -1 })
      .limit(limit)
      .lean()
    res.json(topListings)
  } catch (e) {
    res.status(500).json({ error: "Top listings load error" })
  }
})

// ── Start ─────────────────────────────────────────────────────────────────

const PORT = process.env.PORT || 5001
app.listen(PORT, () => {
  console.log(`🚀 Server running on port ${PORT}`)
  createBot(app)
  createMarketplaceBot(app) 
})