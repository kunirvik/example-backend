// const mongoose = require("mongoose")

// const ListingSchema = new mongoose.Schema(
//   {
//     id:               { type: String, required: true, unique: true },
//     title:            { type: String, required: true },
//     description:      { type: String, default: "" },
//     price:            { type: String, default: "" },
//     category: {
//       type: String,
//       default: "other",
//       enum: ["mtb", "bmx", "skate", "parts", "clothing", "other"],  // Обновлены категории
//     },
//     photos:           [String],
//     contactUsername:  { type: String, default: "" },
//     contactPhone:     { type: String, default: "" },
//     telegramId:       { type: String, required: true },
//     telegramUsername: { type: String, default: "" },
//     status: {
//       type: String,
//       default: "pending",
//       enum: ["pending", "published", "rejected", "expired"],
//     },
//     rejectReason: { type: String, default: "" },
//     expiresAt:    { type: Date, default: null },
//     publishedAt:  { type: Date, default: null },
    
//     // ── НОВЫЕ ПОЛЯ ───────────────────────────────────────────────────────────
    
//     // 6. Счетчик просмотров
//     viewCount: {
//       type: Number,
//       default: 0,
//       min: 0
//     },
    
//     // Опционально: массив для отслеживания уникальных просмотров
//     viewedBy: [{
//       userId: String,
//       viewedAt: Date
//     }],
    
//     // Последний просмотр
//     lastViewedAt: { type: Date, default: null },
//   },
//   { timestamps: true }
// )

// // ── ИНДЕКСЫ ──────────────────────────────────────────────────────────────────

// ListingSchema.index({ status: 1 })
// ListingSchema.index({ telegramId: 1, status: 1 })
// ListingSchema.index({ expiresAt: 1, status: 1 })
// ListingSchema.index({ viewCount: -1 })  // Для сортировки по популярности
// ListingSchema.index({ category: 1, status: 1 })  // Для фильтрации по категориям

// module.exports = mongoose.model("Listing", ListingSchema)

// ═══════════════════════════════════════════════════════════════════════════════
// bot/Listing.js - ПОЛНАЯ СХЕМА С ОПТИМИЗАЦИЯМИ
// ═══════════════════════════════════════════════════════════════════════════════
 
const mongoose = require("mongoose")
 
const ListingSchema = new mongoose.Schema(
  {
    // ─ ОСНОВНЫЕ ПОЛЯ ────────────────────────────────────────────────────────
 
    id: { 
      type: String, 
      required: true, 
      unique: true,
      index: true
    },
    
    title: { 
      type: String, 
      required: true,
      maxlength: 200
    },
    
    description: { 
      type: String, 
      default: "",
      maxlength: 2000
    },
    
    price: { 
      type: String, 
      default: "" 
    },
    
    category: {
      type: String,
      default: "other",
      enum: ["mtb", "bmx", "skate", "parts", "clothing", "other"],
      index: true
    },
    
    // ─ МЕДИА (ЛОКАЛЬНЫЕ ФАЙЛЫ) ─────────────────────────────────────────────
 
    photos: [{
      originalName: String,
      filename: String,          // unique_name_compressed.webp
      fileSize: Number,          // в байтах
      uploadedAt: Date,
      // Путь будет: /uploads/{listingId}/{filename}
    }],
    
    // ─ КОНТАКТЫ ─────────────────────────────────────────────────────────────
 
    contactUsername: { 
      type: String, 
      default: "" 
    },
    
    contactPhone: { 
      type: String, 
      default: "" 
    },
    
    telegramId: { 
      type: String, 
      required: true,
      index: true
    },
    
    telegramUsername: { 
      type: String, 
      default: "" 
    },
    
    // ─ СТАТУС И МОДЕРАЦИЯ ──────────────────────────────────────────────────
 
    status: {
      type: String,
      default: "pending",
      enum: ["pending", "published", "rejected", "expired"],
      index: true
    },
    
    rejectReason: { 
      type: String, 
      default: "" 
    },
    
    // ─ ДЕДЛАЙНЫ (АВТОМАТИЧЕСКОЕ УДАЛЕНИЕ) ──────────────────────────────────
 
    publishedAt: { 
      type: Date, 
      default: null,
      index: true
    },
    
    expiresAt: { 
      type: Date, 
      default: null,
      index: true
    },
    
    // ═══════════════════════════════════════════════════════════════════════
    // ⭐ НОВЫЕ ПОЛЯ ДЛЯ ОПТИМИЗАЦИИ ⭐
    // ═══════════════════════════════════════════════════════════════════════
    
    // ─ АНТИ-ДУБЛИ ───────────────────────────────────────────────────────
 
    listingHash: { 
      type: String,
      default: null,
      index: true
      // SHA256 хеш первых 16 символов
      // Для проверки дубликатов за 24 часа
    },
    
    // ─ ПРОСМОТРЫ ────────────────────────────────────────────────────────
 
    viewCount: {
      type: Number,
      default: 0,
      min: 0,
      index: true  // Для сортировки по популярности
    },
    
    viewedBy: [{
      userId: String,      // ID просмотревшего
      viewedAt: Date       // Когда просмотрено
    }],
    
    lastViewedAt: { 
      type: Date, 
      default: null 
    },
    
    // ─ КАТЕГОРИЙНЫЕ ИНДЕКСЫ ────────────────────────────────────────────
 
  },
  { 
    timestamps: true,  // createdAt, updatedAt
    collection: 'listings'
  }
)
 
