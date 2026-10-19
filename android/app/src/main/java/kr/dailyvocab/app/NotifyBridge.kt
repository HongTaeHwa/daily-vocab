package kr.dailyvocab.app

import android.Manifest
import android.app.Activity
import android.content.pm.PackageManager
import android.os.Build
import android.webkit.JavascriptInterface
import androidx.core.app.NotificationManagerCompat
import androidx.core.content.ContextCompat
import java.util.concurrent.CountDownLatch
import java.util.concurrent.TimeUnit
import org.json.JSONObject

/**
 * 웹앱의 알림 켜기(family.js enableNotify·nativeSchedule)를 안드로이드 로컬 알림(NotifyScheduler)으로 연결한다(window.AndroidNotify).
 * assets/bridge.js 가 이것을 웹앱이 아는 계약 window.DailyVocabNotify = {available, permission(), schedule(o), skipToday(kind), cancel()} 으로 감싼다.
 * 웹앱은 permission() 의 결과를 바로(동기로) 읽으므로, Android 13+ 에서 권한을 물어야 하면 대화상자의 답을 기다렸다가 돌려준다.
 * (@JavascriptInterface 는 UI 스레드가 아닌 JavaBridge 스레드에서 불리므로 기다려도 대화상자는 뜬다. 60초 안에 답이 없으면 그때 상태를 돌려준다.)
 */
class NotifyBridge(
    private val activity: Activity,
    private val requestPermission: () -> Unit,
) {
    @Volatile
    private var waiting: CountDownLatch? = null

    /** 알림 권한: 필요하면 묻고 "granted" | "denied" 를 돌려준다(앱 알림이 꺼져 있어도 "denied"). */
    @JavascriptInterface
    fun permission(): String {
        if (Build.VERSION.SDK_INT >= 33 && !hasPostPermission()) {
            val latch = CountDownLatch(1)
            waiting = latch
            activity.runOnUiThread {
                try {
                    requestPermission()
                } catch (e: Exception) {
                    latch.countDown()
                }
            }
            try {
                latch.await(60, TimeUnit.SECONDS)
            } catch (e: InterruptedException) {
                Thread.currentThread().interrupt()
            }
            waiting = null
        }
        val enabled = (Build.VERSION.SDK_INT < 33 || hasPostPermission()) && NotificationManagerCompat.from(activity).areNotificationsEnabled()
        return if (enabled) "granted" else "denied"
    }

    /** MainActivity 의 권한 요청 결과(허용·거부 모두). */
    fun onPermissionResult() {
        waiting?.countDown()
    }

    /** 웹앱의 시각을 받아 알람을 건다. JSON {daily:{enabled, hour}|null, reminder:{hour}|null}. */
    @JavascriptInterface
    fun schedule(json: String) {
        val o = try {
            JSONObject(json)
        } catch (e: Exception) {
            return
        }
        val daily = o.optJSONObject("daily")
        val dailyHour = if (daily != null && daily.optBoolean("enabled", false)) hourOf(daily) else null
        val reminderHour = o.optJSONObject("reminder")?.let { hourOf(it) }
        NotifyScheduler.configure(activity.applicationContext, dailyHour, reminderHour)
    }

    /** 오늘은 이 알림(daily | reminder)을 띄우지 않는다. 웹앱은 시험을 끝내면 "reminder" 로 부른다. */
    @JavascriptInterface
    fun skipToday(kind: String) {
        NotifyScheduler.skipToday(activity.applicationContext, kind)
    }

    /** 알림을 모두 끈다. */
    @JavascriptInterface
    fun cancel() {
        NotifyScheduler.disable(activity.applicationContext)
    }

    private fun hourOf(o: JSONObject): Int? {
        if (!o.has("hour") || o.isNull("hour")) return null
        val hour = o.optInt("hour", -1)
        return if (hour in 0..23) hour else null
    }

    private fun hasPostPermission() =
        ContextCompat.checkSelfPermission(activity, Manifest.permission.POST_NOTIFICATIONS) == PackageManager.PERMISSION_GRANTED
}
