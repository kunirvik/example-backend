const mongoose = require("mongoose")

const ListingSchema = new mongoose.Schema(
  {
    id:               { type: String, required: true, unique: true },
    title:            { type: String, required: true },
    description:      { type: String, default: "" },
    price:            { type: String, default: "" },
    category: {
      type: String,
      default: "other",
      enum: ["mtb", "bmx", "skate", "parts", "clothing", "other"],  // Обновлены категории
    },
    photos:           [String],
    contactUsername:  { type: String, default: "" },
    contactPhone:     { type: String, default: "" },
    telegramId:       { type: String, required: true },
    telegramUsername: { type: String, default: "" },
    status: {
      type: String,
      default: "pending",
      enum: ["pending", "published", "rejected", "expired"],
    },
    rejectReason: { type: String, default: "" },
    expiresAt:    { type: Date, default: null },
    publishedAt:  { type: Date, default: null },
    
    // ── НОВЫЕ ПОЛЯ ───────────────────────────────────────────────────────────
    
    // 6. Счетчик просмотров
    viewCount: {
      type: Number,
      default: 0,
      min: 0
    },
    
    // Опционально: массив для отслеживания уникальных просмотров
    viewedBy: [{
      userId: String,
      viewedAt: Date
    }],
    
    // Последний просмотр
    lastViewedAt: { type: Date, default: null },
  },
  { timestamps: true }
)

// ── ИНДЕКСЫ ──────────────────────────────────────────────────────────────────

ListingSchema.index({ status: 1 })
ListingSchema.index({ telegramId: 1, status: 1 })
ListingSchema.index({ expiresAt: 1, status: 1 })
ListingSchema.index({ viewCount: -1 })  // Для сортировки по популярности
ListingSchema.index({ category: 1, status: 1 })  // Для фильтрации по категориям

module.exports = mongoose.model("Listing", ListingSchema)