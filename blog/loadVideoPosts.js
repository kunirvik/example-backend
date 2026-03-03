// const fs = require("fs")
// const path = require("path")
// const matter = require("gray-matter")

// const VIDEO_DIR = path.join(__dirname, "videos")

// function loadVideoPosts() {
//   const files = fs.readdirSync(VIDEO_DIR)

//   return files.map(file => {
//     const raw = fs.readFileSync(path.join(VIDEO_DIR, file), "utf-8")
//     const { data, content } = matter(raw)

//     return {
//       id: file,
//       type: "video",
//       title: data.title,
//       date: data.date,
//       tags: data.tags || [],
//       cover: data.cover,
//       url: data.url,
//       excerpt: data.excerpt,
//       content: content || null
//     }
//   })
// }

// module.exports = { loadVideoPosts }
const fs = require("fs")
const path = require("path")
const matter = require("gray-matter")

const VIDEO_DIR = path.join(__dirname, "videos")

function loadVideoPosts() {
  const files = fs.readdirSync(VIDEO_DIR)

  return files.map(file => {
    const raw = fs.readFileSync(path.join(VIDEO_DIR, file), "utf-8")
    const { data, content } = matter(raw)

    return {
      id:      file,
      type:    "video",
      title:   data.title,
      date:    data.date,
      tags:    data.tags    || [],
      cover:   data.cover   || null,
      photos:  data.photos  || [],   // array of image URLs
      url:     data.url     || null, // single YouTube / Rumble link
      videos:  data.videos  || [],   // array of YouTube / Rumble / mp4 links
      video:   data.video   || null, // single direct mp4 URL
      excerpt: data.excerpt || null,
      content: content      || null,
    }
  })
}

module.exports = { loadVideoPosts }