const TelegramBot = require("node-telegram-bot-api")
const cloudinary  = require("../cloudinary.config")
const Listing     = require("./Listing")

const MAX_ACTIVE  = 3
const TTL_DAYS    = 14
const COOLDOWN_MS = 15 * 60 * 1000

const CATEGORIES = [
  { id: "bikes",       label: "🚲 Велосипеди"   },
  { id: "parts",       label: "🔩 Запчастини"    },
  { id: "clothing",    label: "👕 Одяг"           },
  { id: "electronics", label: "📱 Електроніка"   },
  { id: "other",       label: "📦 Інше"           },
]

const CURRENCIES = [
  { id: "uah",   label: "₴ Гривня",      symbol: "₴",  after: true  },
  { id: "usd",   label: "$ Долар",        symbol: "$",  after: false },
  { id: "eur",   label: "€ Євро",         symbol: "€",  after: false },
  { id: "trade", label: "🔄 Обмін",       noAmount: true },
  { id: "free",  label: "🤝 Договірна",   noAmount: true },
]

const BANNED_PATTERNS = [/руб/i, /рублей/i, /rub\b/i, /kzt/i, /тенге/i, /бел/i]

// ── Сесії FSM ─────────────────────────────────────────────────────────────────
const sessions = new Map()

function getSession(id) {
  if (!sessions.has(id)) sessions.set(id, { step: "idle", data: { photos: [] } })
  return sessions.get(id)
}
function resetSession(id) {
  sessions.set(id, { step: "idle", data: { photos: [] } })
}
function makeId(uid) { return `listing-${uid}-${Date.now()}` }

// ── Кулдаун ───────────────────────────────────────────────────────────────────
const cooldowns = new Map()

function cooldownLeft(uid) {
  const last = cooldowns.get(uid)
  if (!last) return 0
  const left = COOLDOWN_MS - (Date.now() - last)
  return left > 0 ? left : 0
}
function fmtCooldown(ms) { return `${Math.ceil(ms / 60000)} хв.` }

// ── Cloudinary ────────────────────────────────────────────────────────────────
async function uploadPhoto(bot, photoArray) {
  const file     = photoArray[photoArray.length - 1]
  const fileLink = await bot.getFileLink(file.file_id)
  const pubId    = `marketplace/listing_${file.file_unique_id}`

  try {
    const ex = await cloudinary.api.resource(pubId, { resource_type: "image" })
    return ex.secure_url
  } catch (_) {}

  const result = await cloudinary.uploader.upload(fileLink, {
    folder: "marketplace", resource_type: "image",
    public_id: `listing_${file.file_unique_id}`, overwrite: false,
    transformation: [{ width: 1200, height: 1200, crop: "limit", quality: "auto:good", format: "webp" }],
  })
  console.log(`☁️  uploaded ${pubId} (${Math.round(result.bytes / 1024)}KB)`)
  return result.secure_url
}

