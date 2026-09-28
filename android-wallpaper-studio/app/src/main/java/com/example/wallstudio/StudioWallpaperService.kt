package com.example.wallstudio

import android.content.Context
import android.graphics.Canvas
import android.os.Handler
import android.os.Looper
import android.os.PowerManager
import android.service.wallpaper.WallpaperService
import android.view.SurfaceHolder

/**
 * Живые обои с настраиваемым стилем (матрица / звёзды / аврора).
 * Настройки берутся из [Prefs] и перечитываются при каждом показе, поэтому
 * изменения в редакторе применяются, когда обои снова становятся видимыми.
 * Рисуем только пока видимы; в энергосбережении снижаем частоту кадров.
 */
class StudioWallpaperService : WallpaperService() {

    override fun onCreateEngine(): Engine = StudioEngine()

    private inner class StudioEngine : Engine() {

        private val renderer = WallpaperRenderer()
        private val handler = Handler(Looper.getMainLooper())
        private val drawRunnable = Runnable { tick() }

        private var visible = false
        private var interval = 66L
        private var powerManager: PowerManager? = null

        private var sized = false
        private var appliedStyle = ""
        private var appliedDensity = -1

        override fun onCreate(holder: SurfaceHolder) {
            super.onCreate(holder)
            setOffsetNotificationsEnabled(false)
            powerManager =
                this@StudioWallpaperService.getSystemService(Context.POWER_SERVICE) as? PowerManager
        }

        override fun onVisibilityChanged(visible: Boolean) {
            this.visible = visible
            if (visible) {
                interval = if (powerManager?.isPowerSaveMode == true) 120L else 66L
                applyPrefs()
                schedule()
            } else {
                handler.removeCallbacks(drawRunnable)
            }
        }

        override fun onSurfaceChanged(holder: SurfaceHolder, format: Int, width: Int, height: Int) {
            super.onSurfaceChanged(holder, format, width, height)
            renderer.setup(width, height)
            sized = true
            appliedStyle = ""; appliedDensity = -1   // заставит applyPrefs заново настроить
            applyPrefs()
        }

        override fun onSurfaceDestroyed(holder: SurfaceHolder) {
            super.onSurfaceDestroyed(holder)
            visible = false
            handler.removeCallbacks(drawRunnable)
            renderer.release()
            sized = false
        }

        override fun onDestroy() {
            super.onDestroy()
            handler.removeCallbacks(drawRunnable)
            renderer.release()
        }

        private fun applyPrefs() {
            if (!sized) return
            val ctx = this@StudioWallpaperService
            val styleName = Prefs.getStyle(ctx)
            val density = Prefs.getDensity(ctx)
            renderer.setSpeed(Prefs.getSpeed(ctx))
            renderer.setIntensity(Prefs.getIntensity(ctx))
            renderer.setBgInt(Prefs.getBg(ctx))
            renderer.setColorInt(Prefs.getColor(ctx))
            if (styleName != appliedStyle) {
                renderer.changeStyle(WallpaperRenderer.styleFromName(styleName))
                appliedStyle = styleName
            }
            if (density != appliedDensity) {
                renderer.setDensity(density)
                appliedDensity = density
            }
        }

        private fun schedule() {
            handler.removeCallbacks(drawRunnable)
            if (visible) handler.postDelayed(drawRunnable, interval)
        }

        private fun tick() {
            renderer.frame()
            val holder = surfaceHolder
            var canvas: Canvas? = null
            try {
                canvas = holder.lockCanvas()
                if (canvas != null) renderer.buffer?.let { canvas.drawBitmap(it, 0f, 0f, null) }
            } catch (_: Exception) {
            } finally {
                if (canvas != null) {
                    try { holder.unlockCanvasAndPost(canvas) } catch (_: Exception) {}
                }
            }
            schedule()
        }
    }
}
