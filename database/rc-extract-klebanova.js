import sql from 'mssql';

const config = {
  server: process.env.RC_HOST || '192.168.196.47',
  port: parseInt(process.env.RC_PORT || '1433'),
  database: process.env.RC_DATABASE || 'Connect',
  user: process.env.RC_USER || 'ggv_n8n',
  password: process.env.RC_PASSWORD || '0QPU+%;zk|UV',
  options: {
    encrypt: false,
    trustServerCertificate: true,
  },
  connectionTimeout: 10000,
  requestTimeout: 60000,
};

async function extractKlebanovaData() {
  const pool = await sql.connect(config);
  
  // 1. Находим компанию "Хабаровск"
  console.log('🔍 Поиск компании "Хабаровск"...');
  const companyResult = await pool.request().query(`
    SELECT idcomp, namecomp, ShortName, iata
    FROM companys
    WHERE namecomp LIKE '%Хабаровск%' OR ShortName LIKE '%Хабаровск%'
    ORDER BY namecomp
  `);
  
  console.log('\n📌 Найдены компании:');
  companyResult.recordset.forEach(c => {
    console.log(`   ID: ${c.idcomp}, Название: ${c.namecomp}, Краткое: ${c.ShortName}, IATA: ${c.iata}`);
  });
  
  // 2. Находим пользователя "Клебанова"
  console.log('\n🔍 Поиск пользователя "Клебанова"...');
  const userResult = await pool.request().query(`
    SELECT id, nameuser, login, mailuser, idcomp, position
    FROM users
    WHERE nameuser LIKE '%Клебанов%'
    ORDER BY nameuser
  `);
  
  console.log('\n📌 Найдены пользователи:');
  userResult.recordset.forEach(u => {
    console.log(`   ID: ${u.id}, ФИО: ${u.nameuser}, Логин: ${u.login}, Email: ${u.mailuser}, Компания: ${u.idcomp}, Должность: ${u.position}`);
  });
  
  // 3. Выгружаем заявки за последние 2 месяца (и все заявки для сравнения)
  const twoMonthsAgo = new Date();
  twoMonthsAgo.setMonth(twoMonthsAgo.getMonth() - 2);
  const dateStr = twoMonthsAgo.toISOString().split('T')[0];
  
  console.log(`\n🔍 Выгрузка заявок с ${dateStr} (за 2 месяца)...`);
  
  // Собираем ID компаний Хабаровска
  const companyIds = companyResult.recordset.map(c => c.idcomp);
  
  // Собираем email пользователей Клебановых
  const userEmails = userResult.recordset.map(u => u.mailuser);
  
  if (companyIds.length === 0 || userEmails.length === 0) {
    console.log('⚠️ Не найдены компании или пользователи. Выгружаем все заявки от пользователей с фамилией Клебанов...');
  }
  
  // Запрос заявок за 2 месяца
  const request = pool.request();
  request.input('dateFrom', sql.Date, dateStr);
  
  let companyFilter = '';
  if (companyIds.length > 0) {
    companyFilter = `AND r.comp IN (${companyIds.join(',')})`;
  }
  
  let userFilter = '';
  if (userEmails.length > 0) {
    userFilter = `AND r.e_mail IN (${userEmails.map(e => `'${e}'`).join(',')})`;
  }
  
  const ticketsResult = await request.query(`
    SELECT
      r.id AS ticket_id,
      r.e_title AS title,
      r.e_message AS description,
      r.e_name AS author,
      r.e_mail AS author_email,
      r.add_date AS created_at,
      r.change_date AS updated_at,
      r.finish_time AS finish_time,
      r.client_finish AS client_finish,
      s.st_name AS status_name,
      r.status AS status_id,
      u.name AS priority_name,
      rt.TypeName AS type_name,
      sys.namesys AS system_name,
      m.namemod AS module_name,
      r.module AS module_id,
      r.system AS system_id,
      r.dopinfo AS extra_info,
      r.time_cost AS time_cost,
      c.ShortName AS company_name
    FROM requests r
    LEFT JOIN status_st s ON s.id = r.status
    LEFT JOIN urg u ON u.id = r.urg
    LEFT JOIN RequestType rt ON rt.id = r.type
    LEFT JOIN systems sys ON sys.idsys = r.system
    LEFT JOIN modules m ON m.idmod = r.module
    LEFT JOIN companys c ON c.idcomp = r.comp
    WHERE r.add_date >= @dateFrom
      ${companyFilter}
      ${userFilter}
    ORDER BY r.add_date DESC
  `);
  
  // Также выгружаем ВСЕ заявки от Клебановой за всё время
  console.log('\n🔍 Выгрузка всех заявок от Клебановой за всё время...');
  const allTicketsRequest = pool.request();
  let allUserFilter = '';
  if (userEmails.length > 0) {
    allUserFilter = `WHERE r.e_mail IN (${userEmails.map(e => `'${e}'`).join(',')})`;
  }
  
  const allTicketsResult = await allTicketsRequest.query(`
    SELECT
      r.id AS ticket_id,
      r.e_title AS title,
      r.e_message AS description,
      r.e_name AS author,
      r.e_mail AS author_email,
      r.add_date AS created_at,
      r.change_date AS updated_at,
      r.finish_time AS finish_time,
      r.client_finish AS client_finish,
      s.st_name AS status_name,
      r.status AS status_id,
      u.name AS priority_name,
      rt.TypeName AS type_name,
      sys.namesys AS system_name,
      m.namemod AS module_name,
      r.module AS module_id,
      r.system AS system_id,
      r.dopinfo AS extra_info,
      r.time_cost AS time_cost,
      c.ShortName AS company_name
    FROM requests r
    LEFT JOIN status_st s ON s.id = r.status
    LEFT JOIN urg u ON u.id = r.urg
    LEFT JOIN RequestType rt ON rt.id = r.type
    LEFT JOIN systems sys ON sys.idsys = r.system
    LEFT JOIN modules m ON m.idmod = r.module
    LEFT JOIN companys c ON c.idcomp = r.comp
    ${allUserFilter}
    ORDER BY r.add_date DESC
  `);
  
  console.log(`\n📊 Найдено заявок за 2 месяца: ${ticketsResult.recordset.length}`);
  console.log(`📊 Найдено заявок за всё время: ${allTicketsResult.recordset.length}`);
  
  // Используем все заявки если за 2 месяца пусто
  const finalTicketsResult = ticketsResult.recordset.length > 0 ? ticketsResult : allTicketsResult;
  const timeRange = ticketsResult.recordset.length > 0 ? 'за 2 месяца' : 'за всё время';
  if (ticketsResult.recordset.length === 0) {
    console.log('⚠️ За 2 месяца заявок нет, используем все заявки за всё время');
  }
  
  console.log(`\n📊 Используем заявок: ${finalTicketsResult.recordset.length} (${timeRange})`);
  
  // 4. Выгружаем комментарии по заявкам
  if (finalTicketsResult.recordset.length > 0) {
    const ticketIds = finalTicketsResult.recordset.map(t => t.ticket_id);
    const commentsResult = await pool.request().query(`
      SELECT
        rd.request_id,
        rd.content AS comment,
        rd.created_at,
        u.nameuser AS author
      FROM requests_description rd
      LEFT JOIN users u ON u.id = rd.user_id
      WHERE rd.request_id IN (${ticketIds.join(',')})
      ORDER BY rd.request_id, rd.created_at
    `);
    
    console.log(`\n📝 Найдено комментариев: ${commentsResult.recordset.length}`);
    
    // 5. Ищем упоминания БРС в заявках и комментариях
    console.log('\n🔍 Поиск упоминаний модуля БРС...');
    
    // БРС может быть в разных полях - ищем по всем
    const brsTickets = finalTicketsResult.recordset.filter(t => 
      t.title?.toLowerCase().includes('брс') || 
      t.description?.toLowerCase().includes('брс') ||
      t.module_name?.toLowerCase().includes('брс') ||
      t.system_name?.toLowerCase().includes('брс') ||
      t.extra_info?.toLowerCase().includes('брс') ||
      t.company_name?.toLowerCase().includes('брс') ||
      String(t.module_id) === '116' // MRMS/БРС часто используют этот ID
    );
    
    const brsComments = commentsResult.recordset.filter(c => 
      c.comment?.toLowerCase().includes('брс')
    );
    
    console.log(`\n📌 Заявок с упоминанием БРС: ${brsTickets.length}`);
    console.log(`📝 Комментариев с упоминанием БРС: ${brsComments.length}`);
    
    // 6. Печатаем ВСЕ заявки
    console.log('\n========== ВСЕ ЗАЯВКИ ЗА 2 МЕСЯЦА ==========');
    finalTicketsResult.recordset.forEach((t, i) => {
      console.log(`\n${i + 1}. 🎫 #${t.ticket_id}: ${t.title}`);
      console.log(`   Статус: ${t.status_name} (${t.status_id}), Приоритет: ${t.priority_name}`);
      console.log(`   Тип: ${t.type_name}, Модуль: ${t.module_name} (${t.module_id}), Система: ${t.system_name}`);
      console.log(`   Дата создания: ${t.created_at}`);
      console.log(`   Дата изменения: ${t.change_date}`);
      console.log(`   Финиш: ${t.finish_time || '—'}, Клиент закрыл: ${t.client_finish || '—'}`);
      console.log(`   Автор: ${t.author} <${t.author_email}>`);
      console.log(`   Компания: ${t.company_name}`);
      console.log(`   Описание: ${t.description?.substring(0, 300)}${t.description?.length > 300 ? '...' : ''}`);
      if (t.extra_info) console.log(`   Доп. инфо: ${t.extra_info}`);
      
      // Комментарии по этой заявке
      const ticketComments = commentsResult.recordset.filter(c => c.request_id === t.ticket_id);
      if (ticketComments.length > 0) {
        console.log(`   💬 Комментарии (${ticketComments.length}):`);
        ticketComments.forEach(c => {
          console.log(`      - ${c.created_at}: ${c.author} — ${c.comment?.substring(0, 150)}`);
        });
      }
    });
    
    // 7. Выводим детали по БРС
    if (brsTickets.length > 0) {
      console.log('\n========== ЗАЯВКИ ПО МОДУЛЮ БРС ==========');
      brsTickets.forEach(t => {
        console.log(`\n🎫 #${t.ticket_id}: ${t.title}`);
        console.log(`   Статус: ${t.status_name}, Приоритет: ${t.priority_name}`);
        console.log(`   Модуль: ${t.module_name}, Система: ${t.system_name}`);
        console.log(`   Дата: ${t.created_at}, Автор: ${t.author}`);
        console.log(`   Описание: ${t.description?.substring(0, 300)}...`);
      });
    }
    
    // 8. Статистика по статусам
    console.log('\n========== СТАТИСТИКА ПО СТАТУСАМ ==========');
    const statusStats = groupByStatus(finalTicketsResult.recordset);
    Object.entries(statusStats).forEach(([status, count]) => {
      console.log(`   ${status}: ${count}`);
    });
    
    // 9. Закрытые vs открытые
    const closedStatuses = [5, 6, 8, 14, 15]; // Закрытые статусы
    const closed = finalTicketsResult.recordset.filter(t => closedStatuses.includes(t.status_id));
    const open = finalTicketsResult.recordset.filter(t => !closedStatuses.includes(t.status_id));
    
    console.log('\n========== ОБЩИЙ СТАТУС ==========');
    console.log(`   Всего заявок: ${finalTicketsResult.recordset.length}`);
    console.log(`   ✅ Закрыто: ${closed.length}`);
    console.log(`   ⏳ В работе/открыто: ${open.length}`);
    
    if (open.length > 0) {
      console.log('\n   ⚠️ НЕ ЗАКРЫТЫЕ ЗАЯВКИ:');
      open.forEach(t => {
        console.log(`      🎫 #${t.ticket_id}: ${t.title} — ${t.status_name}`);
      });
    }
    
    // Сохраняем результаты в JSON
    const output = {
      extracted_at: new Date().toISOString(),
      time_range: timeRange,
      user: userResult.recordset[0],
      companies: companyResult.recordset,
      tickets: finalTicketsResult.recordset,
      comments: commentsResult.recordset,
      brs_tickets: brsTickets,
      brs_comments: brsComments,
      summary: {
        total_tickets: finalTicketsResult.recordset.length,
        total_comments: commentsResult.recordset.length,
        brs_tickets_count: brsTickets.length,
        brs_comments_count: brsComments.length,
        closed_tickets: closed.length,
        open_tickets: open.length,
        status_breakdown: statusStats,
        open_tickets_list: open.map(t => ({ id: t.ticket_id, title: t.title, status: t.status_name })),
      }
    };
    
    console.log('\n💾 Результаты сохранены в database/rc-klebanova-extract.json');
    const fs = await import('fs');
    fs.writeFileSync('database/rc-klebanova-extract.json', JSON.stringify(output, null, 2));
    
    return output;
  }
  
  await pool.close();
}

function groupByStatus(tickets) {
  const statusMap = {};
  tickets.forEach(t => {
    statusMap[t.status_name] = (statusMap[t.status_name] || 0) + 1;
  });
  return statusMap;
}

extractKlebanovaData()
  .then(result => {
    console.log('\n✅ Извлечение завершено');
    process.exit(0);
  })
  .catch(err => {
    console.error('❌ Ошибка:', err);
    process.exit(1);
  });
