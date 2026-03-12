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
const cloudinary = require("./cloudinary.config")
const Post       = require("./bot/Post")

const { createBot }                  = require("./bot/telegramBot")
const { loadAllPosts, loadPostById } = require("./blog/index")

const app    = express()
const upload = multer({ storage: multer.memoryStorage() })

app.use(cors())
app.use(express.json())

mongoose
  .connect(process.env.MONGODB_URI)
  .then(() => console.log("✅ MongoDB connected"))
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
  try { res.json(await loadAllPosts()) }
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
// ── Start ─────────────────────────────────────────────────────────────────

const PORT = process.env.PORT || 5001
app.listen(PORT, () => {
  console.log(`🚀 Server running on port ${PORT}`)
  createBot(app)
})