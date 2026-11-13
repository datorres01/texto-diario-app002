package com.textodiario.app

import android.content.Context
import android.text.Html
import android.util.Base64
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.withContext
import okhttp3.MediaType.Companion.toMediaType
import okhttp3.OkHttpClient
import okhttp3.Request
import okhttp3.RequestBody.Companion.toRequestBody
import org.json.JSONArray
import org.json.JSONObject
import java.io.File
import java.security.MessageDigest
import java.util.concurrent.TimeUnit

data class DailyText(
    val date: String,
    val dateTitle: String,
    val themeScripture: String,
    val bodyParagraphs: List<String>,
    val spokenText: String
)

data class TtsFetchResult(
    val wavBytes: ByteArray?,
    val fromCache: Boolean,
    val errorReason: String?
)

object DailyTextRepository {

    private val httpClient: OkHttpClient by lazy {
        OkHttpClient.Builder()
            .connectTimeout(15, TimeUnit.SECONDS)
            .readTimeout(60, TimeUnit.SECONDS)
            .writeTimeout(20, TimeUnit.SECONDS)
            .followRedirects(false)
            .build()
    }

    private val wolClient: OkHttpClient by lazy {
        OkHttpClient.Builder()
            .connectTimeout(15, TimeUnit.SECONDS)
            .readTimeout(20, TimeUnit.SECONDS)
            .followRedirects(true)
            .build()
    }

    private val bibleExpansions: List<Pair<Regex, String>> = listOf(
        Regex("\\bGén\\.") to "Génesis",
        Regex("\\bÉx\\.") to "Éxodo",
        Regex("\\bLev\\.") to "Levítico",
        Regex("\\bNúm\\.") to "Números",
        Regex("\\bDeut\\.") to "Deuteronomio",
        Regex("\\bJos\\.") to "Josué",
        Regex("\\bJuec\\.") to "Jueces",
        Regex("\\b1\\s*Sam\\.") to "Primero de Samuel",
        Regex("\\b2\\s*Sam\\.") to "Segundo de Samuel",
        Regex("\\b1\\s*Rey\\.") to "Primero de Reyes",
        Regex("\\b2\\s*Rey\\.") to "Segundo de Reyes",
        Regex("\\b1\\s*Crón\\.") to "Primero de Crónicas",
        Regex("\\b2\\s*Crón\\.") to "Segundo de Crónicas",
        Regex("\\bNeh\\.") to "Nehemías",
        Regex("\\bSal\\.") to "Salmo",
        Regex("\\bProv\\.") to "Proverbios",
        Regex("\\bEcl\\.") to "Eclesiastés",
        Regex("\\bCant\\.") to "Cantar de los Cantares",
        Regex("\\bIs\\.") to "Isaías",
        Regex("\\bJer\\.") to "Jeremías",
        Regex("\\bLam\\.") to "Lamentaciones",
        Regex("\\bEzeq\\.") to "Ezequiel",
        Regex("\\bDan\\.") to "Daniel",
        Regex("\\bOs\\.") to "Oseas",
        Regex("\\bAbd\\.") to "Abdías",
        Regex("\\bMiq\\.") to "Miqueas",
        Regex("\\bNah\\.") to "Nahúm",
        Regex("\\bHab\\.") to "Habacuc",
        Regex("\\bSof\\.") to "Sofonías",
        Regex("\\bZac\\.") to "Zacarías",
        Regex("\\bMal\\.") to "Malaquías",
        Regex("\\bMat\\.") to "Mateo",
        Regex("\\bMar\\.") to "Marcos",
        Regex("\\bLuc\\.") to "Lucas",
        Regex("\\bHech\\.") to "Hechos",
        Regex("\\bRom\\.") to "Romanos",
        Regex("\\b1\\s*Cor\\.") to "Primera a los Corintios",
        Regex("\\b2\\s*Cor\\.") to "Segunda a los Corintios",
        Regex("\\bGál\\.") to "Gálatas",
        Regex("\\bEfes\\.") to "Efesios",
        Regex("\\bFilip\\.") to "Filipenses",
        Regex("\\bCol\\.") to "Colosenses",
        Regex("\\b1\\s*Tes\\.") to "Primera a los Tesalonicenses",
        Regex("\\b2\\s*Tes\\.") to "Segunda a los Tesalonicenses",
        Regex("\\b1\\s*Tim\\.") to "Primera a Timoteo",
        Regex("\\b2\\s*Tim\\.") to "Segunda a Timoteo",
        Regex("\\bFilem\\.") to "Filemón",
        Regex("\\bHeb\\.") to "Hebreos",
        Regex("\\bSant\\.") to "Santiago",
        Regex("\\b1\\s*Ped\\.") to "Primera de Pedro",
        Regex("\\b2\\s*Ped\\.") to "Segunda de Pedro",
        Regex("\\bApoc\\.") to "Apocalipsis"
    )

