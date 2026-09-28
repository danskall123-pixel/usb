package com.example.wallstudio

import android.app.Activity
import android.app.WallpaperManager
import android.content.ComponentName
import android.content.Intent
import android.graphics.BitmapFactory
import android.graphics.Color
import android.graphics.drawable.GradientDrawable
import android.net.Uri
import android.os.Bundle
import android.view.Gravity
import android.view.View
import android.widget.Button
import android.widget.LinearLayout
import android.widget.SeekBar
import android.widget.Toast

/** Редактор обоев: живые стили с настройкой, фото-обои и видео-обои. */
class MainActivity : Activity() {

    private lateinit var preview: PreviewView
    private val styleButtons = HashMap<String, Button>()

    private val palette = intArrayOf(
        0xFF1EE66E.toInt(), // зелёный
        0xFF35E0FF.toInt(), // голубой
        0xFF5B8CFF.toInt(), // синий
        0xFFB07CFF.toInt(), // фиолетовый
        0xFFFF4FD8.toInt(), // розовый
        0xFFFF8A3D.toInt(), // оранжевый
        0xFFE8FFF0.toInt()  // белый
    )

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        setContentView(R.layout.activity_main)

        preview = findViewById(R.id.preview)

        // стартовые настройки → в рендерер до первой раскладки
        preview.renderer.apply {
            style = styleOf(Prefs.getStyle(this@MainActivity))
            setSpeed(Prefs.getSpeed(this@MainActivity))
            setColorInt(Prefs.getColor(this@MainActivity))
            densityNorm = Prefs.getDensity(this@MainActivity) / 100f
        }

        wireStyleButtons()
        wireSliders()
        buildColorSwatches()

        findViewById<Button>(R.id.btnApplyLive).setOnClickListener {
            launchLive(ComponentName(this, StudioWallpaperService::class.java))
        }
        findViewById<Button>(R.id.btnPhoto).setOnClickListener { pickImage() }
        findViewById<Button>(R.id.btnVideo).setOnClickListener { pickVideo() }

