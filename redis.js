// ═══════════════════════════════════════════════════════════════════════════════
// redis.js - ЦЕНТРАЛЬНАЯ СИСТЕМА КЕШИРОВАНИЯ
// ═══════════════════════════════════════════════════════════════════════════════

const Redis = require('ioredis')

// ── КОНФИГУРАЦИЯ ───────────────────────────────────────────────────────────────

const redis = new Redis({
  host: process.env.REDIS_HOST || 'localhost',
  port: process.env.REDIS_PORT || 6379,
  password: process.env.REDIS_PASSWORD || undefined,
  retryStrategy: times => {
    const delay = Math.min(times * 50, 2000)
    return delay
  },
  maxRetriesPerRequest: null,
})

redis.on('connect', () => {
  console.log('✅ Redis подключен')
})

redis.on('error', (err) => {
  console.error('❌ Redis ошибка:', err.message)
})

// ── TTL ЗНАЧЕНИЯ (в секундах) ──────────────────────────────────────────────────

const TTL = {
  LISTINGS_LIST: 5 * 60,           // 5 минут - полный список объявлений
  TOP_LISTINGS: 10 * 60,           // 10 минут - топ по просмотрам
  LISTING_DETAIL: 10 * 60,         // 10 минут - детали объявления
  USER_STATS: 60 * 60,             // 1 час - статистика пользователя
  SESSION: 24 * 60 * 60,           // 24 часа - сессия
  DAILY_LIMITS: 24 * 60 * 60,      // 24 часа - дневные лимиты
  SEARCH_RESULTS: 5 * 60,          // 5 минут - результаты поиска
  CATEGORY_COUNT: 30 * 60,         // 30 минут - кол-во по категориям
}

// ── ПРЕФИКСЫ КЛЮЧЕЙ ───────────────────────────────────────────────────────────

const KEYS = {
  // Объявления
  listingsAll: () => 'listings:all',
  listingTop: () => 'listings:top',
  listingDetail: (id) => `listings:detail:${id}`,
  listingsByCategory: (cat) => `listings:category:${cat}`,
  listingsByUser: (uid) => `listings:user:${uid}`,
  
  // Статистика
  listingStats: (id) => `stats:listing:${id}`,
  userStats: (uid) => `stats:user:${uid}`,
  
  // Сессии и лимиты
  userSession: (uid) => `session:${uid}`,
  dailyLimits: (uid) => `limits:daily:${uid}`,
  cooldown: (uid) => `cooldown:${uid}`,
  
  // Поиск
  search: (query) => `search:${Buffer.from(query).toString('base64')}`,
  
  // Индексы для инвалидации
  userListings: (uid) => `user:listings:${uid}`,
}

// ═════════════════════════════════════════════════════════════════════════════════
// БАЗОВЫЕ ОПЕРАЦИИ
// ═════════════════════════════════════════════════════════════════════════════════

/**
 * Получить значение из кеша
 */
async function get(key) {
  try {
    const data = await redis.get(key)
    if (!data) return null
    
    try {
      return JSON.parse(data)
    } catch {
      return data
    }
  } catch (err) {
    console.error(`❌ Redis GET ${key}:`, err.message)
    return null
  }
}

/**
 * Установить значение в кеш
 */
async function set(key, value, ttl = null) {
  try {
    const serialized = typeof value === 'string' ? value : JSON.stringify(value)
    
    if (ttl) {
      await redis.setex(key, ttl, serialized)
    } else {
      await redis.set(key, serialized)
    }
    
    return true
  } catch (err) {
    console.error(`❌ Redis SET ${key}:`, err.message)
    return false
  }
}

/**
 * Удалить значение из кеша
 */
async function del(...keys) {
  try {
    if (keys.length === 0) return 0
    return await redis.del(...keys)
  } catch (err) {
    console.error(`❌ Redis DEL:`, err.message)
    return 0
  }
}

/**
 * Удалить по паттерну (осторожно!)
 */
async function delByPattern(pattern) {
  try {
    const keys = await redis.keys(pattern)
    if (keys.length === 0) return 0
    return await redis.del(...keys)
  } catch (err) {
    console.error(`❌ Redis DELBYPATTERN ${pattern}:`, err.message)
    return 0
  }
}

/**
 * Увеличить счетчик
 */