    fun sanitizeForSpeech(input: String): String {
        // Iteratively remove all nested parentheses () and editorial brackets []
        var cleaned = input
        var prev = ""
        val parenRegex = Regex("\\([^()]*\\)")
        val bracketRegex = Regex("\\[[^\\[\\]]*\\]")
        while (cleaned != prev) {
            prev = cleaned
            cleaned = parenRegex.replace(cleaned, " ")
            cleaned = bracketRegex.replace(cleaned, " ")
        }
        cleaned = cleaned.replace(Regex("[()\\[\\]]"), " ")

        // Remove Watchtower/publication codes (e.g., w24.11 9 párrs. 5, 6)
        cleaned = cleaned.replace(
            Regex("\\bw\\d{2}\\.\\d{2}\\b[\\s\\S]*$", RegexOption.IGNORE_CASE),
            ""
        )

        for ((pattern, replacement) in bibleExpansions) {
            cleaned = pattern.replace(cleaned, replacement)
        }

        cleaned = cleaned.replace(Regex("(\\d+):(\\d+)-(\\d+)"), "$1, versículos $2 al $3")
        cleaned = cleaned.replace(Regex("(\\d+):(\\d+)"), "$1, versículo $2")

        cleaned = cleaned
            .replace(Regex("\\s+([.,;:!?»”])"), "$1")
            .replace(Regex("([.,;:!?])\\s*\\1+"), "$1")
            .replace(Regex("\\s+"), " ")
            .trim()
        return cleaned
    }

    private fun stripHtml(rawHtml: String): String {
        val text = Html.fromHtml(rawHtml, Html.FROM_HTML_MODE_COMPACT).toString()
        return text.replace('\u00A0', ' ').replace(Regex("\\s+"), " ").trim()
    }

    private fun parseWolContentHtml(dateIso: String, contentHtml: String): DailyText {
        val h2Match = Regex("<h2[^>]*>([\\s\\S]*?)</h2>", RegexOption.IGNORE_CASE).find(contentHtml)
        val dateTitle = h2Match?.groupValues?.get(1)?.let { stripHtml(it) } ?: dateIso

        val themeMatch = Regex(
            "<p[^>]*class=\"[^\"]*themeScrp[^\"]*\"[^>]*>([\\s\\S]*?)</p>",
            RegexOption.IGNORE_CASE
        ).find(contentHtml)
        val themeScripture = themeMatch?.groupValues?.get(1)?.let { stripHtml(it) } ?: ""

        val bodyMatch = Regex(
            "<div[^>]*class=\"[^\"]*bodyTxt[^\"]*\"[^>]*>([\\s\\S]*?)</div>",
            RegexOption.IGNORE_CASE
        ).find(contentHtml)
        val bodyHtml = bodyMatch?.groupValues?.get(1) ?: ""

        val paragraphs = Regex("<p[^>]*>([\\s\\S]*?)</p>", RegexOption.IGNORE_CASE)
            .findAll(bodyHtml)
            .map { stripHtml(it.groupValues[1]) }
            .filter { it.isNotBlank() }
            .toList()

        val cleanTheme = sanitizeForSpeech(themeScripture)
        val cleanBodies = paragraphs.map { sanitizeForSpeech(it) }.filter { it.isNotBlank() }
        val spokenText = (listOf("$dateTitle.", cleanTheme) + cleanBodies)
            .filter { it.isNotBlank() }
            .joinToString(" ")
            .replace(Regex("\\s+"), " ")
            .trim()

        return DailyText(
            date = dateIso,
            dateTitle = dateTitle,
            themeScripture = themeScripture,
            bodyParagraphs = paragraphs,
            spokenText = spokenText
        )
    }

