package com.example.matrixwallpaper

import android.graphics.Canvas
import android.graphics.Color
import android.graphics.Paint
import android.graphics.Typeface
import android.os.Handler
import android.os.Looper
import android.service.wallpaper.WallpaperService
import android.view.SurfaceHolder
import kotlin.math.ceil
import kotlin.random.Random

/**
 * Живые обои «матрица»: зелёный цифровой дождь, нарисованный на Canvas.
 *
 * Кадры рисуются только пока обои видимы (см. [onVisibilityChanged]); когда
 * экран гаснет или поверх встаёт приложение — цикл останавливается, чтобы не
 * тратить батарею. Никаких зависимостей и сети: только Android-фреймворк.
 */
class MatrixWallpaperService : WallpaperService() {

    override fun onCreateEngine(): Engine = MatrixEngine()

    private inner class MatrixEngine : Engine() {

        private val handler = Handler(Looper.getMainLooper())

        // Узнаваемый матричный набор: латиница, цифры и катакана.
        private val glyphs = (
            "0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZ" +
            "アイウエオカキクケコサシスセソタチツテトナニヌネノ"
        ).toCharArray()

        private val bgPaint = Paint().apply { color = Color.rgb(5, 8, 10) }

        // Полупрозрачная заливка поверх кадра создаёт затухающий «хвост».
        private val fadePaint = Paint().apply { color = Color.argb(28, 5, 8, 10) }

        private val headPaint = Paint(Paint.ANTI_ALIAS_FLAG).apply {
            color = Color.rgb(215, 255, 228)          // почти белая «голова»
            typeface = Typeface.MONOSPACE
            setShadowLayer(7f, 0f, 0f, Color.argb(200, 0, 255, 102)) // зелёное свечение
        }
        private val bodyPaint = Paint(Paint.ANTI_ALIAS_FLAG).apply {
            color = Color.rgb(0, 255, 102)            // зелёный «след» за головой
            typeface = Typeface.MONOSPACE
        }

        private var fontSize = 0f
        private var columns = 0
        private var drops = IntArray(0)               // y-позиция головы каждой колонки (в строках)
        private var canvasWidth = 0
        private var canvasHeight = 0
        private var visible = false
        private var firstFrame = true

        private val frameIntervalMs = 55L             // ~18 кадров/с — «телевизионная» частота
        private val drawRunnable = Runnable { drawFrame() }

        override fun onVisibilityChanged(visible: Boolean) {
            this.visible = visible
            if (visible) scheduleNextFrame() else handler.removeCallbacks(drawRunnable)
        }

        override fun onSurfaceChanged(
            holder: SurfaceHolder, format: Int, width: Int, height: Int
        ) {
            super.onSurfaceChanged(holder, format, width, height)
            canvasWidth = width
            canvasHeight = height

            // Размер глифа зависит от ширины экрана (примерно 26 колонок).
            fontSize = (width / 26f).coerceIn(24f, 48f)
            headPaint.textSize = fontSize
            bodyPaint.textSize = fontSize

            columns = ceil(width / fontSize.toDouble()).toInt()
            val rows = (height / fontSize).toInt() + 1
            // Случайные стартовые высоты, чтобы дождь не начинался ровной линией.
            drops = IntArray(columns) { -Random.nextInt(0, rows) }
            firstFrame = true
        }

        override fun onSurfaceDestroyed(holder: SurfaceHolder) {
            super.onSurfaceDestroyed(holder)
            visible = false
            handler.removeCallbacks(drawRunnable)
        }

        override fun onDestroy() {
            super.onDestroy()
            handler.removeCallbacks(drawRunnable)
        }

        private fun scheduleNextFrame() {
            handler.removeCallbacks(drawRunnable)
            if (visible) handler.postDelayed(drawRunnable, frameIntervalMs)
        }

        private fun drawFrame() {
            val holder = surfaceHolder
            var canvas: Canvas? = null
            try {
                canvas = holder.lockCanvas()
                if (canvas != null) render(canvas)
            } catch (_: Exception) {
                // Поверхность могла исчезнуть между кадрами — просто пропускаем кадр.
            } finally {
                if (canvas != null) {
                    try { holder.unlockCanvasAndPost(canvas) } catch (_: Exception) {}
                }
            }
            scheduleNextFrame()
        }

        private fun render(canvas: Canvas) {
            if (columns == 0 || drops.isEmpty()) return
            val w = canvasWidth.toFloat()
            val h = canvasHeight.toFloat()

            if (firstFrame) {
                canvas.drawRect(0f, 0f, w, h, bgPaint)
                firstFrame = false
            } else {
                canvas.drawRect(0f, 0f, w, h, fadePaint)
            }

            for (i in 0 until columns) {
                val x = i * fontSize
                val y = drops[i] * fontSize

                if (y >= 0f) {
                    // Яркая «голова».
                    val head = glyphs[Random.nextInt(glyphs.size)]
                    canvas.drawText(head.toString(), x, y, headPaint)
                    // Зелёный символ в только что покинутой ячейке (над головой).
                    if (y - fontSize >= 0f) {
                        val trail = glyphs[Random.nextInt(glyphs.size)]
                        canvas.drawText(trail.toString(), x, y - fontSize, bodyPaint)
                    }
                }

                drops[i]++
                // Капля ушла за низ — иногда перезапускаем колонку сверху.
                if (y > h && Random.nextFloat() > 0.975f) drops[i] = 0
            }
        }
    }
}
