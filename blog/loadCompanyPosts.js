
// module.exports = { loadCompanyPosts }
const fs = require("fs")
const path = require("path")
const matter = require("gray-matter")
const MarkdownIt = require("markdown-it")

const md = new MarkdownIt()
const CONTENT_DIR = path.join(__dirname, "content")

function loadCompanyPosts() {
  const files = fs.readdirSync(CONTENT_DIR)

  return files.map(file => {
    const raw = fs.readFileSync(path.join(CONTENT_DIR, file), "utf-8")
    const { data, content } = matter(raw)

    return {
      id:      data.id,
      type:    "company",
      title:   data.title,
      date:    data.date,
      tags:    data.tags   || [],
      cover:   data.cover  || null,
      photos:  data.photos || [],   // array of image URLs
      photo:   data.photo  || null, // legacy single photo
      url:     data.url    || null, // single YouTube / Rumble link
      videos:  data.videos || [],   // array of YouTube / Rumble / mp4 links
      video:   data.video  || null, // single direct mp4 URL
      excerpt: data.excerpt || null,
      content: md.render(content),
    }
  })
}

module.exports = { loadCompanyPosts }