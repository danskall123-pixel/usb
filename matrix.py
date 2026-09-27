#!/usr/bin/env python3
"""
matrix.py — самозапускающийся «цифровой дождь» в терминале.

Полностью автономный код: без аргументов, без установки, без внешних
зависимостей (только стандартная библиотека Python 3). Запусти — и он
сразу начнёт работать сам:

    python3 matrix.py

Остановка — Ctrl+C.
"""

import os
import random
import shutil
import sys
import time

# Символы «дождя»: латиница, цифры и немного катаканы для антуража.
GLYPHS = "0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZ" "アイウエオカキクケコサシスセソタチツテト"

# ANSI-цвета (зелёная гамма: яркая голова капли -> тускнеющий хвост).
HEAD = "\033[97m"          # белая «голова»
BRIGHT = "\033[92m"        # яркий зелёный
DIM = "\033[32m"           # тусклый зелёный
RESET = "\033[0m"
HIDE_CURSOR = "\033[?25l"
SHOW_CURSOR = "\033[?25h"
CLEAR = "\033[2J\033[H"


def term_size():
    """Текущий размер терминала (столбцы, строки) с разумным запасным вариантом."""
    size = shutil.get_terminal_size(fallback=(80, 24))
    return size.columns, size.lines


def main():
    # Включаем обработку ANSI на новых Windows-терминалах.
    if os.name == "nt":
        os.system("")

    cols, rows = term_size()
    # Позиция «головы» каждой колонки; -1 = колонка сейчас неактивна.
    drops = [random.randint(-rows, 0) if random.random() < 0.5 else -1
             for _ in range(cols)]

    sys.stdout.write(HIDE_CURSOR + CLEAR)
    try:
        while True:
            # Подхватываем ресайз окна на лету.
            new_cols, new_rows = term_size()
            if (new_cols, new_rows) != (cols, rows):
                cols, rows = new_cols, new_rows
                drops = [-1] * cols
                sys.stdout.write(CLEAR)

            buf = []
            for x in range(cols):
                y = drops[x]

                # Иногда «оживляем» неактивную колонку.
                if y < 0:
                    if random.random() < 0.02:
                        drops[x] = 0
                    continue

                # Яркая голова капли.
                if 0 <= y < rows:
                    buf.append(f"\033[{y + 1};{x + 1}H{HEAD}{random.choice(GLYPHS)}")
                # Более тусклый символ прямо за головой.
                if 0 <= y - 1 < rows:
                    buf.append(f"\033[{y};{x + 1}H{BRIGHT}{random.choice(GLYPHS)}")
                # Тусклый «хвост».
                if 0 <= y - 2 < rows:
                    buf.append(f"\033[{y - 1};{x + 1}H{DIM}{random.choice(GLYPHS)}")
                # Стираем символ, вышедший за длину хвоста.
                tail = y - random.randint(6, 14)
                if 0 <= tail < rows:
                    buf.append(f"\033[{tail + 1};{x + 1}H ")

                drops[x] += 1
                # Капля ушла за низ экрана — гасим колонку (перезапустится сама).
                if drops[x] - 14 > rows:
                    drops[x] = -1

            sys.stdout.write("".join(buf) + RESET)
            sys.stdout.flush()
            time.sleep(0.05)
    except KeyboardInterrupt:
        pass
    finally:
        sys.stdout.write(SHOW_CURSOR + RESET + CLEAR)
        sys.stdout.flush()


if __name__ == "__main__":
    main()
