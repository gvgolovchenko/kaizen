#!/usr/bin/env node
/**
 * Утилита для выполнения SQL-запросов к PostgreSQL
 *
 * Использование:
 *   node exec-sql.js "SELECT version()"
 *   node exec-sql.js --file migrations/001_initial_schema.sql
 */

import pg from 'pg'
import { readFileSync } from 'fs'

const { Client } = pg

const config = {
  host: '192.168.178.56',
  port: 8053,
  database: 'postgres',
  user: 'postgres.postgres',
  password: 'project_rivc-opii_db_badbef42b7d0a28c2b21ea15d26862c9',
  ssl: false,
  connectionTimeoutMillis: 30000,
}

async function execSql(sql) {
  const client = new Client(config)
  try {
    await client.connect()
    console.log('Подключено к PostgreSQL')
    const result = await client.query(sql)
    if (result.rows && result.rows.length > 0) {
      console.table(result.rows)
    } else {
      console.log(`Выполнено: ${result.command}, строк затронуто: ${result.rowCount}`)
    }
  } catch (err) {
    console.error('Ошибка выполнения SQL:', err.message)
    process.exit(1)
  } finally {
    await client.end()
  }
}

const args = process.argv.slice(2)

if (args.length === 0) {
  console.error('Использование:')
  console.error('  node exec-sql.js "SQL запрос"')
  console.error('  node exec-sql.js --file путь/к/файлу.sql')
  process.exit(1)
}

let sql
if (args[0] === '--file') {
  const filePath = args[1]
  if (!filePath) {
    console.error('Укажите путь к SQL-файлу')
    process.exit(1)
  }
  sql = readFileSync(filePath, 'utf-8')
  console.log(`Выполняю файл: ${filePath}`)
} else {
  sql = args.join(' ')
}

execSql(sql)
