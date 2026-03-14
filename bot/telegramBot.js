// const TelegramBot = require("node-telegram-bot-api")
// const fs = require("fs")
// const path = require("path")

// const CONTENT_DIR = path.join(__dirname, "../blog/content")

// // ── helpers ───────────────────────────────────────────────────────────────

// function slugify(str = "") {
//   return str
//     .toLowerCase()
//     .replace(/[^a-zа-яё0-9\s]/gi, "")
//     .trim()
//     .replace(/\s+/g, "-")
//     .slice(0, 50) || `post-${Date.now()}`
// }

// function detectVideoUrl(text = "") {
//   const match = text.match(/(https?:\/\/(?:youtu\.be\/|(?:www\.)?youtube\.com\/watch\?v=|rumble\.com\/)[^\s]+)/)
//   return match ? match[1] : null
// }

// function extractTags(text = "") {
//   return [...text.matchAll(/#(\w+)/g)].map(m => m[1])
// }

// function getTitle(text = "") {
//   // Первая строка текста — заголовок
//   return text.split("\n")[0].replace(/#\w+/g, "").trim().slice(0, 100)
// }

// function getBody(text = "") {
//   // Всё кроме первой строки — тело
//   return text.split("\n").slice(1).join("\n").trim()
// }

// async function getPhotoUrl(bot, photos) {
//   // Берём наибольшее разрешение
//   const fileId = photos[photos.length - 1].file_id
//   return await bot.getFileLink(fileId)
// }

// function savePost({ id, title, body, excerpt, tags, cover, photos, url, video, videos }) {
//   let fm = `---\n`
//   fm += `id: "${id}"\n`
//   fm += `title: "${title.replace(/"/g, '\\"')}"\n`
//   fm += `date: "${new Date().toISOString().slice(0, 10)}"\n`
//   if (excerpt)        fm += `excerpt: "${excerpt.replace(/"/g, '\\"')}"\n`
//   if (tags?.length)   fm += `tags: [${tags.map(t => `"${t}"`).join(", ")}]\n`
//   if (cover)          fm += `cover: "${cover}"\n`
//   if (photos?.length) fm += `photos:\n${photos.map(u => `  - "${u}"`).join("\n")}\n`
//   if (url)            fm += `url: "${url}"\n`
//   if (video)          fm += `video: "${video}"\n`
//   if (videos?.length) fm += `videos:\n${videos.map(u => `  - "${u}"`).join("\n")}\n`
//   fm += `---\n\n${body || ""}`

//   fs.writeFileSync(path.join(CONTENT_DIR, `${id}.md`), fm, "utf-8")
// }

// // ── Обработка альбомов (media group) ─────────────────────────────────────
// // Telegram шлёт фото из одного поста несколькими апдейтами с одним media_group_id
// // Нужно их собрать вместе

// const mediaGroups = {} // { [media_group_id]: { timer, photos[], caption } }

// function handleMediaGroup(bot, msg) {
//   const groupId = msg.media_group_id
//   if (!mediaGroups[groupId]) {
//     mediaGroups[groupId] = { photos: [], caption: msg.caption || "" }
//   }

//   const group = mediaGroups[groupId]
//   if (msg.photo) group.photos.push(msg.photo)

//   // Сбрасываем таймер — ждём все фото группы (обычно <1 сек)
//   clearTimeout(group.timer)
//   group.timer = setTimeout(async () => {
//     await processAlbum(bot, group)
//     delete mediaGroups[groupId]
//   }, 1500)
// }

// async function processAlbum(bot, group) {
//   try {
//     const { photos, caption } = group
//     const text = caption || ""
//     const title = getTitle(text) || "Без заголовка"
//     const id = slugify(title)
//     const tags = extractTags(text)
//     const url = detectVideoUrl(text)
//     const body = getBody(text)

