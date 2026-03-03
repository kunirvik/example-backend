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








require("dotenv").config()
const express   = require("express")
const cors      = require("cors")
const mongoose  = require("mongoose")

const { createBot }              = require("./bot/telegramBot")
const { loadAllPosts, loadPostById } = require("./blog/index")

const app = express()

app.use(cors())
app.use(express.json()) // needed to parse Telegram webhook JSON body

// ── MongoDB connection ────────────────────────────────────────────────────

mongoose
  .connect(process.env.MONGODB_URI)
  .then(() => console.log("✅ MongoDB connected"))
  .catch(e  => console.error("❌ MongoDB error:", e.message))

// ── Blog API ──────────────────────────────────────────────────────────────

app.get("/api/blog", async (req, res) => {
  try {
    const posts = await loadAllPosts()
    res.json(posts)
  } catch (e) {
    console.error(e)
    res.status(500).json({ error: "Blog load error" })
  }
})

app.get("/api/blog/:id", async (req, res) => {
  try {
    const post = await loadPostById(req.params.id)
    if (!post) return res.status(404).json({ error: "Post not found" })
    res.json(post)
  } catch (e) {
    console.error(e)
    res.status(500).json({ error: "Post load error" })
  }
})

// ── Start server, then register Telegram webhook ──────────────────────────

const PORT = process.env.PORT || 5001
app.listen(PORT, () => {
  console.log(`🚀 Server running on port ${PORT}`)
  createBot(app) // passes `app` so the bot can register its /bot<token> route
})