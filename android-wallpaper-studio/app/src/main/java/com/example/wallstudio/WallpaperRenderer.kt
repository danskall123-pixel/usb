package com.example.wallstudio

import android.graphics.Bitmap
import android.graphics.Canvas
import android.graphics.Color
import android.graphics.Paint
import android.graphics.RadialGradient
import android.graphics.Rect
import android.graphics.Shader
import android.graphics.Typeface
import kotlin.math.abs
import kotlin.math.cos
import kotlin.math.floor
import kotlin.math.max
import kotlin.math.min
import kotlin.math.sin
import kotlin.random.Random

/**
 * Движок живых стилей. Кадр рисуется в собственный offscreen-[buffer]
 * (устраняет мерцание), который потребитель просто копирует на экран.
 */
class WallpaperRenderer {

    enum class Style { MATRIX, STARFIELD, AURORA, NEON, SNOW, CONSTELLATION, PLASMA, RAIN, FIREFLIES }

    companion object {
        fun styleFromName(n: String): Style = when (n) {
            "STARFIELD" -> Style.STARFIELD
            "AURORA" -> Style.AURORA
            "NEON" -> Style.NEON
            "SNOW" -> Style.SNOW
            "CONSTELLATION" -> Style.CONSTELLATION
            "PLASMA" -> Style.PLASMA
            "RAIN" -> Style.RAIN
            "FIREFLIES" -> Style.FIREFLIES
            else -> Style.MATRIX
        }
    }

    var style = Style.MATRIX
    var speedNorm = 0.5f
    var densityNorm = 0.5f
    var intensityNorm = 0.7f
    var color = 0xFF1EE66E.toInt()
    private var bg = 0xFF04070A.toInt()

    var buffer: Bitmap? = null
        private set
    private var g: Canvas? = null
    private var w = 0
    private var h = 0

    // paints
    private val headPaint = Paint(Paint.ANTI_ALIAS_FLAG).apply { typeface = Typeface.MONOSPACE }
    private val bodyPaint = Paint(Paint.ANTI_ALIAS_FLAG).apply { typeface = Typeface.MONOSPACE }
    private val glowPaint = Paint(Paint.ANTI_ALIAS_FLAG).apply { typeface = Typeface.MONOSPACE }
    private val dotPaint = Paint(Paint.ANTI_ALIAS_FLAG)
    private val linePaint = Paint(Paint.ANTI_ALIAS_FLAG).apply { strokeCap = Paint.Cap.ROUND }
    private val neonWide = Paint(Paint.ANTI_ALIAS_FLAG).apply { strokeCap = Paint.Cap.ROUND }
    private val neonThin = Paint(Paint.ANTI_ALIAS_FLAG).apply { strokeCap = Paint.Cap.ROUND }
    private val auroraPaint = Paint(Paint.ANTI_ALIAS_FLAG)
    private val filterPaint = Paint(Paint.FILTER_BITMAP_FLAG)
    private val starPaint = Paint(Paint.ANTI_ALIAS_FLAG).apply { strokeCap = Paint.Cap.ROUND }

    // MATRIX
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

    // STARFIELD
    private var sx = FloatArray(0); private var sy = FloatArray(0); private var sz = FloatArray(0)

    // generic particles (SNOW / CONSTELLATION / RAIN / FIREFLIES)
    private var gX = FloatArray(0); private var gY = FloatArray(0)
    private var gVX = FloatArray(0); private var gVY = FloatArray(0)
    private var gR = FloatArray(0); private var gP = FloatArray(0)
    private var gCount = 0

    // AURORA / NEON / PLASMA time
    private var t = 0f
    private var blobs = 3

    // PLASMA
    private var plasmaBmp: Bitmap? = null
    private var plasmaPixels = IntArray(0)
    private var pw = 0; private var ph = 0
    private var lut = IntArray(256)
    private val dstRect = Rect()

