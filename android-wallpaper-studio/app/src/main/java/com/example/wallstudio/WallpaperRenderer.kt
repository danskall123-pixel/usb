package com.example.wallstudio

import android.graphics.Bitmap
import android.graphics.Canvas
import android.graphics.Color
import android.graphics.Paint
import android.graphics.RadialGradient
import android.graphics.Shader
import android.graphics.Typeface
import kotlin.math.cos
import kotlin.math.max
import kotlin.math.sin
import kotlin.random.Random

/**
 * Единый движок живых стилей. Рисует кадр в собственный offscreen-[buffer]
 * (устраняет мерцание двойной буферизации), который потребитель — превью или
 * сервис обоев — просто копирует на экран.
 */
class WallpaperRenderer {

    enum class Style { MATRIX, STARFIELD, AURORA }

    var style = Style.MATRIX
    var speedNorm = 0.5f     // 0..1
    var densityNorm = 0.5f   // 0..1
    var color = 0xFF1EE66E.toInt()

    var buffer: Bitmap? = null
        private set
    private var g: Canvas? = null
    private var w = 0
    private var h = 0
    private val bg = Color.rgb(4, 7, 9)

    // --- MATRIX ---
    private val glyphs = (
        "0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZ" +
        "アイウエオカキクケコサシスセソタチツテトナニヌネノ"
    ).toCharArray()
    private val cbuf = CharArray(1)
    private var fontSize = 18f
    private var cols = 0
    private var totalRows = 0
    private var posY = FloatArray(0)
    private var lastRow = IntArray(0)
    private var mSpeed = FloatArray(0)
    private var headCh = CharArray(0)
    private val headPaint = Paint(Paint.ANTI_ALIAS_FLAG).apply { typeface = Typeface.MONOSPACE }
    private val bodyPaint = Paint(Paint.ANTI_ALIAS_FLAG).apply { typeface = Typeface.MONOSPACE }
    private val glowPaint = Paint(Paint.ANTI_ALIAS_FLAG).apply { typeface = Typeface.MONOSPACE }
    private val fadePaint = Paint().apply { color = Color.argb(20, 4, 7, 9) }

    // --- STARFIELD ---
    private var sx = FloatArray(0)
    private var sy = FloatArray(0)
    private var sz = FloatArray(0)
    private val starPaint = Paint(Paint.ANTI_ALIAS_FLAG).apply { strokeCap = Paint.Cap.ROUND }

    // --- AURORA ---
    private var t = 0f
    private var blobs = 3
    private val auroraPaint = Paint(Paint.ANTI_ALIAS_FLAG)

    fun setup(width: Int, height: Int) {
        if (width <= 0 || height <= 0) return
        w = width; h = height
        buffer?.recycle()
        val b = Bitmap.createBitmap(w, h, Bitmap.Config.ARGB_8888)
        g = Canvas(b).apply { drawColor(bg) }
        buffer = b
        reinit()
    }

    fun changeStyle(s: Style) { if (s == style) return; style = s; reinit(); clearBuffer() }
    fun setSpeed(percent: Int) { speedNorm = (percent.coerceIn(0, 100)) / 100f }
    fun setDensity(percent: Int) {
        val n = percent.coerceIn(0, 100) / 100f
        if (n == densityNorm && cols > 0) return
        densityNorm = n; reinit()
    }
    fun setColorInt(c: Int) { color = c; applyColors() }

    fun release() { buffer?.recycle(); buffer = null; g = null }

    private fun clearBuffer() { g?.drawColor(bg) }

    private fun applyColors() {
        bodyPaint.color = color
        headPaint.color = blend(color, Color.WHITE, 0.66f)
        glowPaint.color = withAlpha(blend(color, Color.WHITE, 0.3f), 110)
        starPaint.color = color
    }

    private fun reinit() {
        if (w <= 0 || h <= 0) return
        when (style) {
            Style.MATRIX -> initMatrix()
            Style.STARFIELD -> initStars()
            Style.AURORA -> blobs = (2 + (densityNorm * 2f)).toInt()
        }
        applyColors()
    }

    private fun initMatrix() {
        cols = (14 + densityNorm * 46f).toInt().coerceAtLeast(6)
        fontSize = w.toFloat() / cols
        totalRows = (h / fontSize).toInt()
        headPaint.textSize = fontSize
        bodyPaint.textSize = fontSize
        glowPaint.textSize = fontSize * 1.08f
        posY = FloatArray(cols) { -Random.nextFloat() * totalRows }
        lastRow = IntArray(cols) { Int.MIN_VALUE }
        mSpeed = FloatArray(cols) { 0.12f + Random.nextFloat() * 0.22f }
        headCh = CharArray(cols) { glyphs[Random.nextInt(glyphs.size)] }
    }

