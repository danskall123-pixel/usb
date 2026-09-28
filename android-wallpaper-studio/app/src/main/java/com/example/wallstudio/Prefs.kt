package com.example.wallstudio

import android.content.Context

/** Простое хранилище выбора пользователя, читаемое и приложением, и сервисом обоев. */
object Prefs {
    private const val NAME = "wallstudio"

    private fun sp(c: Context) = c.getSharedPreferences(NAME, Context.MODE_PRIVATE)

    fun getStyle(c: Context) = sp(c).getString("style", "MATRIX") ?: "MATRIX"
    fun setStyle(c: Context, v: String) = sp(c).edit().putString("style", v).apply()

    fun getSpeed(c: Context) = sp(c).getInt("speed", 50)
    fun setSpeed(c: Context, v: Int) = sp(c).edit().putInt("speed", v).apply()

    fun getDensity(c: Context) = sp(c).getInt("density", 50)
    fun setDensity(c: Context, v: Int) = sp(c).edit().putInt("density", v).apply()

    fun getColor(c: Context) = sp(c).getInt("color", 0xFF1EE66E.toInt())
    fun setColor(c: Context, v: Int) = sp(c).edit().putInt("color", v).apply()

    fun getIntensity(c: Context) = sp(c).getInt("intensity", 70)
    fun setIntensity(c: Context, v: Int) = sp(c).edit().putInt("intensity", v).apply()

    fun getBg(c: Context) = sp(c).getInt("bg", 0xFF04070A.toInt())
    fun setBg(c: Context, v: Int) = sp(c).edit().putInt("bg", v).apply()

    fun getVideoUri(c: Context): String? = sp(c).getString("videoUri", null)
    fun setVideoUri(c: Context, v: String?) = sp(c).edit().putString("videoUri", v).apply()
}