//     // Первое фото — cover, остальные — photos[]
//     const coverUrl = photos[0] ? await bot.getFileLink(photos[0][photos[0].length - 1].file_id) : null
//     const restUrls = []
//     for (const ph of photos.slice(1)) {
//       restUrls.push(await bot.getFileLink(ph[ph.length - 1].file_id))
//     }

//     savePost({ id, title, body, tags, cover: coverUrl, photos: restUrls, url })
//     console.log(`✅ Альбом сохранён: ${id} (${photos.length} фото)`)
//   } catch (e) {
//     console.error("❌ Ошибка при сохранении альбома:", e)
//   }
// }

// // ── Создание бота ─────────────────────────────────────────────────────────

// function createBot() {
//   const token = process.env.TELEGRAM_BOT_TOKEN
//   const channelId = process.env.TELEGRAM_CHANNEL_ID // например -1001234567890

//   if (!token) {
//     console.warn("⚠️  TELEGRAM_BOT_TOKEN не задан, бот не запущен")
//     return null
//   }

//   const bot = new TelegramBot(token, { polling: true })

//   bot.on("channel_post", async (msg) => {
//     // Проверяем что пост именно из нашего канала
//     if (channelId && String(msg.chat.id) !== String(channelId)) return

//     const text = msg.text || msg.caption || ""

//     // ── Альбом (несколько фото) ───────────────────────────────────
//     if (msg.media_group_id) {
//       return handleMediaGroup(bot, msg)
//     }

//     // ── Одно фото ────────────────────────────────────────────────
//     if (msg.photo) {
//       try {
//         const title = getTitle(text) || "Без заголовка"
//         const id = slugify(title)
//         const coverUrl = await getPhotoUrl(bot, msg.photo)
//         const tags = extractTags(text)
//         const url = detectVideoUrl(text)
//         const body = getBody(text)

//         savePost({ id, title, body, tags, cover: coverUrl, url })
//         console.log(`✅ Пост с фото: ${id}`)
//       } catch (e) {
//         console.error("❌ Ошибка:", e)
//       }
//       return
//     }

//     // ── Только видео (mp4) ────────────────────────────────────────
//     if (msg.video) {
//       try {
//         const title = getTitle(text) || "Без заголовка"
//         const id = slugify(title)
//         const videoUrl = await bot.getFileLink(msg.video.file_id)
//         const tags = extractTags(text)
//         const body = getBody(text)

//         savePost({ id, title, body, tags, video: videoUrl })
//         console.log(`✅ Видео-пост: ${id}`)
//       } catch (e) {
//         console.error("❌ Ошибка:", e)
//       }
//       return
//     }

//     // ── Только текст ──────────────────────────────────────────────
//     if (text) {
//       const title = getTitle(text) || "Без заголовка"
//       const id = slugify(title)
//       const tags = extractTags(text)
//       const url = detectVideoUrl(text)
//       const body = getBody(text)
//       // Если в тексте YouTube/Rumble — excerpt это первая строка, body — остальное
//       const excerpt = title.slice(0, 120)

//       savePost({ id, title, body, excerpt, tags, url })
//       console.log(`✅ Текстовый пост: ${id}`)
//     }
//   })

//   console.log("🤖 Telegram-бот (канал) запущен")
//   return bot
// }

// module.exports = { createBot }

// const TelegramBot = require("node-telegram-bot-api")
// const cloudinary  = require("../cloudinary.config")
// const Post        = require("../bot/Post")

// // ── helpers ───────────────────────────────────────────────────────────────

// function slugify(str = "") {
//   return str
//     .toLowerCase()
//     .replace(/[^a-zа-яё0-9\s]/gi, "")
//     .trim()
//     .replace(/\s+/g, "-")
//     .slice(0, 50) || `post-${Date.now()}`
// }

// function detectVideoUrl(text = "") {
//   const match = text.match(
//     /(https?:\/\/(?:youtu\.be\/|(?:www\.)?youtube\.com\/watch\?v=|rumble\.com\/)[^\s]+)/
//   )
//   return match ? match[1] : null
// }