    private fun initStars() {
        val n = (60 + densityNorm * 340f).toInt()
        sx = FloatArray(n) { Random.nextFloat() * 2f - 1f }
        sy = FloatArray(n) { Random.nextFloat() * 2f - 1f }
        sz = FloatArray(n) { 0.05f + Random.nextFloat() * 0.95f }
    }

    fun frame() {
        val c = g ?: return
        if (w <= 0) return
        when (style) {
            Style.MATRIX -> drawMatrix(c)
            Style.STARFIELD -> drawStars(c)
            Style.AURORA -> drawAurora(c)
        }
    }

    private fun drawMatrix(c: Canvas) {
        val fw = w.toFloat(); val fh = h.toFloat()
        c.drawRect(0f, 0f, fw, fh, fadePaint)
        val factor = 0.4f + speedNorm * 1.8f
        for (i in 0 until cols) {
            posY[i] += mSpeed[i] * factor
            val row = kotlin.math.floor(posY[i]).toInt()
            val x = i * fontSize
            if (row != lastRow[i]) {
                if (lastRow[i] in 0..totalRows) {
                    cbuf[0] = headCh[i]
                    c.drawText(cbuf, 0, 1, x, lastRow[i] * fontSize + fontSize, bodyPaint)
                }
                headCh[i] = glyphs[Random.nextInt(glyphs.size)]
                lastRow[i] = row
            }
            if (row in 0..totalRows) {
                val y = row * fontSize + fontSize
                cbuf[0] = headCh[i]
                c.drawText(cbuf, 0, 1, x, y, glowPaint)
                c.drawText(cbuf, 0, 1, x, y, headPaint)
            }
            if (posY[i] > totalRows + 16f) {
                posY[i] = -Random.nextFloat() * totalRows
                lastRow[i] = Int.MIN_VALUE
                mSpeed[i] = 0.12f + Random.nextFloat() * 0.22f
            }
        }
    }

    private fun drawStars(c: Canvas) {
        c.drawColor(bg)
        val cx = w * 0.5f; val cy = h * 0.5f
        val half = max(w, h) * 0.5f
        val step = 0.006f + speedNorm * 0.02f
        val n = sz.size
        for (i in 0 until n) {
            val zPrev = sz[i]
            sz[i] -= step
            if (sz[i] <= 0.02f) {
                sx[i] = Random.nextFloat() * 2f - 1f
                sy[i] = Random.nextFloat() * 2f - 1f
                sz[i] = 1f
                continue
            }
            val px = cx + (sx[i] / sz[i]) * half
            val py = cy + (sy[i] / sz[i]) * half
            val ppx = cx + (sx[i] / zPrev) * half
            val ppy = cy + (sy[i] / zPrev) * half
            val depth = 1f - sz[i]
            starPaint.alpha = (60 + depth * 195).toInt().coerceIn(0, 255)
            starPaint.strokeWidth = 0.6f + depth * 2.6f
            c.drawLine(ppx, ppy, px, py, starPaint)
        }
    }

    private fun drawAurora(c: Canvas) {
        c.drawColor(bg)
        val fw = w.toFloat(); val fh = h.toFloat()
        val radius = max(w, h) * 0.6f
        for (k in 0 until blobs) {
            val phase = k * 2.1f
            val bx = fw * (0.5f + 0.34f * sin(t * 0.7f + phase))
            val by = fh * (0.5f + 0.34f * cos(t * 0.52f + phase * 1.3f))
            val col = hueShift(color, (k * 74 - 40).toFloat())
            auroraPaint.shader = RadialGradient(
                bx, by, radius,
                withAlpha(col, 150), withAlpha(col, 0),
                Shader.TileMode.CLAMP
            )
            c.drawRect(0f, 0f, fw, fh, auroraPaint)
        }
        auroraPaint.shader = null
        t += 0.008f + speedNorm * 0.03f
    }

    // --- color helpers ---
    private fun blend(a: Int, b: Int, f: Float): Int {
        val r = (Color.red(a) + (Color.red(b) - Color.red(a)) * f).toInt()
        val g = (Color.green(a) + (Color.green(b) - Color.green(a)) * f).toInt()
        val bl = (Color.blue(a) + (Color.blue(b) - Color.blue(a)) * f).toInt()
        return Color.rgb(r, g, bl)
    }
    private fun withAlpha(c: Int, a: Int): Int = Color.argb(a, Color.red(c), Color.green(c), Color.blue(c))
    private fun hueShift(c: Int, deg: Float): Int {
        val hsv = FloatArray(3)
        Color.colorToHSV(c, hsv)
        hsv[0] = ((hsv[0] + deg) % 360f + 360f) % 360f
        return Color.HSVToColor(hsv)
    }
}
