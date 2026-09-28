package com.example.wallstudio

import android.content.Context
import android.graphics.Canvas
import android.os.Handler
import android.os.Looper
import android.util.AttributeSet
import android.view.View

/** Живое превью эффекта прямо в редакторе (использует тот же [WallpaperRenderer]). */
class PreviewView @JvmOverloads constructor(
    context: Context, attrs: AttributeSet? = null
) : View(context, attrs) {

    val renderer = WallpaperRenderer()
    private val handler = Handler(Looper.getMainLooper())
    private var running = false

    private val tick = object : Runnable {
        override fun run() {
            renderer.frame()
            invalidate()
            if (running) handler.postDelayed(this, 66L)
        }
    }

    override fun onSizeChanged(w: Int, h: Int, ow: Int, oh: Int) {
        super.onSizeChanged(w, h, ow, oh)
        renderer.setup(w, h)
    }

    override fun onDraw(canvas: Canvas) {
        renderer.buffer?.let { canvas.drawBitmap(it, 0f, 0f, null) }
    }

    private fun start() {
        if (running) return
        running = true
        handler.post(tick)
    }

    private fun stop() {
        running = false
        handler.removeCallbacks(tick)
    }

    override fun onWindowVisibilityChanged(visibility: Int) {
        super.onWindowVisibilityChanged(visibility)
        if (visibility == VISIBLE) start() else stop()
    }

    override fun onDetachedFromWindow() {
        super.onDetachedFromWindow()
        stop()
        renderer.release()
    }
}