async function increment(key, amount = 1) {
  try {
    return await redis.incrby(key, amount)
  } catch (err) {
    console.error(`❌ Redis INCR ${key}:`, err.message)
    return null
  }
}

/**
 * Получить счетчик
 */
async function getCounter(key) {
  try {
    const val = await redis.get(key)
    return val ? parseInt(val) : 0
  } catch (err) {
    console.error(`❌ Redis GETCOUNTER ${key}:`, err.message)
    return 0
  }
}

/**
 * Проверить наличие ключа
 */
async function exists(key) {
  try {
    return (await redis.exists(key)) === 1
  } catch (err) {
    console.error(`❌ Redis EXISTS ${key}:`, err.message)
    return false
  }
}

/**
 * Получить TTL ключа (в секундах)
 */
async function getTTL(key) {
  try {
    return await redis.ttl(key)
  } catch (err) {
    console.error(`❌ Redis TTL ${key}:`, err.message)
    return -1
  }
}

// ═════════════════════════════════════════════════════════════════════════════════
// РАБОТА С СПИСКАМИ И ХЕШАМИ
// ═════════════════════════════════════════════════════════════════════════════════

/**
 * Добавить в список (список просмотров)
 */
async function pushToList(key, value, ttl = null) {
  try {
    const serialized = typeof value === 'string' ? value : JSON.stringify(value)
    await redis.rpush(key, serialized)
    
    if (ttl) {
      await redis.expire(key, ttl)
    }
    return true
  } catch (err) {
    console.error(`❌ Redis PUSHTOLIST ${key}:`, err.message)
    return false
  }
}

/**
 * Получить все значения из списка
 */
async function getList(key) {
  try {
    const data = await redis.lrange(key, 0, -1)
    return data.map(item => {
      try {
        return JSON.parse(item)
      } catch {
        return item
      }
    })
  } catch (err) {
    console.error(`❌ Redis GETLIST ${key}:`, err.message)
    return []
  }
}

/**
 * Получить длину списка
 */
async function getListLength(key) {
  try {
    return await redis.llen(key)
  } catch (err) {
    console.error(`❌ Redis LISTLEN ${key}:`, err.message)
    return 0
  }
}

/**
 * Установить хеш (для структурированных данных)
 */
async function hset(key, field, value, ttl = null) {
  try {
    const serialized = typeof value === 'string' ? value : JSON.stringify(value)
    await redis.hset(key, field, serialized)
    
    if (ttl) {
      await redis.expire(key, ttl)
    }
    return true
  } catch (err) {
    console.error(`❌ Redis HSET ${key}:`, err.message)
    return false
  }
}

/**
 * Получить значение хеша
 */
async function hget(key, field) {
  try {
    const data = await redis.hget(key, field)
    if (!data) return null
    
    try {
      return JSON.parse(data)
    } catch {
      return data
    }
  } catch (err) {
    console.error(`❌ Redis HGET ${key}:`, err.message)
    return null
  }
}

/**
 * Получить все значения хеша
 */
async function hgetall(key) {
  try {
    const data = await redis.hgetall(key)
    const result = {}
    
    for (const [field, value] of Object.entries(data)) {
      try {
        result[field] = JSON.parse(value)
      } catch {
        result[field] = value
      }
    }
    
    return result
  } catch (err) {
    console.error(`❌ Redis HGETALL ${key}:`, err.message)
    return {}
  }
}

// ═════════════════════════════════════════════════════════════════════════════════
// ВЫСОКОУРОВНЕВЫЕ ФУНКЦИИ ДЛЯ БИЗНЕС-ЛОГИКИ
// ═════════════════════════════════════════════════════════════════════════════════

/**
 * Кешировать список объявлений
 */
async function cacheListings(listings) {
  return await set(
    KEYS.listingsAll(),
    listings,
    TTL.LISTINGS_LIST
  )
}

/**
 * Получить кешированный список
 */
async function getCachedListings() {
  return await get(KEYS.listingsAll())
}

/**
 * Кешировать топ объявлений
 */
async function cacheTopListings(listings) {
  return await set(
    KEYS.listingTop(),
    listings,
    TTL.TOP_LISTINGS
  )
}

/**
 * Получить топ объявлений
 */
async function getCachedTopListings() {
  return await get(KEYS.listingTop())
}

/**
 * Кешировать детали объявления
 */