        updateStyleButtons(Prefs.getStyle(this))
    }

    // --- стили ---
    private fun wireStyleButtons() {
        styleButtons["MATRIX"] = findViewById(R.id.btnMatrix)
        styleButtons["STARFIELD"] = findViewById(R.id.btnStars)
        styleButtons["AURORA"] = findViewById(R.id.btnAurora)
        for ((name, btn) in styleButtons) {
            btn.setOnClickListener {
                Prefs.setStyle(this, name)
                preview.renderer.changeStyle(styleOf(name))
                updateStyleButtons(name)
            }
        }
    }

    private fun updateStyleButtons(selected: String) {
        for ((name, btn) in styleButtons) {
            btn.alpha = if (name == selected) 1f else 0.55f
        }
    }

    private fun styleOf(name: String): WallpaperRenderer.Style = when (name) {
        "STARFIELD" -> WallpaperRenderer.Style.STARFIELD
        "AURORA" -> WallpaperRenderer.Style.AURORA
        else -> WallpaperRenderer.Style.MATRIX
    }

    // --- слайдеры ---
    private fun wireSliders() {
        val speed = findViewById<SeekBar>(R.id.seekSpeed)
        val density = findViewById<SeekBar>(R.id.seekDensity)
        speed.progress = Prefs.getSpeed(this)
        density.progress = Prefs.getDensity(this)
        speed.setOnSeekBarChangeListener(object : SeekBar.OnSeekBarChangeListener {
            override fun onProgressChanged(sb: SeekBar, p: Int, fromUser: Boolean) {
                Prefs.setSpeed(this@MainActivity, p); preview.renderer.setSpeed(p)
            }
            override fun onStartTrackingTouch(sb: SeekBar) {}
            override fun onStopTrackingTouch(sb: SeekBar) {}
        })
        density.setOnSeekBarChangeListener(object : SeekBar.OnSeekBarChangeListener {
            override fun onProgressChanged(sb: SeekBar, p: Int, fromUser: Boolean) {
                Prefs.setDensity(this@MainActivity, p); preview.renderer.setDensity(p)
            }
            override fun onStartTrackingTouch(sb: SeekBar) {}
            override fun onStopTrackingTouch(sb: SeekBar) {}
        })
    }

    // --- палитра цветов ---
    private fun buildColorSwatches() {
        val row = findViewById<LinearLayout>(R.id.colorRow)
        val size = dp(40); val margin = dp(6)
        val current = Prefs.getColor(this)
        for (c in palette) {
            val v = View(this)
            val lp = LinearLayout.LayoutParams(size, size).apply { marginEnd = margin }
            v.layoutParams = lp
            v.background = swatch(c, c == current)
            v.setOnClickListener {
                Prefs.setColor(this, c)
                preview.renderer.setColorInt(c)
                for (i in 0 until row.childCount) {
                    val child = row.getChildAt(i)
                    child.background = swatch(palette[i], palette[i] == c)
                }
            }
            row.addView(v)
        }
    }

    private fun swatch(color: Int, selected: Boolean): GradientDrawable {
        val d = GradientDrawable()
        d.shape = GradientDrawable.OVAL
        d.setColor(color)
        if (selected) d.setStroke(dp(3), Color.WHITE)
        return d
    }

    // --- установка живых обоев ---
    private fun launchLive(component: ComponentName) {
        val intent = Intent(WallpaperManager.ACTION_CHANGE_LIVE_WALLPAPER).apply {
            putExtra(WallpaperManager.EXTRA_LIVE_WALLPAPER_COMPONENT, component)
        }
        try {
            startActivity(intent)
        } catch (_: Exception) {
            toast(getString(R.string.hint_live))
        }
    }

    // --- фото-обои ---
    private fun pickImage() {
        val intent = Intent(Intent.ACTION_OPEN_DOCUMENT).apply {
            addCategory(Intent.CATEGORY_OPENABLE)
            type = "image/*"
        }
        try { startActivityForResult(intent, REQ_IMAGE) }
        catch (_: Exception) { toast(getString(R.string.no_picker)) }
    }

    // --- видео-обои ---
    private fun pickVideo() {
        val intent = Intent(Intent.ACTION_OPEN_DOCUMENT).apply {
            addCategory(Intent.CATEGORY_OPENABLE)
            type = "video/*"
            addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION or Intent.FLAG_GRANT_PERSISTABLE_URI_PERMISSION)
        }
        try { startActivityForResult(intent, REQ_VIDEO) }
        catch (_: Exception) { toast(getString(R.string.no_picker)) }
    }

    override fun onActivityResult(requestCode: Int, resultCode: Int, data: Intent?) {
        super.onActivityResult(requestCode, resultCode, data)
        if (resultCode != RESULT_OK) return
        val uri = data?.data ?: return
        when (requestCode) {
            REQ_IMAGE -> applyPhoto(uri)
            REQ_VIDEO -> {
                try {
                    contentResolver.takePersistableUriPermission(uri, Intent.FLAG_GRANT_READ_URI_PERMISSION)
                } catch (_: Exception) {}
                Prefs.setVideoUri(this, uri.toString())
                launchLive(ComponentName(this, VideoWallpaperService::class.java))
            }
        }
    }

    private fun applyPhoto(uri: Uri) {
        try {
            val dm = resources.displayMetrics
            val bmp = decodeScaled(uri, dm.widthPixels, dm.heightPixels) ?: run {
                toast(getString(R.string.photo_fail)); return
            }
            WallpaperManager.getInstance(this).setBitmap(bmp)
            toast(getString(R.string.photo_ok))
        } catch (e: Exception) {
            toast(getString(R.string.photo_fail))
        }
    }

    private fun decodeScaled(uri: Uri, reqW: Int, reqH: Int) = run {
        val bounds = BitmapFactory.Options().apply { inJustDecodeBounds = true }
        contentResolver.openInputStream(uri)?.use { BitmapFactory.decodeStream(it, null, bounds) }
        var sample = 1
        var (hh, ww) = bounds.outHeight to bounds.outWidth
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