    fun setup(width: Int, height: Int) {
        if (width <= 0 || height <= 0) return
        w = width; h = height
        buffer?.recycle()
        val b = Bitmap.createBitmap(w, h, Bitmap.Config.ARGB_8888)
        g = Canvas(b).apply { drawColor(bg) }
        buffer = b
        pw = 96; ph = max(1, (96f * h / w).toInt())
        plasmaPixels = IntArray(pw * ph)
        plasmaBmp?.recycle()
        plasmaBmp = Bitmap.createBitmap(pw, ph, Bitmap.Config.ARGB_8888)
        dstRect.set(0, 0, w, h)
        reinit()
    }

    fun changeStyle(s: Style) { if (s == style) return; style = s; reinit(); clearBuffer() }
    fun setSpeed(p: Int) { speedNorm = p.coerceIn(0, 100) / 100f }
    fun setIntensity(p: Int) { intensityNorm = p.coerceIn(0, 100) / 100f }
    fun setColorInt(c: Int) { color = c; applyColors() }
    fun setBgInt(c: Int) { bg = c; clearBuffer() }
    fun setDensity(p: Int) {
        val n = p.coerceIn(0, 100) / 100f
        if (n == densityNorm && (cols > 0 || gCount > 0 || sz.isNotEmpty())) return
        densityNorm = n; reinit()
    }

    fun release() {
        buffer?.recycle(); buffer = null; g = null
        plasmaBmp?.recycle(); plasmaBmp = null
    }

    private fun clearBuffer() { g?.drawColor(bg) }

    private fun applyColors() {
        bodyPaint.color = color
        headPaint.color = blend(color, Color.WHITE, 0.66f)
        glowPaint.color = withAlpha(blend(color, Color.WHITE, 0.3f), 110)
        starPaint.color = color
        buildLut()
    }

    private fun buildLut() {
        val hsv = FloatArray(3); Color.colorToHSV(color, hsv); val base = hsv[0]
        for (i in 0..255) {
            val f = i / 255f
            val hue = ((base + (f - 0.5f) * 150f) % 360f + 360f) % 360f
            lut[i] = Color.HSVToColor(floatArrayOf(hue, 0.72f, 0.22f + 0.78f * f))
        }
    }

    private fun reinit() {
        if (w <= 0 || h <= 0) return
        when (style) {
            Style.MATRIX -> initMatrix()
            Style.STARFIELD -> initStars((60 + densityNorm * 340f).toInt())
            Style.AURORA -> blobs = (2 + densityNorm * 2f).toInt()
            Style.NEON -> {}
            Style.SNOW -> initParticles((80 + densityNorm * 320f).toInt(), Style.SNOW)
            Style.CONSTELLATION -> initParticles((28 + densityNorm * 54f).toInt(), Style.CONSTELLATION)
            Style.PLASMA -> {}
            Style.RAIN -> initParticles((60 + densityNorm * 240f).toInt(), Style.RAIN)
            Style.FIREFLIES -> initParticles((20 + densityNorm * 70f).toInt(), Style.FIREFLIES)
        }
        applyColors()
    }

    private fun initMatrix() {
        cols = (14 + densityNorm * 46f).toInt().coerceAtLeast(6)
        fontSize = w.toFloat() / cols
        totalRows = (h / fontSize).toInt()
        headPaint.textSize = fontSize; bodyPaint.textSize = fontSize; glowPaint.textSize = fontSize * 1.08f
        posY = FloatArray(cols) { -Random.nextFloat() * totalRows }
        lastRow = IntArray(cols) { Int.MIN_VALUE }
        mSpeed = FloatArray(cols) { 0.12f + Random.nextFloat() * 0.22f }
        headCh = CharArray(cols) { glyphs[Random.nextInt(glyphs.size)] }
    }

    private fun initStars(n: Int) {
        sx = FloatArray(n) { Random.nextFloat() * 2f - 1f }
        sy = FloatArray(n) { Random.nextFloat() * 2f - 1f }
        sz = FloatArray(n) { 0.05f + Random.nextFloat() * 0.95f }
    }

