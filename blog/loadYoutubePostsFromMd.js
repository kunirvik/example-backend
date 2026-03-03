const { loadYoutubeSources } = require("./loadYoutubeSources")
const { loadYoutubeRss } = require("./loadYoutubeRss")

async function loadYoutubePostsFromMd() {
  const sources = loadYoutubeSources()

  const posts = await Promise.all(
    sources.map(src =>
      loadYoutubeRss(src.channelId).then(items =>
        items.map(item => ({
          ...item,
          source: "YouTube",
          sourceName: src.name,
          tags: src.tags || []
        }))
      )
    )
  )

  return posts.flat()
}
module.exports = { loadYoutubePostsFromMd }
