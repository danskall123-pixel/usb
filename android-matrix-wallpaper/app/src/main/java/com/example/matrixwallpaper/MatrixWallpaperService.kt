package com.example.matrixwallpaper

import android.content.Context
import android.graphics.Bitmap
import android.graphics.Canvas
import android.graphics.Color
import android.graphics.Paint
import android.graphics.Typeface
import android.os.Handler
import android.os.Looper
import android.os.PowerManager
import android.service.wallpaper.WallpaperService
import android.view.SurfaceHolder
import kotlin.math.ceil
import kotlin.math.floor
import kotlin.random.Random

/**
 * Живые обои «матрица»: зелёный цифровой дождь.
 *
 * Ключевые решения против мерцания и лишнего расхода батареи:
 *  - Кадр собирается в собственный offscreen-[Bitmap] и целиком копируется на
 *    поверхность. Поверхность обоев двойная-буферизованная, и рисование прямо в
 *    неё эффектом «затухания» давало мерцание (каждый lockCanvas отдаёт другой
 *    буфер). Через свой буфер на экран всегда попадает полный корректный кадр.
 *  - У каждой колонки своя скорость; голова перерисовывается чётко, а хвост
 *    плавно затухает лёгкой полупрозрачной заливкой — спокойно и без «шума».
 *  - Никакого размытия/тени на символах. ~15 кадров/с, а в режиме
 *    энергосбережения ~8. Рисуем только пока обои видимы.
 */
class MatrixWallpaperService : WallpaperService() {

    override fun onCreateEngine(): Engine = MatrixEngine()

