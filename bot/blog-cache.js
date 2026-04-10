// ═══════════════════════════════════════════════════════════════════════════════
// blog-cache.js - REDIS КЕШИРОВАНИЕ ДЛЯ БЛОГА
// ═══════════════════════════════════════════════════════════════════════════════

const redis = require('../redis')

const TTL = {
  ALL_POSTS: 5 * 60,        // 5 минут - список всех постов
  POST_DETAIL: 10 * 60,     // 10 минут - детали поста
  TOP_POSTS: 30 * 60,       // 30 минут - топ постов
  SEARCH_TAGS: 10 * 60,     // 10 минут - поиск по тегам
  SESSION: 24 * 60 * 60,    // 24 часа - сессия
  POST_STATS: 60,           // 1 минута - статистика (часто обновляется)
}

// ── ОСНОВНЫЕ ФУНКЦИИ ──────────────────────────────────────────────────────

/**
 * Кешировать все посты
 */
async function cacheAllPosts(posts) {
  try {
    return await redis.set(
      'blog:posts:all',
      posts,
      TTL.ALL_POSTS
    )
  } catch (e) {
    console.error("❌ cacheAllPosts error:", e.message)
    return false
  }
}

/**
 * Получить все посты из кеша
 */
async function getCachedAllPosts() {
  try {
    return await redis.get('blog:posts:all')
  } catch (e) {
    console.error("❌ getCachedAllPosts error:", e.message)
    return null
  }
}

/**
 * Кешировать пост по ID
 */
async function cachePostById(id, post) {
  try {
    return await redis.set(
      `blog:post:${id}`,
      post,
      TTL.POST_DETAIL
    )
  } catch (e) {
    console.error("❌ cachePostById error:", e.message)
    return false
  }
}

/**
 * Получить пост из кеша
 */
async function getCachedPostById(id) {
  try {
    return await redis.get(`blog:post:${id}`)
  } catch (e) {
    console.error("❌ getCachedPostById error:", e.message)
    return null
  }
}

/**
 * Кешировать топ постов
 */
async function cacheTopPosts(posts) {
  try {
    return await redis.set(
      'blog:posts:top',
      posts,
      TTL.TOP_POSTS
    )
  } catch (e) {
    console.error("❌ cacheTopPosts error:", e.message)
    return false
  }
}

/**
 * Получить топ постов из кеша
 */
async function getCachedTopPosts() {
  try {
    return await redis.get('blog:posts:top')
  } catch (e) {
    console.error("❌ getCachedTopPosts error:", e.message)
    return null
  }
}

/**
 * Кешировать поиск по тегам
 */
async function cachePostsByTag(tag, posts) {
  try {
    return await redis.set(
      `blog:posts:tag:${tag}`,
      posts,
      TTL.SEARCH_TAGS
    )
  } catch (e) {
    console.error("❌ cachePostsByTag error:", e.message)
    return false
  }
}

/**
 * Получить посты по тегу из кеша
 */
async function getCachedPostsByTag(tag) {
  try {
    return await redis.get(`blog:posts:tag:${tag}`)
  } catch (e) {
    console.error("❌ getCachedPostsByTag error:", e.message)
    return null
  }
}

/**
 * Записать просмотр поста (счетчик)
 */
async function recordPostView(postId, userId = null) {
  try {
    if (!postId) return { total: 0, tracked: false }

    // Увеличить счетчик просмотров
    const viewKey = `blog:views:${postId}`
    const newCount = await redis.increment(viewKey, 1)
    
    // Установить TTL на 30 дней если его еще нет
    const ttl = await redis.getTTL(viewKey)
    if (ttl === -1) {
      await redis.redis.expire(viewKey, 30 * 24 * 60 * 60)
    }
    
    // Добавить в список просмотрев (для уникальных)
    if (userId) {
      const uniqueKey = `blog:viewers:${postId}`
      const lastViewed = await redis.get(`${uniqueKey}:${userId}`)
      
      if (!lastViewed) {
        await redis.redis.hset(uniqueKey, userId, Date.now())
        // Увеличить счетчик уникальных
        await redis.increment(`blog:unique_views:${postId}`, 1)
      }
    }
    
    return { total: newCount, tracked: true }
  } catch (e) {
    console.error("❌ recordPostView error:", e.message)
    return { total: 0, tracked: false }
  }
}