    suspend fun getDailyText(prefs: PrefsManager, dateIso: String): DailyText = withContext(Dispatchers.IO) {
        val cached = prefs.getCachedTextJson(dateIso)
        if (cached != null) {
            try {
                val decoded = decodeCachedJson(cached)
                if (decoded != null) return@withContext decoded
            } catch (_: Exception) {
            }
        }

        val parts = dateIso.split("-")
        val year = parts[0].toInt()
        val month = parts[1].toInt()
        val day = parts[2].toInt()

        val req = Request.Builder()
            .url("https://wol.jw.org/wol/dt/r4/lp-s/$year/$month/$day")
            .header(
                "User-Agent",
                "Mozilla/5.0 (Linux; Android 13) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Mobile Safari/537.36"
            )
            .build()

        wolClient.newCall(req).execute().use { resp ->
            if (!resp.isSuccessful) {
                throw RuntimeException("No se pudo obtener el texto diario (HTTP ${resp.code})")
            }
            val body = resp.body?.string() ?: throw RuntimeException("Respuesta vacía de wol.jw.org")
            val json = JSONObject(body)
            val item = json.getJSONArray("items").getJSONObject(0)
            val contentHtml = item.getString("content")
            val parsed = parseWolContentHtml(dateIso, contentHtml)

            val cacheObj = JSONObject().apply {
                put("v", 2)
                put("date", parsed.date)
                put("dateTitle", parsed.dateTitle)
                put("themeScripture", parsed.themeScripture)
                put("spokenText", parsed.spokenText)
                put("bodyParagraphs", JSONArray(parsed.bodyParagraphs))
            }
            prefs.saveCachedTextJson(dateIso, cacheObj.toString())
            parsed
        }
    }

    private fun decodeCachedJson(raw: String): DailyText? {
        val obj = JSONObject(raw)
        if (obj.optInt("v", 1) < 2) return null
        val arr = obj.getJSONArray("bodyParagraphs")
        val list = mutableListOf<String>()
        for (i in 0 until arr.length()) {
            list.add(arr.getString(i))
        }
        return DailyText(
            date = obj.getString("date"),
            dateTitle = obj.getString("dateTitle"),
            themeScripture = obj.getString("themeScripture"),
            bodyParagraphs = list,
            spokenText = sanitizeForSpeech(obj.getString("spokenText"))
        )
    }

    private fun sha256Hex(value: String): String {
        val digest = MessageDigest.getInstance("SHA-256").digest(value.toByteArray(Charsets.UTF_8))
        return digest.joinToString("") { "%02x".format(it) }
    }

    private fun getCacheDir(context: Context): File {
        val dir = File(context.filesDir, "tts_cache")
        if (!dir.exists()) dir.mkdirs()
        return dir
    }

    private fun pruneCache(dir: File) {
        val files = dir.listFiles()?.sortedByDescending { it.lastModified() } ?: return
        if (files.size > 25) {
            files.drop(25).forEach { it.delete() }
        }
    }

    suspend fun fetchGeminiTtsWav(
        context: Context,
        baseUrl: String,
        text: String,
        voiceName: String
    ): TtsFetchResult = withContext(Dispatchers.IO) {
        val cleanText = sanitizeForSpeech(text)
        if (cleanText.isBlank()) {
            return@withContext TtsFetchResult(null, false, "Texto vacío")
        }

        val cacheKey = sha256Hex("v2|$voiceName|$cleanText")
        val cacheDir = getCacheDir(context)
        val cacheFile = File(cacheDir, "$cacheKey.wav")
        if (cacheFile.exists() && cacheFile.length() > 44L) {
            return@withContext TtsFetchResult(cacheFile.readBytes(), true, null)
        }

        val cleanBase = baseUrl.trim().trimEnd('/')
        if (cleanBase.isBlank()) {
            return@withContext TtsFetchResult(null, false, "Falta la URL del servidor de voz IA.")
        }

        try {
            val payload = JSONObject().apply {
                put("text", cleanText)
                put("voiceName", voiceName)
            }.toString()

            val request = Request.Builder()
                .url("$cleanBase/api/tts")
                .post(payload.toRequestBody("application/json; charset=utf-8".toMediaType()))
                .build()

            httpClient.newCall(request).execute().use { resp ->
                if (resp.isRedirect || resp.code in listOf(301, 302, 303, 307, 308)) {
                    return@withContext TtsFetchResult(
                        null,
                        false,
                        "El enlace del servidor pide iniciar sesión. Publica tu app en AI Studio (Deploy App) y pega la URL pública."
                    )
                }

                val respBody = resp.body?.string() ?: ""
                if (!resp.isSuccessful) {
                    val reason = when (resp.code) {
                        404 -> "Servidor no publicado todavía (HTTP 404). Haz Deploy en AI Studio para activar la voz IA natural."
                        401, 403 -> "Acceso denegado al servidor (HTTP ${resp.code}). Usa la URL pública de Deploy App."
                        else -> {
                            val apiErr = try {
                                JSONObject(respBody).optString("error", "")
                            } catch (_: Exception) {
                                ""
                            }
                            if (apiErr.isNotBlank()) apiErr else "Error del servidor (HTTP ${resp.code})"
                        }
                    }
                    return@withContext TtsFetchResult(null, false, reason)
                }

                val json = JSONObject(respBody)
                val b64 = json.optString("audioBase64", "")
                if (b64.isBlank()) {
                    return@withContext TtsFetchResult(null, false, "El servidor no devolvió audio IA.")
                }

                val bytes = Base64.decode(b64, Base64.DEFAULT)
                try {
                    cacheFile.writeBytes(bytes)
                    pruneCache(cacheDir)
                } catch (_: Exception) {
                }

                TtsFetchResult(bytes, false, null)
            }
        } catch (e: Exception) {
            TtsFetchResult(null, false, e.message ?: "No se pudo conectar al servidor de voz IA.")
        }
    }