    private fun initParticles(n: Int, s: Style) {
        gCount = n
        gX = FloatArray(n); gY = FloatArray(n); gVX = FloatArray(n)
        gVY = FloatArray(n); gR = FloatArray(n); gP = FloatArray(n)
        val fw = w.toFloat(); val fh = h.toFloat()
        for (i in 0 until n) {
            gX[i] = Random.nextFloat() * fw
            gY[i] = Random.nextFloat() * fh
            gP[i] = Random.nextFloat() * 6.28f
            when (s) {
                Style.SNOW -> { gVX[i] = Random.nextFloat() * 0.8f - 0.4f; gVY[i] = 0.8f + Random.nextFloat() * 1.8f; gR[i] = 1.2f + Random.nextFloat() * 2.6f }
                Style.RAIN -> { gVX[i] = 0f; gVY[i] = 6f + Random.nextFloat() * 9f; gR[i] = Random.nextFloat() }
                Style.CONSTELLATION -> { gVX[i] = Random.nextFloat() * 1.2f - 0.6f; gVY[i] = Random.nextFloat() * 1.2f - 0.6f; gR[i] = 1.6f + Random.nextFloat() * 1.8f }
                else -> { gVX[i] = Random.nextFloat() * 0.6f - 0.3f; gVY[i] = Random.nextFloat() * 0.6f - 0.3f; gR[i] = 1.4f + Random.nextFloat() * 2.2f }
            }
        }
    }

    fun frame() {
        val c = g ?: return
        if (w <= 0) return
        when (style) {
            Style.MATRIX -> drawMatrix(c)
            Style.STARFIELD -> drawStars(c)
            Style.AURORA -> drawAurora(c)
            Style.NEON -> drawNeon(c)
            Style.SNOW -> drawSnow(c)
            Style.CONSTELLATION -> drawConstellation(c)
            Style.PLASMA -> drawPlasma(c)
            Style.RAIN -> drawRain(c)
            Style.FIREFLIES -> drawFireflies(c)
        }
    }

    private fun drawMatrix(c: Canvas) {
        val fw = w.toFloat(); val fh = h.toFloat()
        c.drawColor(withAlpha(bg, 20))
        val factor = 0.4f + speedNorm * 1.8f
        for (i in 0 until cols) {
            posY[i] += mSpeed[i] * factor
            val row = floor(posY[i]).toInt()
            val x = i * fontSize
            if (row != lastRow[i]) {
                if (lastRow[i] in 0..totalRows) { cbuf[0] = headCh[i]; c.drawText(cbuf, 0, 1, x, lastRow[i] * fontSize + fontSize, bodyPaint) }
                headCh[i] = glyphs[Random.nextInt(glyphs.size)]; lastRow[i] = row
            }
            if (row in 0..totalRows) {
                val y = row * fontSize + fontSize; cbuf[0] = headCh[i]
                c.drawText(cbuf, 0, 1, x, y, glowPaint); c.drawText(cbuf, 0, 1, x, y, headPaint)
            }
            if (posY[i] > totalRows + 16f) { posY[i] = -Random.nextFloat() * totalRows; lastRow[i] = Int.MIN_VALUE; mSpeed[i] = 0.12f + Random.nextFloat() * 0.22f }
        }
    }

    private fun drawStars(c: Canvas) {
        c.drawColor(bg)
        val cx = w * 0.5f; val cy = h * 0.5f; val half = max(w, h) * 0.5f
        val step = 0.006f + speedNorm * 0.02f
        for (i in sz.indices) {
            val zp = sz[i]; sz[i] -= step
            if (sz[i] <= 0.02f) { sx[i] = Random.nextFloat() * 2f - 1f; sy[i] = Random.nextFloat() * 2f - 1f; sz[i] = 1f; continue }
            val px = cx + (sx[i] / sz[i]) * half; val py = cy + (sy[i] / sz[i]) * half
            val ppx = cx + (sx[i] / zp) * half; val ppy = cy + (sy[i] / zp) * half
            val depth = 1f - sz[i]
            starPaint.alpha = (60 + depth * 195).toInt().coerceIn(0, 255)
            starPaint.strokeWidth = 0.6f + depth * 2.6f
            c.drawLine(ppx, ppy, px, py, starPaint)
        }
    }