/**
 * Получить статистику поста
 */
async function getPostStats(postId) {
  try {
    const totalViews = await redis.getCounter(`blog:views:${postId}`)
    const uniqueViews = await redis.getCounter(`blog:unique_views:${postId}`)
    
    return {
      postId,
      totalViews: totalViews || 0,
      uniqueViews: uniqueViews || 0,
      engagement: (totalViews && uniqueViews) ? Math.round((uniqueViews / totalViews) * 100) : 0
    }
  } catch (e) {
    console.error("❌ getPostStats error:", e.message)
    return { postId, totalViews: 0, uniqueViews: 0, engagement: 0 }
  }
}

/**
 * Инвалидировать весь кеш блога
 */
async function invalidateBlogCache() {
  try {
    await redis.delByPattern('blog:posts:*')
    console.log('🔄 Blog cache invalidated')
    return true
  } catch (e) {
    console.error("❌ invalidateBlogCache error:", e.message)
    return false
  }
}

/**
 * Инвалидировать кеш конкретного поста
 */
async function invalidatePostCache(postId) {
  try {
    await redis.del(
      `blog:post:${postId}`,
      `blog:posts:all`,
      `blog:posts:top`
    )
    // Инвалидировать все теги
    await redis.delByPattern(`blog:posts:tag:*`)
    console.log(`🔄 Cache invalidated for post ${postId}`)
    return true
  } catch (e) {
    console.error("❌ invalidatePostCache error:", e.message)
    return false
  }
}

/**
 * Получить статистику по всему блогу
 */
async function getBlogStats() {
  try {
    const allPostsKeys = await redis.getAllKeys('blog:views:*')
    let totalViews = 0
    let totalUniqueViews = 0
    
    for (const key of allPostsKeys) {
      const postId = key.replace('blog:views:', '')
      const stats = await getPostStats(postId)
      totalViews += stats.totalViews || 0
      totalUniqueViews += stats.uniqueViews || 0
    }
    
    return {
      totalViews,
      totalUniqueViews,
      totalPosts: allPostsKeys.length,
      avgViewsPerPost: allPostsKeys.length ? Math.round(totalViews / allPostsKeys.length) : 0
    }
  } catch (e) {
    console.error("❌ getBlogStats error:", e.message)
    return { totalViews: 0, totalUniqueViews: 0, totalPosts: 0, avgViewsPerPost: 0 }
  }
}

/**
 * Получить топ постов по просмотрам
 */
async function getTopPostsByViews(limit = 10) {
  try {
    const allPostsKeys = await redis.getAllKeys('blog:views:*')
    
    const postsWithViews = await Promise.all(
      allPostsKeys.map(async (key) => {
        const postId = key.replace('blog:views:', '')
        const views = await redis.getCounter(key)
        return { postId, views }
      })
    )
    
    return postsWithViews
      .sort((a, b) => b.views - a.views)
      .slice(0, limit)
  } catch (e) {
    console.error("❌ getTopPostsByViews error:", e.message)
    return []
  }
}

module.exports = {
  TTL,
  cacheAllPosts,
  getCachedAllPosts,
  cachePostById,
  getCachedPostById,
  cacheTopPosts,
  getCachedTopPosts,
  cachePostsByTag,
  getCachedPostsByTag,
  recordPostView,
  getPostStats,
  invalidateBlogCache,
  invalidatePostCache,
  getBlogStats,
  getTopPostsByViews
}