    private inner class MatrixEngine : Engine() {

        private val handler = Handler(Looper.getMainLooper())

        private val glyphs = (
            "0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZ" +
            "アイウエオカキクケコサシスセソタチツテトナニヌネノ"
        ).toCharArray()
        private val charBuf = CharArray(1)   // переиспользуем — без аллокаций в цикле

        private val bgColor = Color.rgb(4, 7, 9)
        // Мягкая полупрозрачная заливка каждый кадр → плавные хвосты.
        private val fadePaint = Paint().apply { color = Color.argb(20, 4, 7, 9) }
        private val headPaint = Paint(Paint.ANTI_ALIAS_FLAG).apply {
            color = Color.rgb(200, 255, 220)     // яркая, почти белая голова
            typeface = Typeface.MONOSPACE
        }
        private val glowPaint = Paint(Paint.ANTI_ALIAS_FLAG).apply {
            color = Color.argb(110, 120, 255, 170) // дешёвый «ореол» — просто крупнее и полупрозрачно
            typeface = Typeface.MONOSPACE
        }
        private val bodyPaint = Paint(Paint.ANTI_ALIAS_FLAG).apply {
            color = Color.rgb(30, 225, 110)      // зелёный хвост
            typeface = Typeface.MONOSPACE
        }

        // Offscreen-буфер кадра.
        private var buffer: Bitmap? = null
        private var bufferCanvas: Canvas? = null

        private var fontSize = 0f
        private var columns = 0
        private var totalRows = 0
        private var canvasWidth = 0
        private var canvasHeight = 0

        private var posY = FloatArray(0)      // позиция головы (в строках), дробная
        private var lastRow = IntArray(0)     // последняя занятая строка
        private var speed = FloatArray(0)     // строк за кадр
        private var headChar = CharArray(0)   // текущий символ головы колонки

        private var visible = false
        private var frameIntervalMs = 66L     // ~15 fps
        private val drawRunnable = Runnable { tick() }

        private var powerManager: PowerManager? = null

        override fun onCreate(surfaceHolder: SurfaceHolder) {
            super.onCreate(surfaceHolder)
            setOffsetNotificationsEnabled(false) // не будим движок на свайпы столов
            powerManager =
                this@MatrixWallpaperService.getSystemService(Context.POWER_SERVICE) as? PowerManager
        }

        override fun onVisibilityChanged(visible: Boolean) {
            this.visible = visible
            if (visible) {
                frameIntervalMs = if (powerManager?.isPowerSaveMode == true) 120L else 66L
                scheduleNext()
            } else {
                handler.removeCallbacks(drawRunnable)
            }
        }

        override fun onSurfaceChanged(holder: SurfaceHolder, format: Int, width: Int, height: Int) {
            super.onSurfaceChanged(holder, format, width, height)
            canvasWidth = width
            canvasHeight = height

            fontSize = (width / 28f).coerceIn(26f, 46f)
            headPaint.textSize = fontSize
            bodyPaint.textSize = fontSize
            glowPaint.textSize = fontSize * 1.08f

            columns = ceil(width / fontSize.toDouble()).toInt()
            totalRows = (height / fontSize).toInt()

            posY = FloatArray(columns) { -Random.nextFloat() * totalRows }
            lastRow = IntArray(columns) { Int.MIN_VALUE }
            speed = FloatArray(columns) { randomSpeed() }
            headChar = CharArray(columns) { randGlyph() }

            buffer?.recycle()
            val bmp = Bitmap.createBitmap(width, height, Bitmap.Config.ARGB_8888)
            bufferCanvas = Canvas(bmp).apply { drawColor(bgColor) }
            buffer = bmp
        }

        override fun onSurfaceDestroyed(holder: SurfaceHolder) {
            super.onSurfaceDestroyed(holder)
            stopAndRelease()
        }

        override fun onDestroy() {
            super.onDestroy()
            stopAndRelease()
        }

        private fun stopAndRelease() {
            visible = false
            handler.removeCallbacks(drawRunnable)
            buffer?.recycle()
            buffer = null
            bufferCanvas = null
        }

        private fun scheduleNext() {
            handler.removeCallbacks(drawRunnable)
            if (visible) handler.postDelayed(drawRunnable, frameIntervalMs)
        }

        private fun randGlyph(): Char = glyphs[Random.nextInt(glyphs.size)]
        private fun randomSpeed(): Float = 0.15f + Random.nextFloat() * 0.35f

        private fun tick() {
            renderToBuffer()
            blitToScreen()
            scheduleNext()
        }

        private fun renderToBuffer() {
            val c = bufferCanvas ?: return
            if (columns == 0) return
            val w = canvasWidth.toFloat()
            val h = canvasHeight.toFloat()

            // Затухание всего кадра → плавные зелёные хвосты.
            c.drawRect(0f, 0f, w, h, fadePaint)

            for (i in 0 until columns) {
                posY[i] += speed[i]
                val row = floor(posY[i]).toInt()
                val x = i * fontSize

                if (row != lastRow[i]) {
                    // Бывшую голову «опускаем» до зелёного хвоста, сохраняя её символ.
                    if (lastRow[i] in 0..totalRows) {
                        charBuf[0] = headChar[i]
                        c.drawText(charBuf, 0, 1, x, lastRow[i] * fontSize, bodyPaint)
                    }
                    headChar[i] = randGlyph()   // новая голова — новый символ
                    lastRow[i] = row
                }

                // Голову рисуем каждый кадр → она всегда чёткая (не «пульсирует»).
                if (row in 0..totalRows) {
                    val y = row * fontSize
                    charBuf[0] = headChar[i]
                    c.drawText(charBuf, 0, 1, x, y, glowPaint)
                    c.drawText(charBuf, 0, 1, x, y, headPaint)
                }

                // Ушли ниже экрана с запасом на хвост → перезапуск сверху.
                if (posY[i] > totalRows + 16f) {
                    posY[i] = -Random.nextFloat() * totalRows
                    lastRow[i] = Int.MIN_VALUE
                    speed[i] = randomSpeed()
                }
            }
        }

        private fun blitToScreen() {
            val bmp = buffer ?: return
            val holder = surfaceHolder
            var canvas: Canvas? = null
            try {
                canvas = holder.lockCanvas()
                if (canvas != null) canvas.drawBitmap(bmp, 0f, 0f, null)
            } catch (_: Exception) {
                // Поверхность могла исчезнуть между кадрами — пропускаем кадр.
            } finally {
                if (canvas != null) {
                    try { holder.unlockCanvasAndPost(canvas) } catch (_: Exception) {}
                }
            }
        }
    }
}
