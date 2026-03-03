const fs = require("fs")
const path = require("path")
const matter = require("gray-matter")

const SOURCES_DIR = path.join(__dirname, "sources")

function loadYoutubeSources() {
  const files = fs.readdirSync(SOURCES_DIR)

  return files
    .map(file => {
      const raw = fs.readFileSync(
        path.join(SOURCES_DIR, file),
        "utf-8"
      )

      const { data } = matter(raw)
      return data
    })
    .filter(src => src.type === "youtube" && src.enabled)
}

module.exports = { loadYoutubeSources }
