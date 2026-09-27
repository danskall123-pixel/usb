# Matrix Rain — живые обои для Android / GrapheneOS

Нативные живые обои: зелёный «цифровой дождь» (как в демо-версии на canvas),
нарисованный на `Canvas` через стандартный `WallpaperService`.

- **Без Google, без сети, без зависимостей** — только Android-фреймворк.
- Рисует кадры, только пока обои видимы (гаснет экран / открыто приложение →
  цикл останавливается), чтобы экономить батарею.
- `minSdk 26` (Android 8.0+) — покрывает все актуальные Pixel и GrapheneOS.

> Собрать APK «одним кликом» здесь нельзя: нужен Android SDK. Ниже — два способа
> сборки. Оба дают файл `app-debug.apk`, который ставится на телефон.

---

## Способ A. Android Studio (проще всего)

1. Установи **Android Studio** (Windows/Linux/macOS). Внутри уже есть Android SDK
   и подходящий JDK — ничего отдельно ставить не нужно.
2. **Open** → выбери папку `android-matrix-wallpaper`. Дождись Gradle sync
   (Studio сама скачает Gradle 8.9, AGP и Kotlin, создаст `local.properties`).
3. Меню **Build → Build App Bundle(s) / APK(s) → Build APK(s)**.
4. По окончании нажми **locate** — там лежит
   `app/build/outputs/apk/debug/app-debug.apk`.

## Способ B. Командная строка

Нужен установленный **Android SDK** и **JDK 17+**.

1. Укажи путь к SDK одним из двух способов:
   - переменная окружения `ANDROID_HOME` (или `ANDROID_SDK_ROOT`), **либо**
   - файл `local.properties` в папке `android-matrix-wallpaper`:
     ```properties
     sdk.dir=/абсолютный/путь/к/Android/Sdk
     ```
2. Собери debug-APK (обёртка сама подтянет Gradle 8.9):
   ```bash
   cd android-matrix-wallpaper
   ./gradlew assembleDebug          # Windows: gradlew.bat assembleDebug
   ```
3. Готовый файл: `app/build/outputs/apk/debug/app-debug.apk`.

> Нет SDK, а Studio ставить не хочешь? Поставь только **command-line tools**
> и выполни:
> `sdkmanager "platform-tools" "platforms;android-34" "build-tools;34.0.0"`,
> затем пропиши путь в `sdk.dir` и собери как выше.

---

## Установка на GrapheneOS (и любой Android)

`app-debug.apk` подписан отладочным ключом — для личного использования это норм.

**Вариант 1 — просто скопировать файл:**
1. Перекинь `app-debug.apk` на телефон (USB, облако, `adb push` — как удобно).
2. Открой файл во встроенном файловом менеджере → **Установить**.
3. GrapheneOS спросит разрешение «устанавливать из этого источника» — разреши
   (можно потом отозвать в настройках).

**Вариант 2 — через ADB** (включи «Отладку по USB» в настройках разработчика):
```bash
adb install app/build/outputs/apk/debug/app-debug.apk
```

## Как включить обои

- Открой приложение **Matrix Rain** из списка приложений — оно сразу откроет
  системный экран предпросмотра с кнопкой **«Установить обои»**.
- Либо вручную: **Настройки → Обои → Живые обои → Matrix Rain**
  (или долгое нажатие на рабочем столе → *Обои* → *Живые обои*).

---

## Что где лежит

```
android-matrix-wallpaper/
├── settings.gradle.kts / build.gradle.kts / gradle.properties
├── gradlew, gradlew.bat, gradle/wrapper/       # Gradle-обёртка (8.9)
└── app/
    ├── build.gradle.kts
    └── src/main/
        ├── AndroidManifest.xml
        ├── java/com/example/matrixwallpaper/
        │   ├── MatrixWallpaperService.kt        # вся логика дождя
        │   └── MainActivity.kt                  # ярлык: открыть предпросмотр
        └── res/
            ├── values/strings.xml, colors.xml
            ├── drawable/ic_launcher_foreground.xml, wallpaper_thumb.xml
            ├── mipmap-anydpi-v26/ic_launcher.xml
            └── xml/wallpaper.xml
```

### Что подкрутить

Всё — в `MatrixWallpaperService.kt`:
- **частота кадров** — `frameIntervalMs` (66 мс ≈ 15 fps; в энергосбережении 120 мс);
- **скорость падения колонок** — диапазон в `randomSpeed()` (строк за кадр);
- **цвета** — `headPaint` (голова), `bodyPaint` (хвост), `bgColor` (фон);
- **длина хвоста** — альфа у `fadePaint` (меньше альфа = длиннее хвост);
- **размер символов** — делитель в `fontSize = (width / 28f)`;
- **набор символов** — строка `glyphs`.

Против мерцания кадр рисуется в offscreen-`Bitmap` и целиком копируется на экран,
поэтому эффект «затухания» не зависит от буферизации поверхности.
