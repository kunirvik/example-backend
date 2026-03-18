const TelegramBot = require("node-telegram-bot-api")
const cloudinary  = require("../cloudinary.config")
const Listing     = require("./Listing")

// ── Константы ─────────────────────────────────────────────────────────────────
const MAX_ACTIVE  = 3  // макс активных объявлений на одного пользователя
const TTL_DAYS    = 14 // дней жизни объявления после одобрения

const CATEGORIES = [
  { id: "bikes",       label: "🚲 Велосипеды"  },
  { id: "parts",       label: "🔩 Запчасти"     },
  { id: "clothing",    label: "👕 Одежда"        },
  { id: "electronics", label: "📱 Электроника"  },
  { id: "other",       label: "📦 Прочее"        },
]

// ── Сессии (FSM) ──────────────────────────────────────────────────────────────
// Храним состояние диалога для каждого пользователя в памяти.
// При рестарте сервера сессии сбрасываются — это нормально.
// Шаги: idle → category → title → description → price → photos → phone → confirm
const sessions = new Map()

function getSession(id) {
  if (!sessions.has(id)) sessions.set(id, { step: "idle", data: { photos: [] } })
  return sessions.get(id)
}
function resetSession(id) {
  sessions.set(id, { step: "idle", data: { photos: [] } })
}
function makeId(telegramId) {
  return `listing-${telegramId}-${Date.now()}`
}

// ── Cloudinary: загрузка фото СО СЖАТИЕМ ──────────────────────────────────────
// transformation применяется ДО сохранения — в облако ложится уже WebP ≤1200px
async function uploadPhoto(bot, photoArray) {
  const file     = photoArray[photoArray.length - 1]
  const fileLink = await bot.getFileLink(file.file_id)
  const pubId    = `marketplace/listing_${file.file_unique_id}`

  // Дедупликация: если уже загружено — вернём существующий URL
  try {
    const ex = await cloudinary.api.resource(pubId, { resource_type: "image" })
    return ex.secure_url
  } catch (_) {}

  const result = await cloudinary.uploader.upload(fileLink, {
    folder:        "marketplace",
    resource_type: "image",
    public_id:     `listing_${file.file_unique_id}`,
    overwrite:     false,
    transformation: [{
      width:   1200,
      height:  1200,
      crop:    "limit",       // уменьшить если больше, сохранить пропорции
      quality: "auto:good",   // ~70% от оригинала, хорошее качество
      format:  "webp",        // WebP в 2–3× меньше JPEG
    }],
  })
  console.log(`☁️  uploaded ${pubId} (${Math.round(result.bytes / 1024)}KB)`)
  return result.secure_url
}

