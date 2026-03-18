require('dotenv').config()
const mongoose = require('mongoose')
 
// Подключаемся к MongoDB
const MONGODB_URI = process.env.MONGODB_URI
 
if (!MONGODB_URI) {
  console.error('❌ MONGODB_URI не знайдено в .env файлі')
  process.exit(1)
}
 
console.log('🔄 Підключення до MongoDB...')
 
mongoose.connect(MONGODB_URI)
  .then(() => {
    console.log('✅ Підключено до MongoDB')
    return runMigration()
  })
  .then(() => {
    console.log('✅ Міграція завершена успішно!')
    process.exit(0)
  })
  .catch(err => {
    console.error('❌ Помилка міграції:', err.message)
    process.exit(1)
  })
 
async function runMigration() {
  const db = mongoose.connection.db
  const listingsCollection = db.collection('listings')
  
  console.log('\n📊 Аналіз поточної бази даних...')
  
  // Статистика до міграції
  const totalCount = await listingsCollection.countDocuments()
  const withoutViewCount = await listingsCollection.countDocuments({ 
    viewCount: { $exists: false } 
  })
  const oldCategories = await listingsCollection.countDocuments({
    category: { $in: ['bikes', 'electronics'] }
  })
  
  console.log(`\nЗнайдено:`)
  console.log(`  • Всього оголошень: ${totalCount}`)
  console.log(`  • Без viewCount: ${withoutViewCount}`)
  console.log(`  • Зі старими категоріями: ${oldCategories}`)
  
  if (totalCount === 0) {
    console.log('\n⚠️  База даних порожня, міграція не потрібна')
    return
  }
  
  // КРОК 1: Додаємо нові поля
  console.log('\n🔧 КРОК 1: Додаємо viewCount та пов\'язані поля...')
  
  const step1Result = await listingsCollection.updateMany(
    { viewCount: { $exists: false } },
    { 
      $set: { 
        viewCount: 0,
        viewedBy: [],
        lastViewedAt: null
      } 
    }
  )
  
  console.log(`✅ Оновлено ${step1Result.modifiedCount} оголошень`)
  
  // КРОК 2: Міграція старих категорій
  if (oldCategories > 0) {
    console.log('\n🔧 КРОК 2: Міграція старих категорій...')
    
    // bikes → mtb
    const bikesResult = await listingsCollection.updateMany(
      { category: 'bikes' },
      { $set: { category: 'mtb' } }
    )
    console.log(`  • bikes → mtb: ${bikesResult.modifiedCount} оголошень`)
    
    // electronics → other
    const electronicsResult = await listingsCollection.updateMany(
      { category: 'electronics' },
      { $set: { category: 'other' } }
    )
    console.log(`  • electronics → other: ${electronicsResult.modifiedCount} оголошень`)
  } else {
    console.log('\n✅ КРОК 2: Старі категорії не знайдені, пропускаємо')
  }
  
  // КРОК 3: Перевірка результатів
  console.log('\n🔍 КРОК 3: Перевірка результатів міграції...')
  
  const afterMigration = {
    total: await listingsCollection.countDocuments(),
    withViewCount: await listingsCollection.countDocuments({ 
      viewCount: { $exists: true } 
    }),
    byCategory: {}
  }
  
  // Статистика по категоріям
  const categoryStats = await listingsCollection.aggregate([
    { $group: { _id: '$category', count: { $sum: 1 } } },
    { $sort: { count: -1 } }
  ]).toArray()
  
  console.log('\nПісля міграції:')
  console.log(`  • Всього оголошень: ${afterMigration.total}`)
  console.log(`  • З viewCount: ${afterMigration.withViewCount}`)
  
  console.log('\nОголошень по категоріям:')
  categoryStats.forEach(stat => {
    const emoji = {
      mtb: '🚵',
      bmx: '🚴',
      skate: '🛹',
      parts: '🔧',
      clothing: '👕',
      other: '📦'
    }
    console.log(`  ${emoji[stat._id] || '📌'} ${stat._id}: ${stat.count}`)
  })
  
  // Перевірка чи всі оголошення мають нові поля
  if (afterMigration.withViewCount === afterMigration.total) {
    console.log('\n✅ Всі оголошення успішно оновлені!')
  } else {
    console.warn('\n⚠️  Деякі оголошення не були оновлені')
    console.warn(`Оновлено: ${afterMigration.withViewCount} з ${afterMigration.total}`)
  }
  
  // КРОК 4: Перевірка індексів
  console.log('\n🔍 КРОК 4: Перевірка індексів...')
  
  const indexes = await listingsCollection.indexes()
  const requiredIndexes = [
    'viewCount_-1',
    'category_1_status_1'
  ]
  
  const existingIndexNames = indexes.map(idx => idx.name)
  const missingIndexes = requiredIndexes.filter(idx => 
    !existingIndexNames.includes(idx)
  )
  
  if (missingIndexes.length > 0) {
    console.log('\n⚠️  Відсутні індекси (будуть створені при старті додатку):')
    missingIndexes.forEach(idx => console.log(`  • ${idx}`))
    console.log('\nДля оптимізації рекомендується перезапустити сервер.')
  } else {
    console.log('✅ Всі необхідні індекси присутні')
  }
  
  // Закриваємо з'єднання
  await mongoose.disconnect()
}