package com.example.wallstudio

import android.app.Activity
import android.app.WallpaperManager
import android.content.ComponentName
import android.content.Intent
import android.graphics.BitmapFactory
import android.graphics.Color
import android.graphics.Typeface
import android.graphics.drawable.GradientDrawable
import android.net.Uri
import android.os.Bundle
import android.view.View
import android.view.ViewGroup
import android.widget.Button
import android.widget.LinearLayout
import android.widget.SeekBar
import android.widget.Toast

/** Редактор обоев: 9 живых стилей с настройкой, фон, фото- и видео-обои. */
class MainActivity : Activity() {

    private lateinit var preview: PreviewView
    private val styleButtons = HashMap<String, Button>()

    // (id стиля, подпись)
    private val styles = listOf(
        "MATRIX" to "Матрица",
        "STARFIELD" to "Звёзды",
        "AURORA" to "Аврора",
        "NEON" to "Неон-сетка",
        "SNOW" to "Снег",
        "CONSTELLATION" to "Созвездие",
        "PLASMA" to "Плазма",
        "RAIN" to "Дождь",
        "FIREFLIES" to "Светлячки"
    )

    private val palette = intArrayOf(
        0xFF1EE66E.toInt(), 0xFF35E0FF.toInt(), 0xFF5B8CFF.toInt(),
        0xFFB07CFF.toInt(), 0xFFFF4FD8.toInt(), 0xFFFF8A3D.toInt(),
        0xFFFF5A5A.toInt(), 0xFFFFE04D.toInt(), 0xFFE8FFF0.toInt()
    )

    private val backgrounds = intArrayOf(
        0xFF04070A.toInt(), 0xFF060A16.toInt(), 0xFF0D0D10.toInt(), 0xFF0B0713.toInt()
    )

    // экран для фото: система | блокировка | оба
    private var photoTarget = WallpaperManager.FLAG_SYSTEM or WallpaperManager.FLAG_LOCK
    private val targetButtons = ArrayList<Button>()

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        setContentView(R.layout.activity_main)

        preview = findViewById(R.id.preview)
        preview.renderer.apply {
            style = WallpaperRenderer.styleFromName(Prefs.getStyle(this@MainActivity))
            setSpeed(Prefs.getSpeed(this@MainActivity))
            setIntensity(Prefs.getIntensity(this@MainActivity))
            setBgInt(Prefs.getBg(this@MainActivity))
            setColorInt(Prefs.getColor(this@MainActivity))
            densityNorm = Prefs.getDensity(this@MainActivity) / 100f
        }

        buildStyleButtons()
        wireSliders()
        buildColorSwatches()
        buildBgSwatches()
        buildTargetButtons()

        findViewById<Button>(R.id.btnRandom).setOnClickListener { randomize() }
        findViewById<Button>(R.id.btnApplyLive).setOnClickListener {
            launchLive(ComponentName(this, StudioWallpaperService::class.java))
        }
        findViewById<Button>(R.id.btnPhoto).setOnClickListener { pickImage() }
        findViewById<Button>(R.id.btnVideo).setOnClickListener { pickVideo() }

