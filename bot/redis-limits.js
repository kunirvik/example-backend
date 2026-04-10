// ═══════════════════════════════════════════════════════════════════════════════
// redis-limits.js - ФУНКЦИИ ДЛЯ ЛИМИТОВ (вместо Map в памяти)
// ═══════════════════════════════════════════════════════════════════════════════
// ИСПОЛЬЗОВАНИЕ: const limits = require("./redis-limits")
// ═════════════════════════════════════════════════════════════════════════════════

const redis = require('../redis')

// ── КОНСТАНТЫ ──────────────────────────────────────────────────────────────────

const MAX_DAILY = 3        // Макс объявлений в день
const MAX_ACTIVE = 3       // Макс активных объявлений одновременно
const COOLDOWN_MS = 15 * 60 * 1000  // 15 минут между объявлениями

// ── ФУНКЦИИ ───────────────────────────────────────────────────────────────────

/**
 * Получить дневные статистики пользователя из Redis
 * Автоматически сбрасывается в 00:00
 */
async function getDailyStats(uid) {
  try {
    let stats = await redis.get(`limits:daily:${uid}`)
    
    if (!stats) {
      stats = { submitted: 0, rejected: 0, date: new Date().toISOString().split('T')[0] }
      await setDailyStats(uid, stats)
    }
    
    return stats
  } catch (e) {
    console.error("❌ getDailyStats error:", e.message)
    return { submitted: 0, rejected: 0 }
  }
}

/**
 * Установить дневные статистики с TTL до 00:00
 */
async function setDailyStats(uid, stats) {
  try {
    const now = new Date()
    const tomorrow = new Date(now)
    tomorrow.setHours(24, 0, 0, 0)
    
    const secondsUntilMidnight = Math.floor((tomorrow - now) / 1000)
    
    return await redis.set(
      `limits:daily:${uid}`,
      stats,
      secondsUntilMidnight  // ✅ АВТОМАТИЧЕСКИ УДАЛИТСЯ В 00:00
    )
  } catch (e) {
    console.error("❌ setDailyStats error:", e.message)
    return false
  }
}

/**
 * Проверить может ли пользователь создать объявление сегодня
 */
async function canSubmitToday(uid) {
  try {
    const stats = await getDailyStats(uid)
    const totalAttempts = stats.submitted + stats.rejected
    
    return totalAttempts < MAX_DAILY
  } catch (e) {
    console.error("❌ canSubmitToday error:", e.message)
    return true  // В случае ошибки - разрешить (fail open)
  }
}

/**
 * Проверить активные объявления пользователя
 */
async function countActiveListings(uid, Listing) {
  try {
    const count = await Listing.countDocuments({
      telegramId: uid,
      status: 'published'
    })
    
    return count
  } catch (e) {
    console.error("❌ countActiveListings error:", e.message)
    return 0
  }
}

/**
 * Проверить может ли пользователь создать еще одно активное объявление
 */
async function canCreateActive(uid, Listing) {
  try {
    const count = await countActiveListings(uid, Listing)
    return count < MAX_ACTIVE
  } catch (e) {
    console.error("❌ canCreateActive error:", e.message)
    return true
  }
}

/**
 * Записать успешное создание объявления
 */
async function recordSubmission(uid) {
  try {
    const stats = await getDailyStats(uid)
    stats.submitted++
    
    await setDailyStats(uid, stats)
    console.log(`📊 Recorded submission for ${uid}: ${stats.submitted}`)
    
    return stats
  } catch (e) {
    console.error("❌ recordSubmission error:", e.message)
    return null
  }
}

/**
 * Записать отклонение объявления
 */
async function recordRejection(uid) {
  try {
    const stats = await getDailyStats(uid)
    stats.rejected++
    
    await setDailyStats(uid, stats)
    console.log(`📊 Recorded rejection for ${uid}: ${stats.rejected}`)
    
    return stats
  } catch (e) {
    console.error("❌ recordRejection error:", e.message)
    return null
  }
}

/**
 * Получить оставшиеся попытки сегодня
 */
async function getRemainingAttempts(uid) {
  try {
    const stats = await getDailyStats(uid)
    const totalAttempts = stats.submitted + stats.rejected
    
    return Math.max(0, MAX_DAILY - totalAttempts)
  } catch (e) {
    console.error("❌ getRemainingAttempts error:", e.message)
    return MAX_DAILY
  }
}

