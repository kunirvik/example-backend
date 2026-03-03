const Parser = require("rss-parser")
const parser = new Parser()

async function loadYoutubeRss(channelId) {
  const feed = await parser.parseURL(
    `https://www.youtube.com/feeds/videos.xml?channel_id=${channelId}`
  )

  return feed.items.map(item => ({
    id: item.id,
    type: "video",
    title: item.title,
    date: item.pubDate,
    excerpt: item.contentSnippet,
    cover: item.enclosure?.url || null,
    source: "YouTube",
    url: item.link,
    content: null
  }))
}

module.exports = { loadYoutubeRss }