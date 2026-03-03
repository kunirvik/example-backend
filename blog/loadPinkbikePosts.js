const Parser = require("rss-parser")
const parser = new Parser()

async function loadPinkbikePosts() {
  const feed = await parser.parseURL(
    "https://www.pinkbike.com/pinkbike_xml_feed.php"
  )

  return feed.items.slice(0, 5).map(item => ({
    id: item.guid,
    type: "link",
    title: item.title,
    date: item.pubDate,
    excerpt: item.contentSnippet,
    cover: null,
    source: "Pinkbike",
    url: item.link,
    content: null
  }))
}

module.exports = { loadPinkbikePosts }