// function extractTags(text = "") {
//   return [...text.matchAll(/#(\w+)/g)].map(m => m[1])
// }

// function getTitle(text = "") {
//   return text.split("\n")[0].replace(/#\w+/g, "").trim().slice(0, 100)
// }

// function getBody(text = "") {
//   return text.split("\n").slice(1).join("\n").trim()
// }

// // ── Cloudinary upload ─────────────────────────────────────────────────────

// // Cloudinary скачивает файл сам по URL — Buffer и axios не нужны
// async function uploadToCloudinary(fileUrl, folder = "blog", resourceType = "image") {
//   const result = await cloudinary.uploader.upload(fileUrl, {
//     folder,
//     resource_type: resourceType,
//     public_id: `tg_${Date.now()}`,
//   })
//   return result.secure_url
// }

// async function getCloudinaryUrl(bot, fileId, isVideo = false) {
//   const fileLink = await bot.getFileLink(fileId)
//   return uploadToCloudinary(fileLink, "blog", isVideo ? "video" : "image")
// }

// // ── Save to MongoDB ───────────────────────────────────────────────────────

// async function savePost(data) {
//   await Post.findOneAndUpdate({ id: data.id }, data, { upsert: true, new: true })
//   console.log(`✅ Saved to MongoDB: ${data.id}`)
// }

// // ── Media group batching ──────────────────────────────────────────────────

// const mediaGroups = {}

// function handleMediaGroup(bot, msg) {
//   const groupId = msg.media_group_id
//   if (!mediaGroups[groupId]) {
//     mediaGroups[groupId] = { photos: [], caption: msg.caption || "" }
//   }
//   const group = mediaGroups[groupId]
//   if (msg.photo) group.photos.push(msg.photo)

//   clearTimeout(group.timer)
//   group.timer = setTimeout(async () => {
//     await processAlbum(bot, group)
//     delete mediaGroups[groupId]
//   }, 1500)
// }

// async function processAlbum(bot, group) {
//   try {
//     const { photos, caption } = group
//     const text  = caption || ""
//     const title = getTitle(text) || "Без заголовка"
//     const id    = slugify(title)
//     const tags  = extractTags(text)
//     const url   = detectVideoUrl(text)
//     const body  = getBody(text)

//     const fileIds = photos.map(ph => ph[ph.length - 1].file_id)
//     const cdnUrls = await Promise.all(fileIds.map(fid => getCloudinaryUrl(bot, fid)))
//     const [cover, ...restPhotos] = cdnUrls

//     await savePost({
//       id, title, type: "company",
//       date: new Date().toISOString().slice(0, 10),
//       tags, cover, photos: restPhotos, url, content: body,
//       excerpt: title.slice(0, 120), source: "telegram",
//     })
//   } catch (e) {
//     console.error("❌ Album error:", e.message)
//   }
// }

// // ── Bot factory ───────────────────────────────────────────────────────────

// function createBot(app) {
//   const token      = process.env.TELEGRAM_BOT_TOKEN
//   const channelId  = process.env.TELEGRAM_CHANNEL_ID
//   const webhookUrl = process.env.TELEGRAM_WEBHOOK_URL

//   if (!token) {
//     console.warn("⚠️  TELEGRAM_BOT_TOKEN not set, bot disabled")
//     return null
//   }

//   const bot = new TelegramBot(token)

//   // bot.setWebHook(`${webhookUrl}/bot${token}`)
//   bot.setWebHook(`${webhookUrl}/webhook`)
//     .then(() => console.log(`🔗 Webhook set: ${webhookUrl}/bot${token}`))
//     .catch(e  => console.error("❌ Webhook error:", e.message))

//   // app.post(`/bot${token}`, (req, res) => {
//     app.post(`/webhook`, (req, res) => {
//        console.log("📥 Webhook received:", JSON.stringify(req.body))
//     bot.processUpdate(req.body)
//     res.sendStatus(200)
//   })

