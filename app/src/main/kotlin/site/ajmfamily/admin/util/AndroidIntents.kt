package site.ajmfamily.admin.util

import android.content.Context
import android.content.Intent
import android.net.Uri
import androidx.core.content.FileProvider
import java.io.File

/** Writes [csv] to a cache file and opens the share sheet for it (the Android analogue of "Export CSV"). */
fun shareCsv(context: Context, filename: String, csv: String) {
    val dir = File(context.cacheDir, "exports").apply { mkdirs() }
    val file = File(dir, filename)
    file.writeText(csv)
    val uri = FileProvider.getUriForFile(context, "${context.packageName}.fileprovider", file)
    val intent = Intent(Intent.ACTION_SEND).apply {
        type = "text/csv"
        putExtra(Intent.EXTRA_STREAM, uri)
        addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION)
    }
    context.startActivity(Intent.createChooser(intent, "Export CSV"))
}

/** Opens a WhatsApp chat pre-filled with [message] — the same wa.me deep link admin.html uses. */
fun openWhatsApp(context: Context, phone: String, message: String) {
    val digits = phone.filter { it.isDigit() }
    if (digits.isEmpty()) return
    val uri = Uri.parse("https://wa.me/$digits?text=${Uri.encode(message)}")
    context.startActivity(Intent(Intent.ACTION_VIEW, uri))
}
