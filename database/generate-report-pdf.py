#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
Генерация PDF отчёта по заявкам Клебановой Александры (АП Хабаровск)
"""

import json
from datetime import datetime
from reportlab.lib import colors
from reportlab.lib.pagesizes import A4
from reportlab.lib.styles import getSampleStyleSheet, ParagraphStyle
from reportlab.lib.units import cm, inch
from reportlab.platypus import SimpleDocTemplate, Paragraph, Spacer, Table, TableStyle
from reportlab.lib.enums import TA_CENTER, TA_LEFT, TA_JUSTIFY
from reportlab.pdfbase import pdfmetrics
from reportlab.pdfbase.ttfonts import TTFont

# Регистрация шрифта с поддержкой кириллицы (используем встроенный шрифт)
# Для лучшей поддержки кириллицы можно скачать шрифт и зарегистрировать его
# pdfmetrics.registerFont(TTFont('DejaVu', 'DejaVuSans.ttf'))

def create_pdf_report():
    # Загрузка данных из JSON
    with open('database/rc-klebanova-extract.json', 'r', encoding='utf-8') as f:
        data = json.load(f)
    
    # Создание PDF документа
    doc = SimpleDocTemplate(
        "database/Klebanova_Report_2026.pdf",
        pagesize=A4,
        rightMargin=2*cm,
        leftMargin=2*cm,
        topMargin=2*cm,
        bottomMargin=2*cm
    )
    
    # Контейнер для элементов
    elements = []
    
    # Стили
    styles = getSampleStyleSheet()
    
    # Кастомные стили
    title_style = ParagraphStyle(
        'CustomTitle',
        parent=styles['Heading1'],
        fontSize=24,
        textColor=colors.HexColor('#1a1a2e'),
        spaceAfter=30,
        alignment=TA_CENTER,
        fontName='Helvetica-Bold'
    )
    
    subtitle_style = ParagraphStyle(
        'CustomSubtitle',
        parent=styles['Heading2'],
        fontSize=14,
        textColor=colors.HexColor('#666666'),
        spaceAfter=20,
        alignment=TA_CENTER,
        fontName='Helvetica'
    )
    
    heading_style = ParagraphStyle(
        'CustomHeading',
        parent=styles['Heading2'],
        fontSize=16,
        textColor=colors.HexColor('#16213e'),
        spaceAfter=12,
        spaceBefore=12,
        fontName='Helvetica-Bold'
    )
    
    normal_style = ParagraphStyle(
        'CustomNormal',
        parent=styles['Normal'],
        fontSize=10,
        textColor=colors.HexColor('#333333'),
        fontName='Helvetica',
        leading=14
    )
    
    # Заголовок отчёта
    elements.append(Paragraph("📊 СВОДНЫЙ ОТЧЁТ ПО ЗАЯВКАМ", title_style))
    elements.append(Paragraph("Клебанова Александра (АП Хабаровск)", subtitle_style))
    
    # Информация о периоде
    period_info = f"""
    <b>Период:</b> 19 января 2026 — 19 марта 2026 (2 месяца)<br/>
    <b>Дата выгрузки:</b> {datetime.now().strftime('%d.%m.%Y')}<br/>
    <b>Пользователь:</b> {data['user']['nameuser']} ({data['user']['mailuser']})
    """
    elements.append(Paragraph(period_info, normal_style))
    elements.append(Spacer(1, 0.5*cm))
    
    # Общая статистика
    elements.append(Paragraph("📋 ОБЩАЯ СТАТИСТИКА", heading_style))
    
    stats_data = [
        ['Показатель', 'Значение'],
        ['Всего заявок', f"<b>{data['summary']['total_tickets']}</b>"],
        ['✅ Закрыто', f"<b>{data['summary']['closed_tickets']}</b> ({data['summary']['closed_tickets']/data['summary']['total_tickets']*100:.0f}%)"],
        ['⏳ В работе', f"<b>{data['summary']['open_tickets']}</b> ({data['summary']['open_tickets']/data['summary']['total_tickets']*100:.0f}%)"],
        ['🔔 Комментариев', f"<b>{data['summary']['total_comments']}</b>"],
        ['🎯 По модулю БРС', f"<b>{data['summary']['brs_tickets_count']}</b>"],
    ]
    
    stats_table = Table(stats_data, colWidths=[4*cm, 4*cm])
    stats_table.setStyle(TableStyle([
        ('BACKGROUND', (0, 0), (-1, 0), colors.HexColor('#1a1a2e')),
        ('TEXTCOLOR', (0, 0), (-1, 0), colors.whitesmoke),
        ('ALIGN', (0, 0), (-1, -1), 'CENTER'),
        ('FONTNAME', (0, 0), (-1, 0), 'Helvetica-Bold'),
        ('FONTSIZE', (0, 0), (-1, 0), 12),
        ('BOTTOMPADDING', (0, 0), (-1, 0), 12),
        ('BACKGROUND', (0, 1), (-1, -1), colors.HexColor('#f8f9fa')),
        ('TEXTCOLOR', (0, 1), (-1, -1), colors.HexColor('#333333')),
        ('FONTNAME', (0, 1), (-1, -1), 'Helvetica'),
        ('FONTSIZE', (0, 1), (-1, -1), 10),
        ('TOPPADDING', (0, 1), (-1, -1), 8),
        ('BOTTOMPADDING', (0, 1), (-1, -1), 8),
        ('GRID', (0, 0), (-1, -1), 1, colors.HexColor('#dee2e6')),
        ('BACKGROUND', (0, 1), (0, -1), colors.HexColor('#e9ecef')),
        ('FONTNAME', (0, 1), (0, -1), 'Helvetica-Bold'),
    ]))
    elements.append(stats_table)
    elements.append(Spacer(1, 0.5*cm))
    
    # Статусы заявок
    elements.append(Paragraph("📊 СТАТУСЫ ЗАЯВОК", heading_style))
    
    status_data = [['Статус', 'Количество']]
    for status, count in data['summary']['status_breakdown'].items():
        status_data.append([status, str(count)])
    
    status_table = Table(status_data, colWidths=[5*cm, 3*cm])
    status_table.setStyle(TableStyle([
        ('BACKGROUND', (0, 0), (-1, 0), colors.HexColor('#16213e')),
        ('TEXTCOLOR', (0, 0), (-1, 0), colors.whitesmoke),
        ('ALIGN', (0, 0), (-1, -1), 'CENTER'),
        ('FONTNAME', (0, 0), (-1, 0), 'Helvetica-Bold'),
        ('FONTSIZE', (0, 0), (-1, 0), 12),
        ('BOTTOMPADDING', (0, 0), (-1, 0), 12),
        ('BACKGROUND', (0, 1), (-1, -1), colors.HexColor('#f8f9fa')),
        ('TEXTCOLOR', (0, 1), (-1, -1), colors.HexColor('#333333')),
        ('FONTNAME', (0, 1), (-1, -1), 'Helvetica'),
        ('FONTSIZE', (0, 1), (-1, -1), 10),
        ('TOPPADDING', (0, 1), (-1, -1), 8),
        ('BOTTOMPADDING', (0, 1), (-1, -1), 8),
        ('GRID', (0, 0), (-1, -1), 1, colors.HexColor('#dee2e6')),
    ]))
    elements.append(status_table)
    elements.append(Spacer(1, 0.5*cm))
    
    # Закрытые заявки
    elements.append(Paragraph("✅ ЗАКРЫТЫЕ ЗАЯВКИ", heading_style))
    
    closed_tickets = [t for t in data['tickets'] if t['status_id'] in [5, 6, 8, 14, 15]]
    if closed_tickets:
        closed_data = [['№', 'Заявка', 'Модуль', 'Дата']]
        for i, t in enumerate(closed_tickets, 1):
            date_str = datetime.fromisoformat(t['created_at'].replace('Z', '+00:00')).strftime('%d.%m.%Y')
            closed_data.append([
                str(i),
                t['title'][:40],
                t['module_name'][:25],
                date_str
            ])
        
        closed_table = Table(closed_data, colWidths=[0.8*cm, 4*cm, 3.5*cm, 2.5*cm])
        closed_table.setStyle(TableStyle([
            ('BACKGROUND', (0, 0), (-1, 0), colors.HexColor('#28a745')),
            ('TEXTCOLOR', (0, 0), (-1, 0), colors.whitesmoke),
            ('ALIGN', (0, 0), (-1, -1), 'CENTER'),
            ('FONTNAME', (0, 0), (-1, 0), 'Helvetica-Bold'),
            ('FONTSIZE', (0, 0), (-1, 0), 11),
            ('BOTTOMPADDING', (0, 0), (-1, 0), 10),
            ('BACKGROUND', (0, 1), (-1, -1), colors.HexColor('#d4edda')),
            ('TEXTCOLOR', (0, 1), (-1, -1), colors.HexColor('#155724')),
            ('FONTNAME', (0, 1), (-1, -1), 'Helvetica'),
            ('FONTSIZE', (0, 1), (-1, -1), 9),
            ('TOPPADDING', (0, 1), (-1, -1), 6),
            ('BOTTOMPADDING', (0, 1), (-1, -1), 6),
            ('GRID', (0, 0), (-1, -1), 1, colors.HexColor('#c3e6cb')),
            ('VALIGN', (0, 0), (-1, -1), 'MIDDLE'),
        ]))
        elements.append(closed_table)
    elements.append(Spacer(1, 0.5*cm))
    
    # Открытые заявки
    elements.append(Paragraph("⏳ ЗАЯВКИ В РАБОТЕ", heading_style))
    
    open_tickets = [t for t in data['tickets'] if t['status_id'] not in [5, 6, 8, 14, 15]]
    if open_tickets:
        open_data = [['№', 'Заявка', 'Модуль', 'Статус', 'Дата']]
        for i, t in enumerate(open_tickets, 1):
            date_str = datetime.fromisoformat(t['created_at'].replace('Z', '+00:00')).strftime('%d.%m.%Y')
            open_data.append([
                str(i),
                t['title'][:35],
                t['module_name'][:20],
                t['status_name'][:15],
                date_str
            ])
        
        open_table = Table(open_data, colWidths=[0.8*cm, 3.5*cm, 3*cm, 2.5*cm, 2*cm])
        open_table.setStyle(TableStyle([
            ('BACKGROUND', (0, 0), (-1, 0), colors.HexColor('#dc3545')),
            ('TEXTCOLOR', (0, 0), (-1, 0), colors.whitesmoke),
            ('ALIGN', (0, 0), (-1, -1), 'CENTER'),
            ('FONTNAME', (0, 0), (-1, 0), 'Helvetica-Bold'),
            ('FONTSIZE', (0, 0), (-1, 0), 11),
            ('BOTTOMPADDING', (0, 0), (-1, 0), 10),
            ('BACKGROUND', (0, 1), (-1, -1), colors.HexColor('#f8d7da')),
            ('TEXTCOLOR', (0, 1), (-1, -1), colors.HexColor('#721c24')),
            ('FONTNAME', (0, 1), (-1, -1), 'Helvetica'),
            ('FONTSIZE', (0, 1), (-1, -1), 9),
            ('TOPPADDING', (0, 1), (-1, -1), 6),
            ('BOTTOMPADDING', (0, 1), (-1, -1), 6),
            ('GRID', (0, 0), (-1, -1), 1, colors.HexColor('#f5c6cb')),
            ('VALIGN', (0, 0), (-1, -1), 'MIDDLE'),
        ]))
        elements.append(open_table)
    elements.append(Spacer(1, 0.5*cm))
    
    # Подробное описание открытых заявок
    elements.append(Paragraph("🔍 ПОДРОБНОЕ ОПИСАНИЕ ОТКРЫТЫХ ЗАЯВОК", heading_style))
    
    for i, t in enumerate(open_tickets, 1):
        date_str = datetime.fromisoformat(t['created_at'].replace('Z', '+00:00')).strftime('%d.%m.%Y')
        
        # Убираем HTML теги из описания
        import re
        clean_desc = re.sub('<[^<]+?>', '', t['description'])
        
        ticket_detail = f"""
        <b>🎫 #{t['ticket_id']} — {t['title']}</b><br/>
        <b>Модуль:</b> {t['module_name']} ({t['system_name']})<br/>
        <b>Статус:</b> <font color="#dc3545">{t['status_name']}</font><br/>
        <b>Дата:</b> {date_str}<br/>
        <b>Проблема:</b> {clean_desc[:200]}{'...' if len(clean_desc) > 200 else ''}
        """
        elements.append(Paragraph(ticket_detail, normal_style))
        elements.append(Spacer(1, 0.3*cm))
    
    # Анализ по БРС
    elements.append(Paragraph("🎯 АНАЛИЗ ПО МОДУЛЮ БРС", heading_style))
    
    brs_text = """
    <b>Заявок по модулю БРС не обнаружено</b> за последние 2 месяца.<br/><br/>
    Поиск проводился по:<br/>
    • Названиям заявок<br/>
    • Описаниям<br/>
    • Названиям модулей<br/>
    • Дополнительной информации
    """
    elements.append(Paragraph(brs_text, normal_style))
    elements.append(Spacer(1, 0.5*cm))
    
    # Выводы и рекомендации
    elements.append(Paragraph("📈 ВЫВОДЫ И РЕКОМЕНДАЦИИ", heading_style))
    
    recommendations = """
    <b>⚠️ ПРОБЛЕМЫ:</b><br/>
    1. <b>Долгое ожидание по заявке #1393936120</b> — ошибка СПП с 11 февраля (более месяца в статусе "В обработке")<br/>
    2. <b>Нет комментариев от исполнителей</b> — по всем 5 заявкам 0 комментариев, что указывает на отсутствие обратной связи<br/>
    3. <b>Заявка #1393935849 на рассмотрении</b> с 30 января — более 1.5 месяцев без движения<br/><br/>
    
    <b>✅ ПОЛОЖИТЕЛЬНОЕ:</b><br/>
    1. <b>2 заявки закрыты</b> — технические вопросы решены (БД Metrics, телеграмма рейса)<br/>
    2. <b>Все заявки с обычным приоритетом</b> — критичных инцидентов нет<br/><br/>
    
    <b>📝 РЕКОМЕНДАЦИИ:</b><br/>
    1. <b>Ускорить обработку заявки по ошибке СПП</b> (#1393936120) — проблема влияет на ежедневную работу пользователя<br/>
    2. <b>Добавить обратную связь</b> — исполнителям необходимо комментировать заявки<br/>
    3. <b>Проверить статус заявки по SeasonRoute</b> (#1393935849) — решить или перенести в бэклог
    """
    elements.append(Paragraph(recommendations, normal_style))
    elements.append(Spacer(1, 1*cm))
    
    # Подвал
    footer_style = ParagraphStyle(
        'Footer',
        parent=styles['Normal'],
        fontSize=8,
        textColor=colors.HexColor('#666666'),
        alignment=TA_CENTER,
        fontName='Helvetica',
        spaceBefore=2*cm
    )
    
    footer_lines = [
        "Отчёт сгенерирован автоматически системой Rivc.Connect HelpDesk",
        "Файл с данными: rc-klebanova-extract.json",
        f"Дата генерации: {datetime.now().strftime('%d.%m.%Y %H:%M')}"
    ]
    
    elements.append(Spacer(1, 2*cm))
    for line in footer_lines:
        elements.append(Paragraph(line, footer_style))
        elements.append(Spacer(1, 0.2*cm))
    
    # Построение PDF
    doc.build(elements)
    print("✅ PDF отчёт успешно создан: Klebanova_Report_2026.pdf")

if __name__ == '__main__':
    create_pdf_report()