// ═══════════════════════════════════════════════════════════════════════════════
// ИНДЕКСЫ (для быстрого поиска)
// ═══════════════════════════════════════════════════════════════════════════════
 
// Основные индексы
ListingSchema.index({ status: 1 })
ListingSchema.index({ telegramId: 1, status: 1 })
ListingSchema.index({ category: 1, status: 1 })
 
// Для сортировки
ListingSchema.index({ viewCount: -1 })
ListingSchema.index({ createdAt: -1 })
ListingSchema.index({ publishedAt: -1 })
 
// Для проверки дубликатов за последние 24 часа
ListingSchema.index({ 
  telegramId: 1, 
  listingHash: 1, 
  createdAt: -1 
})
 
// Для проверки истечения
ListingSchema.index({ 
  expiresAt: 1, 
  status: 1 
})
 
// ═══════════════════════════════════════════════════════════════════════════════
// TTL INDEX (автоматическое удаление истекших объявлений)
// ═══════════════════════════════════════════════════════════════════════════════
// MongoDB автоматически удалит документ через 3600 секунд (1 час) после expiresAt
 
ListingSchema.index(
  { expiresAt: 1 }, 
  { 
    expireAfterSeconds: 3600,  // Удалить через 1 час после expiresAt
    sparse: true  // Игнорировать null значения
  }
)
 
// ═══════════════════════════════════════════════════════════════════════════════
// MIDDLEWARE (HOOKS)
// ═══════════════════════════════════════════════════════════════════════════════
 
/**
 * Перед сохранением: очистить данные
 */
ListingSchema.pre('save', function(next) {
  // Обрезать пробелы
  if (this.title) this.title = this.title.trim()
  if (this.description) this.description = this.description.trim()
  if (this.price) this.price = this.price.trim()
  
  // Убедиться что listingHash установлен если это новое объявление
  if (!this.listingHash && this.title) {
    // Будет установлен на уровне приложения (Marketplacebot.js)
  }
  
  next()
})
 
/**
 * После удаления: очистить файлы (реализуется в контроллере)
 */
ListingSchema.post('deleteOne', async function(doc) {
  // Удаление файлов должно быть в контроллере, чтобы было синхронно
  // с удалением из БД
  console.log(`[Listing] Document deleted: ${doc.id}`)
})
 
// ═══════════════════════════════════════════════════════════════════════════════
// МЕТОДЫ (ЭКЗЕМПЛЯРЫ)
// ═══════════════════════════════════════════════════════════════════════════════
 
/**
 * Проверить истекло ли объявление
 */
ListingSchema.methods.isExpired = function() {
  if (!this.expiresAt) return false
  return new Date() > this.expiresAt
}
 
/**
 * Получить возраст объявления в днях
 */
ListingSchema.methods.getAgeInDays = function() {
  const ageMs = Date.now() - this.createdAt.getTime()
  return Math.floor(ageMs / (1000 * 60 * 60 * 24))
}
 
