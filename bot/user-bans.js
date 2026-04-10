// ═══════════════════════════════════════════════════════════════════════════════
// bot/user-bans.js - СИСТЕМА БАНОВ (ЗАБАНИТЬ ПОЛЬЗОВАТЕЛЯ)
// ═══════════════════════════════════════════════════════════════════════════════

const redis = require('../redis')
const mongoose = require('mongoose')

// ── СХЕМА БАНОВ В MONGODB ──────────────────────────────────────────────────

const BanSchema = new mongoose.Schema({
  userId: { 
    type: String, 
    required: true, 
    unique: true, 
    index: true 
  },
  
  username: String,
  
  reason: {
    type: String,
    default: 'No reason specified'
  },
  
  bannedBy: String,              // Кто забанил (ID админа)
  
  bannedAt: { 
    type: Date, 
    default: Date.now,
    index: true
  },
  
  expiresAt: Date,               // Временный бан (если null - permanent)
  
  isPermanent: { 
    type: Boolean, 
    default: false 
  },
  
  banType: {                     // Тип бана
    type: String,
    enum: ['marketplace', 'blog', 'both'],
    default: 'both',
    index: true
  },
  
  status: {
    type: String,
    enum: ['active', 'expired', 'revoked'],
    default: 'active',
    index: true
  }
}, { timestamps: true })

const Ban = mongoose.model('Ban', BanSchema)

// ── ОСНОВНЫЕ ФУНКЦИИ ──────────────────────────────────────────────────────

/**
 * Забанить пользователя
 * 
 * @param {string} userId - Telegram ID пользователя
 * @param {object} options - опции
 *   - username: имя пользователя
 *   - reason: причина бана
 *   - bannedBy: кто забанил (ID админа)
 *   - durationDays: длительность в днях (null = permanent)
 *   - banType: 'marketplace' | 'blog' | 'both'
 */
async function banUser(userId, options = {}) {
  try {
    const {
      username = '',
      reason = 'No reason specified',
      bannedBy = 'admin',
      durationDays = null,  // null = permanent
      banType = 'both'      // 'marketplace', 'blog', 'both'
    } = options

    // Вычислить дату истечения бана
    let expiresAt = null
    if (durationDays && durationDays > 0) {
      expiresAt = new Date(Date.now() + durationDays * 24 * 60 * 60 * 1000)
    }

    // 1. Сохранить в MongoDB
    const ban = await Ban.findOneAndUpdate(
      { userId },
      {
        userId,
        username,
        reason,
        bannedBy,
        expiresAt,
        isPermanent: !durationDays,
        banType,
        status: 'active',
        bannedAt: new Date()
      },
      { upsert: true, returnDocument: 'after' }
    )

    // 2. Сохранить в Redis (для быстрой проверки)
    const banKey = `ban:${userId}`
    const ttlSeconds = durationDays 
      ? durationDays * 24 * 60 * 60 
      : null
    
    await redis.set(banKey, JSON.stringify({
      userId,
      username,
      reason,
      banType,
      expiresAt,
      isPermanent: !durationDays
    }), ttlSeconds)

    // 3. Добавить в индекс всех банов
    await redis.redis.sadd('bans:all', userId)

    console.log(`🚫 User ${userId} banned: ${reason}`)
    
    return {
      ok: true,
      ban,
      message: `User ${userId} banned`
    }
  } catch (e) {
    console.error("❌ banUser error:", e.message)
    return { ok: false, error: e.message }
  }
}

/**
 * Проверить забанен ли пользователь
 */
async function isUserBanned(userId, banType = 'both') {
  try {
    if (!userId) return false

    // 1. Проверить в Redis (быстро)
    const cachedBan = await redis.get(`ban:${userId}`)
    
    if (cachedBan) {
      const ban = JSON.parse(cachedBan)
      
      // Проверить тип бана
      if (banType !== 'both' && ban.banType !== 'both' && ban.banType !== banType) {
        return false
      }
      
      // Проверить истечение
      if (ban.expiresAt && new Date(ban.expiresAt) < new Date()) {
        await revokeBan(userId)
        return false
      }
      
      return true
    }

    // 2. Если нет в Redis - проверить MongoDB
    const ban = await Ban.findOne({
      userId,
      status: 'active'
    }).lean()

    if (!ban) return false

    // Проверить тип бана
    if (banType !== 'both' && ban.banType !== 'both' && ban.banType !== banType) {
      return false
    }

    // Проверить истечение
    if (ban.expiresAt && new Date(ban.expiresAt) < new Date()) {
      await revokeBan(userId)
      return false
    }

    // Закешировать в Redis
    const ttl = ban.expiresAt 
      ? Math.floor((new Date(ban.expiresAt) - new Date()) / 1000)
      : null
    
    await redis.set(`ban:${userId}`, JSON.stringify(ban), ttl)

    return true
  } catch (e) {
    console.error("❌ isUserBanned error:", e.message)
    return false
  }
}