//   bot.on("channel_post", async (msg) => {
//       console.log("📨 channel_post from:", msg.chat.id, msg.chat.title)
//     if (channelId && String(msg.chat.id) !== String(channelId)) return

//     const text = msg.text || msg.caption || ""

//     if (msg.media_group_id) return handleMediaGroup(bot, msg)

//     if (msg.photo) {
//       try {
//         const title    = getTitle(text) || "Без заголовка"
//         const coverUrl = await getCloudinaryUrl(bot, msg.photo[msg.photo.length - 1].file_id)
//         await savePost({
//           id: slugify(title), title, type: "company",
//           date: new Date().toISOString().slice(0, 10),
//           tags: extractTags(text), cover: coverUrl,
//           url: detectVideoUrl(text), content: getBody(text),
//           excerpt: title.slice(0, 120), source: "telegram",
//         })
//       } catch (e) { console.error("❌ Photo error:", e.message) }
//       return
//     }

//     if (msg.video) {
//       try {
//         const title    = getTitle(text) || "Без заголовка"
//         const videoUrl = await getCloudinaryUrl(bot, msg.video.file_id, true)
//         await savePost({
//           id: slugify(title), title, type: "company",
//           date: new Date().toISOString().slice(0, 10),
//           tags: extractTags(text), video: videoUrl, content: getBody(text),
//           excerpt: title.slice(0, 120), source: "telegram",
//         })
//       } catch (e) { console.error("❌ Video error:", e.message) }
//       return
//     }

//     if (text) {
//       const title = getTitle(text) || "Без заголовка"
//       await savePost({
//         id: slugify(title), title, type: "company",
//         date: new Date().toISOString().slice(0, 10),
//         tags: extractTags(text), url: detectVideoUrl(text),
//         content: getBody(text), excerpt: title.slice(0, 120),
//         source: "telegram",
//       })
//     }
//   })

//   console.log("🤖 Telegram bot (webhook) started")
//   return bot
// }

// module.exports = { createBot }


// const TelegramBot = require("node-telegram-bot-api")
// const cloudinary  = require("../cloudinary.config")
// const Post        = require("../bot/Post")

// function slugify(str = "") {
//   return str.toLowerCase().replace(/[^a-zа-яё0-9\s]/gi, "").trim().replace(/\s+/g, "-").slice(0, 50) || `post-${Date.now()}`
// }
// function detectVideoUrl(text = "") {
//   const match = text.match(/(https?:\/\/(?:youtu\.be\/|(?:www\.)?youtube\.com\/watch\?v=|rumble\.com\/)[^\s]+)/)
//   return match ? match[1] : null
// }
// function extractTags(text = "") {
//   return [...text.matchAll(/#(\w+)/g)].map(m => m[1])
// }
// function getTitle(text = "") {
//   return text.split("\n")[0].replace(/#\w+/g, "").trim().slice(0, 100)
// }
// function getBody(text = "") {
//   return text.split("\n").slice(1).join("\n").trim()
// }

// async function uploadToCloudinary(fileUrl, folder = "blog", resourceType = "image") {
//   const result = await cloudinary.uploader.upload(fileUrl, {
//     folder,
//     resource_type: resourceType,
//     public_id: `tg_${Date.now()}`,
//   })
//   return result.secure_url
// }
// async function getCloudinaryUrl(bot, fileId, isVideo = false) {
//   const fileLink = await bot.getFileLink(fileId)
//   return uploadToCloudinary(fileLink, "blog", isVideo ? "video" : "image")
// }

// async function savePost(data) {
//   await Post.findOneAndUpdate({ id: data.id }, data, { upsert: true, new: true })
//   console.log(`✅ Saved: ${data.id}`)
// }

// // ── Общий обработчик сообщения (и channel_post и пересланные) ─────────────

// // async function handleMsg(bot, msg) {
// //   const text = msg.text || msg.caption || ""
// //   const title = getTitle(text) || "Без заголовка"
// //   // const id = slugify(title)

