const TelegramBot = require("node-telegram-bot-api")
const cloudinary  = require("../cloudinary.config")
const Listing     = require("./Listing")
const redis = require("../redis")
const bans = require('./user-bans')
const MAX_ACTIVE  = 3
const MAX_DAILY   = 3  // Максимум 3 объявления в день
const TTL_DAYS    = 14
const COOLDOWN_MS = 15 * 60 * 1000  // 15 минут между объявлениями

// ── КАТЕГОРІЇ З УНІКАЛЬНИМИ ПРИКЛАДАМИ ───────────────────────────────────────
const CATEGORIES = [
  {
    id: "mtb",
    label: "🚵 MTB",
    example: "Наприклад: Trek Marlin 5, 2022 рік. Розмір рами 17.5 (М). Стан хороший, пробіг ~500 км. Є подряпини на рамі, технічно справний. Вилка RockShox, гідравлічні гальма."
  },
  {
    id: "bmx",
    label: "🚴 BMX",
    example: "Наприклад: Mongoose Legion L100, 2021. Колеса 20 дюймів. Стан відмінний, використовувався рідко. Без тріщин та серйозних пошкоджень, всі деталі оригінальні."
  },
  {
    id: "skate",
    label: "🛹 Skate",
    example: "Наприклад: Скейтборд Element Section, дека 8 дюймів. Підвіски Independent, колеса Spitfire 52мм. Грип-тейп новий, дошка в хорошому стані."
  },
  {
    id: "parts",
    label: "🔧 Запчастини",
    example: "Наприклад: Касета Shimano Deore XT 11-42T, 11 швидкостей. Майже нова, проїхала ~200 км. Без зносу зубів, працює ідеально."
  },
  {
    id: "clothing",
    label: "👕 Одяг",
    example: "Наприклад: Велофутболка Fox Racing, розмір M. Матеріал швидко сохне, світловідбиваючі елементи. Стан відмінний, прання 2-3 рази, без дефектів."
  },
  {
    id: "other",
    label: "📦 Інше",
    example: "Наприклад: Велосипедний шолом Giro Fixture, розмір M (54-61см). Стан ідеальний, використовувався 1 сезон. Регулювання розміру, знімний козирок."
  },
]
 
const CURRENCIES = [
  { id: "uah",   label: "₴ Гривня",      symbol: "₴",  after: true  },
  { id: "usd",   label: "$ Долар",        symbol: "$",  after: false },
  { id: "eur",   label: "€ Євро",         symbol: "€",  after: false },
  { id: "trade", label: "🔄 Обмін",       noAmount: true },
  { id: "free",  label: "🤝 Договірна",   noAmount: true },
]

// bot/Marketplacebot.js - добавить функцию

const crypto = require('crypto')

// Генерировать уникальный хеш для объявления
function generateListingHash(data) {
  const normalized = `
    ${data.title}
    ${data.category}
    ${data.description || ''}
    ${data.price || ''}
  `.trim()
  
  return crypto
    .createHash('sha256')
    .update(normalized)
    .digest('hex')
    .slice(0, 16)  // Первые 16 символов
}

// Проверить дубли за последние 24 часа
async function isDuplicate(uid, listingHash) {
  const oneDayAgo = new Date(Date.now() - 24 * 60 * 60 * 1000)
  
  const duplicate = await Listing.findOne({
    telegramId: uid,
    listingHash: listingHash,
    createdAt: { $gt: oneDayAgo }
  })
  
  return !!duplicate
} 




const BANNED_PATTERNS = [/руб/i, /рублей/i, /rub\b/i, /kzt/i, /тенге/i, /бел/i]

// ── ВАЛИДАЦИЯ УКРАИНСКОГО НОМЕРА ──────────────────────────────────────────────
const UA_PHONE_REGEX = /^(\+?38)?0(39|50|63|66|67|68|73|91|92|93|94|95|96|97|98|99)\d{7}$/

function validateUkrainianPhone(phone) {
  const cleaned = phone.replace(/[\s\-\(\)]/g, "")
  return UA_PHONE_REGEX.test(cleaned)
}

function formatPhoneForDisplay(phone) {
  const cleaned = phone.replace(/[\s\-\(\)]/g, "")
  if (cleaned.startsWith("+38")) return cleaned
  if (cleaned.startsWith("38")) return "+" + cleaned
  if (cleaned.startsWith("0")) return "+38" + cleaned
  return phone
}