    suspend fun precacheDailyAudio(context: Context, prefs: PrefsManager, daily: DailyText) {
        fetchGeminiTtsWav(context, prefs.apiBaseUrl, "Hora de leer el texto diario.", prefs.voiceName)
        fetchGeminiTtsWav(context, prefs.apiBaseUrl, daily.spokenText, prefs.voiceName)
    }

    suspend fun checkServerHealth(baseUrl: String): Pair<Boolean, String> = withContext(Dispatchers.IO) {
        val cleanBase = baseUrl.trim().trimEnd('/')
        if (cleanBase.isBlank()) {
            return@withContext false to "Ingresa la URL de tu servidor publicado."
        }
        try {
            val req = Request.Builder().url("$cleanBase/api/health").get().build()
            httpClient.newCall(req).execute().use { resp ->
                if (resp.isRedirect) {
                    return@withContext false to "Este enlace pide inicio de sesión de Google. Usa la URL pública de Deploy App."
                }
                if (!resp.isSuccessful) {
                    return@withContext false to when (resp.code) {
                        404 -> "Servidor no publicado (HTTP 404). En AI Studio presiona Deploy App para activarlo."
                        else -> "El servidor respondió con código HTTP ${resp.code}."
                    }
                }
                val body = resp.body?.string() ?: "{}"
                val json = JSONObject(body)
                val hasKey = json.optBoolean("hasGeminiKey", true)
                if (hasKey) {
                    true to "Conectado a Voz IA natural ✓"
                } else {
                    false to "Servidor activo, pero falta GEMINI_API_KEY en el servidor."
                }
            }
        } catch (e: Exception) {
            false to "Sin conexión: ${e.message ?: "verifica tu internet o la URL"}"
        }
    }

    suspend fun sendChatMessage(
        baseUrl: String,
        message: String,
        dailyContext: String,
        history: List<Pair<String, String>>
    ): Result<Pair<String, String>> = withContext(Dispatchers.IO) {
        val cleanBase = baseUrl.trim().trimEnd('/')
        if (cleanBase.isBlank()) {
            return@withContext Result.failure(IllegalStateException("Configura la URL del servidor primero."))
        }
        try {
            val historyArray = JSONArray()
            for ((role, text) in history.takeLast(8)) {
                historyArray.put(JSONObject().apply {
                    put("role", role)
                    put("text", text)
                })
            }

            val payload = JSONObject().apply {
                put("message", message)
                put("dailyContext", dailyContext)
                put("history", historyArray)
            }.toString()

            val req = Request.Builder()
                .url("$cleanBase/api/chat")
                .post(payload.toRequestBody("application/json; charset=utf-8".toMediaType()))
                .build()

            httpClient.newCall(req).execute().use { resp ->
                if (resp.isRedirect) {
                    return@withContext Result.failure(
                        IllegalStateException("El servidor requiere URL pública de Deploy App en AI Studio.")
                    )
                }
                val body = resp.body?.string() ?: ""
                if (!resp.isSuccessful) {
                    val err = try {
                        JSONObject(body).optString("error", "")
                    } catch (_: Exception) {
                        ""
                    }
                    val msg = if (err.isNotBlank()) err else "Error del servidor (HTTP ${resp.code})"
                    return@withContext Result.failure(IllegalStateException(msg))
                }
                val json = JSONObject(body)
                val reply = json.optString("reply", "")
                val spokenReply = sanitizeForSpeech(json.optString("spokenReply", reply))
                if (reply.isBlank()) {
                    Result.failure(IllegalStateException("Respuesta vacía del asistente."))
                } else {
                    Result.success(reply to spokenReply)
                }
            }
        } catch (e: Exception) {
            Result.failure(e)
        }
    }
}