async function cacheListing(id, listing) {
  return await set(
    KEYS.listingDetail(id),
    listing,
    TTL.LISTING_DETAIL
  )
}

/**
 * Получить детали объявления
 */
async function getCachedListing(id) {
  return await get(KEYS.listingDetail(id))
}

/**
 * Кешировать статистику объявления
 */
async function cacheListingStats(id, stats) {
  return await set(
    KEYS.listingStats(id),
    stats,
    TTL.LISTING_DETAIL
  )
}

/**
 * Получить статистику объявления
 */
async function getCachedListingStats(id) {
  return await get(KEYS.listingStats(id))
}

/**
 * Сохранить сессию пользователя
 */
async function saveSession(uid, sessionData) {
  return await set(
    KEYS.userSession(uid),
    sessionData,
    TTL.SESSION
  )
}

/**
 * Получить сессию пользователя
 */
async function getSession(uid) {
  return await get(KEYS.userSession(uid))
}

/**
 * Удалить сессию
 */
async function deleteSession(uid) {
  return await del(KEYS.userSession(uid))
}

/**
 * Установить дневные лимиты
 */
async function setDailyLimits(uid, limits) {
  const now = new Date()
  const tomorrow = new Date(now)
  tomorrow.setHours(24, 0, 0, 0)
  const secondsUntilMidnight = Math.floor((tomorrow - now) / 1000)
  
  return await set(
    KEYS.dailyLimits(uid),
    limits,
    secondsUntilMidnight
  )
}

/**
 * Получить дневные лимиты
 */
async function getDailyLimits(uid) {
  return await get(KEYS.dailyLimits(uid))
}

/**
 * Инвалидировать кеш объявлений
 */
async function invalidateListingsCache() {
  await Promise.all([
    del(KEYS.listingsAll()),
    del(KEYS.listingTop()),
    delByPattern('listings:category:*'),
    delByPattern('search:*'),
  ])
  console.log('🔄 Кеш объявлений инвалидирован')
}

/**
 * Инвалидировать кеш для конкретного объявления
 */
async function invalidateListing(id) {
  await Promise.all([
    del(KEYS.listingDetail(id)),
    del(KEYS.listingStats(id)),
  ])
}

/**
 * Получить все ключи (для дебага)
 */
async function getAllKeys(pattern = '*') {
  try {
    return await redis.keys(pattern)
  } catch (err) {
    console.error(`❌ Redis KEYS ${pattern}:`, err.message)
    return []
  }
}

/**
 * Получить информацию о Redis
 */
async function getInfo() {
  try {
    const info = await redis.info('stats')
    return info
  } catch (err) {
    console.error('❌ Redis INFO:', err.message)
    return null
  }
}

/**
 * Очистить ВСЕ данные (ОСТОРОЖНО!)
 */
async function flushAll() {
  try {
    await redis.flushall()
    console.log('⚠️  Redis полностью очищен')
    return true
  } catch (err) {
    console.error('❌ Redis FLUSHALL:', err.message)
    return false
  }
}

/**
 * Очистить только объявления (кроме сессий)
 */
async function flushListingsCache() {
  try {
    await delByPattern('listings:*')
    await delByPattern('stats:*')
    await delByPattern('search:*')
    console.log('🔄 Кеш объявлений очищен')
    return true
  } catch (err) {
    console.error('❌ Ошибка очистки кеша:', err.message)
    return false
  }
}

// ═════════════════════════════════════════════════════════════════════════════════
// ЭКСПОРТ
// ═════════════════════════════════════════════════════════════════════════════════

module.exports = {
  redis,
  TTL,
  KEYS,
  
  // Базовые операции
  get,
  set,
  del,
  delByPattern,
  increment,
  getCounter,
  exists,
  getTTL,
  
  // Списки и хеши
  pushToList,
  getList,
  getListLength,
  hset,
  hget,
  hgetall,
  
  // Бизнес-логика
  cacheListings,
  getCachedListings,
  cacheTopListings,
  getCachedTopListings,
  cacheListing,
  getCachedListing,
  cacheListingStats,
  getCachedListingStats,
  saveSession,
  getSession,
  deleteSession,
  setDailyLimits,
  getDailyLimits,
  invalidateListingsCache,
  invalidateListing,
  
  // Утилиты
  getAllKeys,
  getInfo,
  flushAll,
  flushListingsCache,
}