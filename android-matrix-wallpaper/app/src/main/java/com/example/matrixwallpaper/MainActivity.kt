package com.example.matrixwallpaper

import android.app.Activity
import android.app.WallpaperManager
import android.content.ComponentName
import android.content.Intent
import android.os.Bundle
import android.widget.Toast

/**
 * Невидимая активность-ярлык. По тапу по иконке приложения сразу открывает
 * системный экран предпросмотра именно этих живых обоев с кнопкой «Установить».
 * Если система не поддержала прямой предпросмотр — подсказываем путь вручную.
 */
class MainActivity : Activity() {

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)

        val intent = Intent(WallpaperManager.ACTION_CHANGE_LIVE_WALLPAPER).apply {
            putExtra(
                WallpaperManager.EXTRA_LIVE_WALLPAPER_COMPONENT,
                ComponentName(this@MainActivity, MatrixWallpaperService::class.java)
            )
        }

        try {
            startActivity(intent)
        } catch (_: Exception) {
            Toast.makeText(this, getString(R.string.open_picker_hint), Toast.LENGTH_LONG).show()
        }

        finish()
    }
}
