#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
Тестовый файл для проверки qwen3-coder:30b
"""

import json

def get_data(file):
    f = open(file, 'r')
    data = json.load(f)
    f.close()
    return data

def process_tickets(tickets, status_filter):
    result = []
    for t in tickets:
        if t['status_id'] == status_filter:
            result.append(t)
    return result

def main():
    data = get_data('rc-klebanova-extract.json')
    tickets = data['tickets']
    
    closed = process_tickets(tickets, 6)
    print("Закрытые заявки:")
    for c in closed:
        print(f"  - {c['title']}")
    
    print(f"\nВсего закрыто: {len(closed)}")

if __name__ == '__main__':
    main()