// //   // Дата: берём из оригинального поста если есть, иначе сегодня
// //   const originalDate = msg.forward_date || msg.date
// //   const date = new Date(originalDate * 1000).toISOString().slice(0, 10)
// // // const id = `${slugify(title)}-${date}-${msg.message_id}`
// // const id = `${slugify(title)}-${msg.forward_from_message_id || msg.message_id}`
// //   const base = {
// //     id, title, type: "company", date,
// //     tags: extractTags(text),
// //     url: detectVideoUrl(text),
// //     content: getBody(text),
// //     excerpt: title.slice(0, 120),
// //     source: "telegram",
// //   }

// //   if (msg.photo) {
// //     try {
// //       const coverUrl = await getCloudinaryUrl(bot, msg.photo[msg.photo.length - 1].file_id)
// //       await savePost({ ...base, cover: coverUrl })
// //     } catch (e) { console.error("❌ Photo error:", e.message) }
// //     return
// //   }

// //   if (msg.video) {
// //     try {
// //       const videoUrl = await getCloudinaryUrl(bot, msg.video.file_id, true)
// //       await savePost({ ...base, video: videoUrl })
// //     } catch (e) { console.error("❌ Video error:", e.message) }
// //     return
// //   }

// //   if (text) {
// //     await savePost(base)
// //   }
// // }

// async function handleMsg(bot, msg) {
//   const text = msg.text || msg.caption || ""
//   const title = getTitle(text) || "Без заголовка"
//   const originalDate = msg.forward_date || msg.date
//   const date = new Date(originalDate * 1000).toISOString().slice(0, 10)
//   const originId = msg.forward_from_message_id || msg.message_id
//   const id = `${slugify(title)}-${originId}`

//   const base = {
//     id, title, type: "company", date,
//     tags: extractTags(text),
//     url: detectVideoUrl(text),
//     content: getBody(text),
//     excerpt: title.slice(0, 120),
//     source: "telegram",
//   }

//   if (msg.photo) {
//     try {
//       const coverUrl = await getCloudinaryUrl(bot, msg.photo[msg.photo.length - 1].file_id)
//       await savePost({ ...base, cover: coverUrl })
//     } catch (e) { console.error("❌ Photo error:", e.message) }
//     return
//   }

//   if (msg.video) {
//     try {
//       const videoUrl = await getCloudinaryUrl(bot, msg.video.file_id, true)
//       await savePost({ ...base, video: videoUrl })
//     } catch (e) { console.error("❌ Video error:", e.message) }
//     return
//   }

//   if (text) await savePost(base)
// }


// // ── Media group batching ──────────────────────────────────────────────────

// const mediaGroups = {}
// function handleMediaGroup(bot, msg) {
//   const groupId = msg.media_group_id
//   if (!mediaGroups[groupId]) {
//     mediaGroups[groupId] = { 
//       photos: [], 
//       caption: msg.caption || "", 
//       date: msg.forward_date || msg.date,
//       // ID альбома берём из media_group_id — он одинаковый для всех фото
//       groupId: groupId
//     }
//   }
//   const group = mediaGroups[groupId]
//   if (msg.photo) group.photos.push(msg.photo)

//   clearTimeout(group.timer)
//   group.timer = setTimeout(async () => {
//     await processAlbum(bot, group)
//     delete mediaGroups[groupId]
//   }, 1500)
// }
// // function handleMediaGroup(bot, msg) {
// //   const groupId = msg.media_group_id
// //   if (!mediaGroups[groupId]) {
// //     mediaGroups[groupId] = { photos: [], caption: msg.caption || "", date: msg.forward_date || msg.date }
// //   }
// //   const group = mediaGroups[groupId]
// //   if (msg.photo) group.photos.push(msg.photo)

// //   clearTimeout(group.timer)
// //   group.timer = setTimeout(async () => {
// //     await processAlbum(bot, group)
// //     delete mediaGroups[groupId]
// //   }, 1500)
// // }

