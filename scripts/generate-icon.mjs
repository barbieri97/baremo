#!/usr/bin/env node
/**
 * Gera `build/icon.png`, a partir do qual o electron-builder deriva o `.ico` do
 * Windows e o `.icns` do macOS.
 *
 * O desenho vem da própria paleta da spec (§5) e representa o que o app faz:
 * faixas de classificação de comprimentos diferentes sobre fundo azul escuro —
 * o mesmo gráfico de perfil que os relatórios imprimem.
 *
 * É um marcador de posição honesto, não identidade visual: melhor que despachar
 * o logotipo do Electron, que informa o produto errado. Substituível a qualquer
 * momento trocando `build/icon.png`.
 *
 *   node scripts/generate-icon.mjs
 */

import { execFileSync } from 'node:child_process'
import { mkdirSync } from 'node:fs'

mkdirSync('build', { recursive: true })

const script = `
from PIL import Image, ImageDraw

SIZE = 1024
BACKGROUND = (26, 54, 93)          # Azul escuro  #1A365D
BARS = [
    ((43, 108, 176), 0.40),        # Azul claro   #2B6CB0
    ((72, 187, 120), 0.72),        # Verde claro  #48BB78
    ((236, 201, 75), 0.55),        # Amarelo      #ECC94B
    ((221, 107, 32), 0.30),        # Laranja      #DD6B20
]

# Desenha em 4x e reduz: as bordas arredondadas ficam limpas sem antialias manual.
SCALE = 4
canvas = Image.new("RGBA", (SIZE * SCALE, SIZE * SCALE), (0, 0, 0, 0))
draw = ImageDraw.Draw(canvas)

radius = int(SIZE * SCALE * 0.22)
draw.rounded_rectangle([0, 0, SIZE * SCALE - 1, SIZE * SCALE - 1], radius=radius, fill=BACKGROUND)

# Quatro barras centralizadas verticalmente, com um respiro nas laterais.
left = int(SIZE * SCALE * 0.20)
usable = SIZE * SCALE * 0.60
height = int(SIZE * SCALE * 0.10)
gap = int(SIZE * SCALE * 0.055)
total = len(BARS) * height + (len(BARS) - 1) * gap
top = (SIZE * SCALE - total) // 2

for index, (color, fraction) in enumerate(BARS):
    y = top + index * (height + gap)
    draw.rounded_rectangle(
        [left, y, left + int(usable * fraction), y + height],
        radius=height // 2,
        fill=color,
    )

canvas.resize((SIZE, SIZE), Image.LANCZOS).save("build/icon.png")
print("build/icon.png gerado")
`

execFileSync('python3', ['-c', script], { stdio: 'inherit' })
