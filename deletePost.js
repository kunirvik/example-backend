const Post      = require("./bot/Post")
const cloudinary = require("./cloudinary.config")

// ── Удалить пост из MongoDB + фото из Cloudinary ──────────────────────────

async function deletePostById(id) {
  const post = await Post.findOne({ id })
  if (!post) return { ok: false, reason: "not found" }

  // Удаляем фото/видео из Cloudinary
  const toDelete = [
    post.cover,
    ...(post.photos || []),
    post.video,
  ].filter(Boolean)

  for (const url of toDelete) {
    try {
      // Достаём public_id из URL Cloudinary
      // URL вида: https://res.cloudinary.com/<cloud>/image/upload/v123/blog/ABC123.jpg
      const match = url.match(/\/(?:image|video)\/upload\/(?:v\d+\/)?(.+?)(?:\.\w+)?$/)
      if (match) {
        const publicId    = match[1]
        const resourceType = url.includes("/video/") ? "video" : "image"
        await cloudinary.uploader.destroy(publicId, { resource_type: resourceType })
        console.log(`🗑️  Cloudinary deleted: ${publicId}`)
      }
    } catch (e) {
      console.warn(`⚠️  Cloudinary delete failed for ${url}:`, e.message)
    }
  }

  await Post.deleteOne({ id })
  console.log(`🗑️  MongoDB deleted: ${id}`)
  return { ok: true, id }
}

// ── REST endpoint  DELETE /api/blog/:id ───────────────────────────────────
// Защита простым секретом из .env: ADMIN_SECRET=yourpassword
// Вызов: DELETE /api/blog/tg-123-456  +  Header: x-admin-secret: yourpassword

function registerDeleteRoute(app) {
  app.delete("/api/blog/:id", async (req, res) => {
    const secret = process.env.ADMIN_SECRET
    if (secret && req.headers["x-admin-secret"] !== secret) {
      return res.status(403).json({ error: "Forbidden" })
    }

    const result = await deletePostById(req.params.id)
    if (!result.ok) return res.status(404).json({ error: result.reason })
    res.json({ deleted: result.id })
  })

  console.log("🗑️  DELETE /api/blog/:id registered")
}

// ── Telegram команда /delete <id> ─────────────────────────────────────────
// Только для разрешённого userId из .env: ADMIN_TELEGRAM_ID=123456789

function registerDeleteCommand(bot) {
  const adminId = process.env.ADMIN_TELEGRAM_ID

  bot.onText(/\/delete (.+)/, async (msg, match) => {
    if (adminId && String(msg.from.id) !== String(adminId)) return

    const id     = match[1].trim()
    const result = await deletePostById(id)

    if (!result.ok) {
      bot.sendMessage(msg.chat.id, `❌ Пост не найден: ${id}`)
    } else {
      bot.sendMessage(msg.chat.id, `✅ Удалён: ${id}`)
    }
  })

  // /list — показывает последние 20 постов с их ID
  bot.onText(/\/list/, async (msg) => {
    if (adminId && String(msg.from.id) !== String(adminId)) return

    const posts = await Post.find({}).sort({ createdAt: -1 }).limit(20).lean()
    if (!posts.length) return bot.sendMessage(msg.chat.id, "Постов нет")

    const text = posts.map(p => `• ${p.date}  <code>${p.id}</code>\n  ${p.title}`).join("\n\n")
    bot.sendMessage(msg.chat.id, text, { parse_mode: "HTML" })
  })

  console.log("🤖 Bot commands /delete and /list registered")
}

module.exports = { deletePostById, registerDeleteRoute, registerDeleteCommand }