/**
 * Получить информацию о бане
 */
async function getBanInfo(userId) {
  try {
    if (!userId) {
      return { isBanned: false, ban: null }
    }

    const ban = await Ban.findOne({ 
      userId, 
      status: 'active' 
    }).lean()
    
    if (!ban) {
      return { isBanned: false, ban: null }
    }

    // Проверить истечение
    if (ban.expiresAt && new Date(ban.expiresAt) < new Date()) {
      await revokeBan(userId)
      return { isBanned: false, ban: null }
    }

    const daysLeft = ban.expiresAt 
      ? Math.ceil((new Date(ban.expiresAt) - new Date()) / (1000 * 60 * 60 * 24))
      : null

    return {
      isBanned: true,
      ban: {
        ...ban,
        daysLeft,
        message: `You are banned${daysLeft ? ` for ${daysLeft} more days` : ' permanently'}. Reason: ${ban.reason}`
      }
    }
  } catch (e) {
    console.error("❌ getBanInfo error:", e.message)
    return { isBanned: false, ban: null }
  }
}

/**
 * Разбанить пользователя
 */
async function revokeBan(userId, revokedBy = 'admin') {
  try {
    if (!userId) return { ok: false, error: 'userId is required' }

    // 1. Обновить в MongoDB
    const result = await Ban.findOneAndUpdate(
      { userId },
      { status: 'revoked' }
    )

    if (!result) {
      return { ok: false, error: 'Ban not found' }
    }

    // 2. Удалить из Redis
    await redis.del(`ban:${userId}`)
    await redis.redis.srem('bans:all', userId)

    console.log(`✅ User ${userId} unbanned by ${revokedBy}`)
    
    return { ok: true, message: `User ${userId} unbanned` }
  } catch (e) {
    console.error("❌ revokeBan error:", e.message)
    return { ok: false, error: e.message }
  }
}

/**
 * Получить все активные баны
 */
async function getAllActiveBans(filter = {}) {
  try {
    const query = { status: 'active', ...filter }
    
    return await Ban.find(query)
      .sort({ bannedAt: -1 })
      .lean()
  } catch (e) {
    console.error("❌ getAllActiveBans error:", e.message)
    return []
  }
}

/**
 * Получить статистику банов
 */
async function getBanStats() {
  try {
    const total = await Ban.countDocuments({ status: 'active' })
    const permanent = await Ban.countDocuments({ 
      status: 'active',
      isPermanent: true
    })
    const temporary = total - permanent

    const byType = await Ban.aggregate([
      { $match: { status: 'active' } },
      { $group: { _id: '$banType', count: { $sum: 1 } } }
    ])

    return {
      total,
      permanent,
      temporary,
      byType: Object.fromEntries(byType.map(b => [b._id, b.count]) || [])
    }
  } catch (e) {
    console.error("❌ getBanStats error:", e.message)
    return { total: 0, permanent: 0, temporary: 0, byType: {} }
  }
}

/**
 * Получить историю банов пользователя
 */
async function getUserBanHistory(userId) {
  try {
    return await Ban.find({ userId })
      .sort({ bannedAt: -1 })
      .lean()
  } catch (e) {
    console.error("❌ getUserBanHistory error:", e.message)
    return []
  }
}

/**
 * Обновить дату истечения бана
 */
async function extendBan(userId, additionalDays) {
  try {
    const ban = await Ban.findOne({ userId, status: 'active' })
    
    if (!ban) {
      return { ok: false, error: 'Ban not found' }
    }

    let newExpiresAt = ban.expiresAt || new Date()
    newExpiresAt = new Date(newExpiresAt.getTime() + additionalDays * 24 * 60 * 60 * 1000)

    await Ban.findOneAndUpdate(
      { userId },
      { expiresAt: newExpiresAt }
    )

    // Обновить Redis
    const ttl = Math.floor((newExpiresAt - new Date()) / 1000)
    const banData = await Ban.findOne({ userId, status: 'active' }).lean()
    await redis.set(`ban:${userId}`, JSON.stringify(banData), ttl)

    console.log(`⏰ Ban extended for ${userId} by ${additionalDays} days`)

    return { ok: true, newExpiresAt }
  } catch (e) {
    console.error("❌ extendBan error:", e.message)
    return { ok: false, error: e.message }
  }
}

module.exports = {
  Ban,
  banUser,
  isUserBanned,
  getBanInfo,
  revokeBan,
  getAllActiveBans,
  getBanStats,
  getUserBanHistory,
  extendBan
}