/**
 * Получить дни до истечения
 */
ListingSchema.methods.getDaysUntilExpiry = function() {
  if (!this.expiresAt) return null
  
  const daysMs = this.expiresAt.getTime() - Date.now()
  return Math.max(0, Math.ceil(daysMs / (1000 * 60 * 60 * 24)))
}
 
/**
 * Форматировать для вывода
 */
ListingSchema.methods.toJSON = function() {
  const obj = this.toObject()
  
  // Добавить вычисленные поля
  obj.isExpired = this.isExpired()
  obj.daysUntilExpiry = this.getDaysUntilExpiry()
  obj.ageInDays = this.getAgeInDays()
  
  // Убрать приватные поля
  delete obj.__v
  
  return obj
}
 
// ═══════════════════════════════════════════════════════════════════════════════
// СТАТИЧЕСКИЕ МЕТОДЫ (ДЛЯ КЛАССА)
// ═══════════════════════════════════════════════════════════════════════════════
 
/**
 * Получить объявления пользователя
 */
ListingSchema.statics.findByUser = function(telegramId, status = null) {
  let query = this.find({ telegramId })
  
  if (status) {
    query = query.where('status').equals(status)
  }
  
  return query.sort({ createdAt: -1 })
}
 
/**
 * Получить опубликованные объявления
 */
ListingSchema.statics.findPublished = function() {
  return this.find({ status: 'published' })
    .where('expiresAt')
    .gt(new Date())
    .sort({ createdAt: -1 })
}
 
/**
 * Получить истекшие объявления
 */
ListingSchema.statics.findExpired = function() {
  const now = new Date()
  
  return this.find({
    status: 'published',
    expiresAt: {
      $lt: now,
      $ne: null
    }
  })
}
 
/**
 * Получить топ по просмотрам
 */
ListingSchema.statics.findTopByViews = function(limit = 10) {
  return this.find({ status: 'published' })
    .sort({ viewCount: -1 })
    .limit(limit)
}
 
/**
 * Получить по категориям
 */
ListingSchema.statics.findByCategory = function(category) {
  return this.find({
    category,
    status: 'published'
  }).sort({ createdAt: -1 })
}
 
/**
 * Проверить наличие дубликата за 24 часа
 */
ListingSchema.statics.findDuplicate = function(telegramId, listingHash) {
  const oneDayAgo = new Date(Date.now() - 24 * 60 * 60 * 1000)
  
  return this.findOne({
    telegramId,
    listingHash,
    createdAt: { $gt: oneDayAgo }
  })
}
 
/**
 * Статистика по категориям
 */
ListingSchema.statics.getCategoryStats = function() {
  return this.aggregate([
    { $match: { status: 'published' } },
    { 
      $group: {
        _id: '$category',
        count: { $sum: 1 },
        totalViews: { $sum: '$viewCount' }
      }
    },
    { $sort: { count: -1 } }
  ])
}
 
/**
 * Обновить статус для набора объявлений
 */
ListingSchema.statics.updateStatus = async function(ids, newStatus) {
  return this.updateMany(
    { id: { $in: ids } },
    { $set: { status: newStatus } }
  )
}
 
// ═══════════════════════════════════════════════════════════════════════════════
 
module.exports = mongoose.model("Listing", ListingSchema)
 
// ═══════════════════════════════════════════════════════════════════════════════
// ПРИМЕРЫ ИСПОЛЬЗОВАНИЯ:
//
// const Listing = require('./Listing')
//
// // Найти все объявления пользователя
// const myListings = await Listing.findByUser(userId)
//
// // Найти опубликованные (не истекшие)
// const published = await Listing.findPublished()
//
// // Найти истекшие объявления
// const expired = await Listing.findExpired()
//
// // Найти топ по просмотрам
// const popular = await Listing.findTopByViews(20)
//
// // Найти по категориям
// const bikes = await Listing.findByCategory('mtb')
//
// // Проверить дубликат
// const duplicate = await Listing.findDuplicate(userId, hash)
// if (duplicate) {
//   return 'Это объявление уже существует!'
// }
//
// // Получить статистику
// const stats = await Listing.getCategoryStats()
// ═══════════════════════════════════════════════════════════════════════════════ 