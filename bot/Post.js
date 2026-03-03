const mongoose = require("mongoose")

const PostSchema = new mongoose.Schema({
  id:      { type: String, required: true, unique: true },
  type:    { type: String, default: "company" },
  title:   { type: String, required: true },
  date:    { type: String, required: true },
  tags:    [String],
  cover:   String,
  photos:  [String],
  url:     String,
  videos:  [String],
  video:   String,
  excerpt: String,
  content: String,
  source:  { type: String, default: "telegram" },
}, { timestamps: true })

module.exports = mongoose.model("Post", PostSchema)