    private fun drawAurora(c: Canvas) {
        c.drawColor(bg)
        val fw = w.toFloat(); val fh = h.toFloat(); val radius = max(w, h) * 0.6f
        val a = (150 * intensityNorm + 40).toInt().coerceIn(0, 200)
        for (k in 0 until blobs) {
            val phase = k * 2.1f
            val bx = fw * (0.5f + 0.34f * sin(t * 0.7f + phase))
            val by = fh * (0.5f + 0.34f * cos(t * 0.52f + phase * 1.3f))
            val col = hueShift(color, (k * 74 - 40).toFloat())
            auroraPaint.shader = RadialGradient(bx, by, radius, withAlpha(col, a), withAlpha(col, 0), Shader.TileMode.CLAMP)
            c.drawRect(0f, 0f, fw, fh, auroraPaint)
        }
        auroraPaint.shader = null
        t += 0.008f + speedNorm * 0.03f
    }

    private fun drawNeon(c: Canvas) {
        c.drawColor(bg)
        val fw = w.toFloat(); val fh = h.toFloat()
        val horizon = fh * 0.42f; val vpx = fw * 0.5f
        neonWide.color = color; neonWide.alpha = (70 * intensityNorm).toInt().coerceIn(10, 160); neonWide.strokeWidth = 7f
        neonThin.color = blend(color, Color.WHITE, 0.5f); neonThin.alpha = 230; neonThin.strokeWidth = 1.8f
        val fan = 11; val spread = fw * 0.95f
        for (i in -fan..fan) { val xb = vpx + (i.toFloat() / fan) * spread; neonLine(c, vpx, horizon, xb, fh) }
        val m = 12; val off = (t * 0.6f) % 1f
        for (k in 0..m) { val fr = (k + off) / m; val yy = horizon + (fh - horizon) * fr * fr; neonLine(c, 0f, yy, fw, yy) }
        t += 0.02f + speedNorm * 0.06f
    }
    private fun neonLine(c: Canvas, x1: Float, y1: Float, x2: Float, y2: Float) {
        c.drawLine(x1, y1, x2, y2, neonWide); c.drawLine(x1, y1, x2, y2, neonThin)
    }

    private fun drawSnow(c: Canvas) {
        c.drawColor(bg)
        dotPaint.color = blend(color, Color.WHITE, 0.7f)
        val sp = 0.4f + speedNorm * 1.8f; val fw = w.toFloat()
        for (i in 0 until gCount) {
            gY[i] += gVY[i] * sp
            gX[i] += gVX[i] * sp + sin((gY[i] + gP[i]) * 0.02f) * 0.6f
            if (gY[i] > h + 4) { gY[i] = -4f; gX[i] = Random.nextFloat() * fw }
            if (gX[i] < -4) gX[i] = fw; if (gX[i] > fw + 4) gX[i] = 0f
            dotPaint.alpha = (110 + gR[i] * 35).toInt().coerceIn(60, 255)
            c.drawCircle(gX[i], gY[i], gR[i], dotPaint)
        }
    }

    private fun drawRain(c: Canvas) {
        c.drawColor(bg)
        linePaint.color = color
        val sp = 0.6f + speedNorm * 2.4f; val fw = w.toFloat()
        for (i in 0 until gCount) {
            val len = 8f + gR[i] * 16f
            linePaint.alpha = (90 + gR[i] * 130).toInt().coerceIn(60, 255)
            linePaint.strokeWidth = 1f + gR[i] * 1.6f
            c.drawLine(gX[i], gY[i], gX[i], gY[i] + len, linePaint)
            gY[i] += gVY[i] * sp
            if (gY[i] > h) { gY[i] = -len; gX[i] = Random.nextFloat() * fw }
        }
    }