// ── Форматування ──────────────────────────────────────────────────────────────
function escMd(s = "") {
  return String(s).replace(/[_*[\]()~`>#+\-=|{}.!\\]/g, "\\$&")
}

function formatPrice(currency, amount) {
  const cur = CURRENCIES.find(c => c.id === currency)
  if (!cur) return amount || "Не вказана"
  if (cur.noAmount) return cur.label
  if (!amount) return cur.label
  return cur.after ? `${amount} ${cur.symbol}` : `${cur.symbol}${amount}`
}

function preview(data, username) {
  const cat   = CATEGORIES.find(c => c.id === data.category)?.label || data.category
  const price = formatPrice(data.currency, data.amount)
  const count = data.photos.length
  return [
    `📋 *Ваше оголошення:*`, ``,
    `*Категорія:* ${escMd(cat)}`,
    `*Назва:* ${escMd(data.title)}`,
    `*Ціна:* ${escMd(price)}`,
    data.description ? `*Опис:* ${escMd(data.description)}` : null,
    data.phone       ? `*Телефон:* ${escMd(data.phone)}`    : null,
    `*Контакт:* @${escMd(username || "—")}`,
    ``, `_\\(фото: ${count} шт\\.\\)_`,
  ].filter(Boolean).join("\n")
}

// ── Крокові функції ───────────────────────────────────────────────────────────

async function askCurrency(bot, chatId, s) {
  s.step = "currency"
  await bot.sendMessage(chatId,
    "💰 *Крок 3 з 5* — Оберіть тип ціни:",
    {
      parse_mode: "Markdown",
      reply_markup: { inline_keyboard: [
        CURRENCIES.slice(0, 3).map(c => ({ text: c.label, callback_data: `cur_${c.id}` })),
        CURRENCIES.slice(3).map(c  => ({ text: c.label, callback_data: `cur_${c.id}` })),
      ]},
    }
  )
}

async function askAmount(bot, chatId, s) {
  s.step = "amount"
  const cur = CURRENCIES.find(c => c.id === s.data.currency)
  await bot.sendMessage(chatId,
    `${cur.label} — введіть суму цифрами:\n_Наприклад: 1500 або 50_`,
    {
      parse_mode: "Markdown",
      reply_markup: { inline_keyboard: [[{ text: "◀️ Змінити валюту", callback_data: "back_currency" }]] },
    }
  )
}

async function askPhotos(bot, chatId, s) {
  s.step = "photos"
  await bot.sendMessage(chatId,
    "📸 *Крок 4 з 5* — Додайте фото товару (до 5 штук).\n_Фото автоматично стискаються._",
    {
      parse_mode: "Markdown",
      reply_markup: { inline_keyboard: [[{ text: "⏭ Пропустити", callback_data: "skip_photos" }]] },
    }
  )
}

async function askPhone(bot, chatId, s) {
  s.step = "phone"
  await bot.sendMessage(chatId,
    "📞 *Крок 5 з 5* — Телефон для зв'язку (необов'язково).\nПокупці зможуть написати вам у Telegram.",
    {
      parse_mode: "Markdown",
      reply_markup: { inline_keyboard: [[{ text: "⏭ Пропустити", callback_data: "skip_phone" }]] },
    }
  )
}

async function showConfirm(bot, chatId, s, username) {
  s.step = "confirm"
  const text    = preview(s.data, username)
  const caption = text + "\n\n_Все вірно\\?_"
  const kb = {
    parse_mode: "MarkdownV2",
    reply_markup: { inline_keyboard: [[
      { text: "✅ Надіслати на модерацію", callback_data: "confirm" },
      { text: "✏️ Заповнити знову",        callback_data: "restart" },
    ]]},
  }
  if (s.data.photos[0]) {
    await bot.sendPhoto(chatId, s.data.photos[0], { caption, ...kb })
  } else {
    await bot.sendMessage(chatId, caption, kb)
  }
}

// ── Обробник повідомлень ──────────────────────────────────────────────────────
async function onMessage(bot, msg) {
  const uid      = String(msg.from.id)
  const username = msg.from.username || ""
  const text     = msg.text || ""
  const s        = getSession(uid)

  if (text === "/start") {
    resetSession(uid)
    return bot.sendMessage(msg.chat.id,
      "Привіт! Це барахолка.\n\nБезкоштовно розміщуй оголошення про продаж.\nМаксимум *3* активних оголошення.\nСтрок дії — *14 днів* після схвалення.",
      {
        parse_mode: "Markdown",
        reply_markup: { inline_keyboard: [[
          { text: "📝 Подати оголошення", callback_data: "start" },
          { text: "📋 Мої оголошення",    callback_data: "mine"  },
        ]]},
      }
    )
  }

  if (text === "/cancel") {
    resetSession(uid)
    return bot.sendMessage(msg.chat.id, "Скасовано. Напишіть /start щоб почати знову.")
  }

  switch (s.step) {
    case "title": {
      if (text.length < 3)   return bot.sendMessage(msg.chat.id, "Мінімум 3 символи. Спробуйте ще раз:")
      if (text.length > 100) return bot.sendMessage(msg.chat.id, "Максимум 100 символів. Спробуйте ще раз:")
      s.data.title = text
      s.step = "description"
      return bot.sendMessage(msg.chat.id,
        `Назва: *${escMd(text)}*\n\nКрок 2 з 5 — Напишіть опис або пропустіть\\.`,
        {
          parse_mode: "MarkdownV2",
          reply_markup: { inline_keyboard: [[{ text: "⏭ Пропустити", callback_data: "skip_desc" }]] },
        }
      )
    }
    case "description": {
      s.data.description = text.slice(0, 500)
      return askCurrency(bot, msg.chat.id, s)
    }
    case "amount": {
      if (BANNED_PATTERNS.some(rx => rx.test(text))) {
        return bot.sendMessage(msg.chat.id,
          "Рублі та інші валюти тут не приймаються.\nОберіть: гривня, долар, євро, обмін або договірна.",
          { reply_markup: { inline_keyboard: [[{ text: "◀️ Обрати валюту", callback_data: "back_currency" }]] } }
        )
      }
      const num = text.trim().replace(",", ".")
      if (!/^\d+(\.\d+)?$/.test(num)) {
        return bot.sendMessage(msg.chat.id,
          "Введіть суму цифрами, наприклад *1500* або *50*",
          {
            parse_mode: "Markdown",
            reply_markup: { inline_keyboard: [[{ text: "◀️ Змінити валюту", callback_data: "back_currency" }]] },
          }
        )
      }
      s.data.amount = num
      return askPhotos(bot, msg.chat.id, s)
    }
    case "photos": {
      if (msg.photo) {
        if (s.data.photos.length >= 5) {
          return bot.sendMessage(msg.chat.id, "Максимум 5 фото. Натисніть «Готово»:",
            { reply_markup: { inline_keyboard: [[{ text: "✅ Готово", callback_data: "photos_done" }]] } }
          )
        }
        const pm = await bot.sendMessage(msg.chat.id, `Завантажую фото ${s.data.photos.length + 1}...`)
        try {
          const url = await uploadPhoto(bot, msg.photo)
          s.data.photos.push(url)
          const n = s.data.photos.length
          await bot.editMessageText(`Фото ${n} завантажено.`, { chat_id: msg.chat.id, message_id: pm.message_id })
          return bot.sendMessage(msg.chat.id,
            n < 5 ? "Надішліть ще фото або натисніть «Готово»:" : "Максимум 5 фото:",
            { reply_markup: { inline_keyboard: [[{ text: `✅ Готово (${n})`, callback_data: "photos_done" }]] } }
          )
        } catch (e) {
          console.error("upload error:", e.message)
          return bot.editMessageText("Помилка завантаження. Спробуйте ще раз:", { chat_id: msg.chat.id, message_id: pm.message_id })
        }
      }
      if (text && text !== "/cancel") {
        return bot.sendMessage(msg.chat.id, "Надішліть саме фото (не файл), або пропустіть:",
          { reply_markup: { inline_keyboard: [[{ text: "⏭ Пропустити", callback_data: "skip_photos" }]] } }
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
        return bot.sendMessage(msg.chat.id, "Напишіть /start щоб подати оголошення.")
      }
    }
  }
}

// ── Обробник кнопок ───────────────────────────────────────────────────────────
async function onCallback(bot, q) {
  const uid      = String(q.from.id)
  const username = q.from.username || ""
  const chatId   = q.message.chat.id
  const data     = q.data

  await bot.answerCallbackQuery(q.id)

  // ── Старт / перезапуск ───────────────────────────────────────────────────
  if (data === "start" || data === "restart") {
    const left = cooldownLeft(uid)
    if (left > 0) {
      return bot.sendMessage(chatId,
        `Ви нещодавно подавали оголошення.\n\nЗачекайте ще *${fmtCooldown(left)}* перед наступним.\n_Це захист від спаму._`,
        { parse_mode: "Markdown" }
      )
    }
    const count = await Listing.countDocuments({ telegramId: uid, status: { $in: ["pending", "published"] } })
    if (count >= MAX_ACTIVE) {
      return bot.sendMessage(chatId,
        `У вас вже ${count} активних оголошення (макс. ${MAX_ACTIVE}).\nДочекайтесь закінчення старих або зверніться до адміністратора.`
      )
    }

    resetSession(uid)
    const s = getSession(uid)
    s.step = "category"

    await bot.sendMessage(chatId,
      "⚠️ *Прочитайте перед заповненням:*\n\n" +
      "• Реальна назва та опис товару\n" +
      "• Актуальна ціна — лише гривня, долар, євро\n" +
      "• Фото підвищують шанс схвалення\n" +
      "• Одне оголошення — один товар\n" +
      "• Після надсилання не можна редагувати\n\n" +
      "_Наступне оголошення можна подати через 15 хвилин._",
      { parse_mode: "Markdown" }
    )

    return bot.sendMessage(chatId, "Крок 1 з 5 — Оберіть категорію:", {
      reply_markup: { inline_keyboard: [
        CATEGORIES.slice(0, 2).map(c => ({ text: c.label, callback_data: `cat_${c.id}` })),
        CATEGORIES.slice(2, 4).map(c => ({ text: c.label, callback_data: `cat_${c.id}` })),
        [{ text: CATEGORIES[4].label, callback_data: `cat_${CATEGORIES[4].id}` }],
      ]},
    })
  }

  const s = getSession(uid)

  // ── Категорія ─────────────────────────────────────────────────────────────
  if (data.startsWith("cat_") && s.step === "category") {
    const catId = data.slice(4)
    const label = CATEGORIES.find(c => c.id === catId)?.label || catId
    s.data.category = catId
    s.step = "title"
    return bot.sendMessage(chatId,
      `Категорія: *${label}*\n\nКрок 2 з 5 — Введіть назву товару:\n_Наприклад: "Велосипед Trek Marlin 5, 2022"_`,
      { parse_mode: "Markdown" }
    )
  }

  // ── Валюта ────────────────────────────────────────────────────────────────
  if (data === "back_currency") {
    return askCurrency(bot, chatId, s)
  }

  if (data.startsWith("cur_") && (s.step === "currency" || s.step === "amount")) {
    const curId = data.slice(4)
    const cur   = CURRENCIES.find(c => c.id === curId)
    if (!cur) return
    s.data.currency = curId
    s.data.amount   = ""
    if (cur.noAmount) return askPhotos(bot, chatId, s)
    return askAmount(bot, chatId, s)
  }

  if (data === "skip_desc"   && s.step === "description") { s.data.description = ""; return askCurrency(bot, chatId, s) }
  if (data === "skip_photos" && s.step === "photos")       { return askPhone(bot, chatId, s) }
  if (data === "photos_done" && s.step === "photos")       { return askPhone(bot, chatId, s) }
  if (data === "skip_phone"  && s.step === "phone")        { s.data.phone = ""; return showConfirm(bot, chatId, s, username) }

  // ── Підтвердження ─────────────────────────────────────────────────────────
  if (data === "confirm" && s.step === "confirm") {
    const left = cooldownLeft(uid)
    if (left > 0) return bot.sendMessage(chatId, `Зачекайте ще ${fmtCooldown(left)}.`)

    try {
      await Listing.create({
        id:               makeId(uid),
        title:            s.data.title,
        description:      s.data.description,
        price:            formatPrice(s.data.currency, s.data.amount),
        category:         s.data.category,
        photos:           s.data.photos,
        contactPhone:     s.data.phone,
        contactUsername:  username,
        telegramId:       uid,
        telegramUsername: username,
        status:           "pending",
      })

      cooldowns.set(uid, Date.now())
      resetSession(uid)

      return bot.sendMessage(chatId,
        "Оголошення надіслано на модерацію.\n\nРозглянемо протягом 24 годин.\n_Наступне — через 15 хвилин._",
        { parse_mode: "Markdown" }
      )
    } catch (e) {
      console.error("listing save error:", e.message)
      return bot.sendMessage(chatId, "Помилка при збереженні. Спробуйте /start")
    }
  }

  if (data === "cancel") {
    resetSession(uid)
    return bot.sendMessage(chatId, "Скасовано. /start — почати знову.")
  }

  // ── Мої оголошення ────────────────────────────────────────────────────────
  if (data === "mine") {
    const list = await Listing.find({ telegramId: uid }).sort({ createdAt: -1 }).limit(10).lean()
    if (!list.length) {
      return bot.sendMessage(chatId, "У вас ще немає оголошень. /start — подати перше.")
    }
    const emoji = { pending: "⏳", published: "✅", rejected: "❌", expired: "🕐" }
    const lbl   = { pending: "На модерації", published: "Опубліковано", rejected: "Відхилено", expired: "Закінчилось" }
    const txt   = list.map((l, i) =>
      `${i + 1}\\. ${emoji[l.status]} *${escMd(l.title)}*\n` +
      `   ${escMd(lbl[l.status])} · ${escMd(l.price || "—")}` +
      (l.rejectReason ? `\n   _Причина: ${escMd(l.rejectReason)}_` : "")
    ).join("\n\n")
    return bot.sendMessage(chatId, `*Ваші оголошення:*\n\n${txt}`, { parse_mode: "MarkdownV2" })
  }
}

// ── Сповіщення ────────────────────────────────────────────────────────────────
let _bot = null

async function notifyUser(telegramId, text) {
  if (!_bot || !telegramId) return
  try { await _bot.sendMessage(telegramId, text, { parse_mode: "Markdown" }) }
  catch (e) { console.warn("notify failed:", e.message) }
}

async function notifyApproved(listing) {
  await notifyUser(listing.telegramId,
    `✅ *Оголошення схвалено!*\n\n${listing.title}\n\nОпубліковано і буде активним ${TTL_DAYS} днів.`
  )
}
async function notifyRejected(listing, reason = "") {
  await notifyUser(listing.telegramId,
    `❌ *Оголошення відхилено*\n\n${listing.title}` +
    (reason ? `\n\nПричина: ${reason}` : "") +
    `\n\nЗ питань зверніться до адміністратора.`
  )
}
async function notifyExpired(listing) {
  await notifyUser(listing.telegramId,
    `🕐 *Оголошення закінчилось*\n\n${listing.title}\n\nСтрок ${TTL_DAYS} днів минув. Подайте знову: /start`
  )
}

// ── Запуск ────────────────────────────────────────────────────────────────────
function createMarketplaceBot(app) {
  const token      = process.env.MARKETPLACE_BOT_TOKEN
  const webhookUrl = process.env.TELEGRAM_WEBHOOK_URL
  const isDev      = process.env.NODE_ENV !== "production"

  if (!token) {
    console.warn("⚠️  MARKETPLACE_BOT_TOKEN не задано — бот барахолки не запущено")
    return null
  }

  const bot = new TelegramBot(token, isDev ? { polling: true } : {})
  _bot = bot

  if (!isDev) {
    bot.setWebHook(`${webhookUrl}/market-webhook`)
      .then(() => console.log(`🛒 Market webhook: ${webhookUrl}/market-webhook`))
      .catch(e  => console.error("❌ Market webhook error:", e.message))
    app.post("/market-webhook", (req, res) => { bot.processUpdate(req.body); res.sendStatus(200) })
  } else {
    console.log("🛒 Market bot: polling mode (dev)")
  }

  bot.on("message",        msg => onMessage(bot, msg).catch(e  => console.error("msg err:", e.message)))
  bot.on("callback_query", q   => onCallback(bot, q).catch(e   => console.error("cb err:",  e.message)))

  console.log("🛒 Marketplace bot started")
  return bot
}

module.exports = { createMarketplaceBot, notifyApproved, notifyRejected, notifyExpired, TTL_DAYS }