// // async function processAlbum(bot, group) {
// //   try {
// //     const { photos, caption, date: rawDate } = group
// //     const text  = caption || ""
// //     const title = getTitle(text) || "Без заголовка"
// //     // const id    = slugify(title)
// //     const id = `${slugify(title)}-${date}`
// //     const date  = new Date(rawDate * 1000).toISOString().slice(0, 10)

// //     const fileIds = photos.map(ph => ph[ph.length - 1].file_id)
// //     const cdnUrls = await Promise.all(fileIds.map(fid => getCloudinaryUrl(bot, fid)))
// //     const [cover, ...restPhotos] = cdnUrls

// //     await savePost({
// //       id, title, type: "company", date,
// //       tags: extractTags(text), cover, photos: restPhotos,
// //       url: detectVideoUrl(text), content: getBody(text),
// //       excerpt: title.slice(0, 120), source: "telegram",
// //     })
// //   } catch (e) {
// //     console.error("❌ Album error:", e.message)
// //   }
// // }

// async function processAlbum(bot, group) {
//   try {
//     const { photos, caption, date: rawDate, groupId } = group
//     const text  = caption || ""
//     const title = getTitle(text) || "Без заголовка"
//     const date  = new Date(rawDate * 1000).toISOString().slice(0, 10)
//     // используем groupId для уникальности альбома
//     const id    = `${slugify(title)}-${groupId}`

//     const fileIds = photos.map(ph => ph[ph.length - 1].file_id)
//     const cdnUrls = await Promise.all(fileIds.map(fid => getCloudinaryUrl(bot, fid)))
//     const [cover, ...restPhotos] = cdnUrls

//     await savePost({
//       id, title, type: "company", date,
//       tags: extractTags(text), cover, photos: restPhotos,
//       url: detectVideoUrl(text), content: getBody(text),
//       excerpt: title.slice(0, 120), source: "telegram",
//     })
//   } catch (e) {
//     console.error("❌ Album error:", e.message)
//   }
// }

// // ── Bot factory ───────────────────────────────────────────────────────────

// function createBot(app) {
//   const token      = process.env.TELEGRAM_BOT_TOKEN
//   const channelId  = process.env.TELEGRAM_CHANNEL_ID
//   const webhookUrl = process.env.TELEGRAM_WEBHOOK_URL

//   if (!token) {
//     console.warn("⚠️  TELEGRAM_BOT_TOKEN not set, bot disabled")
//     return null
//   }

//   const bot = new TelegramBot(token)

//   bot.setWebHook(`${webhookUrl}/webhook`)
//     .then(() => console.log(`🔗 Webhook set: ${webhookUrl}/webhook`))
//     .catch(e  => console.error("❌ Webhook error:", e.message))

//   app.post(`/webhook`, (req, res) => {
//     console.log("📥 Webhook received:", JSON.stringify(req.body).slice(0, 100))
//     bot.processUpdate(req.body)
//     res.sendStatus(200)
//   })

//   // ── Посты из канала (новые) ──────────────────────────────────────────
//   bot.on("channel_post", async (msg) => {
//     if (channelId && String(msg.chat.id) !== String(channelId)) return
//     console.log("📨 channel_post from:", msg.chat.id)
//     if (msg.media_group_id) return handleMediaGroup(bot, msg)
//     await handleMsg(bot, msg)
//   })

//   // ── Пересланные сообщения боту в личку ──────────────────────────────
//   bot.on("message", async (msg) => {
//     // Только пересланные из канала
//     if (!msg.forward_from_chat && !msg.forward_origin) return
//     console.log("📨 Forwarded message received")
//     if (msg.media_group_id) return handleMediaGroup(bot, msg)
//     await handleMsg(bot, msg)
//   })

//   console.log("🤖 Telegram bot (webhook) started")
//   return bot
// }

// module.exports = { createBot }