        updateStyleButtons(Prefs.getStyle(this))
    }

    // --- стили (прокручиваемый ряд) ---
    private fun buildStyleButtons() {
        val row = findViewById<LinearLayout>(R.id.styleRow)
        for ((id, label) in styles) {
            val b = Button(this)
            b.text = label
            b.isAllCaps = false
            val lp = LinearLayout.LayoutParams(ViewGroup.LayoutParams.WRAP_CONTENT, ViewGroup.LayoutParams.WRAP_CONTENT)
            lp.marginEnd = dp(6)
            b.layoutParams = lp
            b.setOnClickListener { selectStyle(id) }
            styleButtons[id] = b
            row.addView(b)
        }
    }

    private fun selectStyle(id: String) {
        Prefs.setStyle(this, id)
        preview.renderer.changeStyle(WallpaperRenderer.styleFromName(id))
        updateStyleButtons(id)
    }

    private fun updateStyleButtons(selected: String) {
        for ((name, btn) in styleButtons) btn.alpha = if (name == selected) 1f else 0.5f
    }

    // --- слайдеры ---
    private fun wireSliders() {
        val speed = findViewById<SeekBar>(R.id.seekSpeed)
        val density = findViewById<SeekBar>(R.id.seekDensity)
        val intensity = findViewById<SeekBar>(R.id.seekIntensity)
        speed.progress = Prefs.getSpeed(this)
        density.progress = Prefs.getDensity(this)
        intensity.progress = Prefs.getIntensity(this)
        speed.setOnSeekBarChangeListener(seek { Prefs.setSpeed(this, it); preview.renderer.setSpeed(it) })
        density.setOnSeekBarChangeListener(seek { Prefs.setDensity(this, it); preview.renderer.setDensity(it) })
        intensity.setOnSeekBarChangeListener(seek { Prefs.setIntensity(this, it); preview.renderer.setIntensity(it) })
    }

    private inline fun seek(crossinline onChange: (Int) -> Unit) = object : SeekBar.OnSeekBarChangeListener {
        override fun onProgressChanged(sb: SeekBar, p: Int, fromUser: Boolean) = onChange(p)
        override fun onStartTrackingTouch(sb: SeekBar) {}
        override fun onStopTrackingTouch(sb: SeekBar) {}
    }

    // --- цвет ---
    private fun buildColorSwatches() {
        val row = findViewById<LinearLayout>(R.id.colorRow)
        for (c in palette) {
            val v = View(this)
            v.layoutParams = LinearLayout.LayoutParams(dp(40), dp(40)).apply { marginEnd = dp(6) }
            v.background = swatch(c, c == Prefs.getColor(this), true)
            v.setOnClickListener { selectColor(c) }
            row.addView(v)
        }
    }
    private fun selectColor(c: Int) {
        Prefs.setColor(this, c)
        preview.renderer.setColorInt(c)
        val row = findViewById<LinearLayout>(R.id.colorRow)
        for (i in 0 until row.childCount) row.getChildAt(i).background = swatch(palette[i], palette[i] == c, true)
    }

    // --- фон ---
    private fun buildBgSwatches() {
        val row = findViewById<LinearLayout>(R.id.bgRow)
        for (c in backgrounds) {
            val v = View(this)
            v.layoutParams = LinearLayout.LayoutParams(dp(40), dp(40)).apply { marginEnd = dp(6) }
            v.background = swatch(c, c == Prefs.getBg(this), false)
            v.setOnClickListener { selectBg(c) }
            row.addView(v)
        }
    }
    private fun selectBg(c: Int) {
        Prefs.setBg(this, c)
        preview.renderer.setBgInt(c)
        val row = findViewById<LinearLayout>(R.id.bgRow)
        for (i in 0 until row.childCount) row.getChildAt(i).background = swatch(backgrounds[i], backgrounds[i] == c, false)
    }

    private fun swatch(color: Int, selected: Boolean, oval: Boolean): GradientDrawable {
        val d = GradientDrawable()
        d.shape = if (oval) GradientDrawable.OVAL else GradientDrawable.RECTANGLE
        if (!oval) d.cornerRadius = dp(8).toFloat()
        d.setColor(color)
        d.setStroke(dp(if (selected) 3 else 1), if (selected) Color.WHITE else 0x33FFFFFF)
        return d
    }

    // --- экран для фото ---
    private fun buildTargetButtons() {
        val map = listOf(
            (WallpaperManager.FLAG_SYSTEM or WallpaperManager.FLAG_LOCK) to "Оба",
            WallpaperManager.FLAG_SYSTEM to "Главный",
            WallpaperManager.FLAG_LOCK to "Блокир."
        )
        val row = findViewById<LinearLayout>(R.id.targetRow)
        for ((flag, label) in map) {
            val b = Button(this)
            b.text = label; b.isAllCaps = false
            b.layoutParams = LinearLayout.LayoutParams(0, ViewGroup.LayoutParams.WRAP_CONTENT, 1f)
            b.setOnClickListener { photoTarget = flag; updateTargetButtons() }
            b.tag = flag
            targetButtons.add(b); row.addView(b)
        }
        updateTargetButtons()
    }
    private fun updateTargetButtons() {
        for (b in targetButtons) b.alpha = if (b.tag == photoTarget) 1f else 0.5f
    }

    // --- случайно ---
    private fun randomize() {
        val id = styles.random().first
        selectStyle(id)
        findViewById<SeekBar>(R.id.seekSpeed).progress = (20..90).random()
        findViewById<SeekBar>(R.id.seekDensity).progress = (25..90).random()
        findViewById<SeekBar>(R.id.seekIntensity).progress = (45..100).random()
        selectColor(palette.random())
    }

    // --- установка живых обоев ---
    private fun launchLive(component: ComponentName) {
        val intent = Intent(WallpaperManager.ACTION_CHANGE_LIVE_WALLPAPER)
            .putExtra(WallpaperManager.EXTRA_LIVE_WALLPAPER_COMPONENT, component)
        try { startActivity(intent) } catch (_: Exception) { toast(getString(R.string.hint_live)) }
    }

    // --- фото / видео ---
    private fun pickImage() = openDoc("image/*", REQ_IMAGE, false)
    private fun pickVideo() = openDoc("video/*", REQ_VIDEO, true)

    private fun openDoc(mime: String, req: Int, persist: Boolean) {
        val intent = Intent(Intent.ACTION_OPEN_DOCUMENT).apply {
            addCategory(Intent.CATEGORY_OPENABLE); type = mime
            if (persist) addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION or Intent.FLAG_GRANT_PERSISTABLE_URI_PERMISSION)
        }
        try { startActivityForResult(intent, req) } catch (_: Exception) { toast(getString(R.string.no_picker)) }
    }

    override fun onActivityResult(requestCode: Int, resultCode: Int, data: Intent?) {
        super.onActivityResult(requestCode, resultCode, data)
        if (resultCode != RESULT_OK) return
        val uri = data?.data ?: return
        when (requestCode) {
            REQ_IMAGE -> applyPhoto(uri)
            REQ_VIDEO -> {
                try { contentResolver.takePersistableUriPermission(uri, Intent.FLAG_GRANT_READ_URI_PERMISSION) } catch (_: Exception) {}
                Prefs.setVideoUri(this, uri.toString())
                launchLive(ComponentName(this, VideoWallpaperService::class.java))
            }
        }
    }

    private fun applyPhoto(uri: Uri) {
        try {
            val dm = resources.displayMetrics
            val bmp = decodeScaled(uri, dm.widthPixels, dm.heightPixels) ?: run { toast(getString(R.string.photo_fail)); return }
            WallpaperManager.getInstance(this).setBitmap(bmp, null, true, photoTarget)
            toast(getString(R.string.photo_ok))
        } catch (e: Exception) { toast(getString(R.string.photo_fail)) }
    }

    private fun decodeScaled(uri: Uri, reqW: Int, reqH: Int) = run {
        val bounds = BitmapFactory.Options().apply { inJustDecodeBounds = true }
        contentResolver.openInputStream(uri)?.use { BitmapFactory.decodeStream(it, null, bounds) }
        var sample = 1
        val hh = bounds.outHeight; val ww = bounds.outWidth
        while (hh / sample > reqH * 1.2 || ww / sample > reqW * 1.2) sample *= 2
        val opts = BitmapFactory.Options().apply { inSampleSize = sample }
        contentResolver.openInputStream(uri)?.use { BitmapFactory.decodeStream(it, null, opts) }
    }

    private fun dp(v: Int): Int = (v * resources.displayMetrics.density).toInt()
    private fun toast(m: String) = Toast.makeText(this, m, Toast.LENGTH_LONG).show()

    companion object {
        private const val REQ_IMAGE = 1
        private const val REQ_VIDEO = 2
    }
}