    private fun drawConstellation(c: Canvas) {
        c.drawColor(bg)
        val sp = 0.3f + speedNorm * 1.4f; val fw = w.toFloat(); val fh = h.toFloat()
        for (i in 0 until gCount) {
            gX[i] += gVX[i] * sp; gY[i] += gVY[i] * sp
            if (gX[i] < 0 || gX[i] > fw) gVX[i] = -gVX[i]
            if (gY[i] < 0 || gY[i] > fh) gVY[i] = -gVY[i]
        }
        val thr = min(w, h) * 0.16f; val thr2 = thr * thr
        linePaint.color = color; linePaint.strokeWidth = 1.4f
        for (i in 0 until gCount) for (j in i + 1 until gCount) {
            val dx = gX[i] - gX[j]; val dy = gY[i] - gY[j]; val d2 = dx * dx + dy * dy
            if (d2 < thr2) { val a = 1f - d2 / thr2; linePaint.alpha = (a * 160 * intensityNorm + 20).toInt().coerceIn(0, 255); c.drawLine(gX[i], gY[i], gX[j], gY[j], linePaint) }
        }
        dotPaint.color = blend(color, Color.WHITE, 0.4f); dotPaint.alpha = 235
        for (i in 0 until gCount) c.drawCircle(gX[i], gY[i], gR[i], dotPaint)
    }

    private fun drawFireflies(c: Canvas) {
        c.drawColor(withAlpha(bg, 36))
        val sp = 0.2f + speedNorm * 1.0f; val fw = w.toFloat(); val fh = h.toFloat()
        for (i in 0 until gCount) {
            gVX[i] = (gVX[i] + (Random.nextFloat() - 0.5f) * 0.04f).coerceIn(-0.8f, 0.8f)
            gVY[i] = (gVY[i] + (Random.nextFloat() - 0.5f) * 0.04f).coerceIn(-0.8f, 0.8f)
            gX[i] += gVX[i] * sp; gY[i] += gVY[i] * sp
            if (gX[i] < 0) gX[i] = fw; if (gX[i] > fw) gX[i] = 0f
            if (gY[i] < 0) gY[i] = fh; if (gY[i] > fh) gY[i] = 0f
            gP[i] += 0.06f
            val bl = (0.35f + 0.65f * abs(sin(gP[i]))) * intensityNorm
            val a = (bl * 255).toInt().coerceIn(0, 255)
            dotPaint.color = color; dotPaint.alpha = (a * 0.35f).toInt(); c.drawCircle(gX[i], gY[i], gR[i] * 2.4f, dotPaint)
            dotPaint.color = blend(color, Color.WHITE, 0.5f); dotPaint.alpha = a; c.drawCircle(gX[i], gY[i], gR[i], dotPaint)
        }
    }

    private fun drawPlasma(c: Canvas) {
        val pb = plasmaBmp ?: return
        var idx = 0
        for (y in 0 until ph) {
            val yy = y.toFloat()
            for (x in 0 until pw) {
                val xx = x.toFloat()
                val v = sin(xx * 0.09f + t) + sin(yy * 0.10f - t * 0.8f) + sin((xx + yy) * 0.06f + t * 0.5f)
                var li = (((v + 3f) / 6f) * 255f).toInt()
                if (li < 0) li = 0 else if (li > 255) li = 255
                plasmaPixels[idx++] = lut[li]
            }
        }
        pb.setPixels(plasmaPixels, 0, pw, 0, 0, pw, ph)
        c.drawBitmap(pb, null, dstRect, filterPaint)
        t += 0.03f + speedNorm * 0.09f
    }

    // helpers
    private fun blend(a: Int, b: Int, f: Float): Int {
        val r = (Color.red(a) + (Color.red(b) - Color.red(a)) * f).toInt()
        val g = (Color.green(a) + (Color.green(b) - Color.green(a)) * f).toInt()
        val bl = (Color.blue(a) + (Color.blue(b) - Color.blue(a)) * f).toInt()
        return Color.rgb(r, g, bl)
    }
    private fun withAlpha(c: Int, a: Int): Int = Color.argb(a, Color.red(c), Color.green(c), Color.blue(c))
    private fun hueShift(c: Int, deg: Float): Int {
        val hsv = FloatArray(3); Color.colorToHSV(c, hsv)
        hsv[0] = ((hsv[0] + deg) % 360f + 360f) % 360f
        return Color.HSVToColor(hsv)
    }
}
