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
      enum: ["bikes", "parts", "clothing", "electronics", "other"],
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
  },
  { timestamps: true }
)

ListingSchema.index({ status: 1 })
ListingSchema.index({ telegramId: 1, status: 1 })
ListingSchema.index({ expiresAt: 1, status: 1 })

module.exports = mongoose.model("Listing", ListingSchema)