// ── Сесії FSM (БЕЗ ІСТОРІЇ) ──────────────────────────────────────────────────
const sessions = new Map()

function getSession(id) {
  if (!sessions.has(id)) {
    sessions.set(id, { 
      step: "idle", 
      data: { photos: [] }
    })
  }
  return sessions.get(id)
}

function resetSession(id) {
  sessions.set(id, { 
    step: "idle", 
    data: { photos: [] }
  })
}

function makeId(uid) { return `listing-${uid}-${Date.now()}` }

// ── СИСТЕМА ДНЕВНЫХ ЛИМИТОВ ───────────────────────────────────────────────────
// const dailyAttempts = new Map()

// function getDailyStats(uid) {
//   const today = new Date().toISOString().split("T")[0]
//   const stats = dailyAttempts.get(uid)
  
//   if (!stats || stats.date !== today) {
//     const newStats = { date: today, submitted: 0, rejected: 0 }
//     dailyAttempts.set(uid, newStats)
//     return newStats
//   }
//   return stats
// }

// ✅ Redis управляет лимитами с TTL


async function getDailyStats(uid) {
  let stats = await redis.getDailyLimit(uid)
  
  if (!stats) {
    stats = { submitted: 0, rejected: 0 }
    await redis.setDailyLimit(uid, stats)
  }
  
  return stats
}

async function canSubmitToday(uid) {
  const stats = await getDailyStats(uid)
  const totalAttempts = stats.submitted + stats.rejected
  return totalAttempts < MAX_DAILY
}

async function recordSubmission(uid) {
  await redis.incrementDailyAttempt(uid, 'submitted')
}

async function recordRejection(uid) {
  await redis.incrementDailyAttempt(uid, 'rejected')
}

async function getRemainingAttempts(uid) {
  const stats = await getDailyStats(uid)
  const totalAttempts = stats.submitted + stats.rejected
  return Math.max(0, MAX_DAILY - totalAttempts)
}

function canSubmitToday(uid) {
  const stats = getDailyStats(uid)
  const totalAttempts = stats.submitted + stats.rejected
  return totalAttempts < MAX_DAILY
}

function getRemainingAttempts(uid) {
  const stats = getDailyStats(uid)
  const totalAttempts = stats.submitted + stats.rejected
  return Math.max(0, MAX_DAILY - totalAttempts)
}

function recordSubmission(uid) {
  const stats = getDailyStats(uid)
  stats.submitted++
}

function recordRejection(uid) {
  const stats = getDailyStats(uid)
  stats.rejected++
}

// ── Кулдаун ───────────────────────────────────────────────────────────────────
const cooldowns = new Map()

function cooldownLeft(uid) {
  const last = cooldowns.get(uid)
  if (!last) return 0
  const left = COOLDOWN_MS - (Date.now() - last)
  return left > 0 ? left : 0
}

function fmtCooldown(ms) { 
  return `${Math.ceil(ms / 60000)} хв.` 
}

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
    folder: "marketplace", 
    resource_type: "image",
    public_id: `listing_${file.file_unique_id}`, 
    overwrite: false,
    transformation: [{ 
      width: 1200, 
      height: 1200, 
      crop: "limit", 
      quality: "auto:good", 
      format: "webp" 
    }],
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
  const phone = data.phone ? formatPhoneForDisplay(data.phone) : null
  
  return [
    `📋 *Ваше оголошення:*`, ``,
    `*Категорія:* ${escMd(cat)}`,
    `*Назва:* ${escMd(data.title)}`,
    `*Ціна:* ${escMd(price)}`,
    data.description ? `*Опис:* ${escMd(data.description)}` : null,
    phone ? `*Телефон:* ${escMd(phone)}` : null,
    `*Контакт:* @${escMd(username || "—")}`,
    ``, `_\\(фото: ${count} шт\\.\\)_`,
  ].filter(Boolean).join("\n")
}

// ── Крокові функції ───────────────────────────────────────────────────────────

async function askCategory(bot, chatId, s) {
  s.step = "category"
  await bot.sendMessage(chatId, "📂 *Крок 1 з 5* — Оберіть категорію:", {
    parse_mode: "Markdown",
    reply_markup: { inline_keyboard: [
      CATEGORIES.slice(0, 2).map(c => ({ text: c.label, callback_data: `cat_${c.id}` })),
      CATEGORIES.slice(2, 4).map(c => ({ text: c.label, callback_data: `cat_${c.id}` })),
      CATEGORIES.slice(4).map(c => ({ text: c.label, callback_data: `cat_${c.id}` })),
    ]},
  })
}

