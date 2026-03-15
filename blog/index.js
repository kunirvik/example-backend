// const { loadCompanyPosts } = require("./loadCompanyPosts")
// // const { loadPinkbikePosts } = require("./loadPinkbikePosts")
// // const { loadYoutubePostsFromMd } = require("./loadYoutubePostsFromMd")
// const { loadVideoPosts } = require("./loadVideoPosts")
// async function loadAllPosts() {
//   const [
//     company,
//     youtube,
//     // pinkbike
//   ] = await Promise.all([
//     loadCompanyPosts(),
//     // loadYoutubePostsFromMd(),
//     loadVideoPosts(),
//     // loadPinkbikePosts()
//   ])

// //   return [...company, ...youtube, ...pinkbike]

//  return [...company, ...youtube]
//     .sort((a, b) => new Date(b.date) - new Date(a.date))
// }

// async function loadPostById(id) {
//   const posts = await loadAllPosts()
//   return posts.find(p => p.id === id)
// }

// module.exports = { 
//   loadAllPosts,
//   loadPostById


//  }

const Post = require("../bot/Post")
const fs   = require("fs")
const path = require("path")
const matter = require("gray-matter")
const MarkdownIt = require("markdown-it")

const md = new MarkdownIt()

// ── Load posts from file system (legacy company posts) ────────────────────

function loadCompanyPostsFromFiles() {
  const CONTENT_DIR = path.join(__dirname, "content")
  if (!fs.existsSync(CONTENT_DIR)) return []

  return fs.readdirSync(CONTENT_DIR).map(file => {
    const raw = fs.readFileSync(path.join(CONTENT_DIR, file), "utf-8")
    const { data, content } = matter(raw)
    return {
      id:      data.id,
      type:    "company",
      title:   data.title,
      date:    data.date,
      tags:    data.tags   || [],
      cover:   data.cover  || null,
      photos:  data.photos || [],
      url:     data.url    || null,
      videos:  data.videos || [],
      video:   data.video  || null,
      excerpt: data.excerpt || null,
      content: md.render(content),
      source:  "file",
    }
  })
}

function loadVideoPostsFromFiles() {
  const VIDEO_DIR = path.join(__dirname, "videos")
  if (!fs.existsSync(VIDEO_DIR)) return []

  return fs.readdirSync(VIDEO_DIR).map(file => {
    const raw = fs.readFileSync(path.join(VIDEO_DIR, file), "utf-8")
    const { data, content } = matter(raw)
    return {
      id:      file,
      type:    "video",
      title:   data.title,
      date:    data.date,
      tags:    data.tags   || [],
      cover:   data.cover  || null,
      photos:  data.photos || [],
      url:     data.url    || null,
      videos:  data.videos || [],
      video:   data.video  || null,
      excerpt: data.excerpt || null,
      content: content || null,
      source:  "file",
    }
  })
}

// ── Main API ──────────────────────────────────────────────────────────────

async function loadAllPosts() {
  // 1. Posts from MongoDB (Telegram bot)
  // const mongoPosts = await Post.find({}).lean()

const mongoPosts = await Post.find({ status: "published" }).lean()

  // 2. Legacy posts from markdown files
  const filePosts = [
    ...loadCompanyPostsFromFiles(),
    ...loadVideoPostsFromFiles(),
  ]

  // Merge: MongoDB wins on id collision (more recent source)
  const mongoIds = new Set(mongoPosts.map(p => p.id))
  const uniqueFilePosts = filePosts.filter(p => !mongoIds.has(p.id))

  return [...mongoPosts, ...uniqueFilePosts]

    .sort((a, b) => {
  const aTime = new Date(a.updatedAt || a.date)
  const bTime = new Date(b.updatedAt || b.date)
  return bTime - aTime
})
}

async function loadPostById(id) {
  // Try MongoDB first
  const mongoPost = await Post.findOne({ id }).lean()
  if (mongoPost) return mongoPost

  // Fallback to file system
  const posts = [...loadCompanyPostsFromFiles(), ...loadVideoPostsFromFiles()]
  return posts.find(p => p.id === id) || null
}

module.exports = { loadAllPosts, loadPostById }