const TelegramBot = require("node-telegram-bot-api")
const cloudinary  = require("../cloudinary.config")
const Post        = require("../bot/Post")
const { registerDeleteCommand } = require("../deletePost") 
// ── Helpers ───────────────────────────────────────────────────────────────

function slugify(str = "") {
  return str
    .toLowerCase()
    .replace(/[^a-zа-яё0-9\s]/gi, "")
    .trim()
    .replace(/\s+/g, "-")
    .slice(0, 50) || "post"
}

function detectVideoUrl(text = "") {
  const match = text.match(
    /(https?:\/\/(?:youtu\.be\/|(?:www\.)?youtube\.com\/watch\?v=|rumble\.com\/)[^\s]+)/
  )
  return match ? match[1] : null
}

function extractTags(text = "") {
  return [...text.matchAll(/#(\w+)/g)].map(m => m[1])
}

function getTitle(text = "") {
  return text.split("\n")[0].replace(/#\w+/g, "").trim().slice(0, 100)
}

function getBody(text = "") {
  return text.split("\n").slice(1).join("\n").trim()
}


function makePostId(msg) {
  const originMsgId  = msg.forward_from_message_id || msg.message_id
  const originChatId = msg.forward_from_chat?.id || msg.chat.id
  return `tg-${originChatId}-${originMsgId}`
}

function makeAlbumId(mediaGroupId) {
  return `tg-album-${mediaGroupId}`
}



async function uploadToCloudinary(fileUrl, fileUniqueId, folder = "blog", resourceType = "image") {
  const publicId = `${folder}/${fileUniqueId}`


  try {
    const existing = await cloudinary.api.resource(publicId, { resource_type: resourceType })
    console.log(`☁️  Cloudinary: already exists — ${publicId}`)
    return existing.secure_url
  } catch (_) {
    
  }

  const result = await cloudinary.uploader.upload(fileUrl, {
    folder,
    resource_type: resourceType,
    public_id:     fileUniqueId,   // стабильный ID файла от Telegram
    overwrite:     false,          // не перезаписывать существующий
  })
  console.log(`☁️  Cloudinary: uploaded — ${publicId}`)
  return result.secure_url
}

async function getCloudinaryUrl(bot, photo, isVideo = false) {
  const fileObj      = Array.isArray(photo) ? photo[photo.length - 1] : photo
  const fileLink     = await bot.getFileLink(fileObj.file_id)
  const fileUniqueId = fileObj.file_unique_id
  return uploadToCloudinary(fileLink, fileUniqueId, "blog", isVideo ? "video" : "image")
}



async function savePost(data) {
  const doc = await Post.findOneAndUpdate(
    { id: data.id },
    { $set: data },           // $set — не стирает поля, которых нет в data
    { upsert: true, new: true }
  )
  console.log(`✅ MongoDB saved: ${data.id}`)
  return doc
}


function makeTelegramUrl(msgId) {
  const username = process.env.TELEGRAM_CHANNEL_USERNAME
  if (!username || !msgId) return null
  return `https://t.me/${username}/${msgId}`
}
// ── Обработка одиночного сообщения ────────────────────────────────────────

async function handleMsg(bot, msg) {
  const text  = msg.text || msg.caption || ""
  const title = getTitle(text) || "Без заголовка"

  // Дата оригинального поста (Unix → ISO)
  const rawDate = msg.forward_date || msg.date
  const date    = new Date(rawDate * 1000).toISOString().slice(0, 10)

  // Стабильный уникальный ID
  const id = makePostId(msg)


// ↓ originMsgId нужен для URL (message_id поста в канале)
  const originMsgId = msg.forward_from_message_id || msg.message_id


  const base = {
    id, title, type: "company", date,
    tags:    extractTags(text),
    url:     detectVideoUrl(text),
    content: getBody(text),
    excerpt: title.slice(0, 120),
    source:  "telegram",
     telegramUrl: makeTelegramUrl(originMsgId),
  }

  if (msg.photo) {
    try {
      const coverUrl = await getCloudinaryUrl(bot, msg.photo)
      await savePost({ ...base, cover: coverUrl })
    } catch (e) { console.error("❌ Photo error:", e.message) }
    return
  }

  if (msg.video) {
    try {
      const videoUrl = await getCloudinaryUrl(bot, msg.video, true)
      await savePost({ ...base, video: videoUrl })
    } catch (e) { console.error("❌ Video error:", e.message) }
    return
  }

  if (text) await savePost(base)
}



const mediaGroups = {}

function handleMediaGroup(bot, msg) {
  const groupId = msg.media_group_id

  if (!mediaGroups[groupId]) {
    mediaGroups[groupId] = {
      photos:   [],
      caption:  msg.caption || "",
      rawDate:  msg.forward_date || msg.date,
      groupId,
    }
  }

  const group = mediaGroups[groupId]
  if (msg.photo) group.photos.push(msg.photo)

  clearTimeout(group.timer)
  group.timer = setTimeout(async () => {
    await processAlbum(bot, group)
    delete mediaGroups[groupId]
  }, 1500)
}

async function processAlbum(bot, group) {
  try {
    const { photos, caption, rawDate, groupId } = group
    const text  = caption || ""
    const title = getTitle(text) || "Без заголовка"
    const date  = new Date(rawDate * 1000).toISOString().slice(0, 10)
    const id    = makeAlbumId(groupId)   // стабильный ID альбома

    // Загружаем все фото (дедупликация через file_unique_id)
    const cdnUrls = await Promise.all(photos.map(ph => getCloudinaryUrl(bot, ph)))
    const [cover, ...restPhotos] = cdnUrls

    await savePost({
      id, title, type: "company", date,
      tags:    extractTags(text),
      cover,
      photos:  restPhotos,
      url:     detectVideoUrl(text),
      content: getBody(text),
      excerpt: title.slice(0, 120),
      source:  "telegram",
      telegramUrl: makeTelegramUrl(originMsgId),  
    })
  } catch (e) {
    console.error("❌ Album error:", e.message)
  }
}

// ── Bot factory ───────────────────────────────────────────────────────────

function createBot(app) {
  const token      = process.env.TELEGRAM_BOT_TOKEN
  const channelId  = process.env.TELEGRAM_CHANNEL_ID
  const webhookUrl = process.env.TELEGRAM_WEBHOOK_URL

  if (!token) {
    console.warn("⚠️  TELEGRAM_BOT_TOKEN not set, bot disabled")
    return null
  }

  const bot = new TelegramBot(token)

  bot.setWebHook(`${webhookUrl}/webhook`)
    .then(() => console.log(`🔗 Webhook set: ${webhookUrl}/webhook`))
    .catch(e  => console.error("❌ Webhook error:", e.message))

  app.post("/webhook", (req, res) => {
    console.log("📥 Webhook:", JSON.stringify(req.body).slice(0, 120))
    bot.processUpdate(req.body)
    res.sendStatus(200)
  })

  // Новые посты канала
  bot.on("channel_post", async (msg) => {
    if (channelId && String(msg.chat.id) !== String(channelId)) return
    console.log("📨 channel_post:", msg.chat.id, "msg_id:", msg.message_id)
    if (msg.media_group_id) return handleMediaGroup(bot, msg)
    await handleMsg(bot, msg)
  })

  // Пересланные боту в личку (для ручного добавления старых постов)
  bot.on("message", async (msg) => {
      if (String(msg.from.id) !== String(process.env.ADMIN_TELEGRAM_ID)) return
    if (!msg.forward_from_chat && !msg.forward_origin) return
    console.log("📨 Forwarded msg, origin_id:", msg.forward_from_message_id)
    if (msg.media_group_id) return handleMediaGroup(bot, msg)
    await handleMsg(bot, msg)
  })

  console.log("🤖 Telegram bot (webhook) started")
  registerDeleteCommand(bot)
  return bot
}

module.exports = { createBot }