async function askTitle(bot, chatId, s) {
  s.step = "title"
  const cat = CATEGORIES.find(c => c.id === s.data.category)
  await bot.sendMessage(chatId,
    `✏️ *Крок 2 з 5* — Введіть назву товару:\n\n_${escMd(cat?.example || "")}_`,
    { parse_mode: "MarkdownV2" }
  )
}

async function askDescription(bot, chatId, s) {
  s.step = "description"
  const cat = CATEGORIES.find(c => c.id === s.data.category)
  await bot.sendMessage(chatId,
    `📝 *Крок 3 з 5* — Опишіть товар або пропустіть:\n\n_${escMd(cat?.example || "")}_`,
    {
      parse_mode: "MarkdownV2",
      reply_markup: { inline_keyboard: [[
        { text: "⏭ Пропустити", callback_data: "skip_desc" }
      ]]}
    }
  )
}

async function askCurrency(bot, chatId, s) {
  s.step = "currency"
  await bot.sendMessage(chatId,
    "💰 *Крок 4 з 5* — Оберіть тип ціни:",
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
      reply_markup: { inline_keyboard: [[
        { text: "◀️ Змінити валюту", callback_data: "back_currency" }
      ]]},
    }
  )
}

async function askPhotos(bot, chatId, s) {
  s.step = "photos"
  await bot.sendMessage(chatId,
    "📸 *Крок 5 з 5* — Додайте фото товару (до 5 штук).\n_Фото автоматично стискаються._",
    {
      parse_mode: "Markdown",
      reply_markup: { inline_keyboard: [[
        { text: "⏭ Пропустити", callback_data: "skip_photos" }
      ]]},
    }
  )
}

async function askPhone(bot, chatId, s) {
  s.step = "phone"
  await bot.sendMessage(chatId,
    "📞 *Крок 6 з 6* — Телефон для зв'язку (необов'язково).\n\n" +
    "_Формат: +380XXXXXXXXX або 0XXXXXXXXX_\n" +
    "Покупці зможуть написати вам у Telegram.",
    {
      parse_mode: "Markdown",
      reply_markup: { inline_keyboard: [[
        { text: "⏭ Пропустити", callback_data: "skip_phone" }
      ]]},
    }
  )
}

async function showConfirm(bot, chatId, s, username) {
  s.step = "confirm"
  const text    = preview(s.data, username)
  const caption = text + "\n\n_Все вірно\\?_"
  const kb = {
    parse_mode: "MarkdownV2",
    reply_markup: { inline_keyboard: [
      [{ text: "✅ Надіслати на модерацію", callback_data: "confirm" }],
      [{ text: "🔄 Заповнити знову", callback_data: "restart" }],
    ]},
  }
  if (s.data.photos[0]) {
    await bot.sendPhoto(chatId, s.data.photos[0], { caption, ...kb })
  } else {
    await bot.sendMessage(chatId, caption, kb)
  }
}

// ── ПРИВЕТСТВЕННАЯ СТРАНИЦА ───────────────────────────────────────────────────

async function showWelcome(bot, chatId, uid) {
  const remaining = getRemainingAttempts(uid)
  const stats = getDailyStats(uid)
  
  let statusText = ""
  if (stats.submitted + stats.rejected > 0) {
    statusText = `\n\n📊 *Сьогодні:* ${stats.submitted} подано, ${stats.rejected} відхилено\n` +
                 `*Залишилось спроб:* ${remaining} з ${MAX_DAILY}`
  }
  
  await bot.sendMessage(chatId,
    `👋 *Ласкаво просимо до барахолки\\!*\n\n` +
    `📋 *Про сервіс:*\n` +
    `• Безкоштовне розміщення оголошень\n` +
    `• Максимум *${MAX_ACTIVE}* активних оголошення\n` +
    `• Максимум *${MAX_DAILY}* оголошення на день\n` +
    `• Строк дії — *${TTL_DAYS} днів*\n` +
    `• Інтервал між оголошеннями — *15 хвилин*\n\n` +
    `⚠️ *Важливі правила:*\n` +
    `• Один товар \\= одне оголошення\n` +
    `• Чесний та детальний опис\n` +
    `• Реальна ціна \\(₴, \\$, €\\)\n` +
    `• Якісні фото підвищують шанс схвалення\n` +
    `• Заборонені валюти: рублі, тенге, білоруські рублі\n\n` +
    `❌ *Система спроб:*\n` +
    `• У вас є ${MAX_DAILY} спроби на день\n` +
    `• Якщо всі ${MAX_DAILY} оголошення відхілено \\— наступна спроба завтра\n` +
    `• Модерація протягом 24 годин${escMd(statusText)}`,
    {
      parse_mode: "MarkdownV2",
      reply_markup: { inline_keyboard: [
        [{ text: "🚀 Створити оголошення", callback_data: "start_new" }],
        [{ text: "📋 Мої оголошення", callback_data: "mine" }],
      ]},
    }
  )
}

