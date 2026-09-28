package com.example.wallstudio

import android.media.MediaPlayer
import android.net.Uri
import android.service.wallpaper.WallpaperService
import android.view.SurfaceHolder

/**
 * Живые обои из выбранного пользователем видео: зацикленное воспроизведение
 * без звука на поверхность обоев. Пауза, когда обои не видны.
 * URI видео хранится в [Prefs] (с постоянным разрешением на чтение).
 */
class VideoWallpaperService : WallpaperService() {

    override fun onCreateEngine(): Engine = VideoEngine()

    private inner class VideoEngine : Engine() {

        private var player: MediaPlayer? = null
        private var visible = false

        override fun onSurfaceCreated(holder: SurfaceHolder) {
            super.onSurfaceCreated(holder)
            val uriStr = Prefs.getVideoUri(this@VideoWallpaperService) ?: return
            try {
                player = MediaPlayer().apply {
                    setSurface(holder.surface)
                    setDataSource(this@VideoWallpaperService, Uri.parse(uriStr))
                    isLooping = true
                    setVolume(0f, 0f)          // обои без звука
                    setOnPreparedListener { mp ->
                        if (visible) runCatching { mp.start() }
                    }
                    setOnErrorListener { _, _, _ -> true }
                    prepareAsync()
                }
            } catch (_: Exception) {
                player = null
            }
        }

        override fun onVisibilityChanged(visible: Boolean) {
            this.visible = visible
            val p = player ?: return
            try {
                if (visible) { if (!p.isPlaying) p.start() }
                else { if (p.isPlaying) p.pause() }
            } catch (_: Exception) {}
        }

        override fun onSurfaceDestroyed(holder: SurfaceHolder) {
            super.onSurfaceDestroyed(holder)
            visible = false
            releasePlayer()
        }

        override fun onDestroy() {
            super.onDestroy()
            releasePlayer()
        }

        private fun releasePlayer() {
            player?.let {
                runCatching { it.stop() }
                runCatching { it.release() }
            }
            player = null
        }
    }
}