/**
 * Установить кулдаун (15 минут между объявлениями)
 */
async function setCooldown(uid) {
  try {
    const cooldownMinutes = Math.ceil(COOLDOWN_MS / 60000)
    
    return await redis.set(
      `cooldown:${uid}`,
      Date.now(),
      cooldownMinutes * 60  // TTL в секундах
    )
  } catch (e) {
    console.error("❌ setCooldown error:", e.message)
    return false
  }
}

/**
 * Получить время до конца кулдауна (в миллисекундах)
 */
async function getCooldownLeft(uid) {
  try {
    const lastSubmit = await redis.get(`cooldown:${uid}`)
    
    if (!lastSubmit) {
      return 0
    }
    
    const lastTime = parseInt(lastSubmit)
    const left = COOLDOWN_MS - (Date.now() - lastTime)
    
    return left > 0 ? left : 0
  } catch (e) {
    console.error("❌ getCooldownLeft error:", e.message)
    return 0
  }
}

/**
 * Форматировать кулдаун для пользователя
 */
function formatCooldown(ms) {
  if (ms <= 0) return "0 мин"
  
  const totalSeconds = Math.ceil(ms / 1000)
  const minutes = Math.ceil(totalSeconds / 60)
  
  return `${minutes} хв.`
}

/**
 * Получить всю статистику пользователя
 */
async function getUserStats(uid) {
  try {
    const dailyStats = await getDailyStats(uid)
    const cooldownLeft = await getCooldownLeft(uid)
    const remaining = await getRemainingAttempts(uid)
    
    return {
      dailyStats,
      cooldownLeft,
      cooldownFormatted: formatCooldown(cooldownLeft),
      remaining,
      canSubmit: cooldownLeft === 0 && remaining > 0
    }
  } catch (e) {
    console.error("❌ getUserStats error:", e.message)
    return {
      dailyStats: { submitted: 0, rejected: 0 },
      cooldownLeft: 0,
      cooldownFormatted: "0 мин",
      remaining: MAX_DAILY,
      canSubmit: true
    }
  }
}

/**
 * Очистить лимиты для пользователя (для тестирования)
 */
async function clearUserLimits(uid) {
  try {
    await redis.del(`limits:daily:${uid}`, `cooldown:${uid}`)
    console.log(`🔄 Cleared limits for ${uid}`)
    return true
  } catch (e) {
    console.error("❌ clearUserLimits error:", e.message)
    return false
  }
}

/**
 * Получить статистику по всем пользователям
 * (для админа, будьте аккуратны!)
 */
async function getAllUserStats() {
  try {
    const limitKeys = await redis.getAllKeys('limits:daily:*')
    const stats = {}
    
    for (const key of limitKeys) {
      const uid = key.replace('limits:daily:', '')
      stats[uid] = await getDailyStats(uid)
    }
    
    return stats
  } catch (e) {
    console.error("❌ getAllUserStats error:", e.message)
    return {}
  }
}

// ── ЭКСПОРТ ───────────────────────────────────────────────────────────────────

module.exports = {
  // Константы
  MAX_DAILY,
  MAX_ACTIVE,
  COOLDOWN_MS,
  
  // Основные функции
  getDailyStats,
  setDailyStats,
  canSubmitToday,
  countActiveListings,
  canCreateActive,
  recordSubmission,
  recordRejection,
  getRemainingAttempts,
  
  // Кулдаун
  setCooldown,
  getCooldownLeft,
  formatCooldown,
  
  // Утилиты
  getUserStats,
  clearUserLimits,
  getAllUserStats
}

// ═════════════════════════════════════════════════════════════════════════════════
// ПРИМЕРЫ ИСПОЛЬЗОВАНИЯ:
// 
// const limits = require('./redis-limits')
//
// // Проверить может ли пользователь подать объявление
// const canSubmit = await limits.canSubmitToday(uid)
// if (!canSubmit) {
//   return bot.sendMessage(chatId, 'Лимит исчерпан')
// }
//
// // Записать успешное создание
// await limits.recordSubmission(uid)
// await limits.setCooldown(uid)
//
// // Получить полную статистику
// const stats = await limits.getUserStats(uid)
// console.log(`Осталось попыток: ${stats.remaining}`)
// console.log(`Кулдаун: ${stats.cooldownFormatted}`)
// ═════════════════════════════════════════════════════════════════════════════════