// ── Вспомогалки ───────────────────────────────────────────────────────────────
function escMd(s = "") {
  return String(s).replace(/[_*[\]()~`>#+\-=|{}.!\\]/g, "\\$&")
}

function preview(data, username) {
  const cat = CATEGORIES.find(c => c.id === data.category)?.label || data.category
  return [
    `📋 *Ваше объявление:*`, ``,
    `*Категория:* ${cat}`,
    `*Название:* ${escMd(data.title)}`,
    `*Цена:* ${escMd(data.price || "не указана")}`,
    data.description ? `*Описание:* ${escMd(data.description)}` : null,
    data.phone       ? `*Телефон:* ${escMd(data.phone)}`        : null,
    `*Контакт:* @${escMd(username || "—")}`,
    ``, `_(фото: ${data.photos.length} шт.)_`,
  ].filter(Boolean).join("\n")
}

// ── Шаговые функции ───────────────────────────────────────────────────────────
async function askPrice(bot, chatId, s) {
  s.step = "price"
  await bot.sendMessage(chatId,
    "💰 *Шаг 3 из 5* — Укажите цену:\n\n_Например: `1500 грн`, `$50`, `договорная`_",
    { parse_mode: "Markdown" }
  )
}

async function askPhotos(bot, chatId, s) {
  s.step = "photos"
  await bot.sendMessage(chatId,
    "📸 *Шаг 4 из 5* — Добавьте фото товара (до 5 штук).\n\n_Фото автоматически сжимаются до WebP._",
    {
      parse_mode: "Markdown",
      reply_markup: { inline_keyboard: [[{ text: "⏭ Пропустить", callback_data: "skip_photos" }]] },
    }
  )
}

async function askPhone(bot, chatId, s) {
  s.step = "phone"
  await bot.sendMessage(chatId,
    "📞 *Шаг 5 из 5* — Телефон для связи (необязательно).\n\nПокупатели и так смогут написать вам в Telegram.",
    {
      parse_mode: "Markdown",
      reply_markup: { inline_keyboard: [[{ text: "⏭ Пропустить", callback_data: "skip_phone" }]] },
    }
  )
}

async function showConfirm(bot, chatId, s, username) {
  s.step = "confirm"
  const text = preview(s.data, username)
  const kb = {
    parse_mode: "MarkdownV2",
    reply_markup: {
      inline_keyboard: [[
        { text: "✅ Отправить на модерацию", callback_data: "confirm" },
        { text: "❌ Отменить",               callback_data: "cancel"  },
      ]],
    },
  }
  if (s.data.photos[0]) {
    await bot.sendPhoto(chatId, s.data.photos[0], { caption: text + "\n\n_Всё верно?_", ...kb })
  } else {
    await bot.sendMessage(chatId, text + "\n\n_Всё верно?_", kb)
  }
}

// ── Обработчик сообщений ──────────────────────────────────────────────────────
async function onMessage(bot, msg) {
  const uid      = String(msg.from.id)
  const username = msg.from.username || ""
  const text     = msg.text || ""
  const s        = getSession(uid)

  if (text === "/start") {
    resetSession(uid)
    return bot.sendMessage(msg.chat.id,
      `👋 Привет! Это барахолка\\.\n\nБесплатно размещай объявления о продаже\\.\nМаксимум *${MAX_ACTIVE}* активных объявления\\.\nСрок действия — *${TTL_DAYS} дней* после одобрения\\.`,
      {
        parse_mode: "MarkdownV2",
        reply_markup: { inline_keyboard: [[
          { text: "📝 Подать объявление", callback_data: "start" },
          { text: "📋 Мои объявления",    callback_data: "mine"  },
        ]]},
      }
    )
  }

  if (text === "/cancel") {
    resetSession(uid)
    return bot.sendMessage(msg.chat.id, "❌ Отменено. /start — начать заново.")
  }

  switch (s.step) {
    case "title": {
      if (text.length < 3)   return bot.sendMessage(msg.chat.id, "⚠️ Минимум 3 символа:")
      if (text.length > 100) return bot.sendMessage(msg.chat.id, "⚠️ Максимум 100 символов:")
      s.data.title = text
      s.step = "description"
      return bot.sendMessage(msg.chat.id,
        `✅ Название: *${escMd(text)}*\n\n✏️ *Шаг 2 из 5* — Напишите описание товара или пропустите\\.`,
        {
          parse_mode: "MarkdownV2",
          reply_markup: { inline_keyboard: [[{ text: "⏭ Пропустить", callback_data: "skip_desc" }]] },
        }
      )
    }
    case "description": {
      s.data.description = text.slice(0, 500)
      return askPrice(bot, msg.chat.id, s)
    }
    case "price": {
      if (!text) return bot.sendMessage(msg.chat.id, "⚠️ Укажите цену:")
      s.data.price = text.slice(0, 50)
      return askPhotos(bot, msg.chat.id, s)
    }
    case "photos": {
      if (msg.photo) {
        if (s.data.photos.length >= 5) {
          return bot.sendMessage(msg.chat.id, "⚠️ Максимум 5 фото. Нажмите «Готово»:",
            { reply_markup: { inline_keyboard: [[{ text: `✅ Готово`, callback_data: "photos_done" }]] } }
          )
        }
        const pm = await bot.sendMessage(msg.chat.id, `⏳ Загружаю фото ${s.data.photos.length + 1}...`)
        try {
          const url = await uploadPhoto(bot, msg.photo)
          s.data.photos.push(url)
          const n = s.data.photos.length
          await bot.editMessageText(`✅ Фото ${n} загружено.`, { chat_id: msg.chat.id, message_id: pm.message_id })
          return bot.sendMessage(msg.chat.id,
            n < 5 ? "Отправьте ещё фото или нажмите «Готово»:" : "Максимум 5 фото:",
            { reply_markup: { inline_keyboard: [[{ text: `✅ Готово (${n})`, callback_data: "photos_done" }]] } }
          )
        } catch (e) {
          console.error("upload error:", e.message)
          return bot.editMessageText("❌ Ошибка загрузки, попробуйте ещё раз:", { chat_id: msg.chat.id, message_id: pm.message_id })
        }
      }
      if (text && text !== "/cancel") {
        return bot.sendMessage(msg.chat.id, "📸 Отправьте именно фото (не файл), или пропустите:",
          { reply_markup: { inline_keyboard: [[{ text: "⏭ Пропустить", callback_data: "skip_photos" }]] } }
        )
      }
      break
    }
    case "phone": {
      s.data.phone = text.slice(0, 20)
      return showConfirm(bot, msg.chat.id, s, username)
    }
    default: {
      if (text && !text.startsWith("/")) {
        return bot.sendMessage(msg.chat.id, "Напишите /start чтобы подать объявление.")
      }
    }
  }
}

// ── Обработчик кнопок ─────────────────────────────────────────────────────────
async function onCallback(bot, q) {
  const uid      = String(q.from.id)
  const username = q.from.username || ""
  const chatId   = q.message.chat.id
  const data     = q.data
  const s        = getSession(uid)

  await bot.answerCallbackQuery(q.id)

  // Начало анкеты
  if (data === "start") {
    const count = await Listing.countDocuments({ telegramId: uid, status: { $in: ["pending", "published"] } })
    if (count >= MAX_ACTIVE) {
      return bot.sendMessage(chatId, `⚠️ У вас уже ${count} активных объявления (макс. ${MAX_ACTIVE}).\nДождитесь истечения или напишите администратору.`)
    }
    resetSession(uid)
    const s = getSession(uid)  // ← берём СВЕЖУЮ сессию после сброса
    s.step = "category"
    return bot.sendMessage(chatId, "📦 *Шаг 1 из 5* — Выберите категорию:", {
      parse_mode: "Markdown",
      reply_markup: { inline_keyboard: [
        CATEGORIES.slice(0, 2).map(c => ({ text: c.label, callback_data: `cat_${c.id}` })),
        CATEGORIES.slice(2, 4).map(c => ({ text: c.label, callback_data: `cat_${c.id}` })),
        [{ text: CATEGORIES[4].label, callback_data: `cat_${CATEGORIES[4].id}` }],
      ]},
    })
  }

  // Выбор категории
  if (data.startsWith("cat_") && s.step === "category") {
    const id    = data.slice(4)
    const label = CATEGORIES.find(c => c.id === id)?.label || id
    s.data.category = id
    s.step = "title"
    return bot.sendMessage(chatId,
      `✅ Категория: *${label}*\n\n✏️ *Шаг 2 из 5* — Введите название товара:`,
      { parse_mode: "Markdown" }
    )
  }

  if (data === "skip_desc"   && s.step === "description") { s.data.description = ""; return askPrice(bot, chatId, s) }
  if (data === "skip_photos" && s.step === "photos")       { return askPhone(bot, chatId, s) }
  if (data === "photos_done" && s.step === "photos")       { return askPhone(bot, chatId, s) }
  if (data === "skip_phone"  && s.step === "phone")        { s.data.phone = ""; return showConfirm(bot, chatId, s, username) }

  // Подтверждение → сохраняем в БД
  if (data === "confirm" && s.step === "confirm") {
    try {
      const listing = await Listing.create({
        id:               makeId(uid),
        title:            s.data.title,
        description:      s.data.description,
        price:            s.data.price,
        category:         s.data.category,
        photos:           s.data.photos,
        contactPhone:     s.data.phone,
        contactUsername:  username,
        telegramId:       uid,
        telegramUsername: username,
        status:           "pending",
      })
      resetSession(uid)
      return bot.sendMessage(chatId,
        `✅ *Объявление отправлено на модерацию\\!*\n\nМы рассмотрим его в течение 24 часов и уведомим вас\\.`,
        { parse_mode: "MarkdownV2" }
      )
    } catch (e) {
      console.error("listing save error:", e.message)
      return bot.sendMessage(chatId, "❌ Ошибка при сохранении. Попробуйте /start")
    }
  }

  if (data === "cancel") {
    resetSession(uid)
    return bot.sendMessage(chatId, "❌ Отменено. /start — начать заново.")
  }

  // Мои объявления
  if (data === "mine") {
    const list = await Listing.find({ telegramId: uid }).sort({ createdAt: -1 }).limit(10).lean()
    if (!list.length) return bot.sendMessage(chatId, "У вас ещё нет объявлений. /start — подать первое!")
    const emoji = { pending: "⏳", published: "✅", rejected: "❌", expired: "🕐" }
    const label = { pending: "На модерации", published: "Опубликовано", rejected: "Отклонено", expired: "Истекло" }
    const txt = list.map((l, i) =>
      `${i + 1}\\. ${emoji[l.status]} *${escMd(l.title)}*\n   ${escMd(label[l.status])} · ${escMd(l.price || "—")}` +
      (l.rejectReason ? `\n   _Причина: ${escMd(l.rejectReason)}_` : "")
    ).join("\n\n")
    return bot.sendMessage(chatId, `📋 *Ваши объявления:*\n\n${txt}`, { parse_mode: "MarkdownV2" })
  }
}

// ── Уведомления от API → пользователю ────────────────────────────────────────
let _bot = null

async function notifyUser(telegramId, text) {
  if (!_bot || !telegramId) return
  try { await _bot.sendMessage(telegramId, text, { parse_mode: "MarkdownV2" }) }
  catch (e) { console.warn("notify failed:", e.message) }
}

async function notifyApproved(listing) {
  await notifyUser(listing.telegramId,
    `✅ *Объявление одобрено\\!*\n\n*${escMd(listing.title)}*\n\nОпубликовано и будет активно ${TTL_DAYS} дней\\.`
  )
}
async function notifyRejected(listing, reason = "") {
  await notifyUser(listing.telegramId,
    `❌ *Объявление отклонено*\n\n*${escMd(listing.title)}*` +
    (reason ? `\n\n_Причина: ${escMd(reason)}_` : "") +
    `\n\nПо вопросам — обратитесь к администратору\\.`
  )
}
async function notifyExpired(listing) {
  await notifyUser(listing.telegramId,
    `🕐 *Объявление истекло*\n\n*${escMd(listing.title)}*\n\nСрок ${TTL_DAYS} дней истёк\\. Подайте заново: /start`
  )
}

// ── Запуск бота ───────────────────────────────────────────────────────────────
function createMarketplaceBot(app) {
  const token      = process.env.MARKETPLACE_BOT_TOKEN
  const webhookUrl = process.env.TELEGRAM_WEBHOOK_URL

  if (!token) {
    console.warn("⚠️  MARKETPLACE_BOT_TOKEN не задан — бот барахолки не запущен")
    return null
  }

  const bot = new TelegramBot(token)
  _bot = bot

  bot.setWebHook(`${webhookUrl}/market-webhook`)
    .then(() => console.log(`🛒 Market webhook: ${webhookUrl}/market-webhook`))
    .catch(e  => console.error("❌ Market webhook error:", e.message))

  app.post("/market-webhook", (req, res) => {
    bot.processUpdate(req.body)
    res.sendStatus(200)
  })

  bot.on("message",       msg => onMessage(bot, msg).catch(e   => console.error("msg err:", e.message)))
  bot.on("callback_query", q  => onCallback(bot, q).catch(e    => console.error("cb err:",  e.message)))

  console.log("🛒 Marketplace bot started")
  return bot
}

module.exports = { createMarketplaceBot, notifyApproved, notifyRejected, notifyExpired, TTL_DAYS }