// ── Обробник повідомлень ──────────────────────────────────────────────────────
async function onMessage(bot, msg) {
  const uid      = String(msg.from.id)
  const username = msg.from.username || ""
  const text     = msg.text || ""
  const s        = getSession(uid)
 
  const chatId = msg.chat.id

    // ✅ ПРОВЕРИТЬ БАН
  const isBanned = await bans.isUserBanned(uid, 'marketplace')
  
  if (isBanned) {
    const banInfo = await bans.getBanInfo(uid)
    return bot.sendMessage(chatId, 
      `🚫 ${banInfo.ban.message}`
    )
  } 

  
  if (text === "/start") {
    resetSession(uid)
    return showWelcome(bot, msg.chat.id, uid)
  }

  if (text === "/cancel") {
    resetSession(uid)
    return bot.sendMessage(msg.chat.id, "❌ Скасовано. Напишіть /start щоб почати знову.")
  }

  switch (s.step) {
    case "title": {
      if (text.length < 3) {
        return bot.sendMessage(msg.chat.id, 
          "⚠️ Назва занадто коротка. Мінімум 3 символи. Спробуйте ще раз:"
        )
      }
      if (text.length > 100) {
        return bot.sendMessage(msg.chat.id, 
          "⚠️ Назва занадто довга. Максимум 100 символів. Спробуйте ще раз:"
        )
      }
      s.data.title = text
      return askDescription(bot, msg.chat.id, s)
    }
    
    case "description": {
      s.data.description = text.slice(0, 500)
      return askCurrency(bot, msg.chat.id, s)
    }
    
    case "amount": {
      if (BANNED_PATTERNS.some(rx => rx.test(text))) {
        return bot.sendMessage(msg.chat.id,
          "❌ Рублі та інші заборонені валюти не приймаються.\n" +
          "Оберіть: гривня, долар, євро, обмін або договірна.",
          { 
            reply_markup: { inline_keyboard: [[
              { text: "◀️ Обрати валюту", callback_data: "back_currency" }
            ]]}
          }
        )
      }
      const num = text.trim().replace(",", ".")
      if (!/^\d+(\.\d+)?$/.test(num)) {
        return bot.sendMessage(msg.chat.id,
          "⚠️ Введіть суму цифрами, наприклад *1500* або *50*",
          {
            parse_mode: "Markdown",
            reply_markup: { inline_keyboard: [[
              { text: "◀️ Змінити валюту", callback_data: "back_currency" }
            ]]},
          }
        )
      }
      s.data.amount = num
      return askPhotos(bot, msg.chat.id, s)
    }
    
    case "photos": {
      if (msg.photo) {
        if (s.data.photos.length >= 5) {
          return bot.sendMessage(msg.chat.id, 
            "⚠️ Максимум 5 фото. Натисніть «Готово»:",
            { 
              reply_markup: { inline_keyboard: [[
                { text: "✅ Готово", callback_data: "photos_done" }
              ]]}
            }
          )
        }
        const pm = await bot.sendMessage(msg.chat.id, `⏳ Завантажую фото ${s.data.photos.length + 1}...`)
        try {
          const url = await uploadPhoto(bot, msg.photo)
          s.data.photos.push(url)
          const n = s.data.photos.length
          await bot.editMessageText(
            `✅ Фото ${n} завантажено.`, 
            { chat_id: msg.chat.id, message_id: pm.message_id }
          )
          return bot.sendMessage(msg.chat.id,
            n < 5 ? "Надішліть ще фото або натисніть «Готово»:" : "Максимум 5 фото досягнуто:",
            { 
              reply_markup: { inline_keyboard: [[
                { text: `✅ Готово (${n})`, callback_data: "photos_done" }
              ]]}
            }
          )
        } catch (e) {
          console.error("upload error:", e.message)
          return bot.editMessageText(
            "❌ Помилка завантаження. Спробуйте ще раз:", 
            { chat_id: msg.chat.id, message_id: pm.message_id }
          )
        }
      }
      if (text && text !== "/cancel") {
        return bot.sendMessage(msg.chat.id, 
          "⚠️ Надішліть саме фото (не файл), або пропустіть:",
          { 
            reply_markup: { inline_keyboard: [[
              { text: "⏭ Пропустити", callback_data: "skip_photos" }
            ]]}
          }
        )
      }
      break
    }
    
    case "phone": {
      const cleaned = text.trim()
      if (cleaned && !validateUkrainianPhone(cleaned)) {
        return bot.sendMessage(msg.chat.id,
          "⚠️ *Невірний формат номера телефону*\n\n" +
          "Приклади правильних форматів:\n" +
          "• \\+380501234567\n" +
          "• 380501234567\n" +
          "• 0501234567\n\n" +
          "_Спробуйте ще раз або пропустіть цей крок_",
          {
            parse_mode: "MarkdownV2",
            reply_markup: { inline_keyboard: [[
              { text: "⏭ Пропустити", callback_data: "skip_phone" }
            ]]},
          }
        )
      }
      s.data.phone = cleaned ? formatPhoneForDisplay(cleaned) : ""
      return showConfirm(bot, msg.chat.id, s, username)
    }
    
    default: {
      if (text && !text.startsWith("/")) {
        return bot.sendMessage(msg.chat.id, 
          "ℹ️ Напишіть /start щоб подати оголошення або подивитись меню."
        )
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

  // ── Старт нового оголошення ──────────────────────────────────────────────
  if (data === "start_new" || data === "restart") {
    if (!canSubmitToday(uid)) {
      const stats = getDailyStats(uid)
      return bot.sendMessage(chatId,
        `⏸ *Ліміт оголошень вичерпано*\n\n` +
        `Ви вже подали максимум оголошень сьогодні:\n` +
        `• Подано: ${stats.submitted}\n` +
        `• Відхилено: ${stats.rejected}\n` +
        `• Загальний ліміт: ${MAX_DAILY}\n\n` +
        `Спробуйте завтра після 00:00!`,
        { parse_mode: "Markdown" }
      )
    }

    const left = cooldownLeft(uid)
    if (left > 0) {
      return bot.sendMessage(chatId,
        `⏰ *Зачекайте між оголошеннями*\n\n` +
        `Ви нещодавно подавали оголошення.\n` +
        `Зачекайте ще *${fmtCooldown(left)}*\n\n` +
        `_Це захист від спаму._`,
        { parse_mode: "Markdown" }
      )
    }

    const count = await Listing.countDocuments({ 
      telegramId: uid, 
      status: { $in: ["pending", "published"] } 
    })
    
    if (count >= MAX_ACTIVE) {
      return bot.sendMessage(chatId,
        `📋 *Ліміт активних оголошень*\n\n` +
        `У вас вже ${count} активних оголошення (макс. ${MAX_ACTIVE}).\n\n` +
        `Дочекайтесь закінчення старих або зверніться до адміністратора.`,
        { parse_mode: "Markdown" }
      )
    }

    resetSession(uid)
    const s = getSession(uid)
    return askCategory(bot, chatId, s)
  }

  const s = getSession(uid)

  // ── Категорія ─────────────────────────────────────────────────────────────
  if (data.startsWith("cat_") && s.step === "category") {
    const catId = data.slice(4)
    const cat = CATEGORIES.find(c => c.id === catId)
    if (!cat) return
    
    s.data.category = catId
    return askTitle(bot, chatId, s)
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
    
    if (cur.noAmount) {
      return askPhotos(bot, chatId, s)
    }
    return askAmount(bot, chatId, s)
  }

  // ── Пропуски ──────────────────────────────────────────────────────────────
  if (data === "skip_desc" && s.step === "description") {
    s.data.description = ""
    return askCurrency(bot, chatId, s)
  }
  
  if (data === "skip_photos" && s.step === "photos") {
    return askPhone(bot, chatId, s)
  }
  
  if (data === "photos_done" && s.step === "photos") {
    return askPhone(bot, chatId, s)
  }
  
  if (data === "skip_phone" && s.step === "phone") {
    s.data.phone = ""
    return showConfirm(bot, chatId, s, username)
  }

  // ── Підтвердження ─────────────────────────────────────────────────────────
  // if (data === "confirm" && s.step === "confirm") {

  //   const left = cooldownLeft(uid)
  //   if (left > 0) {
  //     return bot.sendMessage(chatId, `⏰ Зачекайте ще ${fmtCooldown(left)}.`)
  //   }

  //   // 2. Проверить дневной лимит (ИЗ REDIS!)
  // const canSubmit = await canSubmitToday(uid)
  // if (!canSubmit) {
  //   return bot.sendMessage(chatId,
  //     `⏸ Ви вичерпали денний ліміт оголошень (${MAX_DAILY} шт).\nСпробуйте завтра!`
  //   )
  // }

  //   // if (!canSubmitToday(uid)) {
  //   //   return bot.sendMessage(chatId,
  //   //     `⏸ Ви вичерпали денний ліміт оголошень (${MAX_DAILY} шт).\nСпробуйте завтра!`
  //   //   )
  //   // }

  //   try {
  //     await Listing.create({
  //       id:               makeId(uid),
  //       title:            s.data.title,
  //       description:      s.data.description,
  //       price:            formatPrice(s.data.currency, s.data.amount),
  //       category:         s.data.category,
  //       photos:           s.data.photos,
  //       contactPhone:     s.data.phone,
  //       contactUsername:  username,
  //       telegramId:       uid,
  //       telegramUsername: username,
  //       status:           "pending",
  //       viewCount:        0,
  //     })

  //     recordSubmission(uid)
  //     cooldowns.set(uid, Date.now())
  //     resetSession(uid)

  //     const remaining = getRemainingAttempts(uid)
      
  //     return bot.sendMessage(chatId,
  //       `✅ *Оголошення надіслано на модерацію\\!*\n\n` +
  //       `⏱ Розглянемо протягом 24 годин\\.\n` +
  //       `⏰ Наступне оголошення — через 15 хвилин\\.\n\n` +
  //       `📊 Залишилось спроб сьогодні: *${remaining}* з ${MAX_DAILY}`,
  //       { parse_mode: "MarkdownV2" }
  //     )
  //   } catch (e) {
  //     console.error("listing save error:", e.message)
  //     return bot.sendMessage(chatId, 
  //       "❌ Помилка при збереженні. Спробуйте /start"
  //     )
  //   }
  // }

  if (data === "confirm" && s.step === "confirm") {
  const uid = q.from.id
  const chatId = q.message.chat.id
  const username = q.from.username || "unknown"
  
  try {
    // 1. Проверка дневного лимита (REDIS)
    const canSubmit = await canSubmitToday(uid)
    if (!canSubmit) {
      return bot.sendMessage(chatId,
        `⏸ Ви вичерпали денний ліміт оголошень (${MAX_DAILY} шт).`
      )
    }

    // 2. НОВОЕ: Проверка дубликатов ✅
    const listingHash = generateListingHash(s.data)
    const isDup = await isDuplicate(uid, listingHash)
    
    if (isDup) {
      return bot.sendMessage(chatId,
        `⚠️ *Виявлено дублікат!*\n\n` +
        `Ви вже публікували це оголошення протягом останніх 24 годин.\n` +
        `Спробуйте пізніше або змініть описання.`,
        { parse_mode: "Markdown" }
      )
    }

    // 3. Создать объявление С ХЕШЕМ
    await Listing.create({
      id: makeId(uid),
      title: s.data.title,
      description: s.data.description,
      price: formatPrice(s.data.currency, s.data.amount),
      category: s.data.category,
      photos: s.data.photos,
      contactPhone: s.data.phone,
      contactUsername: username,
      telegramId: uid,
      telegramUsername: username,
      status: "pending",
      viewCount: 0,
      listingHash: listingHash  // ✅ СОХРАНИТЬ ХЕШ
    })

    // 4. Записать попытку
    await recordSubmission(uid)
    cooldowns.set(uid, Date.now())
    resetSession(uid)

    const remaining = await getRemainingAttempts(uid)
    
    return bot.sendMessage(chatId,
      `✅ *Оголошення надіслано на модерацію!*\n\n` +
      `📊 Залишилось спроб сьогодні: *${remaining}* з ${MAX_DAILY}`,
      { parse_mode: "MarkdownV2" }
    )
    
  } catch (e) {
    console.error("listing save error:", e.message)
    return bot.sendMessage(chatId, 
      "❌ Помилка при збереженні. Спробуйте /start"
    )
  }
}



  if (data === "cancel") {
    resetSession(uid)
    return bot.sendMessage(chatId, "❌ Скасовано. /start — почати знову.")
  }

  // ── Мої оголошення ────────────────────────────────────────────────────────
  if (data === "mine") {
    const list = await Listing.find({ telegramId: uid })
      .sort({ createdAt: -1 })
      .limit(10)
      .lean()
      
    if (!list.length) {
      return bot.sendMessage(chatId, 
        "📭 У вас ще немає оголошень.\n\nНатисніть /start щоб подати перше."
      )
    }
    
    const emoji = { 
      pending: "⏳", 
      published: "✅", 
      rejected: "❌", 
      expired: "🕐" 
    }
    const lbl = { 
      pending: "На модерації", 
      published: "Опубліковано", 
      rejected: "Відхилено", 
      expired: "Закінчилось" 
    }
    
    const txt = list.map((l, i) =>
      `${i + 1}\\. ${emoji[l.status]} *${escMd(l.title)}*\n` +
      `   ${escMd(lbl[l.status])} · ${escMd(l.price || "—")}` +
      (l.viewCount ? `\n   👁 Переглядів: ${l.viewCount}` : "") +
      (l.rejectReason ? `\n   _Причина: ${escMd(l.rejectReason)}_` : "")
    ).join("\n\n")
    
    const stats = getDailyStats(uid)
    const remaining = getRemainingAttempts(uid)
    
    return bot.sendMessage(chatId, 
      `*📋 Ваші оголошення:*\n\n${txt}\n\n` +
      `📊 *Статистика сьогодні:*\n` +
      `Подано: ${stats.submitted} · Відхилено: ${stats.rejected}\n` +
      `Залишилось спроб: ${remaining} з ${MAX_DAILY}`,
      { parse_mode: "MarkdownV2" }
    )
  }
}



// ── Сповіщення ────────────────────────────────────────────────────────────────
let _bot = null

async function notifyUser(telegramId, text) {
  if (!_bot || !telegramId) return
  try { 
    await _bot.sendMessage(telegramId, text, { parse_mode: "Markdown" }) 
  } catch (e) { 
    console.warn("notify failed:", e.message) 
  }
}

async function notifyApproved(listing) {
  await notifyUser(listing.telegramId,
    `✅ *Оголошення схвалено!*\n\n` +
    `${listing.title}\n\n` +
    `Опубліковано і буде активним ${TTL_DAYS} днів.`
  )
}

async function notifyRejected(listing, reason = "") {
  recordRejection(listing.telegramId)
  
  const remaining = getRemainingAttempts(listing.telegramId)
  
  await notifyUser(listing.telegramId,
    `❌ *Оголошення відхилено*\n\n` +
    `${listing.title}` +
    (reason ? `\n\nПричина: ${reason}` : "") +
    `\n\n📊 Залишилось спроб сьогодні: ${remaining} з ${MAX_DAILY}` +
    (remaining === 0 ? "\n\n⏸ Ліміт вичерпано. Спробуйте завтра!" : "") +
    `\n\nЗ питань зверніться до адміністратора.`
  )
}

async function notifyExpired(listing) {
  await notifyUser(listing.telegramId,
    `🕐 *Оголошення закінчилось*\n\n` +
    `${listing.title}\n\n` +
    `Строк ${TTL_DAYS} днів минув. Подайте знову: /start`
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
    app.post("/market-webhook", (req, res) => { 
      bot.processUpdate(req.body)
      res.sendStatus(200) 
    })
  } else {
    console.log("🛒 Market bot: polling mode (dev)")
  }

  bot.on("message", msg => 
    onMessage(bot, msg).catch(e => console.error("msg err:", e.message))
  )
  bot.on("callback_query", q => 
    onCallback(bot, q).catch(e => console.error("cb err:", e.message))
  )

  console.log("🛒 Marketplace bot started")
  return bot
}

module.exports = { 
  createMarketplaceBot, 
  notifyApproved, 
  notifyRejected, 
  notifyExpired, 
  recordRejection,
  TTL_DAYS 
}